/**
 * Incident stress tests — ST-1 / ST-1b mechanism (TASK_2026_437 P1, rerun on
 * the P2 watch host).
 *
 * Reproduces the 2026-09-14 trigger against the REAL services (see
 * `git-watcher.stress.harness.ts`): a real `GitWatcherService` fed by the real
 * `ElectronWorkspaceWatcher` over the built `@parcel/watcher` host, on an
 * 8,000-file tree. Asserts only mechanism counts: git status spawns, renderer
 * pushes, batch shapes. The event-loop delay is logged, never asserted here —
 * absolute budgets live in `git-watcher.stress.perf.spec.ts` behind
 * `PTAH_PERF_SPECS=1`, following `off-thread-process-spawner.perf.spec.ts`.
 * Every count is logged BEFORE the first assertion, so a failing run still
 * explains itself.
 *
 * ST-1  — agent worktrees under `.claude-worktrees/`. Deleting them must cost
 *         0 `git status` spawns and 0 pushes inside delete + 10 s.
 * ST-1b — a plain tree of the same size under `pkgs/big/` (no `.git`
 *         pointers, so nothing excludes it). See that test for exactly what
 *         is guaranteed.
 *
 * Scope decisions (unchanged from `test-report-b6.md`): no real
 * `WorkspaceFileIndexService` here (its overflow rebuild is pinned in
 * `workspace-file-index.service.spec.ts`), and the I1 ablations are not run.
 */

import 'reflect-metadata';

import * as path from 'path';

import {
  GitWatcherStressRig,
  buildCheckoutTree,
  sleep,
} from './git-watcher.stress.harness';

/** Two orders of magnitude above the storm breaker's 500 events/s threshold. */
const TOTAL_FILES = 8_000;

/** The acceptance window after the delete (plan: "waits 10 s"). */
const SETTLE_MS = 10_000;

/** Baseline gate timeout: covers the host fork, the initial refresh and slow git. */
const BASELINE_TIMEOUT_MS = 60_000;

/**
 * Extra wait after the window so a wrong second refresh would be counted: a
 * batch echoing the first refresh would wait out the 2 s workspace debounce
 * and a host batch interval before it spawned.
 */
const SECOND_REFRESH_GRACE_MS = 4_000;

jest.setTimeout(180_000);

