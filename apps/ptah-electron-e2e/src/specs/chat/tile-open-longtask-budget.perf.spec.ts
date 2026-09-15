import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ElementHandle, Page } from '@playwright/test';
import { test, expect } from '../../support/fixtures';
import type { UiDriver } from '../../support/ui-driver';
import {
  bucketByClick,
  summarizeCpuProfile,
  type CpuProfile,
  type CpuProfileSummary,
  type LongTaskAttribution,
  type LongTaskEntry,
} from '../../support/perf-diagnostics';

type PageContext = ReturnType<Page['context']>;
/** The CDP session type Playwright doesn't export a top-level name for. */
type CDPSession = Awaited<ReturnType<PageContext['newCDPSession']>>;

/**
 * AC-11 perf spec (TASK_2026_437 P4, Batch 22) — opening 3 tiles of a
 * 2,000-event session must not block the renderer main thread.
 *
 * `SessionHistoryReplayer` (Batch 20) replays a resumed session's `events` in
 * chunks of 250 with a `yieldToMacrotask` between chunks, and
 * `finalizeSessionHistory` (Batch 19, C16) indexes message boundaries and
 * trees in one pass instead of a per-message `find`. This spec is the
 * end-to-end proof that those two changes keep three concurrent resumes off
 * the renderer's long-task budget, measured with the browser's own
 * `PerformanceObserver('longtask')` against the real running app (no test
 * double for the observer or the renderer that hosts the tiles).
 *
 * Budgets (implementation-plan.md AC-11): no single renderer long task over
 * 200 ms; total long-task blocked time across the whole open-3-tiles window
 * at most 1,500 ms. If a run misses either budget, the spec reports the
 * measured numbers and FAILS — it must not loosen the budget to pass; a miss
 * here is evidence for Q6 (tail-paged session history), not a reason to widen
 * the gate. The hard assertion against these budgets lives ONLY on the first
 * test below ("cold: opening 3 tiles ..."); the warm-up/1-tile/3-tile-warm
 * tests further down are diagnostic measurements for Q6 and do not gate.
 *
 * ── Why three SEPARATE sessions, not one session opened three times ────────
 * `CanvasStore.addTileFromSession` focuses the existing tile instead of
 * creating a duplicate when a tile for that session id is already open
 * (`canvas.store.ts` `addTileFromSession`), so re-requesting the same session
 * id three times would open exactly one tile, not three. AC-11's "3 tiles of
 * a 2,000-event session" is read here as three tiles, each carrying its own
 * ~2,000-event history of the same shape and size (so ~6,000 total events
 * across the 3 tiles, not one 2,000-event session shared by all 3) — the
 * worst case the renderer actually has to survive when a user opens three
 * heavy sessions at once.
 *
 * ── How a tile opens on an EXISTING session in this harness ─────────────────
 * The sidebar session list's `onSessionClick` (`app-shell.component.ts`) calls
 * `AppStateManager.requestCanvasSession(sessionId, name)` in grid layout mode
 * (the Electron shell forces grid mode), which `OrchestraCanvasComponent`
 * picks up and turns into `canvasStore.addTileFromSession` +
 * `chatStore.switchSession` — the same `chat:resume` RPC path a real
 * session-history open takes. `ui.goto('canvas')` (not `'chat'`) is used to
 * reach the canvas grid without `ensureCanvasChatTile` creating an unrelated
 * extra draft tile.
 *
 * ── Fixture ─────────────────────────────────────────────────────────────────
 * `buildLargeSessionEvents` generates a deterministic (seeded) ~2,000-event
 * mix of message_start / text_delta / tool_start / tool_result /
 * message_complete across ~150-190 turns per session — the same event shapes
 * `largeFixture` in `message-finalization.session-history.spec.ts` (Batch 19)
 * uses, restated here as a flat chronological array (the shape `chat:resume`
 * actually returns) rather than a pre-built `StreamingState`. Each session's
 * final assistant turn carries a unique marker so the test can assert each
 * tile rendered ITS OWN last message, not a stale/duplicate one. Fixture text
 * is short and markup-free ('ok' tool outputs, one-line deltas) — cheaper per
 * event than a real session with fenced code/long markdown through
 * `libs/frontend/markdown`, so if anything this understates real cost.
 *
 * ── What this measurement does NOT represent (see test-report-b22.md) ──────
 * - **Development renderer build.** The `e2e` target's `dependsOn`
 *   (`apps/ptah-electron-e2e/project.json`) builds `ptah-electron` via
 *   `build-dev` + `copy-renderer-dev`, which builds the Angular webview with
 *   `--configuration=development` (`apps/ptah-electron/project.json:324`) —
 *   unminified, no AOT prod optimizations, Angular dev-mode checks active.
 *   Every run in this file (unless a production build was manually swapped in
 *   for one comparison run — see the report) measures a build nobody ships.
 * - **Fresh app, no warm-up**, for the first ("cold") test: `fixtures.ts`
 *   launches a brand-new `ElectronApplication` per test, so the very first
 *   tile populated in that test may pay one-time module-eval/JIT cost the
 *   2nd and 3rd tiles don't. The warm-up tests further down open a small
 *   throwaway tile first, inside the SAME app instance, specifically to
 *   separate this out.
 * - **Mock IPC.** `chat:resume` here returns instantly from a fake `ipcMain`
 *   handler with no real IPC/JSONL-parsing/SDK round trip — see
 *   test-report-b22.md's "Risks" section for why this likely understates
 *   real cost rather than overstates it. `ui-driver.ts`'s function-string
 *   resolver is now memoized by source text (previously recompiled via
 *   `new Function` on every call, which could desynchronize the 3
 *   "concurrent" resumes' arrival at the renderer — see
 *   `b22-code-logic-review.md` §4).
 *
 * `PTAH_PERF_PROFILE=1` (in addition to `PTAH_PERF_SPECS=1`) turns on a CDP
 * `Profiler` capture around the cold 3-tile open, written as a raw
 * `.cpuprofile` under `D:\projects\ptah-437-backup\` (never into the repo)
 * plus a self-time-by-category console summary — see `summarizeCpuProfile`
 * below and the "Attribution" section of test-report-b22.md.
 *
 * ── No Playwright locator/actionability work inside the measurement window ──
 * A CDP profile of the first version of this spec found that ≥38.9% of
 * sampled renderer CPU during the "cold" window was Playwright's OWN injected
 * accessible-name/actionability engine (`getTextAlternativeInternal`,
 * `isElementHiddenForAria`, confirmed against `node_modules/playwright-core`),
 * driven by this spec's OWN `expect(locator).toBeVisible()` polling and
 * `.filter({ hasText })` calls re-scanning an already-large DOM every tick.
 * `PerformanceObserver('longtask')` cannot tell that cost apart from the
 * app's — it counts any main-thread task over 50 ms, whoever owns it.
 *
 * Fixed by moving everything Playwright-locator-shaped OUTSIDE the timed
 * window: `resolveButtonHandles` resolves the 3 sidebar row `ElementHandle`s
 * with ordinary locators BEFORE the observer is installed, and
 * `openTilesWithinPage` does the click + "did all 3 markers render" wait
 * INSIDE one `page.evaluate` call, using a native `HTMLElement.click()` (the
 * same click event Angular's zone-patched listener reacts to) and a
 * `MutationObserver` running entirely in the page — no repeated
 * Node↔renderer round trips, no accessible-name computation, during the
 * window. Any Playwright locator work needed to sanity-check the result
 * happens strictly AFTER the window closes and the observer has already been
 * read. See test-report-b22.md's "Old vs new harness" table for the before/
 * after numbers this produced.
 *
 * ── Click cadence is a deliberate stress case, not a model of typical pacing ─
 * `openTilesWithinPage` separates the 3 clicks by one `requestAnimationFrame`
 * yield each (~16 ms apart — see that function's own doc comment for why a
 * yield is there at all). That is HARSHER than a real user's double/triple
 * click, which is realistically tens to hundreds of ms apart. This is a
 * deliberate reading of AC-11's "open 3 tiles... at once" as the
 * near-simultaneous stress case, not an attempt to model "a user browsing 3
 * sessions moderately quickly" — a reader should not assume the ~16 ms gap
 * models normal pacing.
 *
 * ── A real product bug this harness surfaced (not fixed here) ──────────────
 * Firing the 3 clicks with no yield between them (tried first) silently
 * dropped 2 of 3 tiles: `AppStateManager.requestCanvasSession`
 * (`libs/frontend/core/src/lib/services/app-state.service.ts:255,696-714`)
 * writes to a single-slot signal (`_canvasSessionRequest`) consumed by
 * exactly one `effect()` in `OrchestraCanvasComponent`
 * (`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:293-308`).
 * Two `.set()` calls before that effect's next flush leave only the second
 * request standing — the first is gone with no visible error (its promise
 * resolves `false` only after a 5 s safety timeout, per
 * `app-state.service.ts`'s own doc comment, and the sidebar's click handler
 * does not appear to surface even that). This is a real, if narrow, PRODUCT
 * bug a rapid multi-click in the sidebar can hit — not fixed in this batch
 * (test-only); the `requestAnimationFrame` yield here is a test-harness
 * accommodation, not a substitute for a product fix. Recommended follow-up:
 * queue `canvasSessionRequest`s (or serialize/debounce the click handler) so
 * a second click can't overwrite a first one still waiting to be consumed.
 * See test-report-b22.md's "Product bug found" section.
 */

