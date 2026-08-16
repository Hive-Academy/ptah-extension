/**
 * B0.9 — the queue actually drains.
 *
 * B0.6 switched session end from "analyze inline" to "enqueue", but nothing in
 * production ever called `SkillDrainService.registerStageHandler`. An item
 * whose stage has no handler is marked `skipped` with
 * `no handler for stage <x>`, so every row B0.6 wrote died on arrival:
 * session-end analysis and the embedding backfill were both dark, while the
 * trigger service kept running the inline pipeline Phase 0 exists to replace.
 *
 * Two things are pinned here, and the second is the one that matters.
 *
 * 1. `start()` registers the `prefilter` and `embedding` handlers, and a
 *    drained row therefore reaches the real worker. The negative control at
 *    the bottom of the first block drains an UNWIRED stage and asserts it DOES
 *    come back `skipped` — without it, "not skipped" would be satisfied by a
 *    drain that never claimed anything.
 *
 * 2. The `force: true` trap. `enqueueAnalyze` records the session's turn count
 *    in the same-process `analyzedSessions` map at enqueue time. The drain
 *    then calls back into `analyzeSession` IN THE SAME PROCESS with the same
 *    transcript, so without `force` the map comparison returns `null` and the
 *    row finishes having done nothing — a queue draining into a void, which
 *    looks green in every test that only counts drain summaries.
 *
 * The last block runs the REAL `SkillQueueStore` over a real SQLite file and
 * walks one session from trigger to terminal row, asserting that no row is
 * left `skipped` for want of a handler. That is C0's self-containment claim.
 */
import 'reflect-metadata';
import { SkillSynthesisService } from './skill-synthesis.service';
import type { SkillCandidateStore } from './skill-candidate.store';
import type { SkillMdGenerator } from './skill-md-generator';
import type { SkillPromotionService } from './skill-promotion.service';
import type { TrajectoryExtractor } from './trajectory-extractor';
import type { SkillCandidateRow } from './types';
import type { JudgePanelService } from './gates/judge-panel.service';
import {
  REPLAY_REASONS,
  type ReplayValidatorService,
} from './gates/replay-validator.service';
import {
  TRIGGER_EVAL_SKIP_REASONS,
  type TriggerEvalService,
} from './gates/trigger-eval.service';
import type { SkillLaneFailure } from './lanes/lane.types';
import { SkillQueueStore } from './queue/skill-queue.store';
import {
  SkillDrainService,
  SKILL_DRAIN_KEYS,
} from './queue/skill-drain.service';
import type {
  EnqueueInput,
  EnqueueResult,
  SkillQueueRow,
  SkillQueueStage,
} from './queue/skill-queue.types';
import {
  liveSignal,
  makeBudgetStub,
  makeTracker,
  makeWorkspace as makeDrainWorkspace,
} from './queue/skill-drain.test-support';
import {
  asConnection,
  makeTempDbPath,
  noopLogger,
  openQueueDb,
  resolveOpener,
  type TestDatabase,
} from './queue/queue-db.test-support';

type SessionEndCallback = (data: {
  sessionId: string;
  workspaceRoot: string;
}) => void;

const WS = 'D:/repo';

function trajectory(turnCount: number) {
  return {
    hash: `hash-${turnCount}`,
    canonicalText: 'canon',
    turnCount,
    sessionTurnCount: turnCount,
    shortDescription: 'do thing',
    slug: 'do-thing',
    editCount: 2,
    toolUseCount: 4,
    bashTestPassed: false,
    charLength: 900,
    hasSuccessMarker: true,
  };
}

function queueRow(overrides: Partial<SkillQueueRow> = {}): SkillQueueRow {
  return {
    id: 'row-1',
    sessionId: 's1',
    workspaceRoot: WS,
    transcriptPath: null,
    source: 'session-end',
    stage: 'prefilter',
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
    ...overrides,
  };
}

/**
 * A `SkillSynthesisService` whose doubles all reach the real worker bodies:
 * the extractor yields a trajectory that passes the prefilter, the candidate
 * store accepts a registration, and the embedder + vec status are live so
 * `backfillEmbeddings` does real work rather than short-circuiting to `0`.
 */
/** The candidate the gate stages are dispatched to grade. */
const CANDIDATE = {
  id: 'cand-1',
  name: 'do-thing',
  description: 'does the thing',
  bodyPath: '',
  sourceSessionIds: ['s1'],
} as unknown as SkillCandidateRow;

