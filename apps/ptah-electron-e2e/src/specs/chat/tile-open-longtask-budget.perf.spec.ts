import { test, expect } from '../../support/fixtures';
import {
  summarizeCpuProfile,
  type CpuProfile,
  type CpuProfileSummary,
} from '../../support/perf-diagnostics';
import {
  collectLongTasks,
  installLongTaskObserver,
  installRafAttribution,
  openTilesWithinPage,
  startTraceCapture,
  type CDPSession,
} from '../../support/perf-page-capture';
import {
  assertScrollSanity,
  assertUsableMeasurement,
  captureOptionalDiagnostics,
  logMeasurementBuckets,
  resolvePerfOutputDirectory,
  summarizeMeasurement,
  writeCpuProfile,
  writeDiagnostics,
} from '../../support/perf-measurement-report';
import {
  diagnosticEventCount,
  makeSessionFixture,
  prepareCanvasWithSessions,
  resolveButtonHandles,
  sessionRowButton,
  waitForTileMarker,
} from '../../support/perf-session-fixture';

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
 * `.cpuprofile` under `PTAH_PERF_OUT_DIR` (default `os.tmpdir()/ptah-perf`,
 * never into the repo)
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
 * ── Product bug this harness surfaced, fixed by TASK_2026_453 C3 ─────────
 * The first no-yield version of this harness silently dropped 2 of 3 tiles
 * because rapid requests overwrote one single pending value. TASK_2026_453 C3
 * replaced that bridge with the FIFO `canvasSessionRequests` queue, drained
 * in order by `OrchestraCanvasComponent`, so every rapid click is now handled.
 * The one-rAF gap remains intentionally: it is the disclosed stress cadence
 * used by the M0 baseline and later comparisons, not a product workaround.
 * See test-report-b22.md's historical "Product bug found" section.
 */

const PERF_ENABLED = process.env['PTAH_PERF_SPECS'] === '1';
const PROFILE_ENABLED = process.env['PTAH_PERF_PROFILE'] === '1';
const RAF_ATTRIBUTION_ENABLED =
  process.env['PTAH_PERF_RAF_ATTRIBUTION'] === '1';
const TRACE_ENABLED = process.env['PTAH_PERF_TRACE'] === '1';

/** AC-11: no single renderer long task may exceed this. */
const MAX_SINGLE_LONG_TASK_MS = 200;
/** AC-11: total long-task blocked time across the whole open window. */
const MAX_TOTAL_BLOCKED_MS = 1_500;

/** AC-11: the literal per-session event count the acceptance criterion names. */
const TARGET_EVENTS_PER_SESSION = 2_000;
/** Warm-up tile fixture: small on purpose — only its first-render/JIT cost matters. */
const WARMUP_EVENTS = 20;

