/**
 * ADVISORY perf spec for ST-2 / AC-7 (TASK_2026_437 AC-2 P2, AC-7) — opt-in,
 * never a CI gate.
 *
 * An absolute event-loop-delay budget measures the HOST, and this repository
 * normally runs several agents building and testing in one working tree, so
 * the budgets live here rather than in the always-run
 * `workspace-watch-host.stress.spec.ts` (mechanism counts). Same split, and
 * same reasoning, as `git-watcher.stress.perf.spec.ts` /
 * `off-thread-process-spawner.perf.spec.ts` (Batch 15 style review, serious
 * #2). This spec asserts the ms budgets; it logs the mechanism counts for
 * context, so a mechanism regression cannot hide the numbers.
 *
 *   PTAH_PERF_SPECS=1 npx nx test @ptah-extension/platform-electron --testPathPattern=workspace-watch-host.stress.perf
 *
 * Run it on a QUIET machine, against the acceptance table's 75,000-file tree.
 *
 * Both scenarios here run the SAME rig
 * (`workspace-watch-host.stress.harness.ts`) the mechanism spec uses — the
 * out-of-process delete and the persistent RSS monitor (Batch 15's rig-
 * attribution fix) apply here unconditionally, so this file cannot reproduce
 * the false ~270-295 ms event-loop-delay reading the pre-fix rig produced
 * (`test-report-b15.md` "Rig attribution follow-up").
 */

import {
  ensureHostBundleExists,
  runMassDeleteStorm,
  runSingleKillScenario,
} from './workspace-watch-host.stress.harness';

const PERF_ENABLED = process.env['PTAH_PERF_SPECS'] === '1';

/** `describe` when explicitly enabled, `describe.skip` otherwise. */
const perfDescribe = PERF_ENABLED ? describe : describe.skip;

/** Acceptance table: "75,000 files in ~7,500 directories". */
const TOTAL_FILES = 75_000;

/** Both budgets are measured over delete + 10 s. */
const SETTLE_MS = 10_000;

/** AC-2 (P2): p99 ≤ 30 ms, max ≤ 100 ms. */
const AC2_P2_P99_MS = 30;
const AC2_P2_MAX_MS = 100;

/** AC-7: host restarted ≤ 3 s; main p99 unchanged vs AC-2 (P2). */
const AC7_RESTART_MS = 3_000;
const AC7_P99_MS = AC2_P2_P99_MS;

jest.setTimeout(420_000);

beforeAll(() => {
  ensureHostBundleExists();
});

perfDescribe('ST-2 — host stress perf budgets (TASK_2026_437 AC-2 P2)', () => {
  it('75,000-file mass delete keeps the loop within AC-2 (P2)', async () => {
    const result = await runMassDeleteStorm(TOTAL_FILES, SETTLE_MS);
    console.log(
      `[ST-2 perf, ${process.platform}] files=${TOTAL_FILES} delete=${result.deleteMs}ms ` +
        `batches=${result.batches} overflow=${result.overflowBatches} ` +
        `changedPaths=${result.changedPaths} dropped=${result.droppedTotal} ` +
        `hostRestarts=${result.hostRestarts} nativeErrorDiagnosed=${result.nativeErrorDiagnosed} ` +
        `hostRestartedDuringRun=${result.hostRestartedDuringRun} ` +
        `rss(kb) before=${result.rssBeforeKb} peak=${result.rssPeakKb ?? 'not sampled'} after=${result.rssAfterKb} ` +
        `rssMonitorErrors=${result.rssMonitorErrors.length} ` +
        `loop p50=${result.delay.p50Ms.toFixed(2)}ms p99=${result.delay.p99Ms.toFixed(2)}ms max=${result.delay.maxMs.toFixed(2)}ms ` +
        `— incident baseline 265-615ms lag every 2s; AC-2 P2 budget p99<=${AC2_P2_P99_MS}ms max<=${AC2_P2_MAX_MS}ms`,
    );

    expect(result.hostExitedUnexpectedly).toBe(false);
    expect(result.delay.p99Ms).toBeLessThanOrEqual(AC2_P2_P99_MS);
    expect(result.delay.maxMs).toBeLessThanOrEqual(AC2_P2_MAX_MS);
  });
});

perfDescribe('AC-7 — host-kill perf budgets', () => {
  it('restart ≤ 3 s and main p99 unchanged vs AC-2 (P2)', async () => {
    // Passing the budget itself as the restart-wait timeout means a slow
    // restart fails this test the same way a missed budget would; the
    // explicit assertion below is belt-and-suspenders documentation of the
    // same number, matching `git-watcher.stress.perf.spec.ts`'s style of
    // asserting the acceptance table's figure directly.
    const result = await runSingleKillScenario(AC7_RESTART_MS);
    console.log(
      `[AC-7 single kill perf, ${process.platform}] restartMs=${result.restartMs} ` +
        `overflowA=${result.overflowA} overflowB=${result.overflowB} ` +
        `loop p50=${result.delay.p50Ms.toFixed(2)}ms p99=${result.delay.p99Ms.toFixed(2)}ms max=${result.delay.maxMs.toFixed(2)}ms ` +
        `— budget restart<=${AC7_RESTART_MS}ms p99<=${AC7_P99_MS}ms`,
    );

    expect(result.restartMs).toBeLessThanOrEqual(AC7_RESTART_MS);
    expect(result.overflowA).toBe(1);
    expect(result.overflowB).toBe(1);
    expect(result.isDegraded).toBe(false);
    expect(result.delay.p99Ms).toBeLessThanOrEqual(AC7_P99_MS);
  });
});
