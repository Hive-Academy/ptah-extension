/**
 * The tier split in `DRAIN_TIER_LIMITS` — how MUCH each tier drains, as opposed
 * to WHICH stages it may run (`DRAIN_TIER_STAGES`, pinned by the fairness spec).
 *
 * ## What went wrong, measured rather than reasoned
 *
 * `archaeology` is nightly-only, the nightly cron fires ONCE a day, and the old
 * selection took `maxItemsPerRun` (4) items with `perWorkspaceBatch` (1) from
 * each workspace in a SINGLE pass. Against a real 849-session corpus that is a
 * supply of at most four rows a day — in practice one, because 85 % of sessions
 * belong to a single project and a lone workspace yielded exactly
 * `perWorkspaceBatch` — against a demand of ~30 new sessions a day, each of
 * which chains one archaeology row. The standing backlog measured 835 rows and
 * grew monotonically, so the stage shipped inert while `maxTokensPerDay`
 * (2 000 000) sat ~96 % unspent.
 *
 * ## What this spec pins, and why BOTH halves are needed
 *
 * The fix is a per-tier item cap plus round-robin ROUNDS on the nightly tier
 * only. Each half fails differently, so each needs its own assertion:
 *
 *  - **The cap alone is not enough.** With one dominant workspace and a
 *    single-pass deal, raising the cap to 40 still yields exactly ONE row —
 *    `perWorkspaceBatch` binds long before the cap does. `takes the whole
 *    nightly cap from a single workspace` is the assertion that catches a
 *    reviewer who "simplifies" the rounds away and leaves the number.
 *  - **Rounds alone are not enough either**, and rounds applied to the frequent
 *    tier are an unmeasured 4× on a cadence that is already keeping up — one
 *    that runs the token-spending `synthesis` and `judge` stages 96 times a day.
 *    The three frequent-tier assertions below fail the moment that tier is
 *    given the nightly cap, the nightly rounds, or both.
 *
 * The alternative fix — a big `perWorkspaceBatch` for the nightly tier — is
 * rejected here in code, not in prose: `splits the nightly cap evenly between
 * two busy workspaces` is exactly what a big batch cannot do, because every
 * workspace visited on one tick carries the identical `last_drained_at` and the
 * order among them then falls back to `workspace_root ASC`.
 *
 * Runs the REAL store over a real SQLite file: the round-robin order lives in
 * `ELIGIBLE_WORKSPACES_SQL` and the eligibility window in `ELIGIBLE_SQL`, so a
 * mocked store would assert the test's own arithmetic instead of the product's.
 */
import 'reflect-metadata';
import { SkillQueueStore } from './skill-queue.store';
import {
  SkillDrainService,
  SKILL_DRAIN_DEFAULTS,
  SKILL_DRAIN_KEYS,
} from './skill-drain.service';
import type { SkillQueueRow, SkillQueueStage } from './skill-queue.types';
import {
  asConnection,
  makeTempDbPath,
  noopLogger,
  openQueueDb,
  resolveOpener,
  type TestDatabase,
} from './queue-db.test-support';
import {
  liveSignal,
  makeBudgetStub,
  makeTracker,
  makeWorkspace,
} from './skill-drain.test-support';

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;

/** Alphabetical, because equally-drained workspaces tie-break on the root. */
const WS_A = 'D:/repo-a';
const WS_B = 'D:/repo-b';

