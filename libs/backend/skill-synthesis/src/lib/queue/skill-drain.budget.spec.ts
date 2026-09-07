/**
 * R3 — archaeologist cost scales linearly with session count.
 *
 * Two behaviours protect the daily cap, and they are different from each other:
 *
 *  - The DRAIN-LEVEL gate (`skill-drain.gates.spec.ts`, P0-6) stops a tick that
 *    starts over budget.
 *  - The PER-ITEM check, pinned here, handles a budget exhausted *during* the
 *    tick. Token-spending stages are left untouched — still `queued`, eligible
 *    next tick — while embedding / clustering keep draining, because they cost
 *    nothing but local CPU. "Cheap stages continue after an expensive one
 *    exhausts the budget" is the requirement, and a single drain-level check
 *    cannot express it.
 *
 * Plus the ordering rule: from 80 % of the budget onward the eligible window is
 * sorted cheap-stages-first, so the tail of the budget buys the most work.
 *
 * ## `trigger-eval` is on the SPENDING side of both rules (TASK_2026_253)
 *
 * This file's own header used to name it a free stage. It is not: the gate
 * generates its probe set with one lane call per evaluation, and while it sat
 * outside `TOKEN_SPENDING_STAGES` the drain kept dispatching those rows past
 * `maxTokensPerDay` and, above 80 %, actively PREFERRED them over `judge`. Both
 * halves are pinned below, because a set-membership regression is otherwise
 * invisible — the tokens still reach the ledger, just too late to gate anything.
 *
 * ## So is `prefilter`, and the free list is now TWO stages (TASK_2026_356)
 *
 * The identical defect, found in the identical place, one task later — which is
 * why the last describe block in this file stops pinning stages one at a time
 * and pins the WHOLE classification instead. `prefilter` reaches a model
 * (`runPrefilterStage` → `analyzeSession` → `SkillSynthesizerService.synthesize`
 * → `LaneRunnerService.run`) and was measured at $0.077 on one boot, the single
 * largest line of that boot's ~$0.19, while ranking `0` — cheapest of eleven —
 * in `STAGE_COST_RANK`. Three tests in this file used it as their FREE stage on
 * the strength of the old comment; they now use `embedding`, which is genuinely
 * local, and their intent is unchanged.
 */
import 'reflect-metadata';
import { SkillDrainService, SKILL_DRAIN_KEYS } from './skill-drain.service';
import { SKILL_QUEUE_STAGES } from './skill-queue.types';
import type { SkillQueueRow, SkillQueueStage } from './skill-queue.types';
import type { SkillBudgetStore } from './skill-budget.store';
import type { SkillQueueStore } from './skill-queue.store';
import {
  liveSignal,
  makeLogger,
  makeTracker,
  makeWorkspace,
  type DrainSettings,
} from './skill-drain.test-support';

const MAX_TOKENS = 1_000_000;

function makeRow(
  id: string,
  stage: SkillQueueStage,
  root: string,
): SkillQueueRow {
  return {
    id,
    sessionId: `session-${id}`,
    workspaceRoot: root,
    transcriptPath: null,
    source: 'session-end',
    stage,
    dependsOn: null,
    status: 'queued',
    turnCount: 6,
    attemptCount: 1,
    enqueuedAt: 1_770_000_000_000,
    notBefore: 0,
    claimedBy: null,
    claimedAt: null,
    finishedAt: null,
    lane: null,
    reason: null,
    lastError: null,
    candidateId: null,
    payload: {},
  };
}

/** A queue stub serving a fixed per-workspace eligible window. */
function makeQueueOver(windows: Record<string, SkillQueueRow[]>) {
  const byId = new Map<string, SkillQueueRow>();
  for (const rows of Object.values(windows)) {
    for (const row of rows) byId.set(row.id, row);
  }
  const parts = {
    reapStale: jest.fn(() => 0),
    listEligibleWorkspaces: jest.fn(() => Object.keys(windows)),
    listEligible: jest.fn((root: string) => windows[root] ?? []),
    markWorkspaceDrained: jest.fn(),
    tryClaim: jest.fn((id: string) => byId.get(id) ?? null),
    touchClaim: jest.fn(() => true),
    markDone: jest.fn(),
    markFailed: jest.fn(),
    markUnscored: jest.fn(),
    markSkipped: jest.fn(),
  };
  return { ...parts, store: parts as unknown as SkillQueueStore };
}