function makeService(opts: {
  queue: {
    enqueue: (input: EnqueueInput) => EnqueueResult;
  } & Record<string, unknown>;
  drain: SkillDrainService | null;
  enabled?: boolean;
  judgePanel?: Partial<JudgePanelService> | null;
  replayValidator?: Partial<ReplayValidatorService> | null;
  triggerEval?: Partial<TriggerEvalService> | null;
}) {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as ConstructorParameters<typeof SkillSynthesisService>[0];
  const connection = {
    isOpen: true,
    openAndMigrate: jest.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof SkillSynthesisService>[1];
  const vecStatus = {
    available: true,
  } as unknown as ConstructorParameters<typeof SkillSynthesisService>[2];
  const workspaceProvider = {
    getConfiguration: jest.fn(
      (_section: string, key: string, fallback: unknown) =>
        key === 'skillSynthesis.enabled' ? (opts.enabled ?? true) : fallback,
    ),
  } as unknown as ConstructorParameters<typeof SkillSynthesisService>[3];

  const unembedded = {
    id: 'cand-1',
    name: 'do-thing',
    description: 'does the thing',
    bodyPath: '',
    embeddingRowid: null,
  };
  const store = {
    findByTrajectoryHash: jest.fn(() => null),
    findById: jest.fn(() => CANDIDATE),
    registerCandidate: jest.fn(() => ({
      candidate: { id: 'cand-1' },
      reused: false,
    })),
    recordInvocation: jest.fn(),
    getDominantSkillSlugForSessions: jest.fn(() => null),
    listByStatus: jest.fn(() => [unembedded]),
    setEmbedding: jest.fn(),
  } as unknown as jest.Mocked<SkillCandidateStore>;
  const md = {
    candidatesRoot: jest.fn(() => '/tmp/cands'),
    writeCandidate: jest.fn(() => ({
      slug: 'do-thing',
      dir: '/tmp/cands/do-thing',
      filePath: '/tmp/cands/do-thing/SKILL.md',
    })),
  } as unknown as jest.Mocked<SkillMdGenerator>;
  const promotion = {
    evaluate: jest.fn(),
  } as unknown as jest.Mocked<SkillPromotionService>;
  const extractor = {
    extract: jest.fn().mockResolvedValue(trajectory(6)),
  } as unknown as jest.Mocked<TrajectoryExtractor>;
  const embedder = {
    embed: jest.fn().mockResolvedValue([new Float32Array([0.1, 0.2])]),
  };

  let sessionEnd: SessionEndCallback | null = null;
  const sessionEndRegistry = {
    register: jest.fn((cb: SessionEndCallback) => {
      sessionEnd = cb;
      return jest.fn();
    }),
  } as unknown as ConstructorParameters<typeof SkillSynthesisService>[9];

  const svc = new SkillSynthesisService(
    logger,
    connection,
    vecStatus,
    workspaceProvider,
    store,
    md,
    promotion,
    extractor,
    null,
    sessionEndRegistry,
    null,
    null,
    embedder as never,
    null,
    opts.queue as never,
    opts.drain,
    null,
    null,
    (opts.judgePanel ?? null) as never,
    (opts.replayValidator ?? null) as never,
    (opts.triggerEval ?? null) as never,
  );

  async function fireSessionEnd(
    sessionId = 's1',
    workspaceRoot = WS,
  ): Promise<void> {
    if (!sessionEnd) throw new Error('session-end callback not registered');
    (sessionEnd as SessionEndCallback)({ sessionId, workspaceRoot });
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }

  return { svc, store, md, extractor, embedder, fireSessionEnd };
}

/** A queue double that serves exactly one row to the drain, then nothing. */
function makeOneRowQueue(row: SkillQueueRow) {
  let served = false;
  const parts = {
    enqueue: jest.fn((): EnqueueResult => ({ outcome: 'created', row: null })),
    reapStale: jest.fn(() => 0),
    listEligibleWorkspaces: jest.fn(() => (served ? [] : [row.workspaceRoot])),
    listEligible: jest.fn(() => (served ? [] : [row])),
    markWorkspaceDrained: jest.fn(),
    tryClaim: jest.fn(() => {
      served = true;
      return { ...row, status: 'claimed' as const };
    }),
    touchClaim: jest.fn(() => true),
    mergePayload: jest.fn(),
    requeue: jest.fn(() => true),
    markDone: jest.fn(),
    markFailed: jest.fn(),
    markUnscored: jest.fn(),
    markSkipped: jest.fn(),
  };
  return parts;
}

function makeDrainOver(queue: unknown): SkillDrainService {
  return new SkillDrainService(
    noopLogger,
    queue as SkillQueueStore,
    makeBudgetStub(0).store,
    makeTracker(),
    makeDrainWorkspace({
      // Both caps: the gate cases below drain `weekly` (which reads its own
      // key) and the rest drain `frequent`. Same number, so neither changes.
      [SKILL_DRAIN_KEYS.maxItemsPerRun]: 4,
      [SKILL_DRAIN_KEYS.weeklyMaxItemsPerRun]: 4,
      [SKILL_DRAIN_KEYS.perWorkspaceBatch]: 2,
    }),
  );
}

const drainOpts = () => ({
  tier: 'frequent' as const,
  signal: liveSignal(),
  onBattery: false,
});

describe('SkillSynthesisService — drain stage handlers (B0.9.1)', () => {
  it('dispatches a claimed prefilter row to the analyzeSession worker', async () => {
    const queue = makeOneRowQueue(queueRow({ stage: 'prefilter' }));
    const drain = makeDrainOver(queue);
    const { svc, store } = makeService({ queue, drain });
    await svc.start();

    const summary = await drain.drain(drainOpts());

    expect(summary.claimed).toBe(1);
    expect(summary.done).toBe(1);
    expect(store.registerCandidate).toHaveBeenCalledTimes(1);
    expect(queue.markDone).toHaveBeenCalledWith(
      'row-1',
      expect.objectContaining({ candidateId: 'cand-1' }),
    );
  });

  it('dispatches a claimed embedding row to the backfillEmbeddings worker', async () => {
    const queue = makeOneRowQueue(
      queueRow({ id: 'row-2', stage: 'embedding', workspaceRoot: '' }),
    );
    const drain = makeDrainOver(queue);
    const { svc, store, embedder } = makeService({ queue, drain });
    await svc.start();

    const summary = await drain.drain(drainOpts());

    expect(summary.done).toBe(1);
    expect(embedder.embed).toHaveBeenCalledTimes(1);
    expect(store.setEmbedding).toHaveBeenCalledTimes(1);
  });

  it('never marks a wired stage skipped for want of a handler', async () => {
    for (const stage of ['prefilter', 'embedding'] as SkillQueueStage[]) {
      const queue = makeOneRowQueue(
        queueRow({ stage, workspaceRoot: stage === 'embedding' ? '' : WS }),
      );
      const drain = makeDrainOver(queue);
      const { svc } = makeService({ queue, drain });
      await svc.start();

      const summary = await drain.drain(drainOpts());

      expect(summary.skippedItems).toBe(0);
      expect(queue.markSkipped).not.toHaveBeenCalled();
    }
  });

  it('NEGATIVE CONTROL — an unwired stage still comes back skipped', async () => {
    // Without this, "not skipped" above would also hold for a drain that
    // claimed nothing at all.
    const queue = makeOneRowQueue(queueRow({ stage: 'clustering' }));
    const drain = makeDrainOver(queue);
    const { svc } = makeService({ queue, drain });
    await svc.start();

    const summary = await drain.drain(drainOpts());

    expect(summary.skippedItems).toBe(1);
    expect(queue.markSkipped).toHaveBeenCalledWith('row-1', {
      reason: 'no handler for stage clustering',
    });
  });

  it('registers handlers even when the master switch is off at start', async () => {
    // `start()` returns early when disabled, but the tray can re-enable
    // background learning without a restart. Registering below that early
    // return would leave every subsequently drained row skipped.
    const queue = makeOneRowQueue(queueRow());
    const drain = makeDrainOver(queue);
    const { svc } = makeService({ queue, drain, enabled: false });
    await svc.start();

    await drain.drain(drainOpts());

    // The row is still skipped — `start()` bailed, so the worker has nothing
    // to say — but it is skipped by the HANDLER, with the handler's reason.
    // "no handler for stage prefilter" would mean the wiring itself was lost.
    expect(queue.markSkipped).toHaveBeenCalledWith('row-1', {
      reason: 'no candidate from this session',
    });
  });

  it('starts cleanly in a host with no drain registered', async () => {
    const queue = makeOneRowQueue(queueRow());
    const { svc } = makeService({ queue, drain: null });
    await expect(svc.start()).resolves.toBeUndefined();
  });
});

describe('SkillSynthesisService — the same-process dedup trap (B0.9.1)', () => {
  it('runs the worker for a row this process itself enqueued', async () => {
    // `enqueueAnalyze` writes turnCount 6 into `analyzedSessions`. Without
    // `force`, `analyzeSession` sees `6 <= 6` and returns null — the drain
    // reports a tidy summary and the candidate is never written.
    const queue = makeOneRowQueue(queueRow({ turnCount: 6 }));
    const drain = makeDrainOver(queue);
    const { svc, store, fireSessionEnd } = makeService({ queue, drain });
    await svc.start();
    await fireSessionEnd();
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'prefilter', turnCount: 6 }),
    );

    const summary = await drain.drain(drainOpts());

    expect(store.registerCandidate).toHaveBeenCalledTimes(1);
    expect(summary.done).toBe(1);
  });
});

