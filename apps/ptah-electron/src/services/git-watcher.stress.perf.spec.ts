/**
 * ADVISORY perf spec for the ST-1 / ST-1b incident (TASK_2026_437 AC-1, AC-2
 * P1) — opt-in, never a CI gate.
 *
 * An absolute event-loop-delay budget measures the HOST, and this repository
 * normally runs several agents building and testing in one working tree, so
 * the budgets live here rather than in the always-run
 * `git-watcher.stress.spec.ts` (mechanism counts). Same split, and same
 * reasoning, as `off-thread-process-spawner.perf.spec.ts`. This spec asserts
 * ONLY the budgets; it logs the mechanism counts for context, so a mechanism
 * regression cannot hide the numbers.
 *
 *   PTAH_PERF_SPECS=1 npx nx test ptah-electron --testPathPattern=git-watcher.stress.perf
 *
 * Run it on a QUIET machine, against the acceptance table's 75,000-file tree.
 */

import 'reflect-metadata';

import * as path from 'path';

import {
  GitWatcherStressRig,
  buildCheckoutTree,
} from './git-watcher.stress.harness';

const PERF_ENABLED = process.env['PTAH_PERF_SPECS'] === '1';

/** `describe` when explicitly enabled, `describe.skip` otherwise. */
const perfDescribe = PERF_ENABLED ? describe : describe.skip;

/** Acceptance table: "75,000 files in ~7,500 directories". */
const TOTAL_FILES = 75_000;

/** Both budgets are measured over delete + 10 s. */
const SETTLE_MS = 10_000;

const BASELINE_TIMEOUT_MS = 120_000;

/** AC-1: p99 ≤ 50 ms, max ≤ 200 ms. */
const AC1_P99_MS = 50;
const AC1_MAX_MS = 200;

/** AC-2 (P1): p99 ≤ 100 ms, max ≤ 500 ms. */
const AC2_P1_P99_MS = 100;
const AC2_P1_MAX_MS = 500;

jest.setTimeout(420_000);

perfDescribe(
  'GitWatcherService — incident perf budgets ST-1 / ST-1b (TASK_2026_437)',
  () => {
    let rig: GitWatcherStressRig;

    beforeEach(() => {
      rig = new GitWatcherStressRig();
    });

    afterEach(() => {
      rig.dispose();
    });

    it('ST-1: deleting 75,000 files under .claude-worktrees/ keeps the loop within AC-1', async () => {
      const tree = path.join(rig.workspaceRoot, '.claude-worktrees');
      buildCheckoutTree(tree, TOTAL_FILES, true);
      await rig.armAndSettleBaseline(BASELINE_TIMEOUT_MS);

      const window = await rig.deleteAndSettle(tree, SETTLE_MS);
      console.log(rig.describe('ST-1 perf', window));

      expect(window.delay.p99Ms).toBeLessThanOrEqual(AC1_P99_MS);
      expect(window.delay.maxMs).toBeLessThanOrEqual(AC1_MAX_MS);
    });

    it('ST-1b: deleting 75,000 files under pkgs/big/ keeps the loop within AC-2 P1', async () => {
      const tree = path.join(rig.workspaceRoot, 'pkgs', 'big');
      buildCheckoutTree(tree, TOTAL_FILES, false);
      await rig.armAndSettleBaseline(BASELINE_TIMEOUT_MS);

      const window = await rig.deleteAndSettle(tree, SETTLE_MS);
      console.log(rig.describe('ST-1b perf', window));

      expect(window.delay.p99Ms).toBeLessThanOrEqual(AC2_P1_P99_MS);
      expect(window.delay.maxMs).toBeLessThanOrEqual(AC2_P1_MAX_MS);
    });
  },
);
