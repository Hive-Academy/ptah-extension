import 'reflect-metadata';
import { SkillClusteringService } from './skill-clustering.service';
import type { SkillCandidateStore } from './skill-candidate.store';
import type {
  SkillCandidateRow,
  SkillSynthesisSettings,
  CandidateId,
} from './types';

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as ConstructorParameters<typeof SkillClusteringService>[0];

function makeSettings(
  overrides: Partial<SkillSynthesisSettings> = {},
): SkillSynthesisSettings {
  return {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.9,
    maxActiveSkills: 50,
    candidatesDir: '',
    eligibilityMinTurns: 5,
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.9,
    prefilterMinEdits: 1,
    prefilterMinChars: 800,
    prefilterMinToolUses: 2,
    judgeEnabled: false,
    minJudgeScore: 6,
    judgeModel: 'inherit',
    maxPinnedSkills: 10,
    curatorEnabled: true,
    curatorIntervalHours: 24,
    suggestionMinClusterSize: 2,
    suggestionMaxCandidates: 200,
    ...overrides,
  };
}

function row(id: string, embeddingRowid: number | null): SkillCandidateRow {
  return {
    id: id as CandidateId,
    name: id,
    description: 'desc',
    bodyPath: '/SKILL.md',
    sourceSessionIds: [`sess-${id}`],
    trajectoryHash: id,
    embeddingRowid,
    status: 'candidate',
    successCount: 0,
    failureCount: 0,
    createdAt: 1,
    promotedAt: null,
    rejectedAt: null,
    rejectedReason: null,
    pinned: false,
  };
}

function makeStore(
  candidates: SkillCandidateRow[],
  embeddings: Record<number, Float32Array>,
): SkillCandidateStore {
  return {
    listByStatus: jest.fn((status: string) =>
      status === 'candidate' ? candidates : [],
    ),
    getEmbedding: jest.fn((rowid: number) => embeddings[rowid] ?? null),
  } as unknown as SkillCandidateStore;
}

describe('SkillClusteringService', () => {
  it('returns empty when sqlite-vec is unavailable (fail-open)', () => {
    const vecStatus = { available: false } as never;
    const store = makeStore([row('a', 1)], { 1: Float32Array.from([1, 0]) });
    const svc = new SkillClusteringService(noopLogger, vecStatus, store);
    expect(svc.clusterCandidates(makeSettings())).toEqual([]);
  });

  it('returns empty when fewer embedded candidates than min cluster size', () => {
    const vecStatus = { available: true } as never;
    const store = makeStore([row('a', 1)], { 1: Float32Array.from([1, 0]) });
    const svc = new SkillClusteringService(noopLogger, vecStatus, store);
    expect(svc.clusterCandidates(makeSettings())).toEqual([]);
  });

  it('groups similar candidates into a cluster of size >= min', () => {
    const vecStatus = { available: true } as never;
    const store = makeStore([row('a', 1), row('b', 2), row('c', 3)], {
      1: Float32Array.from([1, 0, 0]),
      2: Float32Array.from([0.99, 0.01, 0]),
      3: Float32Array.from([0, 0, 1]),
    });
    const svc = new SkillClusteringService(noopLogger, vecStatus, store);
    const clusters = svc.clusterCandidates(makeSettings());
    expect(clusters).toHaveLength(1);
    const ids = clusters[0].members.map((m) => m.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('skips candidates without embeddings', () => {
    const vecStatus = { available: true } as never;
    const store = makeStore([row('a', 1), row('b', null), row('c', 3)], {
      1: Float32Array.from([1, 0]),
      3: Float32Array.from([0.99, 0.01]),
    });
    const svc = new SkillClusteringService(noopLogger, vecStatus, store);
    const clusters = svc.clusterCandidates(makeSettings());
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.id).sort()).toEqual(['a', 'c']);
  });
});