const PERF_ENABLED = process.env['PTAH_PERF_SPECS'] === '1';
const PROFILE_ENABLED = process.env['PTAH_PERF_PROFILE'] === '1';

/** AC-11: no single renderer long task may exceed this. */
const MAX_SINGLE_LONG_TASK_MS = 200;
/** AC-11: total long-task blocked time across the whole open window. */
const MAX_TOTAL_BLOCKED_MS = 1_500;

/** AC-11: the literal per-session event count the acceptance criterion names. */
const TARGET_EVENTS_PER_SESSION = 2_000;
/** Warm-up tile fixture: small on purpose — only its first-render/JIT cost matters. */
const WARMUP_EVENTS = 20;

/**
 * Diagnostics land here, never in the repo — mirrors the existing
 * `D:\projects\ptah-437-backup\` convention this task already uses for batch
 * logs and patches (see `handoff.md` "Batch N — COMMITTED" evidence lines).
 */
const BACKUP_DIR = 'D:\\projects\\ptah-437-backup';

interface GeneratedEvent {
  readonly id: string;
  readonly eventType: string;
  readonly timestamp: number;
  readonly sessionId: string;
  readonly source: 'history';
  readonly messageId: string;
  readonly role?: 'user' | 'assistant';
  readonly blockIndex?: number;
  readonly delta?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly isTaskTool?: boolean;
  readonly output?: string;
  readonly isError?: boolean;
  readonly stopReason?: string;
  readonly tokenUsage?: { input: number; output: number };
}

