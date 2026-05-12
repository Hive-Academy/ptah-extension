/**
 * SkillClusterDedupService specs.
 *
 * Tests: vecExtensionLoaded=false short-circuits, empty list returns false,
 * similar candidate above threshold returns true, boundary case at exactly
 * threshold returns false (strictly greater), invalidate() rebuilds on next call.
 */
import 'reflect-metadata';
import { SkillClusterDedupService } from './skill-cluster-dedup.service';
import type { SkillCandidateStore } from './skill-candidate.store';
import type {
  SkillSynthesisSettings,
  SkillCandidateRow,
  CandidateId,
} from './types';

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function makeSettings(threshold = 0.8): SkillSynthesisSettings {
  return {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.85,
    maxActiveSkills: 50,
    candidatesDir: '',
    eligibilityMinTurns: 5,
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    minTrajectoryFidelityRatio: 0.4,
    dedupClusterThreshold: threshold,
    minAbstractionEditDistance: 0.3,
    judgeEnabled: false,
    minJudgeScore: 6.0,
    judgeModel: 'inherit',
    maxPinnedSkills: 10,
    curatorEnabled: false,
    curatorIntervalHours: 24,
  };
}

function fakePromotedRow(
  id: string,
  embeddingRowid: number | null = 1,
): SkillCandidateRow {
  return {
    id: id as CandidateId,
    name: id,
    description: 'desc',
    bodyPath: '/SKILL.md',
    sourceSessionIds: [],
    trajectoryHash: id,
    embeddingRowid,
    status: 'promoted',
    successCount: 3,
    failureCount: 0,
    createdAt: 1,
    promotedAt: 1,
    rejectedAt: null,
    rejectedReason: null,
    pinned: false,
  };
}

function makeVecConnection(loaded: boolean) {
  return {
    vecExtensionLoaded: loaded,
    db: {},
  };
}

// Precomputed unit vectors
const VEC_A = new Float32Array([1, 0, 0]); // sim([1,0,0],[1,0,0]) = 1.0
const VEC_B = new Float32Array([0, 1, 0]); // sim with VEC_A = 0.0

describe('SkillClusterDedupService', () => {
  it('returns false without throwing when vecExtensionLoaded=false', () => {
    const store = {
      listByStatus: jest.fn(() => []),
      getEmbedding: jest.fn(() => null),
    } as unknown as SkillCandidateStore;
    const connection = makeVecConnection(false);
    const svc = new SkillClusterDedupService(
      noopLogger as never,
      connection as never,
      store,
    );
    expect(svc.isDuplicate(VEC_A, makeSettings())).toBe(false);
    expect(store.listByStatus).not.toHaveBeenCalled();
  });

  it('returns false when there are no promoted skills (empty cluster list)', () => {
    const store = {
      listByStatus: jest.fn(() => []),
      getEmbedding: jest.fn(() => null),
    } as unknown as SkillCandidateStore;
    const connection = makeVecConnection(true);
    const svc = new SkillClusterDedupService(
      noopLogger as never,
      connection as never,
      store,
    );
    expect(svc.isDuplicate(VEC_A, makeSettings(0.8))).toBe(false);
  });

  it('returns true when candidate is highly similar to a cluster centroid (sim > threshold)', () => {
    const promoted = [fakePromotedRow('sk-a', 1)];
    const store = {
      listByStatus: jest.fn(() => promoted),
      getEmbedding: jest.fn(() => VEC_A),
    } as unknown as SkillCandidateStore;
    const connection = makeVecConnection(true);
    const svc = new SkillClusterDedupService(
      noopLogger as never,
      connection as never,
      store,
    );
    // Both probe and centroid are [1,0,0] → similarity = 1.0 > 0.8 → duplicate
    expect(svc.isDuplicate(VEC_A, makeSettings(0.8))).toBe(true);
  });

  it('returns false when similarity exactly equals threshold (strictly greater required)', () => {
    // Use orthogonal vectors: sim(VEC_A, VEC_B) = 0.0 < threshold
    const promoted = [fakePromotedRow('sk-b', 1)];
    const store = {
      listByStatus: jest.fn(() => promoted),
      getEmbedding: jest.fn(() => VEC_B),
    } as unknown as SkillCandidateStore;
    const connection = makeVecConnection(true);
    const svc = new SkillClusterDedupService(
      noopLogger as never,
      connection as never,
      store,
    );
    // similarity = 0.0, threshold = 0.0 → NOT strictly greater → not duplicate
    expect(svc.isDuplicate(VEC_A, makeSettings(0.0))).toBe(false);
  });

  it('invalidate() causes clusters to be rebuilt on the next isDuplicate call', () => {
    const promoted = [fakePromotedRow('sk-a', 1)];
    const listByStatus = jest.fn(() => promoted);
    const store = {
      listByStatus,
      getEmbedding: jest.fn(() => VEC_A),
    } as unknown as SkillCandidateStore;
    const connection = makeVecConnection(true);
    const svc = new SkillClusterDedupService(
      noopLogger as never,
      connection as never,
      store,
    );
    const settings = makeSettings(0.8);

    // First call — builds clusters
    svc.isDuplicate(VEC_A, settings);
    const firstCallCount = listByStatus.mock.calls.length;

    // Invalidate — next call should rebuild
    svc.invalidate();
    svc.isDuplicate(VEC_A, settings);
    expect(listByStatus.mock.calls.length).toBeGreaterThan(firstCallCount);
  });
});