describe('GitWatcherService — incident stress tests ST-1 / ST-1b (TASK_2026_437)', () => {
  let rig: GitWatcherStressRig;

  beforeEach(() => {
    rig = new GitWatcherStressRig();
  });

  afterEach(() => {
    rig.dispose();
  });

  it('ST-1: recursive delete under .claude-worktrees/ costs no git status and no push (AC-1)', async () => {
    const tree = path.join(rig.workspaceRoot, '.claude-worktrees');
    buildCheckoutTree(tree, TOTAL_FILES, true);
    await rig.armAndSettleBaseline(BASELINE_TIMEOUT_MS);

    const window = await rig.deleteAndSettle(tree, SETTLE_MS);
    console.log(rig.describe('ST-1', window));

    expect(rig.statusSpawns()).toHaveLength(0);
    expect(rig.spawnCount()).toBe(0);
    expect(rig.statusPushes()).toHaveLength(0);
    expect(rig.contentPushes()).toHaveLength(0);
    // Excluded in the host: no path reaches main and no storm is entered.
    expect(rig.changedPaths).toBe(0);
    expect(rig.overflowBatches).toBe(0);
  });

  /**
   * ST-1b on the watch host — the AC-2 mechanism contract.
   *
   * How it usually holds: `@parcel/watcher` reports the delete's first event
   * alone (measured ~80-110 ms in) and the rest up to ~550 ms later in one
   * callback. The host coalescer holds the first batch after a quiet period
   * for the subscription's `minBatchIntervalMs` (1 s for `GitWatcherService`),
   * so the lone event is still pending when the flood enters the storm, which
   * folds it into the storm's single `overflow` — on an IDLE machine this
   * yields exactly one batch total (the strict form
   * `git-watcher.stress.perf.spec.ts` asserts under `PTAH_PERF_SPECS=1`).
   *
   * **CI run 34922130353 (`main`, ubuntu, `nx run ptah-electron:test --coverage
   * --maxWorkers=2`) failed the strict `toHaveLength(1)` form**: on a loaded
   * Linux runner the recursive delete can start below the storm threshold, so
   * the first ~29 paths legitimately leave as a normal (non-overflow) batch
   * BEFORE the flood pushes the coalescer into the storm — the 1 s leading
   * hold only absorbs a LONE leading event, not a small batch, on a slow
   * machine (FU-11h residual: "timed 1 s hold residual risk on very slow
   * machines"). This is correct product behaviour under load, not a defect,
   * so the CI-always mechanism form below tolerates it (R-P11: CI asserts the
   * bounded mechanism; the exact single-batch/single-refresh form is an
   * idle-machine perf-spec assertion, not a CI one).
   *
   * Asserted here (bounded mechanism, holds under load):
   *   1. At most ONE non-overflow batch arrives BEFORE the overflow.
   *   2. One storm overflow, or the port's documented two-overflow native
   *      rebuild sequence, arrives for the incident.
   *   3. No normal batch arrives AFTER the first overflow (FU-4d: no directory `update`
   *      echo of our own `git status`, and delivery does not run on after the
   *      incident is over).
   *   4. At most one refresh cycle starts before the overflow (the leading
   *      non-overflow batch, if any, may trigger one), and exactly one refresh
   *      cycle starts per overflow at-or-after the first. Cycles are counted
   *      by their first spawn
   *      (the `rev-parse` probe): under load the probe can fail and end the
   *      cycle before `git status` is spawned.
   *   5. Each overflow produces one truncated content push, without amplification.
   *   6. No NTFS/echo directory-update artifact (`directoryUpdates === 0`).
   */
  it('ST-1b: recursive delete under pkgs/big/ settles to a bounded refresh/overflow shape (AC-2)', async () => {
    const tree = path.join(rig.workspaceRoot, 'pkgs', 'big');
    buildCheckoutTree(tree, TOTAL_FILES, false);
    await rig.armAndSettleBaseline(BASELINE_TIMEOUT_MS);

    const window = await rig.deleteAndSettle(tree, SETTLE_MS);
    await sleep(SECOND_REFRESH_GRACE_MS);
    console.log(
      `${rig.describe('ST-1b', window)} ` +
        `batchLog=${JSON.stringify(
          rig.batchLog.map((b) => ({
            ...b,
            at: b.at - window.deleteStartedAt,
          })),
        )} cycles=${JSON.stringify(
          rig.refreshCycles().map((c) => c.at - window.deleteStartedAt),
        )}`,
    );

    const batches = rig.batchLog;
    const overflowIndex = batches.findIndex((b) => b.overflow);
    expect(overflowIndex).toBeGreaterThanOrEqual(0); // an overflow batch exists at all

    const overflowBatches = batches.filter((b) => b.overflow);
    const batchesBeforeOverflow = batches.slice(0, overflowIndex);
    const batchesAfterOverflow = batches.slice(overflowIndex + 1);
    const overflowAt = batches[overflowIndex].at;
    const cycles = rig.refreshCycles();
    const cyclesBeforeOverflow = cycles.filter((c) => c.at < overflowAt);
    const cyclesAfterOverflow = cycles.filter((c) => c.at >= overflowAt);

    // 1-3: batch shape around the bounded overflow/rebuild sequence.
    expect(batchesBeforeOverflow.length).toBeLessThanOrEqual(1);
    expect(overflowBatches.length).toBeGreaterThanOrEqual(1);
    expect(overflowBatches.length).toBeLessThanOrEqual(2);
    expect(batchesAfterOverflow.every((batch) => batch.overflow)).toBe(true);
    // 4: refresh cycles around the overflow/rebuild sequence.
    expect(cyclesBeforeOverflow.length).toBeLessThanOrEqual(1);
    expect(cyclesAfterOverflow).toHaveLength(overflowBatches.length);
    // 5: content pushes have a one-to-one relationship with recovery signals.
    expect(rig.contentPushes()).toHaveLength(overflowBatches.length);
    expect(
      rig
        .contentPushes()
        .every(
          (push) =>
            (push.payload as { truncated: boolean }).truncated === true,
        ),
    ).toBe(true);
    // 6: no directory-update echo.
    expect(rig.directoryUpdates).toBe(0);
  });
});
