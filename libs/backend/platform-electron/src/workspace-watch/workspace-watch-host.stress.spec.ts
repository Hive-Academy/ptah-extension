/**
 * Host stress ST-2 + host-kill AC-7 — MECHANISM (TASK_2026_437 Batch 15),
 * against the REAL packaged watch host. Rig is in
 * `workspace-watch-host.stress.harness.ts`; ms budgets are in the sibling
 * `workspace-watch-host.stress.perf.spec.ts` (Batch 15 style review, serious
 * #2 — same mechanism/perf file split `git-watcher.stress.spec.ts` /
 * `git-watcher.stress.perf.spec.ts` already use, for the same reason: this
 * repository normally runs several agents building and testing in one
 * working tree, and an absolute ms budget asserted unconditionally in CI is
 * exactly what stretches under that contention (`test-report-b6.md`
 * "Environment").
 *
 * ## A1 — does the native subscription survive a Windows buffer overflow?
 *
 * Resolved by reading `WorkspaceWatchHostCore` (platform-core), not by
 * catching the raw engine in the act: EVERY native error — Windows
 * `ReadDirectoryChangesW` overflow included — sets `rebuildRequested` and
 * `overflowOnSettle`; the core never tries to keep a subscription that
 * reported an error, it releases it, awaits the release, and subscribes
 * again (`workspace-watch-host-core.ts` "Re-subscribe versus rebuild"). So
 * from any consumer's vantage point the design answer is "it does not need
 * to survive — the host always rebuilds it".
 *
 * That design answer is UNVERIFIED for the specific native
 * `ReadDirectoryChangesW` overflow path itself: no run of this suite, at up
 * to 75,000 deleted files, has ever produced a genuine
 * `nativeErrorDiagnosed` reading (see the ST-2 test's own log line). The
 * `native-error` → rebuild path IS covered — by `workspace-watch-host-core.spec.ts`'s
 * fake-engine unit specs (which can inject the error deterministically) and
 * by AC-7 at the HOST level (a killed process is a different, but
 * consumer-equivalent, loss of the native subscription) — just not by a real
 * observed Windows buffer overflow. This mirrors a failure mode this same
 * codebase already found on Linux: `@parcel/watcher` silently under-reporting
 * WITHOUT ever invoking the error callback (`batches.md` PR #510 Linux CI
 * fix, parcel-bundler/watcher#243) — the design answer here rests on the
 * assumption that Windows always raises a catchable error on overflow, which
 * this suite has not independently confirmed. How it could be forced later:
 * shrink `@parcel/watcher`'s internal buffer via a build flag if one exists,
 * or synthesize the OS-level condition directly (a test double at the
 * `fs`/native-binding layer) rather than relying on volume alone. Tracked as
 * a follow-up, not resolved by this batch.
 *
 * ## What is real-time vs shortened
 *
 * ST-2 and the "single kill" AC-7 case run the supervisor's PRODUCTION
 * timers (2 s heartbeat, 3 missed = 6 s failure window, 250 ms restart delay,
 * 5-per-10-min budget) against a REAL process kill and a REAL mass file
 * delete. Only the "past the restart budget" degraded-mode case injects a
 * faster `supervision` (a real, documented constructor option — not a mock of
 * internals) so CI does not spend minutes proving a state machine that does
 * not care what the numbers are, only their ordering.
 *
 * ## AC-7 "exactly one overflow" — proven for a bare kill only
 *
 * `workspace-watch-host-core.ts`'s own design sends TWO overflows for an
 * in-host rebuild (native error, refused subscribe, storm-end with
 * unreconciled creates): one when the loss is detected, one once the rebuilt
 * subscription is live. If a real native-level loss is already mid-rebuild
 * at the moment the WHOLE host process is killed, the supervisor's
 * process-failure path (`onHostFailure`) signals a FURTHER overflow on top —
 * `WorkspaceWatchBatchRelay`'s `overflowOwed` is a boolean, so two overflows
 * only collapse into one delivered batch if they land in the SAME 250 ms
 * coalescer flush. The single-kill test below never has a native-level loss
 * in flight (its temp trees are tiny), so it proves "exactly one overflow"
 * for a BARE kill only. The composite case (native loss in flight + process
 * kill) is a documented open risk, not exercised here — see the test report.
 *
 * ## Platform
 *
 * No Windows-only assumption is asserted as a MUST. The mechanism this suite
 * checks — bounded batches, one overflow per loss incident, delivery resumes,
 * host-kill triggers a supervised restart — is the platform-neutral contract
 * every adapter (`@parcel/watcher` on Windows/macOS/Linux) already runs
 * through `runWorkspaceWatcherContract`. `process.platform` is recorded on
 * every logged line so a CI failure is attributable to an OS difference if
 * one appears.
 */