/**
 * Deterministic LCG seeded from the session id — same reproducibility
 * property as `largeFixture`'s fixed seed, but keyed per session so fixtures
 * built for different sessions are distinct without depending on wall-clock
 * randomness.
 */
function makeRand(seedStr: string): () => number {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed * 31 + seedStr.charCodeAt(i)) % 2_147_483_647;
  }
  if (seed <= 0) seed += 2_147_483_646;
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % 1000;
  };
}

/**
 * Builds a flat, chronologically-ordered `FlatStreamEventUnion`-shaped event
 * array for one session: user turn, assistant turn with several text deltas,
 * 1-2 tool calls, then message_complete — repeated until at least
 * `targetEvents` events exist. The very last assistant turn's final delta
 * carries `marker` so the rendered transcript is independently verifiable per
 * tile.
 */
function buildLargeSessionEvents(
  sessionId: string,
  marker: string,
  targetEvents = TARGET_EVENTS_PER_SESSION,
): { events: GeneratedEvent[]; actualCount: number } {
  const rand = makeRand(sessionId);
  const events: GeneratedEvent[] = [];
  let ts = Date.now();
  let turn = 0;
  // A turn adds a variable number of events (8-12, see below), so checking
  // "close to target" at the top of every remaining turn could stay true for
  // more than one turn and place the marker twice. Latch it instead: exactly
  // one turn ever qualifies as final.
  let markerPlaced = false;

  const push = (
    partial: Omit<GeneratedEvent, 'id' | 'timestamp' | 'sessionId' | 'source'>,
  ): void => {
    events.push({
      id: randomUUID(),
      timestamp: ts++,
      sessionId,
      source: 'history',
      ...partial,
    });
  };

  while (events.length < targetEvents) {
    const userId = `u-${turn}`;
    const assistantId = `a-${turn}`;
    // Per turn: 2 (user start+delta) + 1 (assistant start) + deltaCount (2-4)
    // + 2*toolCount (2-4) + 1 (complete) = 8-12 events.
    const isFinalTurn = !markerPlaced && events.length + 12 >= targetEvents;
    if (isFinalTurn) {
      markerPlaced = true;
    }

    push({ eventType: 'message_start', messageId: userId, role: 'user' });
    push({
      eventType: 'text_delta',
      messageId: userId,
      blockIndex: 0,
      delta: `Turn ${turn}: please continue and re-check the build output.`,
    });

    push({
      eventType: 'message_start',
      messageId: assistantId,
      role: 'assistant',
    });
    const deltaCount = 2 + (rand() % 3);
    for (let i = 0; i < deltaCount; i++) {
      const isLastDelta = isFinalTurn && i === deltaCount - 1;
      push({
        eventType: 'text_delta',
        messageId: assistantId,
        blockIndex: 0,
        delta: isLastDelta
          ? marker
          : `partial response chunk ${turn}.${i} covering the requested change `,
      });
    }

    const toolCount = 1 + (rand() % 2);
    for (let i = 0; i < toolCount; i++) {
      const toolCallId = `tc-${turn}-${i}`;
      push({
        eventType: 'tool_start',
        messageId: assistantId,
        toolCallId,
        toolName: 'Read',
        isTaskTool: false,
      });
      push({
        eventType: 'tool_result',
        messageId: assistantId,
        toolCallId,
        output: 'ok',
        isError: false,
      });
    }

    push({
      eventType: 'message_complete',
      messageId: assistantId,
      stopReason: 'end_turn',
      tokenUsage: { input: 100 + turn, output: 50 + turn },
    });

    turn++;
  }

  return { events, actualCount: events.length };
}

