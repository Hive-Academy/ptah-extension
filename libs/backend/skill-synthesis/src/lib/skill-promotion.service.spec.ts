/**
 * SkillPromotionService specs — exercise the promotion contract:
 *   - threshold (3 successes), dedup (cosine 0.85), cap (50, LRU eviction).
 * Heavy mocking of SkillCandidateStore + SkillMdGenerator avoids SQLite.
 */
import 'reflect-metadata';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  SkillPromotionService,
  rankingScore,
  MIN_REPLAY_CONFIDENCE_KEY,
  MIN_REPLAY_CONFIDENCE_DEFAULT,
} from './skill-promotion.service';
import { JUDGE_REASONS, type JudgeDecision } from './skill-judge.service';
import type { SkillCandidateStore } from './skill-candidate.store';
import type { SkillMdGenerator } from './skill-md-generator';
import type {
  CandidateId,
  SkillCandidateRow,
  SkillSynthesisSettings,
} from './types';
import { unjudgedVerdictFields, unmeasuredGateFields } from './types';

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as ConstructorParameters<typeof SkillPromotionService>[0];

const SETTINGS: SkillSynthesisSettings = {
  enabled: true,
  successesToPromote: 3,
  dedupCosineThreshold: 0.85,
  maxActiveSkills: 50,
  candidatesDir: '',
  eligibilityMinTurns: 5,
  evictionDecayRate: 0.95,
  generalizationContextThreshold: 3,
  dedupClusterThreshold: 0.78,
  prefilterMinEdits: 1,
  prefilterMinChars: 800,
  prefilterMinToolUses: 2,
  judgeEnabled: false,
  minJudgeScore: 6.0,
  judgeModel: 'inherit',
  maxPinnedSkills: 10,
  curatorEnabled: false,
  curatorIntervalHours: 24,
  suggestionMinClusterSize: 2,
  suggestionMaxCandidates: 200,
};

function row(overrides: Partial<SkillCandidateRow> = {}): SkillCandidateRow {
  return {
    id: 'cand_test' as CandidateId,
    name: 'do-thing',
    description: 'do a thing',
    bodyPath: '/tmp/x/SKILL.md',
    sourceSessionIds: ['s1'],
    trajectoryHash: 'h',
    embeddingRowid: null,
    status: 'candidate',
    successCount: 0,
    failureCount: 0,
    createdAt: 1,
    promotedAt: null,
    rejectedAt: null,
    rejectedReason: null,
    pinned: false,
    residency: 'resident',
    ...unjudgedVerdictFields(),
    ...unmeasuredGateFields(),
    ...overrides,
  };
}

function makeStore(
  initial: SkillCandidateRow,
): jest.Mocked<SkillCandidateStore> {
  let current = initial;
  return {
    findById: jest.fn((id: CandidateId) =>
      id === current.id ? current : null,
    ),
    listActiveOrderedByActivity: jest.fn(() => []),
    listActiveOrderedByDecayScore: jest.fn(() => []),
    updateStatus: jest.fn((id, next, opts) => {
      current = {
        ...current,
        status: next,
        promotedAt: opts?.promotedAt ?? current.promotedAt,
        rejectedAt: next === 'rejected' ? Date.now() : current.rejectedAt,
        rejectedReason:
          next === 'rejected' ? (opts?.reason ?? null) : current.rejectedReason,
        bodyPath: opts?.bodyPath ?? current.bodyPath,
      };
      return current;
    }),
    getEmbedding: jest.fn(() => null),
    searchActiveByEmbedding: jest.fn(() => []),
    listByStatus: jest.fn(() => []),
    countDistinctContexts: jest.fn(() => 0),
    /**
     * A stand-in for the real store's write, minus its validation — the
     * throwing guard is `skill-candidate.store.spec.ts`'s to prove, and
     * duplicating it here would let this spec pass against a promotion service
     * that had quietly grown its own second validation layer.
     */
    recordJudgeVerdict: jest.fn((id: CandidateId, verdict) => {
      current = {
        ...current,
        id,
        judgeStatus: verdict.status,
        judgeScore: verdict.score,
        judgeReason: verdict.reason,
        judgeCriteria: verdict.criteria ?? current.judgeCriteria,
        judgedAt: verdict.judgedAt ?? Date.now(),
      };
      return current;
    }),
    setResidency: jest.fn((id: CandidateId, residency) => ({
      ...current,
      id,
      residency,
    })),
  } as unknown as jest.Mocked<SkillCandidateStore>;
}