describe('SkillSynthesisService — a throwing stage never escapes drain()', () => {
  it('resolves to a DrainSummary when the worker throws', async () => {
    const queue = makeOneRowQueue(queueRow());
    const drain = makeDrainOver(queue);
    const { svc, extractor } = makeService({ queue, drain });
    await svc.start();
    (extractor.extract as jest.Mock).mockRejectedValue(
      new Error('transcript unreadable'),
    );

    const summary = await drain.drain(drainOpts());

    expect(summary.claimed).toBe(1);
    expect(summary.done).toBe(0);
    // attemptCount 1 < maxAttempts 5, so it is retried, not failed.
    expect(summary.unscored).toBe(1);
    expect(summary.error).toBeUndefined();
  });
});

/**
 * B3.5.1 — the three phase-3 gate stages.
 *
 * Every test here drives the REAL `SkillDrainService` on a WEEKLY tick, so what
 * is asserted is the row transition the drain chose, not the object the handler
 * returned. That distinction is the whole point: a handler that flattens a lane
 * failure into `unscored` returns a perfectly well-typed value and only the
 * drain's behaviour reveals it.
 */
describe('SkillSynthesisService — gate stage handlers (B3.5.1)', () => {
  const weeklyOpts = () => ({
    tier: 'weekly' as const,
    signal: liveSignal(),
    onBattery: false,
  });

  const gateRow = (stage: SkillQueueStage) =>
    queueRow({ stage, payload: { candidateId: 'cand-1' } });

  const scoredVerdict = {
    verdict: { status: 'scored', score: 8, criteria: null, reason: 'v' },
    rationales: [],
    escalated: false,
    maxDelta: 0,
    panellists: 2,
    reason: 'judge-panel-agreed',
    persisted: true,
    lens: null,
  };

  const replayResult = (over: Record<string, unknown>) => ({
    status: 'unmeasured',
    confidence: null,
    holdoutSessionId: 's-hold',
    verdictFallback: false,
    reason: REPLAY_REASONS.emptyPlan,
    persisted: true,
    failure: null,
    ...over,
  });

  describe('judge-panel', () => {
    it('a scored verdict finishes the row done, carrying the candidate', async () => {
      const queue = makeOneRowQueue(gateRow('judge-panel'));
      const drain = makeDrainOver(queue);
      const judgePanel = { evaluate: jest.fn(async () => scoredVerdict) };
      const { svc } = makeService({
        queue,
        drain,
        judgePanel: judgePanel as never,
      });
      await svc.start();

      const summary = await drain.drain(weeklyOpts());

      expect(summary).toMatchObject({ claimed: 1, done: 1 });
      expect(judgePanel.evaluate).toHaveBeenCalledTimes(1);
      expect(queue.markDone).toHaveBeenCalledWith(
        'row-1',
        expect.objectContaining({
          candidateId: 'cand-1',
          reason: 'judge-panel-agreed',
        }),
      );
    });

    it('a disabled verdict is skipped, not retried — a host with no LLM is not broken', async () => {
      const queue = makeOneRowQueue(gateRow('judge-panel'));
      const drain = makeDrainOver(queue);
      const judgePanel = {
        evaluate: jest.fn(async () => ({
          ...scoredVerdict,
          verdict: { ...scoredVerdict.verdict, status: 'disabled' },
          reason: 'judge-disabled',
        })),
      };
      const { svc } = makeService({
        queue,
        drain,
        judgePanel: judgePanel as never,
      });
      await svc.start();

      const summary = await drain.drain(weeklyOpts());

      expect(summary.skippedItems).toBe(1);
      expect(queue.markUnscored).not.toHaveBeenCalled();
    });

    it('an unscored verdict stays re-eligible behind a backoff', async () => {
      const queue = makeOneRowQueue(gateRow('judge-panel'));
      const drain = makeDrainOver(queue);
      const judgePanel = {
        evaluate: jest.fn(async () => ({
          ...scoredVerdict,
          verdict: {
            ...scoredVerdict.verdict,
            status: 'unscored',
            score: null,
          },
          reason: 'judge-no-json-in-response',
        })),
      };
      const { svc } = makeService({
        queue,
        drain,
        judgePanel: judgePanel as never,
      });
      await svc.start();

      const summary = await drain.drain(weeklyOpts());

      expect(summary.unscored).toBe(1);
      expect(queue.markUnscored).toHaveBeenCalledWith(
        'row-1',
        expect.objectContaining({ reason: 'judge-no-json-in-response' }),
      );
    });
  });

  describe('replay', () => {
    /**
     * MUTATION TARGET, and the most important test in this file.
     *
     * The handler must hand `SkillLaneFailure` over VERBATIM. Flattening it to
     * `unscored` type-checks, returns a sane-looking summary, and quietly moves
     * the retry ceiling and the backoff into the one place that cannot read
     * `maxAttempts` — so the only way to see the defect is to assert on which
     * STORE CALL the drain made. `requeue` is the transport path; `markUnscored`
     * is the flattened one.
     */
    it('hands a lane failure to the drain verbatim, which requeues behind the lane backoff', async () => {
      const failure: SkillLaneFailure = {
        kind: 'timeout',
        reason: 'Lane replay: timed out',
        retryAfterMs: 120_000,
      } as SkillLaneFailure;
      const queue = makeOneRowQueue(gateRow('replay'));
      const drain = makeDrainOver(queue);
      const replayValidator = {
        validate: jest.fn(async () => replayResult({ failure })),
      };
      const { svc } = makeService({
        queue,
        drain,
        replayValidator: replayValidator as never,
      });
      await svc.start();

      const summary = await drain.drain(weeklyOpts());

      expect(summary).toMatchObject({ stalled: 1, unscored: 0, failed: 0 });
      expect(queue.requeue).toHaveBeenCalledWith(
        'row-1',
        expect.any(Number),
        'Lane replay: timed out',
      );
      expect(queue.markUnscored).not.toHaveBeenCalled();
      expect(queue.markFailed).not.toHaveBeenCalled();
    });

    it('a measurement finishes the row done', async () => {
      const queue = makeOneRowQueue(gateRow('replay'));
      const drain = makeDrainOver(queue);
      const replayValidator = {
        validate: jest.fn(async () =>
          replayResult({
            status: 'measured',
            confidence: 0.7,
            reason: REPLAY_REASONS.measured,
          }),
        ),
      };
      const { svc } = makeService({
        queue,
        drain,
        replayValidator: replayValidator as never,
      });
      await svc.start();

      const summary = await drain.drain(weeklyOpts());

      expect(summary.done).toBe(1);
      expect(queue.markDone).toHaveBeenCalledWith(
        'row-1',
        expect.objectContaining({ candidateId: 'cand-1' }),
      );
    });

    it('no hold-out is SKIPPED, not unscored — the cluster will not grow one', async () => {
      // `replay-no-holdout` is a permanent fact about the cluster. An
      // `unscored` row would come back every week forever to re-derive the
      // same `null`.
      const queue = makeOneRowQueue(gateRow('replay'));
      const drain = makeDrainOver(queue);
      const replayValidator = {
        validate: jest.fn(async () =>
          replayResult({ reason: REPLAY_REASONS.noHoldout }),
        ),
      };
      const { svc } = makeService({
        queue,
        drain,
        replayValidator: replayValidator as never,
      });
      await svc.start();

      const summary = await drain.drain(weeklyOpts());

      expect(summary).toMatchObject({ skippedItems: 1, unscored: 0 });
    });

    it.each([
      REPLAY_REASONS.noEvidence,
      REPLAY_REASONS.emptyPlan,
      REPLAY_REASONS.unscoredComparison,
    ])(
      '%s stays re-eligible — it is a bad sample, not a fact',
      async (reason) => {
        const queue = makeOneRowQueue(gateRow('replay'));
        const drain = makeDrainOver(queue);
        const replayValidator = {
          validate: jest.fn(async () => replayResult({ reason })),
        };
        const { svc } = makeService({
          queue,
          drain,
          replayValidator: replayValidator as never,
        });
        await svc.start();

        expect((await drain.drain(weeklyOpts())).unscored).toBe(1);
      },
    );

    it.each([
      ['measured', { status: 'measured', reason: REPLAY_REASONS.measured }],
      ['no-holdout', { reason: REPLAY_REASONS.noHoldout }],
      [
        'a lane failure',
        { failure: { kind: 'timeout', reason: 'x', retryAfterMs: 1 } },
      ],
    ])(
      'writes payload.verdictFallback on the %s path',
      async (_label, over) => {
        // `REOPEN_SQL` preserves `payload`, so a path that skipped this write
        // would leave a finished row showing a PREVIOUS pass's flag.
        const queue = makeOneRowQueue(gateRow('replay'));
        const drain = makeDrainOver(queue);
        const replayValidator = {
          validate: jest.fn(async () =>
            replayResult({ verdictFallback: true, ...over }),
          ),
        };
        const { svc } = makeService({
          queue,
          drain,
          replayValidator: replayValidator as never,
        });
        await svc.start();

        await drain.drain(weeklyOpts());

        expect(queue.mergePayload).toHaveBeenCalledWith('row-1', {
          verdictFallback: true,
        });
      },
    );
  });

  describe('trigger-eval', () => {
    const report = (unmeasuredReason: string | null) => ({
      status: 'evaluated',
      report: {
        measurement: { score: 0.5, precision: 0.5, recall: 0.5 },
        prompts: { shouldTrigger: [], nearMiss: [] },
        outcomes: [],
        collisions: [],
        unmeasuredReason,
        activeCompared: 0,
      },
    });

    it('a measurement finishes the row done', async () => {
      const queue = makeOneRowQueue(gateRow('trigger-eval'));
      const drain = makeDrainOver(queue);
      const triggerEval = { evaluate: jest.fn(async () => report(null)) };
      const { svc } = makeService({
        queue,
        drain,
        triggerEval: triggerEval as never,
      });
      await svc.start();

      const summary = await drain.drain(weeklyOpts());

      expect(summary.done).toBe(1);
      expect(queue.markDone).toHaveBeenCalledWith(
        'row-1',
        expect.objectContaining({
          reason: 'trigger-eval-measured',
          candidateId: 'cand-1',
        }),
      );
    });

    it('a retrieval that produced no measurement stays re-eligible', async () => {
      const queue = makeOneRowQueue(gateRow('trigger-eval'));
      const drain = makeDrainOver(queue);
      const triggerEval = {
        evaluate: jest.fn(async () =>
          report('trigger-eval-no-near-miss-prompts'),
        ),
      };
      const { svc } = makeService({
        queue,
        drain,
        triggerEval: triggerEval as never,
      });
      await svc.start();

      expect((await drain.drain(weeklyOpts())).unscored).toBe(1);
    });

    it.each([
      [TRIGGER_EVAL_SKIP_REASONS.disabled, 'skippedItems'],
      [TRIGGER_EVAL_SKIP_REASONS.noEmbedder, 'skippedItems'],
      [TRIGGER_EVAL_SKIP_REASONS.noDescription, 'skippedItems'],
      // The collapsed one: "no lane in this host" and "the lane failed" report
      // the same token, so the bounded failure mode is chosen.
      [TRIGGER_EVAL_SKIP_REASONS.noPrompts, 'unscored'],
    ])('%s maps to %s', async (reason, field) => {
      const queue = makeOneRowQueue(gateRow('trigger-eval'));
      const drain = makeDrainOver(queue);
      const triggerEval = {
        evaluate: jest.fn(async () => ({ status: 'skipped', reason })),
      };
      const { svc } = makeService({
        queue,
        drain,
        triggerEval: triggerEval as never,
      });
      await svc.start();

      const summary = await drain.drain(weeklyOpts());

      expect(summary[field as 'unscored' | 'skippedItems']).toBe(1);
    });
  });

  it.each(['judge-panel', 'replay', 'trigger-eval'] as SkillQueueStage[])(
    'does NOT register %s in a host without the service',
    async (stage) => {
      // The archaeologist's rule: registering a handler that could only answer
      // "I am not here" spends a claim and an attempt to say what the drain
      // already says for free.
      const queue = makeOneRowQueue(gateRow(stage));
      const drain = makeDrainOver(queue);
      const { svc } = makeService({ queue, drain });
      await svc.start();

      await drain.drain(weeklyOpts());

      expect(queue.markSkipped).toHaveBeenCalledWith('row-1', {
        reason: `no handler for stage ${stage}`,
      });
    },
  );
});

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;