interface SessionFixture {
  readonly id: string;
  readonly name: string;
  readonly marker: string;
  readonly events: GeneratedEvent[];
  readonly actualCount: number;
}

function makeSessionFixture(
  label: string,
  targetEvents: number,
): SessionFixture {
  const id = randomUUID();
  const marker = `PTAH_E2E_AC11_${label}_MARKER`;
  const { events, actualCount } = buildLargeSessionEvents(
    id,
    marker,
    targetEvents,
  );
  return {
    id,
    name: `AC-11 perf session ${label}`,
    marker,
    events,
    actualCount,
  };
}

/** Registers `session:list` + `chat:resume` mocks for every given fixture. */
async function mockSessions(
  ui: UiDriver,
  sessions: readonly SessionFixture[],
): Promise<void> {
  const resumePayloadBySession: Record<string, unknown> = {};
  for (const s of sessions) {
    resumePayloadBySession[s.id] = {
      events: s.events,
      stats: {
        totalCost: 12.5,
        tokens: {
          input: 400_000,
          output: 60_000,
          cacheRead: 0,
          cacheCreation: 0,
        },
        messageCount: s.actualCount,
      },
    };
  }

  await ui.mockRpc({
    'session:list': {
      sessions: sessions.map((s, i) => ({
        id: s.id,
        name: s.name,
        messageCount: s.actualCount,
        createdAt: Date.now() - (sessions.length - i) * 1000,
        lastActivityAt: Date.now() - (sessions.length - i) * 1000,
        isActive: false,
      })),
      total: sessions.length,
      hasMore: false,
    },
    'session:validate': { exists: true },
    // Keyed by the resolved session id so each concurrent resume gets its own
    // fixture and its own marker. `ui-driver.ts` now memoizes the compiled
    // resolver by source text, so registering this once per test recompiles
    // exactly once regardless of how many resumes land on it.
    'chat:resume': `(params) => (${JSON.stringify(resumePayloadBySession)})[params.sessionId] ?? { events: [] }`,
  });
}

/**
 * The sidebar row is a `<button>` wrapping the session name AND its metadata
 * line; each `<li>` also carries "Rename session: <name>" / "Delete session:
 * <name>" buttons whose accessible names contain the session name too, so a
 * bare `getByRole('button', { name })` is ambiguous. Scoping to the `<li>` and
 * taking the first button (the row button is the first one rendered —
 * `app-shell.component.html`) resolves to exactly one element.
 */
function sessionRowButton(page: Page, name: string) {
  return page
    .locator('li[role="listitem"]')
    .filter({ hasText: name })
    .getByRole('button')
    .first();
}

/** Opens the canvas, mocks the given sessions, and waits for their sidebar rows. */
async function prepareCanvasWithSessions(
  ui: UiDriver,
  sessions: readonly SessionFixture[],
): Promise<void> {
  await mockSessions(ui, sessions);

  // 'canvas', not 'chat' — ui.goto('chat') additionally creates a blank draft
  // tile via ensureCanvasChatTile, which would leave an unrelated extra tile.
  await ui.goto('canvas');

  // The sidebar's initial `session:list` fetch already ran during fixture
  // setup (`ui.prepare()`), before the mock above was registered, so it saw
  // no sessions. `session:metadataChanged` is the same debounced
  // (`ChatMessageHandler.handleSessionMetadataChanged`, 250 ms) reload the
  // app uses after a real session is created or renamed elsewhere — pushing
  // it here re-fetches `session:list` against the now-registered mock
  // instead of reaching into the sidebar's internals directly.
  await ui.pushEvent({ type: 'session:metadataChanged', payload: {} });

  for (const s of sessions) {
    await expect(sessionRowButton(ui.page, s.name)).toBeVisible();
  }
}