function makeBudget(initial: number): {
  store: SkillBudgetStore;
  set(value: number): void;
} {
  let spent = initial;
  return {
    set: (value: number) => {
      spent = value;
    },
    store: {
      spentToday: () => spent,
      // Must invoke `fn`: the drain runs every stage handler inside this scope.
      withStage: <T>(_stage: string, fn: () => T): T => fn(),
    } as unknown as SkillBudgetStore,
  };
}

function makeDrainOver(
  queue: SkillQueueStore,
  budget: SkillBudgetStore,
  settings: DrainSettings = {},
): SkillDrainService {
  return new SkillDrainService(
    makeLogger(),
    queue,
    budget,
    makeTracker(),
    makeWorkspace({
      [SKILL_DRAIN_KEYS.maxTokensPerDay]: MAX_TOKENS,
      // Both caps, because this file drains BOTH tiers: the `weekly` cases
      // below read `weeklyMaxItemsPerRun` and the `frequent` ones further down
      // read `maxItemsPerRun`. Same number, so no case changes shape.
      [SKILL_DRAIN_KEYS.maxItemsPerRun]: 4,
      [SKILL_DRAIN_KEYS.weeklyMaxItemsPerRun]: 4,
      [SKILL_DRAIN_KEYS.perWorkspaceBatch]: 1,
      ...settings,
    }),
  );
}

