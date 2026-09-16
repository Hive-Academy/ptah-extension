import type { ElementHandle, Page } from '@playwright/test';
import type {
  LongTaskAttribution,
  LongTaskEntry,
  TraceEvent,
} from './perf-diagnostics';

export type PageContext = ReturnType<Page['context']>;
export type CDPSession = Awaited<ReturnType<PageContext['newCDPSession']>>;

export interface DomNodeSample {
  readonly count: number;
  readonly allMarkersPresent: boolean;
}

export interface OpenTilesResult {
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly settled: boolean;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly wallMs: number;
  readonly clickTimes: number[];
  readonly markerTimes: number[];
  readonly replayingDom: DomNodeSample | null;
  readonly settledDomCount: number;
}

export interface RafAttributionRow {
  readonly callSite: string;
  readonly count: number;
}

export interface TraceCapture {
  readonly session: CDPSession;
  readonly events: TraceEvent[];
  readonly completed: Promise<void>;
}

export async function installLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __ptahLongTasks?: LongTaskEntry[];
      __ptahLongTaskObserver?: PerformanceObserver;
    };
    w.__ptahLongTasks = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const withAttribution = entry as unknown as {
          attribution?: LongTaskAttribution[];
        };
        (w.__ptahLongTasks ?? []).push({
          startTime: entry.startTime,
          duration: entry.duration,
          name: entry.name,
          attribution: (withAttribution.attribution ?? []).map((a) => ({
            containerType: a.containerType ?? '',
            containerSrc: a.containerSrc ?? '',
            containerId: a.containerId ?? '',
            containerName: a.containerName ?? '',
          })),
        });
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
    w.__ptahLongTaskObserver = observer;
  });
}

export async function collectLongTasks(page: Page): Promise<LongTaskEntry[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __ptahLongTasks?: LongTaskEntry[];
      __ptahLongTaskObserver?: PerformanceObserver;
    };
    w.__ptahLongTaskObserver?.disconnect();
    return w.__ptahLongTasks ?? [];
  });
}

function installRafAttributionInPage(): void {
  const w = window as unknown as {
    __ptahRafAttributionInstalled?: boolean;
    __ptahRafAttribution?: Record<string, number>;
  };
  if (w.__ptahRafAttributionInstalled) return;
  w.__ptahRafAttributionInstalled = true;
  w.__ptahRafAttribution = {};
  const original = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function ptahRequestAnimationFrame(
    callback: FrameRequestCallback,
  ): number {
    const lines = new Error().stack?.split('\n').slice(1) ?? [];
    const frame =
      lines
        .find(
          (line) =>
            !line.includes('ptahRequestAnimationFrame') &&
            !line.includes('installRafAttributionInPage'),
        )
        ?.trim() ?? '(unknown)';
    const counts = w.__ptahRafAttribution ?? {};
    counts[frame] = (counts[frame] ?? 0) + 1;
    w.__ptahRafAttribution = counts;
    return original(callback);
  };
}

/** Installs the diagnostic rAF call-site wrapper for this and future documents. */
export async function installRafAttribution(page: Page): Promise<void> {
  await page.addInitScript(installRafAttributionInPage);
  await page.evaluate(installRafAttributionInPage);
}

