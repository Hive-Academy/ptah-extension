/**
 * SkillPromotionService specs — exercise the promotion contract:
 *   - threshold (3 successes), dedup (cosine 0.85), cap (50, LRU eviction).
 * Heavy mocking of SkillCandidateStore + SkillMdGenerator avoids SQLite.
 */
import 'reflect-metadata';
import { SkillPromotionService } from './skill-promotion.service';
import type { SkillCandidateStore } from './skill-candidate.store';
import type { SkillMdGenerator } from './skill-md-generator';
import type {
  CandidateId,
  SkillCandidateRow,
  SkillSynthesisSettings,
} from './types';

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
  minTrajectoryFidelityRatio: 0.4,
  dedupClusterThreshold: 0.78,
  minAbstractionEditDistance: 0.3,
  judgeEnabled: false,
  minJudgeScore: 6.0,
  judgeModel: 'inherit',
  maxPinnedSkills: 10,
  curatorEnabled: false,
  curatorIntervalHours: 24,
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
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      md,
      null,
      null,
      null,
    );
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toBe('below-threshold');
    expect(store.updateStatus).not.toHaveBeenCalled();
  });

  it('promotes at exactly the threshold', async () => {
    const store = makeStore(row({ successCount: 3 }));
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      md,
      null,
      null,
      null,
    );
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
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      md,
      null,
      null,
      null,
    );
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toBe('already-promoted');
  });

  it('rejects an already-rejected candidate', async () => {
    const store = makeStore(row({ successCount: 5, status: 'rejected' }));
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      md,
      null,
      null,
      null,
    );
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.reason).toBe('already-rejected');
  });

  it('rejects when not found', async () => {
    const store = makeStore(row({ successCount: 3 }));
    (store.findById as jest.Mock).mockReturnValueOnce(null);
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      md,
      null,
      null,
      null,
    );
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
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      md,
      null,
      null,
      null,
    );
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
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      md,
      null,
      null,
      null,
    );
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.promoted).toBe(true);
    expect(decision.closestMatchSimilarity).toBeCloseTo(0.84);
  });

  it('LRU-evicts least-active when at cap', async () => {
    const store = makeStore(row({ successCount: 3 }));
    const lruVictim = row({ id: 'lru' as CandidateId, status: 'promoted' });
    const others: SkillCandidateRow[] = [];
    for (let i = 0; i < 49; i++) {
      others.push(row({ id: `p${i}` as CandidateId, status: 'promoted' }));
    }
    // listActiveOrderedByDecayScore is ascending (lowest score first = evict first).
    (store.listActiveOrderedByDecayScore as jest.Mock).mockReturnValue([
      lruVictim,
      ...others,
    ]);
    const md = makeMdGenerator();
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      md,
      null,
      null,
      null,
    );
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.promoted).toBe(true);
    expect(decision.evictedSkillId).toBe('lru');
    // First updateStatus call evicts lru, second promotes the candidate.
    expect(store.updateStatus).toHaveBeenNthCalledWith(
      1,
      'lru',
      'rejected',
      expect.objectContaining({ reason: 'decay-cap-eviction' }),
    );
    expect(store.updateStatus).toHaveBeenNthCalledWith(
      2,
      'cand_test',
      'promoted',
      expect.any(Object),
    );
  });

  it('continues with original bodyPath when SKILL.md materialization fails', async () => {
    const store = makeStore(
      row({ successCount: 3, bodyPath: '/orig/SKILL.md' }),
    );
    const md = makeMdGenerator();
    (md.promoteToActive as jest.Mock).mockImplementation(() => {
      throw new Error('disk full');
    });
    const svc = new SkillPromotionService(
      noopLogger,
      store,
      md,
      null,
      null,
      null,
    );
    const decision = await svc.evaluate('cand_test' as CandidateId, SETTINGS);
    expect(decision.promoted).toBe(true);
    expect(decision.filePath).toBe('/orig/SKILL.md');
  });
});