import {
  ensureHostBundleExists,
  runDegradedPastBudgetScenario,
  runMassDeleteStorm,
  runSingleKillScenario,
} from './workspace-watch-host.stress.harness';

beforeAll(() => {
  ensureHostBundleExists();
});

describe('ST-2 — mass delete storm against the real watch host', () => {
  it('CI mechanism (8,000 files): bounded batches, delivery resumes, subscription survives or is rebuilt', async () => {
    const result = await runMassDeleteStorm(8_000, 10_000);
    console.log(
      `[ST-2 mechanism, ${process.platform}] delete=${result.deleteMs}ms ` +
        `batches=${result.batches} overflow=${result.overflowBatches} ` +
        `changedPaths=${result.changedPaths} dropped=${result.droppedTotal} ` +
        `hostRestarts=${result.hostRestarts} nativeErrorDiagnosed=${result.nativeErrorDiagnosed} ` +
        `hostRestartedDuringRun=${result.hostRestartedDuringRun} ` +
        `rss(kb) before=${result.rssBeforeKb} peak=${result.rssPeakKb ?? 'not sampled'} after=${result.rssAfterKb} ` +
        `rssMonitorErrors=${result.rssMonitorErrors.length} ` +
        `loop p50=${result.delay.p50Ms.toFixed(2)}ms p99=${result.delay.p99Ms.toFixed(2)}ms max=${result.delay.maxMs.toFixed(2)}ms`,
    );

    // No per-event message reached the test process: 8,000 deletes must
    // never produce anywhere near 8,000 batches — INV-1's ≤4/s cadence over
    // an ~10-13 s window bounds it well under 100 (comment and bound agree;
    // observed across every run so far: 3).
    expect(result.batches).toBeLessThan(100);
    // The host itself never crashed outright during an UNFORCED storm; a
    // host exit here (as opposed to a native watch error handled by the
    // engine) would be an unexpected fatal, not the mechanism ST-2 tests.
    expect(result.hostExitedUnexpectedly).toBe(false);
    // The storm was OBSERVED, not silently swallowed: recorded + dropped
    // changes must be AT LEAST the number of files deleted (deletes alone;
    // buildTree's directories add more on top, so this is not a tight
    // bound, just the floor the comment always claimed).
    expect(result.changedPaths + result.droppedTotal).toBeGreaterThanOrEqual(
      result.fileCount,
    );
  }, 120_000);
});

describe('AC-7 — real host-kill while subscriptions are active', () => {
  it('one real process.kill of the host pid: exactly one overflow per subscriber (bare kill), resubscribe, delivery resumes', async () => {
    // CI mechanism: only "a restart happened" within a generous timeout —
    // the numeric ≤3,000 ms restart budget is asserted in the perf spec
    // (Batch 15 logic review, moderate — R-P11 keeps ms budgets perf-gated).
    const result = await runSingleKillScenario(30_000);
    console.log(
      `[AC-7 single kill mechanism, ${process.platform}] restartMs=${result.restartMs} ` +
        `overflowA=${result.overflowA} overflowB=${result.overflowB} ` +
        `loop p50=${result.delay.p50Ms.toFixed(2)}ms p99=${result.delay.p99Ms.toFixed(2)}ms max=${result.delay.maxMs.toFixed(2)}ms`,
    );

    expect(result.overflowA).toBe(1);
    expect(result.overflowB).toBe(1);
    expect(result.isDegraded).toBe(false);
  }, 45_000);

  it('repeated kills past the restart budget: degraded, overflow cadence, one DegradationReporter call, then recovers', async () => {
    const result = await runDegradedPastBudgetScenario();
    console.log(
      `[AC-7 degraded, ${process.platform}] restarts=${result.restarts} ` +
        `degradations=${result.degradations} overflowTotal=${result.overflowTotal} ` +
        `overflowAtDegraded=${result.overflowAtDegraded} overflowAfterCadenceWait=${result.overflowAfterCadenceWait}`,
    );

    expect(result.degradations).toBe(1);
    // The degraded rescan cadence delivers at least one more overflow while
    // waiting: this WAS a hand-rolled `if (...) throw` inside the harness;
    // asserted here instead, like every other check.
    expect(result.overflowAfterCadenceWait).toBeGreaterThan(
      result.overflowAtDegraded,
    );
  }, 20_000);
});