describe('SkillDrainService — budget (R3)', () => {
  it('orders the window cheap-stages-first above 80% of the budget', async () => {
    const queue = makeQueueOver({
      'D:/repo': [
        makeRow('expensive', 'archaeology', 'D:/repo'),
        makeRow('cheap', 'embedding', 'D:/repo'),
      ],
    });
    // ONE item this tick, so `ran` observes the ORDER of the eligible window
    // rather than its contents. The weekly tier deals in rounds now, so a lone
    // workspace holding two rows would otherwise drain both and the assertion
    // would stop being about ordering at all.
    const drain = makeDrainOver(queue.store, makeBudget(800_000).store, {
      [SKILL_DRAIN_KEYS.weeklyMaxItemsPerRun]: 1,
    });
    const ran: string[] = [];
    for (const stage of ['archaeology', 'embedding'] as const) {
      drain.registerStageHandler(stage, async (ctx) => {
        ran.push(ctx.row.id);
        return { outcome: 'done' };
      });
    }

    await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(ran).toEqual(['cheap']);
  });

  it('keeps enqueue order below 80% of the budget', async () => {
    const queue = makeQueueOver({
      'D:/repo': [
        makeRow('expensive', 'archaeology', 'D:/repo'),
        makeRow('cheap', 'embedding', 'D:/repo'),
      ],
    });
    // Same single-item window as above, and for the same reason.
    const drain = makeDrainOver(queue.store, makeBudget(799_999).store, {
      [SKILL_DRAIN_KEYS.weeklyMaxItemsPerRun]: 1,
    });
    const ran: string[] = [];
    for (const stage of ['archaeology', 'embedding'] as const) {
      drain.registerStageHandler(stage, async (ctx) => {
        ran.push(ctx.row.id);
        return { outcome: 'done' };
      });
    }

    await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(ran).toEqual(['expensive']);
  });

  it('defers token-spending stages but keeps draining cheap ones once the budget runs out mid-tick', async () => {
    const queue = makeQueueOver({
      'D:/a': [makeRow('judge-1', 'judge', 'D:/a')],
      'D:/b': [makeRow('embedding-1', 'embedding', 'D:/b')],
      'D:/c': [makeRow('synthesis-1', 'synthesis', 'D:/c')],
    });
    const budget = makeBudget(0);
    const drain = makeDrainOver(queue.store, budget.store);
    const ran: string[] = [];

    drain.registerStageHandler('judge', async (ctx) => {
      ran.push(ctx.row.id);
      budget.set(MAX_TOKENS); // the lane consumed the rest of the cap
      return { outcome: 'done' };
    });
    for (const stage of ['embedding', 'synthesis'] as const) {
      drain.registerStageHandler(stage, async (ctx) => {
        ran.push(ctx.row.id);
        return { outcome: 'done' };
      });
    }

    const summary = await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(ran).toEqual(['judge-1', 'embedding-1']);
    expect(summary).toMatchObject({
      claimed: 2,
      done: 2,
      budgetDeferred: 1,
      budgetExhausted: true,
    });
    // The deferred row was never claimed, so it stays eligible next tick.
    expect(queue.tryClaim).not.toHaveBeenCalledWith(
      'synthesis-1',
      expect.anything(),
      expect.anything(),
    );
    expect(queue.markSkipped).not.toHaveBeenCalled();
  });

  /**
   * TASK_2026_253's regression guard, and the reason the whole task existed.
   *
   * `trigger-eval` spends one lane call per row. While it was absent from
   * `TOKEN_SPENDING_STAGES` this drain ran the row anyway, so `maxTokensPerDay`
   * was not a ceiling for roughly half of all weekly rows.
   */
  it('defers a trigger-eval row once the budget is exhausted mid-tick', async () => {
    const queue = makeQueueOver({
      'D:/a': [makeRow('judge-1', 'judge', 'D:/a')],
      'D:/b': [makeRow('trigger-eval-1', 'trigger-eval', 'D:/b')],
    });
    const budget = makeBudget(0);
    const drain = makeDrainOver(queue.store, budget.store);
    const ran: string[] = [];

    drain.registerStageHandler('judge', async (ctx) => {
      ran.push(ctx.row.id);
      budget.set(MAX_TOKENS); // the lane consumed the rest of the cap
      return { outcome: 'done' };
    });
    drain.registerStageHandler('trigger-eval', async (ctx) => {
      ran.push(ctx.row.id);
      return { outcome: 'done' };
    });

    const summary = await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(ran).toEqual(['judge-1']);
    expect(summary).toMatchObject({ budgetDeferred: 1, budgetExhausted: true });
    // Deferred, not skipped: it stays queued and eligible next tick.
    expect(queue.tryClaim).not.toHaveBeenCalledWith(
      'trigger-eval-1',
      expect.anything(),
      expect.anything(),
    );
    expect(queue.markSkipped).not.toHaveBeenCalled();
  });

  /**
   * The ordering half. `trigger-eval` used to rank BELOW `judge`, so the tail of
   * the budget preferred it — a spending stage the drain believed was free.
   */
  it('ranks trigger-eval after judge and before digest under cheap-first', async () => {
    const queue = makeQueueOver({
      'D:/repo': [
        makeRow('digest-1', 'digest', 'D:/repo'),
        makeRow('trigger-eval-1', 'trigger-eval', 'D:/repo'),
        makeRow('judge-1', 'judge', 'D:/repo'),
      ],
    });
    const drain = makeDrainOver(queue.store, makeBudget(800_000).store, {
      [SKILL_DRAIN_KEYS.weeklyMaxItemsPerRun]: 3,
      [SKILL_DRAIN_KEYS.perWorkspaceBatch]: 3,
    });
    const ran: string[] = [];
    for (const stage of ['digest', 'trigger-eval', 'judge'] as const) {
      drain.registerStageHandler(stage, async (ctx) => {
        ran.push(ctx.row.id);
        return { outcome: 'done' };
      });
    }

    await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(ran).toEqual(['judge-1', 'trigger-eval-1', 'digest-1']);
  });

  /**
   * TASK_2026_356's regression guard — the same shape, one stage over.
   *
   * `prefilter` drafts the candidate with a model, so it spends on every
   * eligible session. While it sat outside `TOKEN_SPENDING_STAGES` this drain
   * ran the row anyway: on the pre-fix table `TOKEN_SPENDING_STAGES.has(
   * 'prefilter')` is `false`, the per-item check short-circuits, and the row is
   * claimed and dispatched with the budget already at `MAX_TOKENS` — so `ran`
   * comes back `['judge-1', 'prefilter-1']` and `budgetDeferred` is `0`. Both
   * assertions below fail on that table and pass on this one.
   */
  it('defers a prefilter row once the budget is exhausted mid-tick', async () => {
    const queue = makeQueueOver({
      'D:/a': [makeRow('judge-1', 'judge', 'D:/a')],
      'D:/b': [makeRow('prefilter-1', 'prefilter', 'D:/b')],
    });
    const budget = makeBudget(0);
    const drain = makeDrainOver(queue.store, budget.store);
    const ran: string[] = [];

    drain.registerStageHandler('judge', async (ctx) => {
      ran.push(ctx.row.id);
      budget.set(MAX_TOKENS); // the lane consumed the rest of the cap
      return { outcome: 'done' };
    });
    drain.registerStageHandler('prefilter', async (ctx) => {
      ran.push(ctx.row.id);
      return { outcome: 'done' };
    });

    const summary = await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(ran).toEqual(['judge-1']);
    expect(summary).toMatchObject({ budgetDeferred: 1, budgetExhausted: true });
    // Deferred, not skipped: it stays queued and eligible next tick. The chain
    // it produces — archaeology, judge-panel, trigger-eval — is therefore not
    // minted either, which is the larger half of the saving.
    expect(queue.tryClaim).not.toHaveBeenCalledWith(
      'prefilter-1',
      expect.anything(),
      expect.anything(),
    );
    expect(queue.markSkipped).not.toHaveBeenCalled();
  });

  /**
   * The ordering half. `prefilter` ranked `0` — cheapest of all eleven stages —
   * so the tail of the budget preferred the drafting call over everything it
   * dwarfs. It now sits between `digest` and `synthesis`.
   */
  it('ranks prefilter after digest and before synthesis under cheap-first', async () => {
    const queue = makeQueueOver({
      'D:/repo': [
        makeRow('synthesis-1', 'synthesis', 'D:/repo'),
        makeRow('prefilter-1', 'prefilter', 'D:/repo'),
        makeRow('judge-1', 'judge', 'D:/repo'),
        makeRow('digest-1', 'digest', 'D:/repo'),
      ],
    });
    const drain = makeDrainOver(queue.store, makeBudget(800_000).store, {
      [SKILL_DRAIN_KEYS.weeklyMaxItemsPerRun]: 4,
      [SKILL_DRAIN_KEYS.perWorkspaceBatch]: 4,
    });
    const ran: string[] = [];
    for (const stage of [
      'synthesis',
      'prefilter',
      'judge',
      'digest',
    ] as const) {
      drain.registerStageHandler(stage, async (ctx) => {
        ran.push(ctx.row.id);
        return { outcome: 'done' };
      });
    }

    await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(ran).toEqual(['judge-1', 'digest-1', 'prefilter-1', 'synthesis-1']);
  });

  it('treats maxTokensPerDay = 0 as unlimited for the per-item check too', async () => {
    const queue = makeQueueOver({
      'D:/a': [makeRow('synthesis-1', 'synthesis', 'D:/a')],
    });
    const drain = makeDrainOver(queue.store, makeBudget(9_999_999).store, {
      [SKILL_DRAIN_KEYS.maxTokensPerDay]: 0,
    });
    let runs = 0;
    drain.registerStageHandler('synthesis', async () => {
      runs++;
      return { outcome: 'done' };
    });

    await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(runs).toBe(1);
  });
});