/** Waits for a tile carrying `marker`'s own bubble to render. */
async function waitForTileMarker(page: Page, marker: string): Promise<void> {
  const tiles = page.locator('[data-testid="canvas-tile"]');
  // A tile renders one `chat-tool-output` bubble per finalized message, so the
  // marker's own bubble is picked out with `hasText`, not just the tile.
  await expect(
    tiles
      .filter({ hasText: marker })
      .locator('[data-testid="chat-tool-output"]', { hasText: marker }),
  ).toBeVisible({ timeout: 20_000 });
}

async function installLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __ptahLongTasks?: LongTaskEntry[] };
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
    (
      w as unknown as { __ptahLongTaskObserver?: PerformanceObserver }
    ).__ptahLongTaskObserver = observer;
  });
}

async function collectLongTasks(page: Page): Promise<LongTaskEntry[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __ptahLongTasks?: LongTaskEntry[];
      __ptahLongTaskObserver?: PerformanceObserver;
    };
    w.__ptahLongTaskObserver?.disconnect();
    return w.__ptahLongTasks ?? [];
  });
}

/**
 * Resolves the 3 sidebar row `<button>` element handles with ordinary
 * Playwright locators. Must be called BEFORE `installLongTaskObserver` — this
 * is the one place in the measured flow where Playwright's accessible-name/
 * actionability engine is allowed to run, and it runs here, outside the
 * window, on purpose.
 */
async function resolveButtonHandles(
  page: Page,
  sessions: readonly SessionFixture[],
): Promise<ElementHandle<HTMLElement>[]> {
  const handles: ElementHandle<HTMLElement>[] = [];
  for (const s of sessions) {
    const handle = await sessionRowButton(page, s.name).elementHandle();
    if (!handle) {
      throw new Error(
        `[AC-11 perf] sessionRowButton element handle not found for "${s.name}"`,
      );
    }
    handles.push(handle as ElementHandle<HTMLElement>);
  }
  return handles;
}

interface OpenTilesResult {
  readonly ok: boolean;
  readonly timedOut: boolean;
  /** `performance.now()` at each click, same order as `buttons`/`markers`. */
  readonly clickTimes: number[];
}

/**
 * Clicks every button and waits for every marker to appear, ENTIRELY inside
 * one `page.evaluate` call: a native `HTMLElement.click()` per button (the
 * same click event Angular's zone-patched listener reacts to — not
 * Playwright's `.click()`, which runs hit-testing/visibility/animation
 * actionability checks first) and a single `MutationObserver` resolving a
 * Promise once every marker string is found in `document.body.textContent`.
 * No Playwright-side polling, no locator resolution, runs during this call —
 * that is the entire point: the long-task window this wraps measures the
 * app, not the test harness.
 *
 * Clicks are separated by one `requestAnimationFrame` yield each — NOT for
 * Playwright actionability, but because "open a tile for this session" is a
 * single-slot request (`AppStateManager`'s `_canvasSessionRequest` signal,
 * consumed by one `effect()` in `OrchestraCanvasComponent`). Firing all 3
 * native clicks in the same synchronous turn (tried first, see
 * `b22-code-logic-review.md` revision 3 discussion) overwrites the signal
 * before Angular's effect ever runs, so only the LAST click's tile actually
 * opens — confirmed by a run where 2 of 3 tiles silently never appeared. One
 * rAF per click is enough for the effect to consume each request before the
 * next click, and costs ~16 ms/click — negligible next to the hundreds of ms
 * this spec measures, and it is a fixed scheduling primitive, not a
 * Playwright-side poll.
 */