maybe('SkillDrainService — per-tier throughput (DRAIN_TIER_LIMITS)', () => {
  let db: TestDatabase;
  let store: SkillQueueStore;
  let handled: SkillQueueRow[];

  const makeDrainOver = (settings: Record<string, unknown> = {}) => {
    const drain = new SkillDrainService(
      noopLogger,
      store,
      makeBudgetStub(0).store,
      makeTracker(),
      makeWorkspace({
        // The SHIPPED values, restated so a default change is visible here as a
        // failure rather than as a silently different test.
        [SKILL_DRAIN_KEYS.maxItemsPerRun]: SKILL_DRAIN_DEFAULTS.maxItemsPerRun,
        [SKILL_DRAIN_KEYS.perWorkspaceBatch]:
          SKILL_DRAIN_DEFAULTS.perWorkspaceBatch,
        ...settings,
      }),
    );
    for (const stage of ['prefilter', 'archaeology'] as SkillQueueStage[]) {
      drain.registerStageHandler(stage, async (ctx) => {
        handled.push(ctx.row);
        return { outcome: 'done' };
      });
    }
    return drain;
  };

  const seed = (
    workspaceRoot: string,
    stage: SkillQueueStage,
    count: number,
    from = 0,
  ): void => {
    for (let i = 0; i < count; i++) {
      store.enqueue({
        sessionId: `${workspaceRoot}#${stage}#${from + i}`,
        stage,
        source: 'session-end',
        workspaceRoot,
        turnCount: 6,
        enqueuedAt: 1_770_000_000_000 + from + i,
      });
    }
  };

  beforeEach(() => {
    const open = opener as NonNullable<typeof opener>;
    db = openQueueDb(open, makeTempDbPath());
    store = new SkillQueueStore(noopLogger, asConnection(db));
    handled = [];
  });

  afterEach(() => {
    db.close();
  });

  describe('the nightly tier', () => {
    it('takes the whole nightly cap from a single workspace', async () => {
      // 85 % of the measured corpus is one project, so this IS the real shape.
      // `perWorkspaceBatch` is 1 and the cap is 40: only repeated rounds can
      // close that gap, and a single-pass deal returns exactly 1.
      seed(WS_A, 'archaeology', 60);

      const summary = await makeDrainOver().drain({
        tier: 'nightly',
        signal: liveSignal(),
        onBattery: false,
      });

      expect(handled).toHaveLength(SKILL_DRAIN_DEFAULTS.nightlyMaxItemsPerRun);
      expect(summary).toMatchObject({
        skipped: false,
        claimed: SKILL_DRAIN_DEFAULTS.nightlyMaxItemsPerRun,
        done: SKILL_DRAIN_DEFAULTS.nightlyMaxItemsPerRun,
        workspacesVisited: 1,
      });
    });

    it('reads its own settings key, not the frequent tier one', async () => {
      seed(WS_A, 'archaeology', 60);

      const summary = await makeDrainOver({
        // Deliberately divergent: if the nightly tier ever falls back to the
        // shared key it takes 9, and if it ignores its own key it takes 40.
        [SKILL_DRAIN_KEYS.maxItemsPerRun]: 9,
        [SKILL_DRAIN_KEYS.nightlyMaxItemsPerRun]: 25,
      }).drain({ tier: 'nightly', signal: liveSignal(), onBattery: false });

      expect(summary.claimed).toBe(25);
    });

    it('scans past the 20-row eligibility floor when the cap is larger', async () => {
      // `ELIGIBLE_SCAN_LIMIT` is 20. A cap of 40 that still scanned 20 rows per
      // workspace would silently halve the tick and look like a fairness
      // property rather than an off-by-a-constant.
      seed(WS_A, 'archaeology', 60);

      const summary = await makeDrainOver().drain({
        tier: 'nightly',
        signal: liveSignal(),
        onBattery: false,
      });

      expect(summary.claimed).toBeGreaterThan(20);
    });

    it('splits the nightly cap evenly between two busy workspaces', async () => {
      // The rejected alternative — nightly `perWorkspaceBatch: 40` — gives
      // 40/0 here, because both roots are stamped with the same
      // `last_drained_at` and `workspace_root ASC` decides the rest forever.
      seed(WS_A, 'archaeology', 60);
      seed(WS_B, 'archaeology', 60, 1000);

      await makeDrainOver().drain({
        tier: 'nightly',
        signal: liveSignal(),
        onBattery: false,
      });

      expect(countByWorkspace(handled)).toEqual({ [WS_A]: 20, [WS_B]: 20 });
    });

    it('does not end the walk at the first workspace that could fill the cap', async () => {
      // The visit loop stops on ROUND-ONE supply, not total supply. Measuring
      // total supply would let WS_A's 60 rows end the walk before WS_B was
      // visited — and an unvisited workspace is also an unbumped cursor.
      seed(WS_A, 'archaeology', 60);
      seed(WS_B, 'archaeology', 1, 1000);

      const summary = await makeDrainOver().drain({
        tier: 'nightly',
        signal: liveSignal(),
        onBattery: false,
      });

      expect(summary.workspacesVisited).toBe(2);
      expect(countByWorkspace(handled)).toEqual({ [WS_A]: 39, [WS_B]: 1 });
    });

    it('leaves perWorkspaceBatch at 1 — the cap alone drives throughput', async () => {
      // The knob this batch deliberately did NOT touch. Rounds make the batch a
      // fairness quantum, so 1 still reaches the cap; this pins that the shipped
      // default is the one being exercised above.
      expect(SKILL_DRAIN_DEFAULTS.perWorkspaceBatch).toBe(1);
    });
  });

  describe('the frequent tier is untouched', () => {
    it('still takes at most maxItemsPerRun across many workspaces', async () => {
      // Six workspaces, one row each. Under the frequent cap that is 4 rows and
      // 4 visited workspaces; under the nightly cap it would be all 6.
      for (let i = 0; i < 6; i++) {
        seed(`D:/repo-${i}`, 'prefilter', 1, i * 100);
      }

      const summary = await makeDrainOver().drain({
        tier: 'frequent',
        signal: liveSignal(),
        onBattery: false,
      });

      expect(summary.claimed).toBe(SKILL_DRAIN_DEFAULTS.maxItemsPerRun);
      expect(summary.workspacesVisited).toBe(
        SKILL_DRAIN_DEFAULTS.maxItemsPerRun,
      );
    });

    it('still takes exactly perWorkspaceBatch from a lone workspace', async () => {
      // Single-round. This is the assertion that goes red if the frequent tier
      // is given `multiRound`, which would quadruple its dispatch rate 96 times
      // a day — including its token-spending `synthesis` and `judge` stages.
      seed(WS_A, 'prefilter', 60);

      const summary = await makeDrainOver().drain({
        tier: 'frequent',
        signal: liveSignal(),
        onBattery: false,
      });

      expect(summary.claimed).toBe(SKILL_DRAIN_DEFAULTS.perWorkspaceBatch);
    });

    it('never reaches a nightly-only stage however large the nightly cap is', async () => {
      // The two tables are independent: the cap says how much, `DRAIN_TIER_STAGES`
      // says what. A tier split that leaked stages would be a much worse bug
      // than the throughput one this batch fixes.
      seed(WS_A, 'archaeology', 60);

      const summary = await makeDrainOver({
        [SKILL_DRAIN_KEYS.nightlyMaxItemsPerRun]: 500,
      }).drain({ tier: 'frequent', signal: liveSignal(), onBattery: false });

      expect(handled).toEqual([]);
      expect(summary.claimed).toBe(0);
      // Visited and cursor-bumped all the same — R4's rule for a workspace
      // whose rows all belong to another tier.
      expect(summary.workspacesVisited).toBe(1);
    });
  });

  describe('the weekly tier keeps the shared cap', () => {
    it('takes maxItemsPerRun, not the nightly cap', async () => {
      // Weekly's own stages have no producers yet, and everything it shares
      // with the nightly tier was drained by that night's 03:00 tick an hour
      // earlier. Giving it an unmeasured cap now would be the scope creep the
      // nightly measurement specifically avoided.
      for (let i = 0; i < 6; i++) {
        seed(`D:/repo-${i}`, 'prefilter', 1, i * 100);
      }

      const summary = await makeDrainOver().drain({
        tier: 'weekly',
        signal: liveSignal(),
        onBattery: false,
      });

      expect(summary.claimed).toBe(SKILL_DRAIN_DEFAULTS.maxItemsPerRun);
    });
  });
});

function countByWorkspace(rows: SkillQueueRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.workspaceRoot] = (out[row.workspaceRoot] ?? 0) + 1;
  }
  return out;
}