describe('SkillDrainService — stage outcomes', () => {
  const singleItem = (stage: SkillQueueStage = 'judge') =>
    makeQueueOver({ 'D:/a': [makeRow('item-1', stage, 'D:/a')] });

  it('records a done outcome with its candidate id', async () => {
    const queue = singleItem();
    const drain = makeDrainOver(queue.store, makeBudget(0).store);
    drain.registerStageHandler('judge', async () => ({
      outcome: 'done',
      candidateId: 'cand-9',
      reason: 'scored',
    }));

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(queue.markDone).toHaveBeenCalledWith('item-1', {
      reason: 'scored',
      candidateId: 'cand-9',
    });
    expect(summary.done).toBe(1);
  });

  it('backs an unscored outcome off with not_before in the future', async () => {
    const queue = singleItem();
    const drain = makeDrainOver(queue.store, makeBudget(0).store);
    drain.registerStageHandler('judge', async () => ({
      outcome: 'unscored',
      reason: 'rate limited',
      retryInMs: 60_000,
    }));

    const before = Date.now();
    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary.unscored).toBe(1);
    const [, opts] = queue.markUnscored.mock.calls[0] as [
      string,
      { reason: string; notBefore: number },
    ];
    expect(opts.reason).toBe('rate limited');
    expect(opts.notBefore).toBeGreaterThanOrEqual(before + 60_000);
  });

  it('retries a thrown stage with backoff until maxAttempts, then fails it', async () => {
    const queue = singleItem();
    const drain = makeDrainOver(queue.store, makeBudget(0).store, {
      [SKILL_DRAIN_KEYS.maxAttempts]: 5,
    });
    drain.registerStageHandler('judge', async () => {
      throw new Error('provider exploded');
    });

    const retried = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    // attemptCount is 1 on the claimed row, well under maxAttempts.
    expect(retried).toMatchObject({ unscored: 1, failed: 0 });
    expect(queue.markFailed).not.toHaveBeenCalled();

    const exhausted = makeQueueOver({
      'D:/a': [{ ...makeRow('item-1', 'judge', 'D:/a'), attemptCount: 5 }],
    });
    const drain2 = makeDrainOver(exhausted.store, makeBudget(0).store, {
      [SKILL_DRAIN_KEYS.maxAttempts]: 5,
    });
    drain2.registerStageHandler('judge', async () => {
      throw new Error('provider exploded');
    });

    const summary = await drain2.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary).toMatchObject({ failed: 1, unscored: 0 });
    expect(exhausted.markFailed).toHaveBeenCalledWith(
      'item-1',
      'provider exploded',
      { reason: 'judge failed after 5 attempts' },
    );
  });

  it('counts a lost claim without touching the row', async () => {
    const queue = singleItem();
    queue.tryClaim.mockReturnValue(null);
    const drain = makeDrainOver(queue.store, makeBudget(0).store);
    drain.registerStageHandler('judge', async () => ({ outcome: 'done' }));

    const summary = await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary).toMatchObject({ lostClaims: 1, claimed: 0, done: 0 });
    expect(queue.markDone).not.toHaveBeenCalled();
  });

  it('hands the handler a touch() that heartbeats the claim', async () => {
    const queue = singleItem();
    const drain = makeDrainOver(queue.store, makeBudget(0).store);
    let heartbeat: boolean | null = null;
    drain.registerStageHandler('judge', async (ctx) => {
      heartbeat = ctx.touch();
      return { outcome: 'done' };
    });

    await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(heartbeat).toBe(true);
    expect(queue.touchClaim).toHaveBeenCalledWith('item-1');
  });
});