async function openTilesWithinPage(
  page: Page,
  buttons: ElementHandle<HTMLElement>[],
  markers: string[],
  timeoutMs = 30_000,
): Promise<OpenTilesResult> {
  return page.evaluate(
    async ({ buttons, markers, timeoutMs }) => {
      const remaining = new Set(markers);
      const clickTimes: number[] = [];
      let settled = false;
      let resolveDone!: (result: OpenTilesResult) => void;
      const donePromise = new Promise<OpenTilesResult>((resolve) => {
        resolveDone = resolve;
      });

      function finish(ok: boolean, timedOut: boolean): void {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timeoutId);
        resolveDone({ ok, timedOut, clickTimes });
      }

      // A first version scanned `document.body.textContent` (the WHOLE
      // accumulated DOM) on every MutationObserver callback. That cost grows
      // with the DOM already inserted, so by the time the 3rd tile is
      // streaming in past ~190 turns from the first two, each callback was
      // re-serializing megabytes of text — a re-profile found this single
      // harness-introduced function costing ~2 s (~20% of sampled CPU) on its
      // own, once Playwright's own locator engine had already been removed
      // from the window. Fixed: only inspect the mutation records
      // themselves (`addedNodes` / the mutated `characterData` node's own
      // text), which costs O(what changed), not O(everything so far).
      function scanMutations(records: MutationRecord[]): void {
        for (const record of records) {
          if (record.type === 'characterData') {
            const t = record.target.textContent ?? '';
            for (const m of [...remaining]) {
              if (t.includes(m)) remaining.delete(m);
            }
            continue;
          }
          for (let i = 0; i < record.addedNodes.length; i++) {
            const t = record.addedNodes[i].textContent ?? '';
            if (!t) continue;
            for (const m of [...remaining]) {
              if (t.includes(m)) remaining.delete(m);
            }
          }
        }
        if (remaining.size === 0) finish(true, false);
      }

      // Only used for the 3 manual post-click checks below (see call site) —
      // whole-body is fine here since it runs at most 3 times per test, not
      // once per mutation.
      function scanWholeBody(): void {
        const text = document.body.textContent ?? '';
        for (const m of [...remaining]) {
          if (text.includes(m)) remaining.delete(m);
        }
        if (remaining.size === 0) finish(true, false);
      }

      const observer = new MutationObserver(scanMutations);
      const timeoutId = setTimeout(() => finish(false, true), timeoutMs);

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      for (const btn of buttons) {
        btn.click();
        clickTimes.push(performance.now());
        // See the function doc comment: yields one frame so the single-slot
        // canvas-session-request signal is consumed before the next click.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        scanWholeBody();
      }

      return donePromise;
    },
    { buttons, markers, timeoutMs },
  );
}

