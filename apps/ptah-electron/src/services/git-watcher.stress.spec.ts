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
   * ST-1b on the watch host — the AC-2 contract, unchanged from P1: one
   * recursive delete of a non-excluded tree costs exactly ONE refresh and ONE
   * truncated content push.
   *
   * How it holds: `@parcel/watcher` reports the delete's first event alone
   * (measured ~80-110 ms in) and the rest up to ~550 ms later in one callback.
   * The host coalescer holds the first batch after a quiet period for the
   * subscription's `minBatchIntervalMs` (1 s for `GitWatcherService`), so the
   * lone event is still pending when the flood enters the storm, which folds
   * it into the storm's single `overflow`.
   *
   * Asserted:
   *   1. Main receives exactly one batch for the incident, and it is the
   *      `overflow` — no normal batch before it, nothing after it (FU-4d: no
   *      directory `update` echo of our own `git status`).
   *   2. No refresh starts before the delete has finished.
   *   3. Exactly ONE refresh cycle (at most one `git status`) and ONE status
   *      push. Cycles are counted by their first spawn (the `rev-parse`
   *      probe): under load the probe can fail and end the cycle before
   *      `git status` is spawned.
   *   4. Exactly one content push, and it is truncated.
   */
  it('ST-1b: recursive delete under pkgs/big/ settles to exactly one refresh and one truncated push (AC-2)', async () => {
    const tree = path.join(rig.workspaceRoot, 'pkgs', 'big');
    buildCheckoutTree(tree, TOTAL_FILES, false);
    await rig.armAndSettleBaseline(BASELINE_TIMEOUT_MS);

    const window = await rig.deleteAndSettle(tree, SETTLE_MS);
    const refreshedInWindow = rig.refreshCycles().length > 0;
    await sleep(SECOND_REFRESH_GRACE_MS);
    console.log(
      `${rig.describe('ST-1b', window)} refreshedInWindow=${refreshedInWindow} ` +
        `batchLog=${JSON.stringify(
          rig.batchLog.map((b) => ({
            ...b,
            at: b.at - window.deleteStartedAt,
          })),
        )} cycles=${JSON.stringify(
          rig.refreshCycles().map((c) => c.at - window.deleteStartedAt),
        )}`,
    );

    const cycles = rig.refreshCycles();

    expect(rig.batchLog).toHaveLength(1);
    expect(rig.batchLog[0]).toMatchObject({ overflow: true, paths: 0 });
    expect(rig.directoryUpdates).toBe(0);
    expect(refreshedInWindow).toBe(true);
    expect(cycles.every((cycle) => cycle.at >= window.deleteEndedAt)).toBe(
      true,
    );
    expect(cycles).toHaveLength(1);
    expect(rig.statusSpawns().length).toBeLessThanOrEqual(1);
    expect(rig.statusPushes()).toHaveLength(1);
    expect(rig.contentPushes()).toHaveLength(1);
    expect(
      (rig.contentPushes()[0].payload as { truncated: boolean }).truncated,
    ).toBe(true);
  });
});