/**
 * The classification itself, pinned for EVERY stage rather than one at a time.
 *
 * TASK_2026_253 added `trigger-eval` to `TOKEN_SPENDING_STAGES` and TASK_2026_356
 * added `prefilter`. Two tasks, one defect, and both were found by reading a
 * cost log rather than by a failing test — because the omission is invisible
 * from inside the subsystem. `LaneRunnerService` books the spend into
 * `SkillBudgetStore` whichever side of the set the stage sits on, so the tokens
 * always land in the ledger; the set decides only whether they were gated
 * BEFORE they were spent. A stage left out therefore looks completely normal
 * everywhere except the bill.
 *
 * These cases exist so a third omission fails here instead. They assert
 * BEHAVIOUR, never set membership: `TOKEN_SPENDING_STAGES` is module-private
 * and exporting it to test it would only prove the table equals itself.
 *
 * ## The two tables below are the classification, and they must stay total
 *
 * `LLM_REACHING_STAGES` — every stage whose work reaches a model. Call sites,
 * read from source:
 *
 *  - `prefilter` — `stage-handlers.service.ts` `runPrefilterStage` →
 *    `SkillSynthesisService.analyzeSession` →
 *    `SkillSynthesizerService.synthesize` → `LaneRunnerService.run`.
 *  - `archaeology` — `runArchaeologyStage` → `SessionArchaeologistService.analyze`,
 *    one lane call per retrieval pass.
 *  - `judge-panel` — `runJudgePanelStage` → `JudgePanelService.evaluate`, two
 *    lane calls plus a possible escalation.
 *  - `replay` — `runReplayStage` → `ReplayValidatorService`, which replays the
 *    hold-out on a lane.
 *  - `trigger-eval` — `runTriggerEvalStage` → `TriggerEvalService.evaluate` →
 *    `generatePrompts`, one lane call for the probe set (TASK_2026_253).
 *  - `synthesis`, `cluster-synthesis`, `judge`, `digest` — DECLARED in
 *    `SKILL_QUEUE_STAGES` with no handler registered in
 *    `registerStageHandlers` and no producer, so there is no call site to cite
 *    and this file does not invent one. They are classified as spending because
 *    that is the safe direction and because each names LLM work by definition:
 *    a mis-classified spending stage costs real money, a mis-classified local
 *    one costs a deferral until the next tick.
 *
 * `LOCAL_ONLY_STAGES` — `embedding` runs the local `IEmbedder`
 * (`runEmbeddingStage` → `backfillEmbeddings`) and `clustering` is cosine
 * arithmetic over the vectors it produced. Neither can reach an endpoint.
 *
 * The coverage case is the part that catches the NEXT stage rather than the
 * last one: a twelfth member of `SKILL_QUEUE_STAGES` belongs to neither table,
 * so it fails here until somebody classifies it deliberately.
 */
