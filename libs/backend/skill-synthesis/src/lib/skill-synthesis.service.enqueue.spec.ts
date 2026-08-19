/**
 * P0-1 — "session end performs no LLM work" (TASK_2026_180, batch B0.6).
 *
 * The acceptance criterion is negative, so the spec has to make the forbidden
 * thing REACHABLE before asserting it does not happen. The synthesizer double
 * below is therefore not inert: it calls the stub `IInternalQuery`, exactly as
 * the real `SkillSynthesizerService` reaches an LLM through the lane runner. If
 * the session-end callback ever regresses to `analyzeSession`, `execute` is
 * called and these tests fail — which is the whole point. A synthesizer stub
 * that resolved `null` would pass this file forever.
 *
 * The other half is the durable "re-analyze only once it grew" rule. It used to
 * live in the in-memory `analyzedSessions` Map; it now lives in the
 * `turn_count` column plus `SkillQueueStore`'s guarded re-open. This spec pins
 * the service's half of that contract — that the FRESHLY OBSERVED turn count is
 * what gets enqueued. Enqueuing `0` would satisfy every other assertion here
 * and permanently wedge the re-open, so it is asserted explicitly.
 */
import 'reflect-metadata';
import { SkillSynthesisService } from './skill-synthesis.service';
import type { SkillCandidateStore } from './skill-candidate.store';
import type { SkillMdGenerator } from './skill-md-generator';
import type { SkillPromotionService } from './skill-promotion.service';
import type { TrajectoryExtractor } from './trajectory-extractor';
import type { SkillQueueStore } from './queue/skill-queue.store';
import type {
  EnqueueInput,
  EnqueueResult,
  SkillQueueRow,
} from './queue/skill-queue.types';
import type { IInternalQuery } from './internal-query.interface';
import {
  SkillDrainService,
  SKILL_DRAIN_KEYS,
} from './queue/skill-drain.service';
import { SkillStageHandlersService } from './queue/stage-handlers.service';
import {
  liveSignal,
  makeBudgetStub,
  makeTracker,
  makeWorkspace as makeDrainWorkspace,
} from './queue/skill-drain.test-support';
import { noopLogger } from './queue/queue-db.test-support';
import type {
  SessionArchaeologistService,
  SessionArchaeologyResult,
} from './archaeology/session-archaeologist.service';
import type { SessionVerdict } from './archaeology/session-verdict.types';
import type { SkillLaneFailure } from './lanes/lane.types';

type SessionEndCallback = (data: {
  sessionId: string;
  workspaceRoot: string;
}) => void;

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