/** Diagnostics land outside the repository. */
const PERF_OUT_DIR = resolvePerfOutputDirectory(
  process.env['PTAH_PERF_OUT_DIR'],
);

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
    // locator work) is measured. buffered: true can also report already
    // queued entries; summarizeMeasurement excludes them by windowStartMs.
    await installLongTaskObserver(page);
    // Diagnostic tracing is hard-disabled in the budget-gating test so CDP
    // collection work cannot contaminate the asserted window.
    const traceCapture = null;

    let cdpSession: CDPSession | null = null;
    if (PROFILE_ENABLED) {
      cdpSession = await page.context().newCDPSession(page);
      await cdpSession.send('Profiler.enable');
      // 100 microseconds — fine enough to separate short (< 1ms) frames
      // without an unreasonable sample count over a ~5-10s window.
      await cdpSession.send('Profiler.setSamplingInterval', { interval: 100 });
      await cdpSession.send('Profiler.start');
    }

    // Click all 3 sidebar rows AND wait for all 3 markers to render, entirely
    // inside one page.evaluate — no Playwright polling during this window.
    const openResult = await openTilesWithinPage(
      page,
      buttonHandles,
      sessions.map((s) => s.marker),
    );

    const observedEntries = await collectLongTasks(page);
    const optionalDiagnostics = await captureOptionalDiagnostics(
      page,
      traceCapture,
      false,
    );

    let cpuSummary: CpuProfileSummary | null = null;
    if (cdpSession) {
      const { profile } = (await cdpSession.send('Profiler.stop')) as {
        profile: CpuProfile;
      };
      await cdpSession.send('Profiler.disable');
      await cdpSession.detach();
      writeCpuProfile(PERF_OUT_DIR, profile);
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

    for (const handle of buttonHandles) {
      await handle.dispose();
    }

    assertUsableMeasurement(openResult);

    // Sanity check AFTER the window closed and the observer was already read —
    // Playwright locator work here cannot pollute the measurement.
    const tiles = page.locator('[data-testid="canvas-tile"]');
    await expect(tiles).toHaveCount(sessions.length);
    for (const s of sessions) {
      await waitForTileMarker(page, s.marker);
    }
    await assertScrollSanity(page, sessions);

    const measurement = summarizeMeasurement(
      observedEntries,
      openResult,
      sessions,
    );
    const { entries, maxDuration, totalDuration } = measurement;
    logMeasurementBuckets('cold-3tile', measurement);

    console.log(
      `[AC-11 perf] wall=${openResult.wallMs.toFixed(2)}ms longTasks=${entries.length} max=${maxDuration.toFixed(
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
    for (const b of measurement.perClick) {
      console.log(
        `[AC-11 perf]   ${b.label}: count=${b.count} max=${b.maxMs.toFixed(2)}ms total=${b.totalMs.toFixed(2)}ms`,
      );
    }

    writeDiagnostics(PERF_OUT_DIR, 'cold-3tile', {
      scenario: 'cold-3tile',
      harness: 'settle-inclusive-v3',
      diagnosticFlags: {
        trace: false,
        rafAttribution: false,
        profile: PROFILE_ENABLED,
        eventCountOverride: null,
      },
      settled: openResult.settled,
      wallMs: openResult.wallMs,
      windowStartMs: openResult.windowStartMs,
      windowEndMs: openResult.windowEndMs,
      clickTimes: openResult.clickTimes,
      markerTimes: openResult.markerTimes,
      preWindowExcluded: measurement.preWindowExcluded,
      domNodes: {
        replaying: openResult.replayingDom,
        settled: openResult.settledDomCount,
      },
      longTaskCount: entries.length,
      maxDurationMs: maxDuration,
      totalDurationMs: totalDuration,
      budgets: {
        maxMs: MAX_SINGLE_LONG_TASK_MS,
        totalMs: MAX_TOTAL_BLOCKED_MS,
      },
      entries,
      perClick: measurement.perClick,
      perMarker: measurement.perMarker,
      rafAttribution: optionalDiagnostics.rafAttribution,
      traceSummary: optionalDiagnostics.traceSummary,
      cpuSummary,
    });

    expect(maxDuration).toBeLessThanOrEqual(MAX_SINGLE_LONG_TASK_MS);
    expect(totalDuration).toBeLessThanOrEqual(MAX_TOTAL_BLOCKED_MS);
  });

  test('diagnostic: cold 3 tiles with optional attribution flags (no AC-11 gate)', async ({
    ui,
  }) => {
    const page = ui.page;
    const eventCount = diagnosticEventCount(process.env['PTAH_PERF_EVENTS']);
    const sessions = ['0', '1', '2'].map((label) =>
      makeSessionFixture(`DIAG_COLD_TILE_${label}`, eventCount),
    );
    await prepareCanvasWithSessions(ui, sessions);
    const buttonHandles = await resolveButtonHandles(page, sessions);
    if (RAF_ATTRIBUTION_ENABLED) await installRafAttribution(page);
    await installLongTaskObserver(page);
    const traceCapture = TRACE_ENABLED ? await startTraceCapture(page) : null;
    const openResult = await openTilesWithinPage(
      page,
      buttonHandles,
      sessions.map((session) => session.marker),
    );
    const observedEntries = await collectLongTasks(page);
    const optionalDiagnostics = await captureOptionalDiagnostics(
      page,
      traceCapture,
      RAF_ATTRIBUTION_ENABLED,
    );
    for (const handle of buttonHandles) await handle.dispose();
    assertUsableMeasurement(openResult);
    await assertScrollSanity(page, sessions);
    const measurement = summarizeMeasurement(
      observedEntries,
      openResult,
      sessions,
    );
    logMeasurementBuckets('diagnostic-cold-3tile', measurement);
    writeDiagnostics(PERF_OUT_DIR, `diagnostic-cold-3tile-${eventCount}`, {
      scenario: 'diagnostic-cold-3tile',
      harness: 'settle-inclusive-v3',
      diagnosticFlags: {
        trace: TRACE_ENABLED,
        rafAttribution: RAF_ATTRIBUTION_ENABLED,
        profile: false,
        eventCountOverride:
          process.env['PTAH_PERF_EVENTS'] === undefined ? null : eventCount,
      },
      eventCount,
      settled: openResult.settled,
      wallMs: openResult.wallMs,
      windowStartMs: openResult.windowStartMs,
      windowEndMs: openResult.windowEndMs,
      clickTimes: openResult.clickTimes,
      markerTimes: openResult.markerTimes,
      preWindowExcluded: measurement.preWindowExcluded,
      domNodes: {
        replaying: openResult.replayingDom,
        settled: openResult.settledDomCount,
      },
      longTaskCount: measurement.entries.length,
      maxDurationMs: measurement.maxDuration,
      totalDurationMs: measurement.totalDuration,
      entries: measurement.entries,
      perClick: measurement.perClick,
      perMarker: measurement.perMarker,
      rafAttribution: optionalDiagnostics.rafAttribution,
      traceSummary: optionalDiagnostics.traceSummary,
    });
  });

  test('diagnostic: warm 1 tile of a ~2,000-event session (no AC-11 gate — for Q6 evidence only)', async ({
    ui,
  }) => {
    const page = ui.page;
    const warmup = makeSessionFixture('WARMUP_SOLO', WARMUP_EVENTS);
    const eventCount = diagnosticEventCount(process.env['PTAH_PERF_EVENTS']);
    const real = makeSessionFixture('SOLO', eventCount);

    await prepareCanvasWithSessions(ui, [warmup, real]);

    // Warm-up: open the tiny throwaway session FIRST, in the same app
    // instance, so its module-eval/JIT/first-render cost is paid before the
    // real measurement window opens — isolating steady-state cost for the
    // real tile from cold-start cost. Ordinary locators are fine here, before
    // the window opens.
    await sessionRowButton(page, warmup.name).click();
    await waitForTileMarker(page, warmup.marker);

    const buttonHandles = await resolveButtonHandles(page, [real]);
    if (RAF_ATTRIBUTION_ENABLED) await installRafAttribution(page);
    await installLongTaskObserver(page);
    const traceCapture = TRACE_ENABLED ? await startTraceCapture(page) : null;
    const openResult = await openTilesWithinPage(page, buttonHandles, [
      real.marker,
    ]);
    const observedEntries = await collectLongTasks(page);
    const optionalDiagnostics = await captureOptionalDiagnostics(
      page,
      traceCapture,
      RAF_ATTRIBUTION_ENABLED,
    );
    for (const handle of buttonHandles) {
      await handle.dispose();
    }

    assertUsableMeasurement(openResult);
    await waitForTileMarker(page, real.marker);

    const measurement = summarizeMeasurement(observedEntries, openResult, [
      real,
    ]);
    const { entries, maxDuration, totalDuration } = measurement;
    logMeasurementBuckets('warm-1tile', measurement);

    console.log(
      `[AC-11 perf][warm-1tile] wall=${openResult.wallMs.toFixed(2)}ms longTasks=${entries.length} max=${maxDuration.toFixed(2)}ms total=${totalDuration.toFixed(2)}ms ` +
        `(informational only — budgets max<=${MAX_SINGLE_LONG_TASK_MS}ms/total<=${MAX_TOTAL_BLOCKED_MS}ms shown for comparison, not asserted here)`,
    );

    writeDiagnostics(PERF_OUT_DIR, 'warm-1tile', {
      scenario: 'warm-1tile',
      harness: 'settle-inclusive-v3',
      diagnosticFlags: {
        trace: TRACE_ENABLED,
        rafAttribution: RAF_ATTRIBUTION_ENABLED,
        profile: false,
        eventCountOverride:
          process.env['PTAH_PERF_EVENTS'] === undefined ? null : eventCount,
      },
      eventCount,
      settled: openResult.settled,
      wallMs: openResult.wallMs,
      windowStartMs: openResult.windowStartMs,
      windowEndMs: openResult.windowEndMs,
      clickTimes: openResult.clickTimes,
      markerTimes: openResult.markerTimes,
      preWindowExcluded: measurement.preWindowExcluded,
      domNodes: {
        replaying: openResult.replayingDom,
        settled: openResult.settledDomCount,
      },
      longTaskCount: entries.length,
      maxDurationMs: maxDuration,
      totalDurationMs: totalDuration,
      entries,
      perClick: measurement.perClick,
      perMarker: measurement.perMarker,
      rafAttribution: optionalDiagnostics.rafAttribution,
      traceSummary: optionalDiagnostics.traceSummary,
    });
  });

  test('diagnostic: warm 3 tiles of a ~2,000-event session (no AC-11 gate — for Q6 evidence only)', async ({
    ui,
  }) => {
    const page = ui.page;
    const warmup = makeSessionFixture('WARMUP_TRIO', WARMUP_EVENTS);
    const eventCount = diagnosticEventCount(process.env['PTAH_PERF_EVENTS']);
    const sessions = ['0', '1', '2'].map((label) =>
      makeSessionFixture(`WARM_TILE_${label}`, eventCount),
    );

    await prepareCanvasWithSessions(ui, [warmup, ...sessions]);

    await sessionRowButton(page, warmup.name).click();
    await waitForTileMarker(page, warmup.marker);

    const buttonHandles = await resolveButtonHandles(page, sessions);
    if (RAF_ATTRIBUTION_ENABLED) await installRafAttribution(page);
    await installLongTaskObserver(page);
    const traceCapture = TRACE_ENABLED ? await startTraceCapture(page) : null;
    const openResult = await openTilesWithinPage(
      page,
      buttonHandles,
      sessions.map((s) => s.marker),
    );
    const observedEntries = await collectLongTasks(page);
    const optionalDiagnostics = await captureOptionalDiagnostics(
      page,
      traceCapture,
      RAF_ATTRIBUTION_ENABLED,
    );
    for (const handle of buttonHandles) {
      await handle.dispose();
    }

    assertUsableMeasurement(openResult);
    for (const s of sessions) {
      await waitForTileMarker(page, s.marker);
    }
    await assertScrollSanity(page, sessions);

    const measurement = summarizeMeasurement(
      observedEntries,
      openResult,
      sessions,
    );
    const { entries, maxDuration, totalDuration } = measurement;
    logMeasurementBuckets('warm-3tile', measurement);

    console.log(
      `[AC-11 perf][warm-3tile] wall=${openResult.wallMs.toFixed(2)}ms longTasks=${entries.length} max=${maxDuration.toFixed(2)}ms total=${totalDuration.toFixed(2)}ms ` +
        `(informational only — budgets max<=${MAX_SINGLE_LONG_TASK_MS}ms/total<=${MAX_TOTAL_BLOCKED_MS}ms shown for comparison, not asserted here)`,
    );
    for (const b of measurement.perClick) {
      console.log(
        `[AC-11 perf][warm-3tile]   ${b.label}: count=${b.count} max=${b.maxMs.toFixed(2)}ms total=${b.totalMs.toFixed(2)}ms`,
      );
    }

    writeDiagnostics(PERF_OUT_DIR, 'warm-3tile', {
      scenario: 'warm-3tile',
      harness: 'settle-inclusive-v3',
      diagnosticFlags: {
        trace: TRACE_ENABLED,
        rafAttribution: RAF_ATTRIBUTION_ENABLED,
        profile: false,
        eventCountOverride:
          process.env['PTAH_PERF_EVENTS'] === undefined ? null : eventCount,
      },
      eventCount,
      settled: openResult.settled,
      wallMs: openResult.wallMs,
      windowStartMs: openResult.windowStartMs,
      windowEndMs: openResult.windowEndMs,
      clickTimes: openResult.clickTimes,
      markerTimes: openResult.markerTimes,
      preWindowExcluded: measurement.preWindowExcluded,
      domNodes: {
        replaying: openResult.replayingDom,
        settled: openResult.settledDomCount,
      },
      longTaskCount: entries.length,
      maxDurationMs: maxDuration,
      totalDurationMs: totalDuration,
      perClick: measurement.perClick,
      perMarker: measurement.perMarker,
      rafAttribution: optionalDiagnostics.rafAttribution,
      traceSummary: optionalDiagnostics.traceSummary,
      entries,
    });
  });
});
