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
import type { EnqueueInput, EnqueueResult } from './queue/skill-queue.types';
import type { IInternalQuery } from './internal-query.interface';

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
});