export async function collectRafAttribution(
  page: Page,
): Promise<RafAttributionRow[]> {
  return page.evaluate(() => {
    const counts = (
      window as unknown as { __ptahRafAttribution?: Record<string, number> }
    ).__ptahRafAttribution;
    return Object.entries(counts ?? {})
      .map(([callSite, count]) => ({ callSite, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  });
}

/** Starts the permanent FU-22d trace capture around the measured window. */
export async function startTraceCapture(page: Page): Promise<TraceCapture> {
  const session = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => {
    complete = resolve;
  });
  session.on('Tracing.dataCollected', (payload) => {
    events.push(...(payload.value as unknown as TraceEvent[]));
  });
  session.on('Tracing.tracingComplete', () => complete());
  await session.send('Tracing.start', {
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'blink.user_timing',
      'v8.execute',
      'disabled-by-default-v8.compile',
      'sampling-frequency=10000',
    ].join(','),
    options: 'sampling-frequency=10000',
    transferMode: 'ReportEvents',
  });
  return { session, events, completed };
}

export async function stopTraceCapture(
  capture: TraceCapture,
): Promise<TraceEvent[]> {
  await capture.session.send('Tracing.end');
  await capture.completed;
  await capture.session.detach();
  return capture.events;
}

/**
 * Clicks every button and waits for every marker to appear, ENTIRELY inside
 * one `page.evaluate` call: a native `HTMLElement.click()` per button (the
 * same click event Angular's zone-patched listener reacts to — not
 * Playwright's `.click()`, which runs hit-testing/visibility/animation
 * actionability checks first) and a single `MutationObserver` resolving a
 * Promise once every marker string is found. No Playwright-side polling, no
 * locator resolution, runs during this call — that is the entire point: the
 * long-task window this wraps measures the app, not the test harness.
 *
 * Clicks are separated by one `requestAnimationFrame` yield to preserve the
 * harness's disclosed stress cadence. This is a deliberate pacing choice, not
 * a workaround for the single-slot bug fixed by TASK_2026_453 C3.
 * The spec header is the canonical incident write-up; keep this capture helper
 * focused on the scheduling contract it must implement.
 *
 * After all markers appear, the observer is scoped to canvas tile subtrees.
 * The measurement closes after 1,000 ms without a tile mutation, capped at
 * 10 seconds after the final marker.
 */
export async function openTilesWithinPage(
  page: Page,
  buttons: ElementHandle<HTMLElement>[],
  markers: string[],
  timeoutMs = 30_000,
): Promise<OpenTilesResult> {
  return page.evaluate(
    async ({ buttons, markers, timeoutMs }) => {
      const remaining = new Set(markers);
      const markerTimeByValue = new Map<string, number>();
      const clickTimes: number[] = [];
      let replayingDom: DomNodeSample | null = null;
      let finished = false;
      let quietId: ReturnType<typeof setTimeout> | undefined;
      let settleCapId: ReturnType<typeof setTimeout> | undefined;
      let resolveDone!: (result: OpenTilesResult) => void;
      const donePromise = new Promise<OpenTilesResult>((resolve) => {
        resolveDone = resolve;
      });
      let windowStartMs = 0;

      const domCount = (): number =>
        document.querySelectorAll('[data-testid="canvas-tile"] *').length;

      function finish(ok: boolean, timedOut: boolean, settled: boolean): void {
        if (finished) return;
        finished = true;
        observer.disconnect();
        clearTimeout(markerTimeoutId);
        if (quietId !== undefined) clearTimeout(quietId);
        if (settleCapId !== undefined) clearTimeout(settleCapId);
        const windowEndMs = performance.now();
        resolveDone({
          ok,
          timedOut,
          settled,
          windowStartMs,
          windowEndMs,
          wallMs: windowEndMs - windowStartMs,
          clickTimes,
          markerTimes: markers.map(
            (marker) => markerTimeByValue.get(marker) ?? Number.NaN,
          ),
          replayingDom,
          settledDomCount: domCount(),
        });
      }

      function resetQuietTimer(): void {
        if (quietId !== undefined) clearTimeout(quietId);
        quietId = setTimeout(() => finish(true, false, true), 1_000);
      }

      function beginSettleWindow(): void {
        observer.disconnect();
        for (const tile of Array.from(
          document.querySelectorAll('[data-testid="canvas-tile"]'),
        )) {
          observer.observe(tile, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });
        }
        resetQuietTimer();
        settleCapId = setTimeout(() => finish(true, false, false), 10_000);
      }

      function recordMarkers(text: string): boolean {
        let found = false;
        for (const marker of [...remaining]) {
          if (!text.includes(marker)) continue;
          remaining.delete(marker);
          markerTimeByValue.set(marker, performance.now());
          found = true;
        }
        return found;
      }

      function afterMarkerScan(found: boolean): void {
        if (found && replayingDom === null) {
          replayingDom = {
            count: domCount(),
            allMarkersPresent: remaining.size === 0,
          };
        }
        if (remaining.size === 0 && settleCapId === undefined) {
          clearTimeout(markerTimeoutId);
          beginSettleWindow();
        }
      }

      function scanMutations(records: MutationRecord[]): void {
        if (remaining.size === 0) {
          resetQuietTimer();
          return;
        }
        let found = false;
        // A first version scanned `document.body.textContent` (the WHOLE
        // accumulated DOM) on every MutationObserver callback. That cost grows
        // with the DOM already inserted, so by the time the 3rd tile is
        // streaming in past ~190 turns from the first two, each callback was
        // re-serializing megabytes of text — a re-profile found this single
        // harness-introduced function costing ~2 s (~20% of sampled CPU) on its
        // own, once Playwright's own locator engine had already been removed
        // from the window. Fixed: only inspect the mutation records themselves
        // (`addedNodes` / the mutated `characterData` node's own text), which
        // costs O(what changed), not O(everything so far).
        for (const record of records) {
          if (record.type === 'characterData') {
            found = recordMarkers(record.target.textContent ?? '') || found;
            continue;
          }
          for (let i = 0; i < record.addedNodes.length; i++) {
            found =
              recordMarkers(record.addedNodes[i].textContent ?? '') || found;
          }
        }
        afterMarkerScan(found);
      }

      function scanWholeBody(): void {
        // Only used for the manual post-click checks below — whole-body is
        // fine here since it runs at most once per click, not once per mutation.
        const found = recordMarkers(document.body.textContent ?? '');
        afterMarkerScan(found);
      }

      const observer = new MutationObserver(scanMutations);
      const markerTimeoutId = setTimeout(
        () => finish(false, true, false),
        timeoutMs,
      );
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      windowStartMs = performance.now();
      for (const btn of buttons) {
        clickTimes.push(performance.now());
        btn.click();
        // Disclosed FU-22a stress cadence; retained until the product queue lands.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        scanWholeBody();
      }

      return donePromise;
    },
    { buttons, markers, timeoutMs },
  );
}

export interface ScrollSanityFailure {
  readonly marker: string;
  readonly reason: string;
  readonly distanceFromBottom?: number;
}

/** Checks tile ownership and near-bottom scroll state outside the perf window. */
export async function checkTileScrollSanity(
  page: Page,
  markers: readonly string[],
): Promise<ScrollSanityFailure[]> {
  return page.evaluate((expectedMarkers) => {
    const tiles = Array.from(
      document.querySelectorAll('[data-testid="canvas-tile"]'),
    );
    const failures: ScrollSanityFailure[] = [];
    for (const marker of expectedMarkers) {
      const tile = tiles.find((candidate) =>
        (candidate.textContent ?? '').includes(marker),
      );
      if (!tile) {
        failures.push({ marker, reason: 'marker not found in any tile' });
        continue;
      }
      const scroll = tile.querySelector(
        '.chat-scroll-container',
      ) as HTMLElement | null;
      if (!scroll) {
        failures.push({ marker, reason: 'chat scroll container not found' });
        continue;
      }
      const distanceFromBottom =
        scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
      if (distanceFromBottom > 120) {
        failures.push({
          marker,
          reason: 'tile is more than 120 px from the bottom',
          distanceFromBottom,
        });
      }
    }
    return failures;
  }, markers);
}
