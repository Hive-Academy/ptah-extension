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

/**
 * Batch 11 proved the STRICT AC-2 mechanism (exactly one overflow batch,
 * exactly one refresh cycle) at THIS tree size — the same size the CI
 * mechanism spec (`git-watcher.stress.spec.ts`) uses. It does not hold at the
 * acceptance table's own 75,000-file perf tree size — see FU-15b below and
 * `test-report-b15.md`.
 */
const TOTAL_FILES_STRICT = 8_000;

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

    it('ST-1b (8,000 files): strict AC-2 mechanism — exactly one overflow batch, exactly one refresh (Batch 11 scale)', async () => {
      const tree = path.join(rig.workspaceRoot, 'pkgs', 'big');
      buildCheckoutTree(tree, TOTAL_FILES_STRICT, false);
      await rig.armAndSettleBaseline(BASELINE_TIMEOUT_MS);

      const window = await rig.deleteAndSettle(tree, SETTLE_MS);
      console.log(
        `${rig.describe('ST-1b strict (8k) perf', window)} batchLog=${JSON.stringify(
          rig.batchLog.map((b) => ({
            ...b,
            at: b.at - window.deleteStartedAt,
          })),
        )} warnLines=${JSON.stringify(rig.warnLines)}`,
      );

      // Strict AC-2 mechanism, proven on an idle machine in Batch 11 AT THIS
      // TREE SIZE: exactly ONE batch for the whole incident, and it is the
      // overflow; exactly ONE refresh cycle. This does NOT extend to the
      // 75,000-file tree below — see that test and FU-15b.
      expect(rig.batchLog).toHaveLength(1);
      expect(rig.batchLog[0]).toMatchObject({ overflow: true, paths: 0 });
      expect(rig.refreshCycles()).toHaveLength(1);
    });

    it('ST-1b: deleting 75,000 files under pkgs/big/ keeps the loop within AC-2 P1 and a bounded overflow/refresh shape (FU-15b)', async () => {
      const tree = path.join(rig.workspaceRoot, 'pkgs', 'big');
      buildCheckoutTree(tree, TOTAL_FILES, false);
      await rig.armAndSettleBaseline(BASELINE_TIMEOUT_MS);

      const window = await rig.deleteAndSettle(tree, SETTLE_MS);
      const batches = rig.batchLog;
      const overflowBatches = batches.filter((b) => b.overflow);
      const nonOverflowBatches = batches.filter((b) => !b.overflow);
      const cycles = rig.refreshCycles();
      const truncatedContentPushes = rig
        .contentPushes()
        .filter((p) => (p.payload as { truncated: boolean }).truncated);
      console.log(
        `${rig.describe('ST-1b perf', window)} batchLog=${JSON.stringify(
          batches.map((b) => ({ ...b, at: b.at - window.deleteStartedAt })),
        )} warnLines=${JSON.stringify(rig.warnLines)}`,
      );

      expect(window.delay.p99Ms).toBeLessThanOrEqual(AC2_P1_P99_MS);
      expect(window.delay.maxMs).toBeLessThanOrEqual(AC2_P1_MAX_MS);

      // Bounded AC-2 mechanism at the 75,000-file scale (FU-15b — NOT the
      // strict "exactly one" form Batch 11 proved at 8,000 files, see the
      // test above). Measured on this idle machine: 3 overflow batches / 3
      // refresh cycles in one confirmation run, 2 / 2 in another, both with
      // ZERO non-overflow batches and ZERO `rig.warnLines` (no rebuild/
      // native-error diagnostic). Confirmed cause from those runs' own
      // `batchLog` timestamps: the gaps BETWEEN successive overflow batches
      // (~3.1-8.8 s) exceed the coalescer's storm `quietMs` (2,000 ms
      // default, `event-storm-breaker.ts`) — a ~16-20 s delete this size can
      // contain a quiet gap longer than 2 s in the OS's own event delivery
      // (kernel-buffered, delivered in bursts), so the breaker exits the
      // storm and re-enters it when the next burst arrives, once or twice
      // more, before the delete + 10 s settle window closes. NOT
      // `maxStormMs` (30,000 ms default — this window is ~18-20 s, never
      // reached) and NOT a rebuild/native-error overflow (would show up as a
      // `rig.warnLines` entry; none did in either confirmation run).
      expect(batches.length).toBeLessThan(10);
      expect(overflowBatches.length).toBeLessThanOrEqual(3);
      // At most one non-overflow batch may leave before the storm is ever
      // entered, same tolerance as the CI mechanism rule.
      expect(nonOverflowBatches.length).toBeLessThanOrEqual(1);
      // One refresh per overflow, plus the CI rule's own one-pre-storm-batch
      // allowance.
      expect(cycles.length).toBeLessThanOrEqual(overflowBatches.length + 1);
      // At most one truncated content push per overflow — never more pushes
      // than incidents.
      expect(truncatedContentPushes.length).toBeLessThanOrEqual(
        overflowBatches.length,
      );
    });
  },
);
