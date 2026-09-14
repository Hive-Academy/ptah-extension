/**
 * Incident stress tests — ST-1 / ST-1b mechanism (TASK_2026_437 P1).
 *
 * Reproduces the 2026-09-14 trigger against the REAL services (see
 * `git-watcher.stress.harness.ts`) on an 8,000-file tree and asserts only
 * mechanism counts: git status spawns, renderer pushes, storm lines. The
 * event-loop delay is logged, never asserted here — absolute budgets live in
 * `git-watcher.stress.perf.spec.ts` behind `PTAH_PERF_SPECS=1`, following
 * `off-thread-process-spawner.perf.spec.ts`. Every count is logged BEFORE the
 * first assertion, so a failing run still explains itself.
 *
 * ST-1  — agent worktrees under `.claude-worktrees/`. Deleting them must cost
 *         0 `git status` spawns and 0 pushes inside delete + 10 s.
 * ST-1b — a plain tree of the same size under `pkgs/big/` (no `.git`
 *         pointers, so nothing excludes it). See that test for exactly what
 *         is guaranteed and why storm entry is not.
 *
 * Scope decisions (unchanged from `test-report-b6.md`): no real
 * `WorkspaceFileIndexService` here (its storm mechanism is pinned in
 * `workspace-file-index.service.spec.ts`), and the I1 ablations are not run.
 */

import 'reflect-metadata';

import * as path from 'path';

import {
  GitWatcherStressRig,
  buildCheckoutTree,
  sleep,
  waitFor,
} from './git-watcher.stress.harness';

/** Two orders of magnitude above the storm breaker's 500 events/s threshold. */
const TOTAL_FILES = 8_000;

/** The acceptance window after the delete (plan: "waits 10 s"). */
const SETTLE_MS = 10_000;

/** Baseline gate timeout: covers a 30 s unattributed safety refresh from the arm phase plus slow git. */
const BASELINE_TIMEOUT_MS = 60_000;

/**
 * `GitWatcherService.UNATTRIBUTED_QUIET_MS` plus margin: the latest a change
 * seen only as unnamed events is refreshed.
 */
const UNATTRIBUTED_REFRESH_DEADLINE_MS = 30_000 + 5_000;

/** Extra wait after the first refresh so a wrong second one would be counted. */
const SECOND_REFRESH_GRACE_MS = 3_000;

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

    // Unnamed events (OS buffer overflow markers) may occur, but they can at
    // most schedule one safety refresh 30 s after they stop — outside this
    // window by construction.
    expect(rig.statusSpawns()).toHaveLength(0);
    expect(rig.spawnCount()).toBe(0);
    expect(rig.statusPushes()).toHaveLength(0);
    expect(rig.contentPushes()).toHaveLength(0);
    // Excluded events never reach the breaker.
    expect(rig.stormLines('entered')).toBe(0);
  });

  /**
   * What ST-1b guarantees, and why storm entry is NOT one of the guarantees.
   *
   * libuv watches a directory tree on Windows with a 4 KB
   * `ReadDirectoryChangesW` buffer (`src/win/fs-event.c`,
   * `uv_directory_watcher_buffer_size`); when it overflows, libuv invokes the
   * callback once with a NULL filename. A fast recursive delete while the main
   * thread is starved (the review run: the whole project's suites in parallel)
   * can therefore reach the watcher as a few unnamed events plus a trickle of
   * named ones, and the breaker legitimately never enters a storm — the
   * `enteredCount 0` run. What must hold whichever way the OS delivered it:
   *
   *   1. No refresh starts before the delete has finished.
   *   2. Exactly ONE refresh cycle (at most one `git status`) and ONE status
   *      push for the whole incident — the change is never lost and never
   *      refreshed twice. It comes from the storm exit or the debounce inside
   *      the 10 s window, or, when the only trace was unnamed events, from the
   *      safety refresh within ~35 s. Cycles are counted by their first spawn
   *      (the `rev-parse` probe): under load the probe can fail and end the
   *      cycle before `git status` is spawned (reproduced with the CPU
   *      saturated: 1 push, 1 spawn, 0 `status`).
   *   3. At most one content push; when a storm was entered, exactly one, and
   *      it is truncated.
   *   4. A storm, if entered, was entered and exited exactly once.
   */
  it('ST-1b: recursive delete under pkgs/big/ settles to exactly one refresh (AC-2 P1)', async () => {
    const tree = path.join(rig.workspaceRoot, 'pkgs', 'big');
    buildCheckoutTree(tree, TOTAL_FILES, false);
    await rig.armAndSettleBaseline(BASELINE_TIMEOUT_MS);

    const window = await rig.deleteAndSettle(tree, SETTLE_MS);
    const refreshedInWindow = rig.refreshCycles().length > 0;
    if (!refreshedInWindow) {
      await waitFor(
        () => rig.refreshCycles().length > 0,
        UNATTRIBUTED_REFRESH_DEADLINE_MS,
      );
    }
    await sleep(SECOND_REFRESH_GRACE_MS);
    console.log(
      `${rig.describe('ST-1b', window)} refreshedInWindow=${refreshedInWindow}`,
    );

    const entered = rig.stormLines('entered');
    const cycles = rig.refreshCycles();

    expect(cycles.every((cycle) => cycle.at >= window.deleteEndedAt)).toBe(
      true,
    );
    expect(cycles).toHaveLength(1);
    expect(rig.statusSpawns().length).toBeLessThanOrEqual(1);
    expect(rig.statusPushes()).toHaveLength(1);
    expect(rig.contentPushes().length).toBeLessThanOrEqual(1);
    expect(entered).toBeLessThanOrEqual(1);
    expect(rig.stormLines('exited')).toBe(entered);
    if (entered === 1) {
      expect(refreshedInWindow).toBe(true);
      expect(rig.contentPushes()).toHaveLength(1);
      expect(
        (rig.contentPushes()[0].payload as { truncated: boolean }).truncated,
      ).toBe(true);
    }
    if (!refreshedInWindow) {
      // Only an overflow-shaped delivery may defer the refresh to the safety net.
      expect(rig.unnamedEvents).toBeGreaterThan(0);
    }
  });
});