const LLM_REACHING_STAGES: readonly SkillQueueStage[] = [
  'prefilter',
  'archaeology',
  'synthesis',
  'cluster-synthesis',
  'judge',
  'judge-panel',
  'replay',
  'trigger-eval',
  'digest',
];

const LOCAL_ONLY_STAGES: readonly SkillQueueStage[] = [
  'embedding',
  'clustering',
];

describe('SkillDrainService — every LLM-reaching stage is budget-gated', () => {
  it('classifies every declared stage exactly once', () => {
    expect([...LLM_REACHING_STAGES, ...LOCAL_ONLY_STAGES].sort()).toEqual(
      [...SKILL_QUEUE_STAGES].sort(),
    );
    for (const stage of LOCAL_ONLY_STAGES) {
      expect(LLM_REACHING_STAGES).not.toContain(stage);
    }
  });

  /**
   * The budget is exhausted by the `judge` row the drain runs FIRST, so this
   * exercises the per-item check mid-tick — the same path the two regression
   * cases above pin, applied to the whole table.
   */
  it.each(LLM_REACHING_STAGES.filter((stage) => stage !== 'judge'))(
    'defers a %s row once the budget is exhausted mid-tick',
    async (stage) => {
      const queue = makeQueueOver({
        'D:/a': [makeRow('judge-1', 'judge', 'D:/a')],
        'D:/b': [makeRow('subject', stage, 'D:/b')],
      });
      const budget = makeBudget(0);
      const drain = makeDrainOver(queue.store, budget.store);
      const ran: string[] = [];

      drain.registerStageHandler('judge', async (ctx) => {
        ran.push(ctx.row.id);
        budget.set(MAX_TOKENS);
        return { outcome: 'done' };
      });
      drain.registerStageHandler(stage, async (ctx) => {
        ran.push(ctx.row.id);
        return { outcome: 'done' };
      });

      // `weekly` is the superset tier, so no case is decided by
      // `DRAIN_TIER_STAGES` instead of by the budget.
      const summary = await drain.drain({
        tier: 'weekly',
        signal: liveSignal(),
        onBattery: false,
      });

      expect(ran).toEqual(['judge-1']);
      expect(summary).toMatchObject({
        budgetDeferred: 1,
        budgetExhausted: true,
      });
      expect(queue.tryClaim).not.toHaveBeenCalledWith(
        'subject',
        expect.anything(),
        expect.anything(),
      );
    },
  );

  it.each(LOCAL_ONLY_STAGES)(
    'keeps draining a %s row after the budget is exhausted',
    async (stage) => {
      const queue = makeQueueOver({
        'D:/a': [makeRow('judge-1', 'judge', 'D:/a')],
        'D:/b': [makeRow('subject', stage, 'D:/b')],
      });
      const budget = makeBudget(0);
      const drain = makeDrainOver(queue.store, budget.store);
      const ran: string[] = [];

      drain.registerStageHandler('judge', async (ctx) => {
        ran.push(ctx.row.id);
        budget.set(MAX_TOKENS);
        return { outcome: 'done' };
      });
      drain.registerStageHandler(stage, async (ctx) => {
        ran.push(ctx.row.id);
        return { outcome: 'done' };
      });

      const summary = await drain.drain({
        tier: 'weekly',
        signal: liveSignal(),
        onBattery: false,
      });

      expect(ran).toEqual(['judge-1', 'subject']);
      expect(summary).toMatchObject({ budgetDeferred: 0, done: 2 });
    },
  );
});