maybe('C0 is self-contained — trigger → drain → terminal row (B0.9.3)', () => {
  let db: TestDatabase;
  let store: SkillQueueStore;

  beforeEach(() => {
    db = openQueueDb(opener as NonNullable<typeof opener>, makeTempDbPath());
    store = new SkillQueueStore(noopLogger, asConnection(db));
  });

  afterEach(() => {
    db.close();
  });

  const allRows = (): SkillQueueRow[] =>
    store.listRecent(50).map((r) => ({ ...r }));

  it('walks a session end and the boot backfill to terminal rows, none skipped for a missing handler', async () => {
    const drain = makeDrainOver(store);
    const {
      svc,
      store: candidates,
      fireSessionEnd,
    } = makeService({
      queue: store as never,
      drain,
    });

    // `start()` writes the `embedding` backfill row; session end writes the
    // `prefilter` row. Two workspaces (`''` and the repo), so a single tick
    // with perWorkspaceBatch 2 reaches both.
    await svc.start();
    await fireSessionEnd();
    expect(
      allRows()
        .map((r) => r.stage)
        .sort(),
    ).toEqual(['embedding', 'prefilter']);
    expect(allRows().every((r) => r.status === 'queued')).toBe(true);

    const summary = await drain.drain(drainOpts());

    expect(summary.claimed).toBe(2);
    expect(summary.done).toBe(2);
    expect(summary.skippedItems).toBe(0);
    expect(summary.failed).toBe(0);

    const rows = allRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('done');
      expect(row.finishedAt).not.toBeNull();
      expect(row.reason ?? '').not.toMatch(/no handler for stage/);
    }
    // The workers really ran, not just the bookkeeping.
    expect(candidates.registerCandidate).toHaveBeenCalledTimes(1);
    expect(candidates.setEmbedding).toHaveBeenCalledTimes(1);
    expect(rows.find((r) => r.stage === 'prefilter')?.candidateId).toBe(
      'cand-1',
    );
  });

  /**
   * B0.9.2's half of the contract. `SkillTriggerService` no longer computes a
   * turn count itself — it hands every trigger to `enqueueAnalyze`, which is
   * the single place the trajectory is read (pure local JSONL + regex, zero
   * LLM). This asserts the NUMBER that lands in the column for each trigger
   * source, because `turnCount: 0` satisfies "enqueue was called" and then
   * `REOPEN_SQL`'s `turn_count < ?` can never be true again.
   */
  it('every trigger source enqueues the observed turn count, never 0', async () => {
    const drain = makeDrainOver(store);
    const { svc, extractor } = makeService({ queue: store as never, drain });
    await svc.start();

    const sources = [
      'idle',
      'subagent-stop',
      'edit-then-test',
      'turn-complete',
      'boot',
    ] as const;
    let turns = 3;
    for (const source of sources) {
      turns += 1;
      (extractor.extract as jest.Mock).mockResolvedValue(trajectory(turns));

      const outcome = await svc.enqueueAnalyze(`s-${source}`, WS, { source });

      expect(outcome).toBe('created');
      const row = store.findBySessionStage(`s-${source}`, 'prefilter');
      expect(row?.stage).toBe('prefilter');
      expect(row?.source).toBe(source);
      expect(row?.turnCount).toBe(turns);
      expect(row?.turnCount).not.toBe(0);
    }
  });

  it('persists the subagent transcript path so the stage handler can re-read it', async () => {
    const drain = makeDrainOver(store);
    const { svc, extractor } = makeService({ queue: store as never, drain });
    await svc.start();
    const transcriptPath = 'D:/tmp/agents/sub-1.jsonl';

    await svc.enqueueAnalyze('sub-1', WS, {
      source: 'subagent-stop',
      transcriptPath,
    });

    expect(store.findBySessionStage('sub-1', 'prefilter')?.transcriptPath).toBe(
      transcriptPath,
    );
    // The extractor was pointed at it at enqueue time too — a subagent
    // transcript does not live at the default path.
    expect(extractor.extract).toHaveBeenCalledWith(
      'sub-1',
      WS,
      expect.any(Number),
      transcriptPath,
    );
  });

  /**
   * B3.5.1 — the `prefilter → {judge-panel, trigger-eval}` producers.
   *
   * Chained from the SUCCESSFUL END of the prefilter handler, exactly like
   * `archaeology`: both gates grade a candidate, and there is no candidate until
   * the cheap regex prefilter said there was something worth spending on.
   */
  describe('the gate producers', () => {
    const gates = {
      judgePanel: { evaluate: jest.fn() },
      triggerEval: { evaluate: jest.fn() },
      replayValidator: { validate: jest.fn() },
    };

    it('writes a judge-panel and a trigger-eval row from a successful prefilter', async () => {
      const drain = makeDrainOver(store);
      const { svc, fireSessionEnd } = makeService({
        queue: store as never,
        drain,
        judgePanel: gates.judgePanel as never,
        triggerEval: gates.triggerEval as never,
      });
      await svc.start();
      await fireSessionEnd();

      // Before the drain there is only the prefilter row (plus the backfill).
      expect(store.findBySessionStage('s1', 'judge-panel')).toBeNull();

      await drain.drain(drainOpts());

      for (const stage of ['judge-panel', 'trigger-eval'] as const) {
        const row = store.findBySessionStage('s1', stage);
        expect(row).toMatchObject({
          stage,
          status: 'queued',
          // The candidate id travels in the PAYLOAD; the column is the drain's.
          payload: { candidateId: 'cand-1' },
          // Round-robin fairness key: these grade a workspace-owned candidate,
          // so `''` (reserved for clustering / the backfill) would be wrong.
          workspaceRoot: WS,
          // `0` compiles and wedges `REOPEN_SQL` forever.
          turnCount: 6,
          // Pointing at the prefilter row would strand these the first time it
          // ended `skipped` — `ELIGIBLE_SQL` requires the ancestor to be `done`.
          dependsOn: null,
        });
        expect(row?.candidateId).toBeNull();
      }
    });

    it('writes NO replay row — the gate has a handler and deliberately no producer', async () => {
      const drain = makeDrainOver(store);
      const { svc, fireSessionEnd } = makeService({
        queue: store as never,
        drain,
        judgePanel: gates.judgePanel as never,
        triggerEval: gates.triggerEval as never,
        replayValidator: gates.replayValidator as never,
      });
      await svc.start();
      await fireSessionEnd();
      await drain.drain(drainOpts());

      expect(store.findBySessionStage('s1', 'replay')).toBeNull();
      expect(store.listRecent(50).some((r) => r.stage === 'replay')).toBe(
        false,
      );
    });

    it('produces nothing for a gate this host does not have', async () => {
      const drain = makeDrainOver(store);
      const { svc, fireSessionEnd } = makeService({
        queue: store as never,
        drain,
        triggerEval: gates.triggerEval as never,
      });
      await svc.start();
      await fireSessionEnd();
      await drain.drain(drainOpts());

      expect(store.findBySessionStage('s1', 'trigger-eval')).not.toBeNull();
      expect(store.findBySessionStage('s1', 'judge-panel')).toBeNull();
    });

    it('re-points a re-opened gate row at the candidate the new pass produced', async () => {
      // `REOPEN_SQL` does not touch `payload`, so without the re-point the row
      // would silently keep grading the FIRST pass's candidate every time the
      // session grows. The producer passes `payload` and `enqueue` re-points
      // the row inside the re-open transaction — see the spy below, and
      // `skill-queue.store.reopen-payload.spec.ts` for why the transaction
      // boundary is the point.
      const mergePayload = jest.spyOn(store, 'mergePayload');
      const drain = makeDrainOver(store);
      const {
        svc,
        store: candidates,
        extractor,
        fireSessionEnd,
      } = makeService({
        queue: store as never,
        drain,
        judgePanel: gates.judgePanel as never,
      });
      await svc.start();
      await fireSessionEnd();
      await drain.drain(drainOpts());
      expect(store.findBySessionStage('s1', 'judge-panel')?.payload).toEqual({
        candidateId: 'cand-1',
      });
      // Finish the gate row so the guarded re-open can fire.
      store.markDone(store.findBySessionStage('s1', 'judge-panel')?.id ?? '');

      (candidates.registerCandidate as jest.Mock).mockReturnValue({
        candidate: { id: 'cand-2' },
        reused: false,
      });
      (extractor.extract as jest.Mock).mockResolvedValue(trajectory(11));
      await fireSessionEnd();
      await drain.drain(drainOpts());

      const row = store.findBySessionStage('s1', 'judge-panel');
      expect(row?.status).toBe('queued');
      expect(row?.payload).toEqual({ candidateId: 'cand-2' });
      // ONE store call. A follow-up `mergePayload` would leave the row `queued`
      // with `cand-1` between the two commits, which is long enough for a
      // second host on the shared database to claim it and grade the
      // superseded candidate.
      expect(mergePayload).not.toHaveBeenCalled();
      mergePayload.mockRestore();
    });
  });

  it('drops a null trajectory without writing a queue row', async () => {
    const drain = makeDrainOver(store);
    const { svc, extractor } = makeService({ queue: store as never, drain });
    await svc.start();
    (extractor.extract as jest.Mock).mockResolvedValue(null);

    const outcome = await svc.enqueueAnalyze('thin-1', WS, { source: 'idle' });

    expect(outcome).toBeNull();
    expect(store.findBySessionStage('thin-1', 'prefilter')).toBeNull();
  });

  it('carries the observed turn count onto the row, so the guarded re-open can fire', async () => {
    const drain = makeDrainOver(store);
    const { svc, extractor, fireSessionEnd } = makeService({
      queue: store as never,
      drain,
    });
    await svc.start();

    (extractor.extract as jest.Mock).mockResolvedValue(trajectory(6));
    await fireSessionEnd();
    const first = store.findBySessionStage('s1', 'prefilter');
    expect(first?.turnCount).toBe(6);
    // `0` compiles, passes a call-counting test, and wedges the re-open.
    expect(first?.turnCount).not.toBe(0);

    await drain.drain(drainOpts());
    expect(store.findBySessionStage('s1', 'prefilter')?.status).toBe('done');

    // The session grows; the finished row re-opens and drains a second time.
    (extractor.extract as jest.Mock).mockResolvedValue(trajectory(11));
    await fireSessionEnd();
    const reopened = store.findBySessionStage('s1', 'prefilter');
    expect(reopened?.status).toBe('queued');
    expect(reopened?.turnCount).toBe(11);

    const second = await drain.drain(drainOpts());
    expect(second.skippedItems).toBe(0);
    expect(store.findBySessionStage('s1', 'prefilter')?.status).toBe('done');
  });
});
