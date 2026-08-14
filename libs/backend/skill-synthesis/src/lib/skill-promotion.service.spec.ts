/**
 * SkillPromotionService specs — exercise the promotion contract:
 *   - threshold (3 successes), dedup (cosine 0.85), cap (50, LRU eviction).
 * Heavy mocking of SkillCandidateStore + SkillMdGenerator avoids SQLite.
 */
import 'reflect-metadata';
import { SkillPromotionService } from './skill-promotion.service';
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