function writeDiagnostics(name: string, data: unknown): void {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `ac11-perf-${name}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[AC-11 perf] wrote diagnostics: ${file}`);
  } catch (error: unknown) {
    console.warn(
      `[AC-11 perf] failed to write diagnostics for "${name}":`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

test.describe('Canvas tile-open long-task budget for a 2,000-event session (TASK_2026_437 AC-11)', () => {
  test.skip(
    !PERF_ENABLED,
    'Absolute long-task budgets depend on the host being quiet; set PTAH_PERF_SPECS=1 ' +
      'on an idle machine (see CLAUDE.md "Stress/perf specs"). Not part of the default e2e run.',
  );

  test('cold: opening 3 tiles of a ~2,000-event session keeps every renderer long task under 200 ms and the total under 1,500 ms', async ({
    ui,
  }) => {
    const page = ui.page;

    const sessions = ['0', '1', '2'].map((label) =>
      makeSessionFixture(`TILE_${label}`, TARGET_EVENTS_PER_SESSION),
    );

    for (const s of sessions) {
      console.log(
        `[AC-11 perf] session ${s.id} fixture: ${s.actualCount} events (target ${TARGET_EVENTS_PER_SESSION})`,
      );
    }

    await prepareCanvasWithSessions(ui, sessions);

    // Resolve the 3 sidebar row element handles with ordinary locators BEFORE
    // the observer is installed — the only Playwright locator work in this
    // test, and it happens outside the measured window on purpose.
    const buttonHandles = await resolveButtonHandles(page, sessions);

    // Install the long-task observer (and, if enabled, the CDP CPU profiler)
    // AFTER the canvas/sidebar are settled and BEFORE any tile opens, so
    // nothing but the 3 resumes (and, per the header comment, no Playwright
    // locator work) is measured. buffered: true also picks up anything
    // already queued at install time.
    await installLongTaskObserver(page);

    let cdpSession: CDPSession | null = null;
    if (PROFILE_ENABLED) {
      cdpSession = await page.context().newCDPSession(page);
      await cdpSession.send('Profiler.enable');
      // 100 microseconds — fine enough to separate short (< 1ms) frames
      // without an unreasonable sample count over a ~5-10s window.
      await cdpSession.send('Profiler.setSamplingInterval', { interval: 100 });
      await cdpSession.send('Profiler.start');
    }

    const wallStart = Date.now();

    // Click all 3 sidebar rows AND wait for all 3 markers to render, entirely
    // inside one page.evaluate — no Playwright polling during this window.
    const openResult = await openTilesWithinPage(
      page,
      buttonHandles,
      sessions.map((s) => s.marker),
    );

    const wallMs = Date.now() - wallStart;

    let cpuSummary: CpuProfileSummary | null = null;
    if (cdpSession) {
      const { profile } = (await cdpSession.send('Profiler.stop')) as {
        profile: CpuProfile;
      };
      await cdpSession.send('Profiler.disable');
      await cdpSession.detach();
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const profilePath = path.join(
        BACKUP_DIR,
        `ac11-perf-cold-3tile-${Date.now()}.cpuprofile`,
      );
      fs.writeFileSync(profilePath, JSON.stringify(profile), 'utf8');
      console.log(`[AC-11 perf] wrote raw CPU profile: ${profilePath}`);
      cpuSummary = summarizeCpuProfile(profile);
      console.log(
        `[AC-11 perf] CPU profile self-time by category (grand total ${cpuSummary.grandTotalMs}ms sampled):`,
      );
      for (const row of cpuSummary.byCategory) {
        console.log(
          `[AC-11 perf]   ${row.category}: ${row.selfMs}ms (${row.selfPct}%)`,
        );
      }
      console.log('[AC-11 perf] top functions by self time:');
      for (const fn of cpuSummary.topFunctionsBySelf) {
        console.log(
          `[AC-11 perf]   ${fn.selfMs}ms  ${fn.functionName}  ${fn.url}`,
        );
      }
    }

    const entries = await collectLongTasks(page);

    for (const handle of buttonHandles) {
      await handle.dispose();
    }

    if (!openResult.ok) {
      throw new Error(
        `[AC-11 perf] tiles did not all render their markers within the window ` +
          `(timedOut=${openResult.timedOut}); measurement is unusable for this run`,
      );
    }

    // Sanity check AFTER the window closed and the observer was already read —
    // Playwright locator work here cannot pollute the measurement.
    const tiles = page.locator('[data-testid="canvas-tile"]');
    await expect(tiles).toHaveCount(sessions.length);
    for (const s of sessions) {
      await waitForTileMarker(page, s.marker);
    }

    const maxDuration = entries.reduce((m, e) => Math.max(m, e.duration), 0);
    const totalDuration = entries.reduce((sum, e) => sum + e.duration, 0);
    const clicks = sessions.map((s, i) => ({
      label: s.marker,
      atMs: openResult.clickTimes[i],
    }));
    const perTile = bucketByClick(entries, clicks);

    console.log(
      `[AC-11 perf] wall=${wallMs}ms longTasks=${entries.length} max=${maxDuration.toFixed(
        2,
      )}ms total=${totalDuration.toFixed(2)}ms (budgets: max<=${MAX_SINGLE_LONG_TASK_MS}ms, total<=${MAX_TOTAL_BLOCKED_MS}ms)`,
    );
    for (const e of entries) {
      console.log(
        `[AC-11 perf]   long task at ${e.startTime.toFixed(2)}ms, duration ${e.duration.toFixed(2)}ms, name="${e.name}", attribution=${JSON.stringify(e.attribution)}`,
      );
    }
    console.log(
      '[AC-11 perf] per-tile bucket (click order — first = cold start, rest = steady state):',
    );
    for (const b of perTile) {
      console.log(
        `[AC-11 perf]   ${b.label}: count=${b.count} max=${b.maxMs.toFixed(2)}ms total=${b.totalMs.toFixed(2)}ms`,
      );
    }

    writeDiagnostics('cold-3tile', {
      scenario: 'cold-3tile',
      harness: 'no-polling-v2',
      wallMs,
      longTaskCount: entries.length,
      maxDurationMs: maxDuration,
      totalDurationMs: totalDuration,
      budgets: {
        maxMs: MAX_SINGLE_LONG_TASK_MS,
        totalMs: MAX_TOTAL_BLOCKED_MS,
      },
      entries,
      perTile,
      cpuSummary,
    });

    expect(maxDuration).toBeLessThanOrEqual(MAX_SINGLE_LONG_TASK_MS);
    expect(totalDuration).toBeLessThanOrEqual(MAX_TOTAL_BLOCKED_MS);
  });

  test('diagnostic: warm 1 tile of a ~2,000-event session (no AC-11 gate — for Q6 evidence only)', async ({
    ui,
  }) => {
    const page = ui.page;
    const warmup = makeSessionFixture('WARMUP_SOLO', WARMUP_EVENTS);
    const real = makeSessionFixture('SOLO', TARGET_EVENTS_PER_SESSION);

    await prepareCanvasWithSessions(ui, [warmup, real]);

    // Warm-up: open the tiny throwaway session FIRST, in the same app
    // instance, so its module-eval/JIT/first-render cost is paid before the
    // real measurement window opens — isolating steady-state cost for the
    // real tile from cold-start cost. Ordinary locators are fine here, before
    // the window opens.
    await sessionRowButton(page, warmup.name).click();
    await waitForTileMarker(page, warmup.marker);

    const buttonHandles = await resolveButtonHandles(page, [real]);
    await installLongTaskObserver(page);
    const wallStart = Date.now();
    const openResult = await openTilesWithinPage(page, buttonHandles, [
      real.marker,
    ]);
    const wallMs = Date.now() - wallStart;

    const entries = await collectLongTasks(page);
    for (const handle of buttonHandles) {
      await handle.dispose();
    }

    if (!openResult.ok) {
      throw new Error(
        `[AC-11 perf][warm-1tile] tile did not render its marker within the window ` +
          `(timedOut=${openResult.timedOut}); measurement is unusable for this run`,
      );
    }
    await waitForTileMarker(page, real.marker);

    const maxDuration = entries.reduce((m, e) => Math.max(m, e.duration), 0);
    const totalDuration = entries.reduce((sum, e) => sum + e.duration, 0);

    console.log(
      `[AC-11 perf][warm-1tile] wall=${wallMs}ms longTasks=${entries.length} max=${maxDuration.toFixed(2)}ms total=${totalDuration.toFixed(2)}ms ` +
        `(informational only — budgets max<=${MAX_SINGLE_LONG_TASK_MS}ms/total<=${MAX_TOTAL_BLOCKED_MS}ms shown for comparison, not asserted here)`,
    );

    writeDiagnostics('warm-1tile', {
      scenario: 'warm-1tile',
      harness: 'no-polling-v2',
      wallMs,
      longTaskCount: entries.length,
      maxDurationMs: maxDuration,
      totalDurationMs: totalDuration,
      entries,
    });
  });

  test('diagnostic: warm 3 tiles of a ~2,000-event session (no AC-11 gate — for Q6 evidence only)', async ({
    ui,
  }) => {
    const page = ui.page;
    const warmup = makeSessionFixture('WARMUP_TRIO', WARMUP_EVENTS);
    const sessions = ['0', '1', '2'].map((label) =>
      makeSessionFixture(`WARM_TILE_${label}`, TARGET_EVENTS_PER_SESSION),
    );

    await prepareCanvasWithSessions(ui, [warmup, ...sessions]);

    await sessionRowButton(page, warmup.name).click();
    await waitForTileMarker(page, warmup.marker);

    const buttonHandles = await resolveButtonHandles(page, sessions);
    await installLongTaskObserver(page);
    const wallStart = Date.now();
    const openResult = await openTilesWithinPage(
      page,
      buttonHandles,
      sessions.map((s) => s.marker),
    );
    const wallMs = Date.now() - wallStart;

    const entries = await collectLongTasks(page);
    for (const handle of buttonHandles) {
      await handle.dispose();
    }

    if (!openResult.ok) {
      throw new Error(
        `[AC-11 perf][warm-3tile] tiles did not all render their markers within the window ` +
          `(timedOut=${openResult.timedOut}); measurement is unusable for this run`,
      );
    }
    for (const s of sessions) {
      await waitForTileMarker(page, s.marker);
    }

    const maxDuration = entries.reduce((m, e) => Math.max(m, e.duration), 0);
    const totalDuration = entries.reduce((sum, e) => sum + e.duration, 0);
    const clicks = sessions.map((s, i) => ({
      label: s.marker,
      atMs: openResult.clickTimes[i],
    }));
    const perTile = bucketByClick(entries, clicks);

    console.log(
      `[AC-11 perf][warm-3tile] wall=${wallMs}ms longTasks=${entries.length} max=${maxDuration.toFixed(2)}ms total=${totalDuration.toFixed(2)}ms ` +
        `(informational only — budgets max<=${MAX_SINGLE_LONG_TASK_MS}ms/total<=${MAX_TOTAL_BLOCKED_MS}ms shown for comparison, not asserted here)`,
    );
    for (const b of perTile) {
      console.log(
        `[AC-11 perf][warm-3tile]   ${b.label}: count=${b.count} max=${b.maxMs.toFixed(2)}ms total=${b.totalMs.toFixed(2)}ms`,
      );
    }

    writeDiagnostics('warm-3tile', {
      scenario: 'warm-3tile',
      harness: 'no-polling-v2',
      wallMs,
      longTaskCount: entries.length,
      maxDurationMs: maxDuration,
      totalDurationMs: totalDuration,
      perTile,
      entries,
    });
  });
});