function makeMdGenerator(): jest.Mocked<SkillMdGenerator> {
  return {
    promoteToActive: jest.fn(() => ({
      slug: 'do-thing',
      dir: '/tmp/active/do-thing',
      filePath: '/tmp/active/do-thing/SKILL.md',
    })),
    candidatesRoot: jest.fn(() => '/tmp/cands'),
    activeRoot: jest.fn(() => '/tmp/active'),
    writeCandidate: jest.fn(),
  } as unknown as jest.Mocked<SkillMdGenerator>;
}

describe('SkillPromotionService', () => {
  it('rejects below threshold (successCount < 3)', async () => {
    const store = makeStore(row({ successCount: 2 }));
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(noopLogger, store, md, null, null);
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toBe('below-threshold');
    expect(store.updateStatus).not.toHaveBeenCalled();
  });

  it('promotes at exactly the threshold', async () => {
    const store = makeStore(row({ successCount: 3 }));
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(noopLogger, store, md, null, null);
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.promoted).toBe(true);
    expect(decision.reason).toBe('promoted');
    expect(decision.filePath).toBe('/tmp/active/do-thing/SKILL.md');
    expect(store.updateStatus).toHaveBeenCalledWith(
      'cand_test',
      'promoted',
      expect.objectContaining({ bodyPath: '/tmp/active/do-thing/SKILL.md' }),
    );
  });

  it('rejects an already-promoted candidate (idempotent)', async () => {
    const store = makeStore(row({ successCount: 5, status: 'promoted' }));
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(noopLogger, store, md, null, null);
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toBe('already-promoted');
  });

  it('rejects an already-rejected candidate', async () => {
    const store = makeStore(row({ successCount: 5, status: 'rejected' }));
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(noopLogger, store, md, null, null);
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.reason).toBe('already-rejected');
  });

  it('rejects when not found', async () => {
    const store = makeStore(row({ successCount: 3 }));
    (store.findById as jest.Mock).mockReturnValueOnce(null);
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(noopLogger, store, md, null, null);
    const decision = await svc.evaluate('missing' as CandidateId, SETTINGS);
    expect(decision.reason).toBe('not-found');
    expect(decision.candidate).toBeNull();
  });

  it('rejects as duplicate when cosine >= threshold (0.86 vs 0.85)', async () => {
    const probe = new Float32Array([1, 0, 0]);
    const store = makeStore(row({ successCount: 3, embeddingRowid: 1 }));
    (store.getEmbedding as jest.Mock).mockReturnValue(probe);
    (store.searchActiveByEmbedding as jest.Mock).mockReturnValue([
      { row: row({ id: 'other' as CandidateId }), similarity: 0.86 },
    ]);
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(noopLogger, store, md, null, null);
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toBe('duplicate');
    expect(decision.closestMatchSimilarity).toBeCloseTo(0.86);
    expect(store.updateStatus).toHaveBeenCalledWith(
      'cand_test',
      'rejected',
      expect.objectContaining({ reason: 'duplicate-of-active-skill' }),
    );
  });

  it('promotes when closest match is below threshold (0.84 vs 0.85)', async () => {
    const probe = new Float32Array([1, 0, 0]);
    const store = makeStore(row({ successCount: 3, embeddingRowid: 1 }));
    (store.getEmbedding as jest.Mock).mockReturnValue(probe);
    (store.searchActiveByEmbedding as jest.Mock).mockReturnValue([
      { row: row({ id: 'other' as CandidateId }), similarity: 0.84 },
    ]);
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(noopLogger, store, md, null, null);
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.promoted).toBe(true);
    expect(decision.closestMatchSimilarity).toBeCloseTo(0.84);
  });

  it('demotes the weakest resident to dormant (not rejected) when at cap', async () => {
    const store = makeStore(row({ successCount: 3 }));
    const weakest = row({ id: 'weak' as CandidateId, status: 'promoted' });
    const others: SkillCandidateRow[] = [];
    for (let i = 0; i < 199; i++) {
      others.push(row({ id: `p${i}` as CandidateId, status: 'promoted' }));
    }
    (store.listActiveOrderedByDecayScore as jest.Mock).mockReturnValue([
      weakest,
      ...others,
    ]);
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(noopLogger, store, md, null, null);
    const decision = await svc.evaluate('cand_test' as CandidateId, {
      ...SETTINGS,
      maxActiveSkills: 200,
    });
    expect(decision.promoted).toBe(true);
    expect(decision.evictedSkillId).toBe('weak');
    expect(store.setResidency).toHaveBeenCalledWith('weak', 'dormant');
    expect(store.updateStatus).not.toHaveBeenCalledWith(
      'weak',
      'rejected',
      expect.anything(),
    );
    expect(store.updateStatus).toHaveBeenCalledWith(
      'cand_test',
      'promoted',
      expect.any(Object),
    );
  });

  it('exempts authored skills from dormancy demotion', async () => {
    const store = makeStore(row({ successCount: 3 }));
    const authored = row({ id: 'auth' as CandidateId, name: 'orchestrate' });
    (store.listActiveOrderedByDecayScore as jest.Mock).mockReturnValue([
      authored,
    ]);
    const registry = {
      listAuthoredSlugs: jest.fn(() => new Set(['orchestrate'])),
    } as unknown as ConstructorParameters<typeof SkillPromotionService>[5];
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      md,
      null,
      null,
      registry,
    );
    const decision = await svc.evaluate('cand_test' as CandidateId, {
      ...SETTINGS,
      maxActiveSkills: 1,
    });
    expect(decision.promoted).toBe(true);
    expect(decision.evictedSkillId).toBeUndefined();
    expect(store.setResidency).not.toHaveBeenCalled();
  });

  it('exempts pinned skills from dormancy (filtered upstream)', async () => {
    const store = makeStore(row({ successCount: 3 }));
    // listActiveOrderedByDecayScore already excludes pinned + dormant rows, so
    // an empty list at cap means nothing to demote.
    (store.listActiveOrderedByDecayScore as jest.Mock).mockReturnValue([]);
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(noopLogger, store, md, null, null);
    const decision = await svc.evaluate('cand_test' as CandidateId, {
      ...SETTINGS,
      maxActiveSkills: 1,
    });
    expect(decision.promoted).toBe(true);
    expect(decision.evictedSkillId).toBeUndefined();
    expect(store.setResidency).not.toHaveBeenCalled();
  });

  // ─── B1.6.2: the judge gate persists a verdict and never fabricates one ────

  describe('judge gate', () => {
    const JUDGED = { ...SETTINGS, judgeEnabled: true };

    function makeJudge(decision: JudgeDecision) {
      const judge = { judge: jest.fn(async () => decision) };
      return judge as unknown as ConstructorParameters<
        typeof SkillPromotionService
      >[4] & { judge: jest.Mock };
    }

    function scored(score: number): JudgeDecision {
      return {
        status: 'scored',
        score,
        criteria: {
          novelty: score,
          actionability: score,
          scope: score,
          generalization: score,
          triggerClarity: score,
        },
        reason: JUDGE_REASONS.verdict,
      };
    }

    it('P1-1 — a judge that could not score leaves the candidate at `candidate`', async () => {
      const store = makeStore(row({ successCount: 3 }));
      const judge = makeJudge({
        status: 'unscored',
        score: null,
        criteria: null,
        reason: 'Lane judge: rate limited',
      });
      const svc = new SkillPromotionService(
        noopLogger,
        store,
        makeMdGenerator(),
        null,
        judge,
      );

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.promoted).toBe(false);
      expect(decision.reason).toBe('judge-unscored');
      // Neither pass nor block: nothing moved the row off `candidate`.
      expect(decision.candidate?.status).toBe('candidate');
      expect(store.updateStatus).not.toHaveBeenCalled();
    });

    it('P1-1 — the unscored verdict is persisted with score=null and its reason', async () => {
      const store = makeStore(row({ successCount: 3 }));
      const judge = makeJudge({
        status: 'unscored',
        score: null,
        criteria: null,
        reason: 'Lane judge: rate limited',
      });
      const svc = new SkillPromotionService(
        noopLogger,
        store,
        makeMdGenerator(),
        null,
        judge,
      );

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(store.recordJudgeVerdict).toHaveBeenCalledWith('cand_test', {
        status: 'unscored',
        score: null,
        reason: 'Lane judge: rate limited',
        criteria: undefined,
      });
      expect(decision.candidate?.judgeScore).toBeNull();
      expect(decision.candidate?.judgeScore).not.toBe(10);
      expect(decision.candidate?.judgeStatus).toBe('unscored');
    });

    it('rejects a scored verdict below minJudgeScore', async () => {
      const store = makeStore(row({ successCount: 3 }));
      const svc = new SkillPromotionService(
        noopLogger,
        store,
        makeMdGenerator(),
        null,
        makeJudge(scored(3)),
      );

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.reason).toBe('below-judge-score');
      expect(store.updateStatus).toHaveBeenCalledWith(
        'cand_test',
        'rejected',
        expect.objectContaining({ reason: 'below-judge-score' }),
      );
    });

    it('promotes on a scored verdict at or above minJudgeScore, criteria and all', async () => {
      const store = makeStore(row({ successCount: 3 }));
      const svc = new SkillPromotionService(
        noopLogger,
        store,
        makeMdGenerator(),
        null,
        makeJudge(scored(8)),
      );

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.promoted).toBe(true);
      expect(store.recordJudgeVerdict).toHaveBeenCalledWith(
        'cand_test',
        expect.objectContaining({
          status: 'scored',
          score: 8,
          criteria: expect.objectContaining({ novelty: 8 }),
        }),
      );
    });

    it('promotes when the gate is disabled, and records that rather than a score', async () => {
      const store = makeStore(row({ successCount: 3 }));
      const svc = new SkillPromotionService(
        noopLogger,
        store,
        makeMdGenerator(),
        null,
        makeJudge({
          status: 'disabled',
          score: null,
          criteria: null,
          reason: JUDGE_REASONS.disabled,
        }),
      );

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.promoted).toBe(true);
      expect(store.recordJudgeVerdict).toHaveBeenCalledWith(
        'cand_test',
        expect.objectContaining({ status: 'disabled', score: null }),
      );
    });

    it('does NOT catch or downgrade the store guard — a bad verdict propagates', async () => {
      const store = makeStore(row({ successCount: 3 }));
      (store.recordJudgeVerdict as jest.Mock).mockImplementation(() => {
        throw new Error(
          "[skill-synthesis] recordJudgeVerdict: a 'unscored' verdict must carry score=null",
        );
      });
      const svc = new SkillPromotionService(
        noopLogger,
        store,
        makeMdGenerator(),
        null,
        makeJudge({
          status: 'unscored',
          score: null,
          criteria: null,
          reason: 'whatever',
        }),
      );

      // A second validation layer here, or a catch, would turn the store's
      // guard into a silent downgrade — which is the defect, not the fix.
      await expect(
        svc.evaluate('cand_test' as CandidateId, JUDGED),
      ).rejects.toThrow('recordJudgeVerdict');
      expect(store.updateStatus).not.toHaveBeenCalled();
    });

    it('skips the gate entirely when no judge is registered', async () => {
      const store = makeStore(row({ successCount: 3 }));
      const svc = new SkillPromotionService(
        noopLogger,
        store,
        makeMdGenerator(),
        null,
        null,
      );

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.promoted).toBe(true);
      expect(store.recordJudgeVerdict).not.toHaveBeenCalled();
    });
  });

  // ─── B3.4.2: the replay gate + measured ranking ───────────────────────────

  /**
   * The whole rule turns on `null` vs `0`, so both directions are pinned here
   * and each has its own case. One test cannot cover both: a rule written as
   * `!(confidence >= min)` passes "a measured 0 is blocked" and fails only the
   * `null` case, while a rule written as `confidence < min` with a truthiness
   * guard passes the `null` case and lets a measured 0 through.
   */
  describe('replay gate', () => {
    const JUDGED = { ...SETTINGS, judgeEnabled: true };

    function makeJudge(decision: JudgeDecision) {
      const judge = { judge: jest.fn(async () => decision) };
      return judge as unknown as ConstructorParameters<
        typeof SkillPromotionService
      >[4] & { judge: jest.Mock };
    }

    function scored(score: number): JudgeDecision {
      return {
        status: 'scored',
        score,
        criteria: {
          novelty: score,
          actionability: score,
          scope: score,
          generalization: score,
          triggerClarity: score,
        },
        reason: JUDGE_REASONS.verdict,
      };
    }

    /** A workspace whose settings come from one plain map. */
    function makeWorkspace(
      values: Record<string, unknown> = {},
    ): IWorkspaceProvider {
      return {
        getConfiguration: jest.fn(
          <T>(_section: string, key: string, fallback: T): T =>
            key in values ? (values[key] as T) : fallback,
        ),
      } as unknown as IWorkspaceProvider;
    }

    function promoteWith(
      overrides: Partial<SkillCandidateRow>,
      workspace?: IWorkspaceProvider,
    ) {
      const store = makeStore(row({ successCount: 3, ...overrides }));
      const svc = new SkillPromotionService(
        noopLogger,
        store,
        makeMdGenerator(),
        null,
        makeJudge(scored(8)),
        null,
        workspace ?? null,
      );
      return { store, svc };
    }

    it('a NULL replayConfidence promotes on the judge score alone', async () => {
      // Unmeasured is not "below threshold". After B3.6 this is the NORMAL case
      // for a cluster at `suggestionMinClusterSize`, which gets no hold-out by
      // design — blocking those would block most cluster-synthesized skills on
      // a measurement that could not exist.
      const { store, svc } = promoteWith({ replayConfidence: null });

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.promoted).toBe(true);
      expect(decision.reason).toBe('promoted');
      expect(store.updateStatus).toHaveBeenCalledWith(
        'cand_test',
        'promoted',
        expect.any(Object),
      );
    });

    it('a MEASURED 0 blocks — it is not the same fact as null', async () => {
      const { store, svc } = promoteWith({
        replayConfidence: 0,
        replayHoldoutSessionId: 's-holdout',
      });

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.promoted).toBe(false);
      expect(decision.reason).toBe('below-replay-confidence');
      // Blocked, NOT rejected: the floor is an untuned midpoint and the weekly
      // tick re-measures, whereas `updateStatus('rejected')` is terminal.
      expect(decision.candidate?.status).toBe('candidate');
      expect(store.updateStatus).not.toHaveBeenCalled();
    });

    it('blocks a measured confidence below the floor', async () => {
      const { svc } = promoteWith({
        replayConfidence: 0.4,
        replayHoldoutSessionId: 's-holdout',
      });

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.promoted).toBe(false);
      expect(decision.reason).toBe('below-replay-confidence');
    });

    it('promotes AT the floor — the comparison is `>=`, not `>`', async () => {
      const { svc } = promoteWith({
        replayConfidence: MIN_REPLAY_CONFIDENCE_DEFAULT,
        replayHoldoutSessionId: 's-holdout',
      });

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.promoted).toBe(true);
    });

    it('promotes a measured confidence above the floor', async () => {
      const { svc } = promoteWith({
        replayConfidence: 0.82,
        replayHoldoutSessionId: 's-holdout',
      });

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.promoted).toBe(true);
    });

    it('reads the floor from replayValidation.minConfidence, not a constant', async () => {
      const { svc } = promoteWith(
        { replayConfidence: 0.7, replayHoldoutSessionId: 's-holdout' },
        // `replayValidation`, NOT `replay` — that sub-tree is the replay LANE's.
        makeWorkspace({ [MIN_REPLAY_CONFIDENCE_KEY]: 0.8 }),
      );

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      // 0.7 promotes at the default 0.5 and is blocked at a configured 0.8.
      expect(decision.promoted).toBe(false);
      expect(decision.reason).toBe('below-replay-confidence');
    });

    it('a nonsensical configured floor falls back rather than blocking everything', async () => {
      const { svc } = promoteWith(
        { replayConfidence: 0.6, replayHoldoutSessionId: 's-holdout' },
        makeWorkspace({ [MIN_REPLAY_CONFIDENCE_KEY]: 42 }),
      );

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.promoted).toBe(true);
    });

    it('replay never RESCUES a candidate the judge scored below the floor', async () => {
      const store = makeStore(
        row({
          successCount: 3,
          replayConfidence: 1,
          replayHoldoutSessionId: 's',
        }),
      );
      const svc = new SkillPromotionService(
        noopLogger,
        store,
        makeMdGenerator(),
        null,
        makeJudge(scored(3)),
      );

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.reason).toBe('below-judge-score');
    });

    it('applies to a host with no judge registered too', async () => {
      // The judge gate and the replay gate are independent axes. A host that
      // never judges must still not promote a candidate a replay measured and
      // found wanting.
      const store = makeStore(
        row({
          successCount: 3,
          replayConfidence: 0.1,
          replayHoldoutSessionId: 's',
        }),
      );
      const svc = new SkillPromotionService(
        noopLogger,
        store,
        makeMdGenerator(),
        null,
        null,
      );

      const decision = await svc.evaluate('cand_test' as CandidateId, JUDGED);

      expect(decision.promoted).toBe(false);
      expect(decision.reason).toBe('below-replay-confidence');
    });
  });

  // ─── B3.4.2: ranking substitutes the MEASURED trigger score ───────────────

  describe('rankingScore', () => {
    function judged(triggerClarity: number): SkillCandidateRow {
      return row({
        judgeStatus: 'scored',
        judgeScore: 8,
        judgeCriteria: {
          novelty: 8,
          actionability: 8,
          scope: 8,
          generalization: 8,
          triggerClarity,
        },
      });
    }

    it('substitutes the measured trigger score for the judged criterion', () => {
      // Judged triggerClarity 10, measured F1 0.2 ⇒ 2/10 on the judge scale.
      const ranking = rankingScore({ ...judged(10), triggerScore: 0.2 });

      expect(ranking.triggerSource).toBe('measured');
      expect(ranking.score).toBe((8 + 8 + 8 + 8 + 2) / 5);
    });

    it('scales the 0–1 trigger score onto the judge 1–10 scale', () => {
      const perfect = rankingScore({ ...judged(1), triggerScore: 1 });
      // Without the scale factor this would be (8+8+8+8+1)/5 = 6.6.
      expect(perfect.score).toBe((8 + 8 + 8 + 8 + 10) / 5);
    });

    it('keeps the judged criterion when the gate never measured', () => {
      // `null` is not `0`: an unevaluated description is not a description that
      // retrieved nothing, and ranking it as one would put every candidate the
      // weekly gate has not reached below every candidate it has.
      const ranking = rankingScore({ ...judged(9), triggerScore: null });

      expect(ranking.triggerSource).toBe('judged');
      expect(ranking.score).toBe((8 + 8 + 8 + 8 + 9) / 5);
    });

    it('a measured 0 IS ranked as zero — it is a result', () => {
      const ranking = rankingScore({ ...judged(10), triggerScore: 0 });

      expect(ranking.triggerSource).toBe('measured');
      expect(ranking.score).toBe((8 + 8 + 8 + 8 + 0) / 5);
    });

    it('is null without a complete judged scorecard', () => {
      expect(rankingScore(row()).score).toBeNull();
      expect(rankingScore(row()).triggerSource).toBe('none');
      expect(rankingScore(null).score).toBeNull();
    });

    it('rides along on the promotion decision', async () => {
      const store = makeStore(
        row({
          successCount: 3,
          judgeStatus: 'scored',
          judgeScore: 8,
          judgeCriteria: {
            novelty: 8,
            actionability: 8,
            scope: 8,
            generalization: 8,
            triggerClarity: 10,
          },
          triggerScore: 0.2,
        }),
      );
      const svc = new SkillPromotionService(
        noopLogger,
        store,
        makeMdGenerator(),
        null,
        null,
      );

      const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);

      expect(decision.promoted).toBe(true);
      expect(decision.ranking?.triggerSource).toBe('measured');
      expect(decision.ranking?.score).toBe((8 + 8 + 8 + 8 + 2) / 5);
      // The judged criterion is still on the row — the comparison between the
      // opinion and the measurement is the point of the gate.
      expect(decision.candidate?.judgeCriteria.triggerClarity).toBe(10);
    });
  });

  it('continues with original bodyPath when SKILL.md materialization fails', async () => {
    const store = makeStore(
      row({ successCount: 3, bodyPath: '/orig/SKILL.md' }),
    );
    const md = makeMdGenerator();
    (md.promoteToActive as jest.Mock).mockImplementation(() => {
      throw new Error('disk full');
    });
    const svc = new SkillPromotionService(noopLogger, store, md, null, null);
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.promoted).toBe(true);
    expect(decision.filePath).toBe('/orig/SKILL.md');
  });
});