describe('SkillSynthesisService — session end enqueues (P0-1)', () => {
  function setup(opts: { enabled?: boolean; withQueue?: boolean } = {}) {
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
      available: false,
      reason: 'binary-missing',
    } as unknown as ConstructorParameters<typeof SkillSynthesisService>[2];
    const workspaceProvider = {
      getConfiguration: jest.fn(
        (_section: string, key: string, fallback: unknown) =>
          key === 'skillSynthesis.enabled' ? (opts.enabled ?? true) : fallback,
      ),
    } as unknown as ConstructorParameters<typeof SkillSynthesisService>[3];
    const store = {
      findByTrajectoryHash: jest.fn(() => null),
      registerCandidate: jest.fn(),
      recordInvocation: jest.fn(),
      getDominantSkillSlugForSessions: jest.fn(() => null),
    } as unknown as jest.Mocked<SkillCandidateStore>;
    // No `activeRoot`: `start()`'s SKILL.md migration block is individually
    // guarded and degrades to a warn, which keeps this spec off the real
    // filesystem. Same shape the sibling service spec relies on.
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

    /**
     * The stub whose call count IS the acceptance criterion. Typed as the
     * library's local `IInternalQuery` so the double cannot drift from the
     * contract the real LLM path uses.
     */
    const internalQuery: jest.Mocked<IInternalQuery> = {
      execute: jest
        .fn()
        .mockRejectedValue(
          new Error('P0-1 violated: session end reached the LLM'),
        ),
    };
    // Reaches the LLM, like the real synthesizer does via the lane runner.
    const synthesizer = {
      synthesize: jest.fn(async () => {
        await internalQuery.execute({
          cwd: '/repo',
          model: 'inherit',
          prompt: 'synthesize',
          mcpServerRunning: false,
          maxTurns: 1,
        });
        return null;
      }),
    } as unknown as ConstructorParameters<typeof SkillSynthesisService>[10];

    let sessionEnd: SessionEndCallback | null = null;
    const sessionEndRegistry = {
      register: jest.fn((cb: SessionEndCallback) => {
        sessionEnd = cb;
        return jest.fn();
      }),
    } as unknown as ConstructorParameters<typeof SkillSynthesisService>[9];

    const enqueued: EnqueueInput[] = [];
    const queue = {
      enqueue: jest.fn((input: EnqueueInput): EnqueueResult => {
        enqueued.push(input);
        return { outcome: 'created', row: null };
      }),
      backfillSessionId: jest.fn(() => ({ migrated: 0, discarded: 0 })),
    } as unknown as jest.Mocked<SkillQueueStore>;

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
      synthesizer,
      null,
      null,
      null,
      opts.withQueue === false ? null : queue,
    );

    /** Fire the session-end callback and let its fire-and-forget body settle. */
    async function fireSessionEnd(
      sessionId = 's1',
      workspaceRoot = '/repo',
    ): Promise<void> {
      if (!sessionEnd) throw new Error('session-end callback not registered');
      (sessionEnd as SessionEndCallback)({ sessionId, workspaceRoot });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    return {
      svc,
      store,
      md,
      extractor,
      internalQuery,
      synthesizer,
      queue,
      enqueued,
      logger,
      workspaceProvider: workspaceProvider as unknown as {
        getConfiguration: jest.Mock;
      },
      fireSessionEnd,
    };
  }

  /** Only the `prefilter` rows — `start()` also queues the embedding backfill. */
  function prefilterRows(rows: EnqueueInput[]): EnqueueInput[] {
    return rows.filter((r) => r.stage === 'prefilter');
  }

  it('makes ZERO LLM calls and enqueues exactly one prefilter row', async () => {
    const { svc, internalQuery, queue, enqueued, fireSessionEnd } = setup();
    await svc.start();
    (queue.enqueue as jest.Mock).mockClear();
    enqueued.length = 0;

    await fireSessionEnd();

    expect(internalQuery.execute).toHaveBeenCalledTimes(0);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(enqueued[0]).toMatchObject({
      sessionId: 's1',
      stage: 'prefilter',
      source: 'session-end',
      workspaceRoot: '/repo',
    });
  });

  it('never runs the synthesizer or writes a candidate at session end', async () => {
    const { svc, store, md, synthesizer, fireSessionEnd } = setup();
    await svc.start();

    await fireSessionEnd();

    expect(
      (synthesizer as unknown as { synthesize: jest.Mock }).synthesize,
    ).not.toHaveBeenCalled();
    expect(md.writeCandidate).not.toHaveBeenCalled();
    expect(store.registerCandidate).not.toHaveBeenCalled();
  });

  it('enqueues the OBSERVED turn count, so the guarded re-open can fire', async () => {
    const { svc, enqueued, fireSessionEnd } = setup();
    await svc.start();

    await fireSessionEnd();

    const [row] = prefilterRows(enqueued);
    expect(row.turnCount).toBe(6);
    // `0` would satisfy every other assertion and wedge the re-open forever.
    expect(row.turnCount).not.toBe(0);
  });

  it('re-enqueues once the session has grown past the last queued turn count', async () => {
    const { svc, extractor, enqueued, fireSessionEnd } = setup();
    await svc.start();
    (extractor.extract as jest.Mock)
      .mockResolvedValueOnce(trajectory(6))
      .mockResolvedValueOnce(trajectory(11));

    await fireSessionEnd();
    await fireSessionEnd();

    expect(prefilterRows(enqueued).map((r) => r.turnCount)).toEqual([6, 11]);
  });

  it('skips the round trip when the session has not grown (same-process fast path)', async () => {
    const { svc, extractor, enqueued, fireSessionEnd } = setup();
    await svc.start();
    (extractor.extract as jest.Mock).mockResolvedValue(trajectory(6));

    await fireSessionEnd();
    await fireSessionEnd();

    expect(prefilterRows(enqueued)).toHaveLength(1);
  });

  it('enqueues nothing when the extractor finds no trajectory, and counts it ineligible', async () => {
    const { svc, extractor, enqueued, fireSessionEnd } = setup();
    await svc.start();
    (extractor.extract as jest.Mock).mockResolvedValue(null);

    await fireSessionEnd();

    expect(prefilterRows(enqueued)).toHaveLength(0);
    expect(svc.getEligibilityHistogram().prefilterTooThin).toBe(1);
    expect(
      svc
        .recentEvents(10)
        .some(
          (e) => e.kind === 'ineligible' && e.reason === 'prefilterTooThin',
        ),
    ).toBe(true);
  });

  it('enqueues nothing for the reserved sessionId "manual"', async () => {
    const { svc, enqueued, extractor, fireSessionEnd } = setup();
    await svc.start();

    await fireSessionEnd('manual');

    expect(prefilterRows(enqueued)).toHaveLength(0);
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  /**
   * TASK_2026_295 — an empty session id never reaches the queue.
   *
   * `skill_synthesis_queue` is `UNIQUE(session_id, stage)`, so every session
   * arriving with `''` collides on ONE row per stage, and the re-open is gated
   * on `turn_count < ?` — the first such session's turn count wedges every
   * later one out permanently. It was only ever held shut by the extractor
   * failing to find a transcript for `''`, and that mitigation does not hold on
   * the subagent path, where `transcriptPath` is passed and the extractor never
   * looks at the session id at all.
   *
   * The extractor assertion is the load-bearing half: it proves the rejection
   * happens BEFORE the read, so it cannot depend on the read failing.
   */
  it('enqueues nothing for an empty sessionId', async () => {
    const { svc, enqueued, extractor, fireSessionEnd } = setup();
    await svc.start();
    enqueued.length = 0;

    await fireSessionEnd('');

    expect(prefilterRows(enqueued)).toHaveLength(0);
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  it('enqueues nothing for a whitespace-only sessionId', async () => {
    const { svc, enqueued, extractor, fireSessionEnd } = setup();
    await svc.start();
    enqueued.length = 0;

    await fireSessionEnd('   ');

    expect(prefilterRows(enqueued)).toHaveLength(0);
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  it('rejects an empty sessionId even when a transcript IS readable', async () => {
    // The negative control for the mitigation the fix replaces: with a
    // transcript in hand the extractor returns a real trajectory, so nothing
    // but the guard stands between `''` and the colliding queue row.
    const { svc, enqueued, extractor } = setup();
    await svc.start();
    enqueued.length = 0;
    (extractor.extract as jest.Mock).mockResolvedValue(trajectory(7));

    const outcome = await svc.enqueueAnalyze('', '/repo', {
      source: 'subagent-stop',
      transcriptPath: '/tmp/agents/agent-1.jsonl',
    });

    expect(outcome).toBeNull();
    expect(prefilterRows(enqueued)).toHaveLength(0);
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  it('does not fall back to the inline pipeline when no queue store is registered', async () => {
    const { svc, store, internalQuery, fireSessionEnd } = setup({
      withQueue: false,
    });
    await svc.start();

    await fireSessionEnd();

    expect(internalQuery.execute).toHaveBeenCalledTimes(0);
    expect(store.registerCandidate).not.toHaveBeenCalled();
  });

  it('start() queues the embedding backfill instead of running it on a timer', async () => {
    jest.useFakeTimers();
    try {
      const { svc, enqueued } = setup();
      await svc.start();

      const backfill = enqueued.filter((r) => r.stage === 'embedding');
      expect(backfill).toHaveLength(1);
      expect(backfill[0]).toMatchObject({
        source: 'boot',
        workspaceRoot: '',
      });
      expect(backfill[0].sessionId).toMatch(
        /^backfill-embeddings:\d{4}-\d{2}-\d{2}$/,
      );
      // Nothing is left pending on the macrotask queue — the 5 s timer is gone.
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('enqueues nothing at session end when skillSynthesis.enabled is false', async () => {
    const { svc, queue, workspaceProvider, fireSessionEnd } = setup();
    await svc.start();
    (queue.enqueue as jest.Mock).mockClear();
    // Flip the master switch AFTER start, the way the tray's pause does.
    workspaceProvider.getConfiguration.mockImplementation(
      (_s: string, k: string, fb: unknown) =>
        k === 'skillSynthesis.enabled' ? false : fb,
    );

    await fireSessionEnd();

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  /**
   * TASK_2026_296 item 6, Part B — `rekeySession`.
   *
   * `analyzedSessions` is the same-process high-water mark of the turn count
   * already handed to the pipeline. Armed under a tabId and never migrated, it
   * splits in two: the canonical id starts from zero and the session is
   * re-enqueued from scratch. Both ids below are real UUID v4 strings, because
   * a tabId IS one.
   */
  describe('rekeySession (TASK_2026_296)', () => {
    const TAB_ID = '4a4a0d5e-6a1c-4d2f-9d3b-3e6f1c5a7b21';
    const REAL_ID = 'b7c2f9a1-0e44-4a6b-8c1d-2f5e9a3b6d70';

    it('carries the turn-count high-water mark onto the new id', async () => {
      const { svc, extractor, enqueued, queue } = setup();
      await svc.start();
      (extractor.extract as jest.Mock).mockResolvedValue(trajectory(7));

      await svc.enqueueAnalyze(TAB_ID, '/repo', { source: 'idle' });
      expect(prefilterRows(enqueued)).toHaveLength(1);

      svc.rekeySession(TAB_ID, REAL_ID);
      expect(queue.backfillSessionId).toHaveBeenCalledWith(TAB_ID, REAL_ID);

      // The same-process fast path now recognises the canonical id: the
      // session has not grown past 7, so nothing is re-enqueued.
      const outcome = await svc.enqueueAnalyze(REAL_ID, '/repo', {
        source: 'idle',
      });
      expect(outcome).toBeNull();
      expect(prefilterRows(enqueued)).toHaveLength(1);
    });

    it('re-enqueues once the session grows past the migrated count', async () => {
      // The paired-isolation sibling: migrating the mark must not turn into a
      // permanent seen-set. A grown session is still legitimately re-analyzed.
      const { svc, extractor, enqueued } = setup();
      await svc.start();
      (extractor.extract as jest.Mock).mockResolvedValue(trajectory(7));
      await svc.enqueueAnalyze(TAB_ID, '/repo', { source: 'idle' });
      svc.rekeySession(TAB_ID, REAL_ID);

      (extractor.extract as jest.Mock).mockResolvedValue(trajectory(12));
      await svc.enqueueAnalyze(REAL_ID, '/repo', { source: 'idle' });

      const rows = prefilterRows(enqueued);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ sessionId: REAL_ID, turnCount: 12 });
    });

    it('keeps the destination mark and discards the tabId one when toId already exists', async () => {
      // R4 — never clobber. The canonical id already recorded 12; the stale
      // tabId mark of 7 must not overwrite it and re-open a finished row.
      const { svc, extractor, enqueued } = setup();
      await svc.start();
      (extractor.extract as jest.Mock).mockResolvedValue(trajectory(7));
      await svc.enqueueAnalyze(TAB_ID, '/repo', { source: 'idle' });
      (extractor.extract as jest.Mock).mockResolvedValue(trajectory(12));
      await svc.enqueueAnalyze(REAL_ID, '/repo', { source: 'idle' });
      expect(prefilterRows(enqueued)).toHaveLength(2);

      svc.rekeySession(TAB_ID, REAL_ID);

      // Still 12, not 7: a 9-turn observation is below the mark and enqueues
      // nothing. Had the rekey clobbered, this would have re-enqueued.
      (extractor.extract as jest.Mock).mockResolvedValue(trajectory(9));
      const outcome = await svc.enqueueAnalyze(REAL_ID, '/repo', {
        source: 'idle',
      });
      expect(outcome).toBeNull();
      expect(prefilterRows(enqueued)).toHaveLength(2);
    });

    it('is a no-op for a blank or identical id pair', async () => {
      const { svc, queue } = setup();
      await svc.start();

      svc.rekeySession('', REAL_ID);
      svc.rekeySession(TAB_ID, '   ');
      svc.rekeySession(TAB_ID, TAB_ID);

      expect(queue.backfillSessionId).not.toHaveBeenCalled();
    });
  });
});

/**
 * P2-4 — the analyzer runs from the DRAIN and from nowhere else.
 *
 * Same negative-criterion shape as P0-1 above, one layer up. The archaeologist
 * is the most expensive stage in the library (R3: once per session, multi-pass),
 * so an inline invocation on the session-end path would reintroduce exactly the
 * cost phase 0 removed — with a bigger bill.
 *
 * The stub is not inert: `analyze` is a counted mock, so a regression that calls
 * it from the trigger path fails the first assertion rather than passing quietly.
 *
 * The chain `prefilter → archaeology` is asserted on the ROW, not on the call
 * count, and specifically on `turnCount`. `SkillQueueStore.enqueue`'s guarded
 * re-open fires on `turn_count < ?`, so an archaeology row written with `0`
 * satisfies "enqueue was called", satisfies "the stage is wired", and then can
 * never re-open for the rest of that session's life.
 */
describe('SkillSynthesisService — the archaeology stage (P2-4)', () => {
  const WS = 'D:/repo';

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

  function verdict(overrides: Partial<SessionVerdict> = {}): SessionVerdict {
    return {
      sessionId: 's1',
      workspaceRoot: WS,
      intent: 'make the thing work',
      outcome: 'it was made to work',
      evidenceClass: 'tests-green',
      frictionMap: [],
      routine: null,
      turnCount: 6,
      lane: 'archaeologist',
      model: 'a-tier-alias',
      passes: 2,
      degradedReason: null,
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    };
  }

  /** A queue double that serves exactly one row to the drain, then nothing. */
  function makeOneRowQueue(row: SkillQueueRow) {
    let served = false;
    const enqueued: EnqueueInput[] = [];
    return {
      enqueued,
      enqueue: jest.fn((input: EnqueueInput): EnqueueResult => {
        enqueued.push(input);
        return { outcome: 'created', row: null };
      }),
      reapStale: jest.fn(() => 0),
      listEligibleWorkspaces: jest.fn(() =>
        served ? [] : [row.workspaceRoot],
      ),
      listEligible: jest.fn(() => (served ? [] : [row])),
      markWorkspaceDrained: jest.fn(),
      tryClaim: jest.fn(() => {
        served = true;
        return { ...row, status: 'claimed' as const };
      }),
      touchClaim: jest.fn(() => true),
      markDone: jest.fn(),
      markFailed: jest.fn(),
      markUnscored: jest.fn(),
      markSkipped: jest.fn(),
      requeue: jest.fn(() => true),
    };
  }

  function setupP24(
    opts: {
      row?: SkillQueueRow;
      analyze?: () => Promise<SessionArchaeologyResult>;
      withArchaeologist?: boolean;
    } = {},
  ) {
    const row = opts.row ?? queueRow();
    const queue = makeOneRowQueue(row);
    const drain = new SkillDrainService(
      noopLogger,
      queue as unknown as SkillQueueStore,
      makeBudgetStub(0).store,
      makeTracker(),
      makeDrainWorkspace({
        [SKILL_DRAIN_KEYS.maxItemsPerRun]: 4,
        [SKILL_DRAIN_KEYS.perWorkspaceBatch]: 2,
      }),
    );

    const analyze = jest.fn(
      opts.analyze ??
        (async (): Promise<SessionArchaeologyResult> => ({
          status: 'ok',
          verdict: verdict(),
        })),
    );
    const archaeologist = { analyze } as unknown as SessionArchaeologistService;

    const candidateStore = {
      findByTrajectoryHash: jest.fn(() => null),
      registerCandidate: jest.fn(() => ({
        candidate: { id: 'cand-1' },
        reused: false,
      })),
      recordInvocation: jest.fn(),
      getDominantSkillSlugForSessions: jest.fn(() => null),
    } as unknown as jest.Mocked<SkillCandidateStore>;

    // TASK_2026_256 — the `prefilter → archaeology` chain lives in the stage
    // handlers now. `start()` is still the registration seam, so these tests
    // still reach the chain through `svc.start()`.
    const stageHandlers = new SkillStageHandlersService(
      noopLogger,
      candidateStore,
      queue as never,
      drain,
      opts.withArchaeologist === false ? null : archaeologist,
    );

    let sessionEnd: SessionEndCallback | null = null;
    const svc = new SkillSynthesisService(
      noopLogger,
      {
        isOpen: true,
        openAndMigrate: jest.fn().mockResolvedValue(undefined),
      } as never,
      { available: false } as never,
      makeDrainWorkspace({}) as never,
      candidateStore,
      {
        candidatesRoot: jest.fn(() => '/tmp/cands'),
        writeCandidate: jest.fn(() => ({
          slug: 'do-thing',
          dir: '/tmp/cands/do-thing',
          filePath: '/tmp/cands/do-thing/SKILL.md',
        })),
      } as unknown as jest.Mocked<SkillMdGenerator>,
      { evaluate: jest.fn() } as unknown as jest.Mocked<SkillPromotionService>,
      {
        extract: jest.fn().mockResolvedValue(trajectory(6)),
      } as unknown as jest.Mocked<TrajectoryExtractor>,
      null,
      {
        register: jest.fn((cb: SessionEndCallback) => {
          sessionEnd = cb;
          return jest.fn();
        }),
      } as never,
      null,
      null,
      null,
      null,
      queue as never,
      null,
      stageHandlers,
    );

    async function fireSessionEnd(sessionId = 's1'): Promise<void> {
      if (!sessionEnd) throw new Error('session-end callback not registered');
      (sessionEnd as SessionEndCallback)({ sessionId, workspaceRoot: WS });
      for (let i = 0; i < 8; i++) await Promise.resolve();
    }

    return { svc, drain, queue, analyze, fireSessionEnd };
  }

  const drainOpts = () => ({
    tier: 'nightly' as const,
    signal: liveSignal(),
    onBattery: false,
  });

  it('makes ZERO analyzer calls on the session-end path', async () => {
    const { svc, analyze, fireSessionEnd } = setupP24();
    await svc.start();

    await fireSessionEnd();

    expect(analyze).toHaveBeenCalledTimes(0);
  });

  it('runs the analyzer when the drain processes an archaeology row', async () => {
    const { svc, drain, analyze } = setupP24({
      row: queueRow({ id: 'row-arch', stage: 'archaeology' }),
    });
    await svc.start();
    expect(analyze).toHaveBeenCalledTimes(0);

    const summary = await drain.drain(drainOpts());

    expect(summary.claimed).toBe(1);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', workspaceRoot: WS }),
    );
    expect(summary.done).toBe(1);
    expect(summary.skippedItems).toBe(0);
  });

  it('is a NIGHTLY stage — a frequent tick never claims one', async () => {
    // R3. Registering the handler is not enough; the tier table is what stops
    // the most expensive stage in the library running every fifteen minutes.
    const { svc, drain, analyze } = setupP24({
      row: queueRow({ id: 'row-arch', stage: 'archaeology' }),
    });
    await svc.start();

    const summary = await drain.drain({ ...drainOpts(), tier: 'frequent' });

    expect(summary.claimed).toBe(0);
    expect(analyze).toHaveBeenCalledTimes(0);
  });

  it('chains prefilter → archaeology carrying the OBSERVED turn count', async () => {
    const { svc, drain, queue } = setupP24({ row: queueRow({ turnCount: 9 }) });
    await svc.start();
    queue.enqueued.length = 0;

    await drain.drain(drainOpts());

    const [chained] = queue.enqueued.filter((r) => r.stage === 'archaeology');
    expect(chained).toBeDefined();
    expect(chained).toMatchObject({
      sessionId: 's1',
      stage: 'archaeology',
      workspaceRoot: WS,
    });
    // `0` would satisfy every assertion above and wedge the re-open forever.
    expect(chained.turnCount).toBe(9);
    expect(chained.turnCount).not.toBe(0);
  });

  it('does not chain when the prefilter found nothing to promote', async () => {
    // The negative control for the chain: without it, "an archaeology row is
    // written" would also hold for an implementation that wrote one for every
    // session and paid the analyzer for the ones the prefilter rejected.
    const { svc, drain, queue } = setupP24();
    await svc.start();
    // `svc.start()` bailed on nothing, but the second drain has no row left,
    // so re-run with a service whose extractor yields a rejected shape.
    queue.enqueued.length = 0;
    (
      svc as unknown as { extractor: { extract: jest.Mock } }
    ).extractor.extract.mockResolvedValue({
      ...trajectory(2),
      editCount: 0,
      toolUseCount: 0,
      turnCount: 2,
      charLength: 10,
    });

    await drain.drain(drainOpts());

    expect(queue.enqueued.filter((r) => r.stage === 'archaeology')).toEqual([]);
  });

  it('hands a lane failure to the drain VERBATIM instead of flattening it', async () => {
    // The stage must not pre-decide the row transition: only the drain reads
    // `maxAttempts`, so a handler that returned `unscored`/`failed` itself would
    // be choosing the ceiling and the backoff where it can see neither. A
    // TRANSPORT failure therefore has to come out as a requeue with the LANE's
    // own backoff, which is only possible if the failure travelled untouched.
    const failure: SkillLaneFailure = {
      kind: 'auth-unresolvable',
      reason: 'the archaeologist lane provider is configured but unusable',
      retryAfterMs: 1_800_000,
    };
    const { svc, drain, queue } = setupP24({
      row: queueRow({ id: 'row-arch', stage: 'archaeology' }),
      analyze: async () => ({ status: 'failed', failure, verdict: null }),
    });
    await svc.start();

    const summary = await drain.drain(drainOpts());

    expect(summary.stalled).toBe(1);
    expect(summary.unscored).toBe(0);
    expect(summary.failed).toBe(0);
    expect(queue.requeue).toHaveBeenCalledWith(
      'row-arch',
      expect.any(Number),
      failure.reason,
    );
    expect(queue.markUnscored).not.toHaveBeenCalled();
    expect(queue.markFailed).not.toHaveBeenCalled();
  });

  it('marks a DEGRADED verdict done — a written row stops the retry', async () => {
    const { svc, drain, queue } = setupP24({
      row: queueRow({ id: 'row-arch', stage: 'archaeology' }),
      analyze: async () => ({
        status: 'ok',
        verdict: verdict({ degradedReason: 'no-query-path', intent: null }),
      }),
    });
    await svc.start();

    const summary = await drain.drain(drainOpts());

    expect(summary.done).toBe(1);
    expect(queue.markDone).toHaveBeenCalledWith(
      'row-arch',
      expect.objectContaining({
        reason: 'analyzed, degraded: no-query-path',
      }),
    );
  });

  it('NEGATIVE CONTROL — a host with no analyzer leaves the stage unwired', async () => {
    // Without this, every "the analyzer ran" assertion above would also hold
    // for a service that registered the handler unconditionally and answered
    // "not here" at the cost of a claim and an attempt.
    const { svc, drain, queue, analyze } = setupP24({
      row: queueRow({ id: 'row-arch', stage: 'archaeology' }),
      withArchaeologist: false,
    });
    await svc.start();

    const summary = await drain.drain(drainOpts());

    expect(analyze).toHaveBeenCalledTimes(0);
    expect(summary.skippedItems).toBe(1);
    expect(queue.markSkipped).toHaveBeenCalledWith('row-arch', {
      reason: 'no handler for stage archaeology',
    });
  });
});
