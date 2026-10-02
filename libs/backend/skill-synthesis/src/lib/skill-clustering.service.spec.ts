import 'reflect-metadata';
import {
  SkillClusteringService,
  type PoolMember,
} from './skill-clustering.service';
import type { SkillCandidateStore } from './skill-candidate.store';
import type { SkillSuggestionStore } from './skill-suggestion.store';
import type {
  SkillCandidateRow,
  SkillSuggestionRow,
  SkillSynthesisSettings,
  CandidateId,
} from './types';
import { unjudgedVerdictFields, unmeasuredGateFields } from './types';

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
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.9,
    prefilterMinEdits: 1,
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
    residency: 'resident',
    workspaceRoot: null,
    ...unjudgedVerdictFields(),
    ...unmeasuredGateFields(),
  };
}

function makeStore(
  candidates: SkillCandidateRow[],
  embeddings: Record<number, Float32Array>,
  promoted: SkillCandidateRow[] = [],
): SkillCandidateStore {
  const all = [...candidates, ...promoted];
  return {
    listByStatus: jest.fn((status: string) =>
      status === 'candidate'
        ? candidates
        : status === 'promoted'
          ? promoted
          : [],
    ),
    findById: jest.fn((id: string) => all.find((r) => r.id === id) ?? null),
    getEmbedding: jest.fn((rowid: number) => embeddings[rowid] ?? null),
  } as unknown as SkillCandidateStore;
}

function promotedRow(
  id: string,
  embeddingRowid: number | null,
  pinned = false,
): SkillCandidateRow {
  return { ...row(id, embeddingRowid), status: 'promoted', pinned };
}

function suggestion(
  id: string,
  memberCandidateIds: string[],
): SkillSuggestionRow {
  return {
    id,
    name: id,
    description: 'desc',
    body: 'body',
    memberSessionIds: [],
    memberCandidateIds,
    clusterSize: memberCandidateIds.length,
    technologyFingerprint: '',
    judgeScore: 7,
    status: 'pending',
    createdAt: 1,
    decidedAt: null,
    mergedInto: null,
    promotedCandidateId: null,
    references: [],
  };
}

function makeSuggestionStore(
  pending: SkillSuggestionRow[] = [],
): SkillSuggestionStore {
  return {
    listByStatus: jest.fn((status: string) =>
      status === 'pending' ? pending : [],
    ),
  } as unknown as SkillSuggestionStore;
}

const noExclusions = {
  suggestionMemberIds: new Set<string>(),
  exemptSlugs: new Set<string>(),
};

function idsOf(members: PoolMember[]): string[] {
  return members.map((m) => `${m.kind}:${m.row.id}`).sort();
}

describe('SkillClusteringService', () => {
  describe('partitionPool', () => {
    const vecOn = { available: true } as never;

    it('reports vecAvailable:false with empty lists when sqlite-vec is unavailable', () => {
      const store = makeStore([row('a', 1), row('b', 2)], {
        1: Float32Array.from([1, 0]),
        2: Float32Array.from([1, 0]),
      });
      const suggestions = makeSuggestionStore();
      const svc = new SkillClusteringService(
        noopLogger,
        { available: false } as never,
        store,
        suggestions,
      );
      expect(svc.partitionPool(makeSettings(), noExclusions)).toEqual({
        vecAvailable: false,
        truncated: false,
        clusters: [],
        orphans: [],
        unembedded: 0,
      });
      expect(store.listByStatus).not.toHaveBeenCalled();
      expect(suggestions.listByStatus).not.toHaveBeenCalled();
    });

    it('splits candidates into clusters and orphans and counts unembedded rows', () => {
      const store = makeStore(
        [row('a', 1), row('b', 2), row('c', 3), row('d', null)],
        {
          1: Float32Array.from([1, 0, 0]),
          2: Float32Array.from([0.99, 0.01, 0]),
          3: Float32Array.from([0, 0, 1]),
        },
      );
      const svc = new SkillClusteringService(
        noopLogger,
        vecOn,
        store,
        makeSuggestionStore(),
      );
      const result = svc.partitionPool(makeSettings(), noExclusions);
      expect(result.vecAvailable).toBe(true);
      expect(result.truncated).toBe(false);
      expect(result.clusters).toHaveLength(1);
      expect(idsOf(result.clusters[0])).toEqual([
        'candidate:a',
        'candidate:b',
      ]);
      expect(idsOf(result.orphans)).toEqual(['candidate:c']);
      expect(result.unembedded).toBe(1);
    });

    it('excludes candidates that already belong to a suggestion', () => {
      const store = makeStore([row('a', 1), row('b', 2)], {
        1: Float32Array.from([1, 0]),
        2: Float32Array.from([1, 0]),
      });
      const svc = new SkillClusteringService(
        noopLogger,
        vecOn,
        store,
        makeSuggestionStore(),
      );
      const result = svc.partitionPool(makeSettings(), {
        suggestionMemberIds: new Set(['b']),
        exemptSlugs: new Set(),
      });
      expect(result.clusters).toEqual([]);
      expect(idsOf(result.orphans)).toEqual(['candidate:a']);
    });

    it('caps candidates newest-first after exclusions and sets truncated', () => {
      // listByStatus is newest-first; the cap keeps the head.
      const store = makeStore([row('x', 9), row('a', 1), row('b', 2), row('c', 3)], {
        9: Float32Array.from([1, 0]),
        1: Float32Array.from([1, 0]),
        2: Float32Array.from([1, 0]),
        3: Float32Array.from([1, 0]),
      });
      const svc = new SkillClusteringService(
        noopLogger,
        vecOn,
        store,
        makeSuggestionStore(),
      );
      const result = svc.partitionPool(
        makeSettings({ suggestionMaxCandidates: 2 }),
        { suggestionMemberIds: new Set(['x']), exemptSlugs: new Set() },
      );
      expect(result.truncated).toBe(true);
      expect(idsOf(result.clusters.flat())).toEqual([
        'candidate:a',
        'candidate:b',
      ]);
    });

    it('does not set truncated when the eligible pool fits the cap exactly', () => {
      const store = makeStore([row('a', 1), row('b', 2)], {
        1: Float32Array.from([1, 0]),
        2: Float32Array.from([1, 0]),
      });
      const svc = new SkillClusteringService(
        noopLogger,
        vecOn,
        store,
        makeSuggestionStore(),
      );
      const result = svc.partitionPool(
        makeSettings({ suggestionMaxCandidates: 2 }),
        noExclusions,
      );
      expect(result.truncated).toBe(false);
    });

    it('embeds a pending suggestion as the centroid of its members', () => {
      // Members m1/m2 sit at [1,0] and [0,1]; their centroid [0.5,0.5] is
      // similar to candidate c ([0.7,0.7]) and to neither member alone at 0.9.
      const members = [row('m1', 11), row('m2', 12)];
      const store = makeStore(
        [row('c', 3)],
        {
          3: Float32Array.from([0.7, 0.7]),
          11: Float32Array.from([1, 0]),
          12: Float32Array.from([0, 1]),
        },
        [],
      );
      (store.findById as jest.Mock).mockImplementation(
        (id: string) => members.find((m) => m.id === id) ?? null,
      );
      const svc = new SkillClusteringService(
        noopLogger,
        vecOn,
        store,
        makeSuggestionStore([suggestion('s1', ['m1', 'm2'])]),
      );
      const result = svc.partitionPool(makeSettings(), noExclusions);
      expect(result.clusters).toHaveLength(1);
      expect(idsOf(result.clusters[0])).toEqual([
        'candidate:c',
        'suggestion:s1',
      ]);
      const sug = result.clusters[0].find((m) => m.kind === 'suggestion');
      expect(sug?.kind === 'suggestion' && sug.memberIds).toEqual([
        'm1',
        'm2',
      ]);
      expect(Array.from(sug?.embedding ?? [])).toEqual([0.5, 0.5]);
    });

    it('skips members with a mismatched dimension and warns once per suggestion', () => {
      const members = [row('m1', 11), row('m2', 12), row('m3', 13)];
      const store = makeStore([], {
        11: Float32Array.from([1, 0]),
        12: Float32Array.from([1, 0, 0]),
        13: Float32Array.from([0, 1, 0]),
      });
      (store.findById as jest.Mock).mockImplementation(
        (id: string) => members.find((m) => m.id === id) ?? null,
      );
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as ConstructorParameters<typeof SkillClusteringService>[0];
      const svc = new SkillClusteringService(
        logger,
        vecOn,
        store,
        makeSuggestionStore([suggestion('s1', ['m1', 'm2', 'm3'])]),
      );
      const result = svc.partitionPool(makeSettings(), noExclusions);
      const sug = result.orphans.find((m) => m.kind === 'suggestion');
      // Only m1 (the first, 2-dim vector) contributes.
      expect(Array.from(sug?.embedding ?? [])).toEqual([1, 0]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('different embedding dimension'),
        { suggestionId: 's1', expectedDimension: 2, skipped: 2 },
      );
    });

    it('skips a pending suggestion when none of its members has an embedding', () => {
      const store = makeStore([row('a', 1)], { 1: Float32Array.from([1, 0]) });
      const svc = new SkillClusteringService(
        noopLogger,
        vecOn,
        store,
        makeSuggestionStore([suggestion('s1', ['gone'])]),
      );
      const result = svc.partitionPool(makeSettings(), noExclusions);
      expect(idsOf(result.orphans)).toEqual(['candidate:a']);
      expect(result.unembedded).toBe(1);
    });

    it('includes promoted rows but excludes pinned and exempt ones', () => {
      const store = makeStore(
        [row('a', 1)],
        {
          1: Float32Array.from([1, 0]),
          2: Float32Array.from([1, 0]),
          3: Float32Array.from([1, 0]),
          4: Float32Array.from([1, 0]),
        },
        [
          promotedRow('p-live', 2),
          promotedRow('p-pinned', 3, true),
          promotedRow('p-authored', 4),
        ],
      );
      const svc = new SkillClusteringService(
        noopLogger,
        vecOn,
        store,
        makeSuggestionStore(),
      );
      const result = svc.partitionPool(makeSettings(), {
        suggestionMemberIds: new Set(),
        exemptSlugs: new Set(['p-authored']),
      });
      expect(result.clusters).toHaveLength(1);
      expect(idsOf(result.clusters[0])).toEqual([
        'candidate:a',
        'promoted:p-live',
      ]);
      expect(result.orphans).toEqual([]);
    });

    it('joins a chain a~b~c with a≁c into one cluster', () => {
      const store = makeStore([row('a', 1), row('b', 2), row('c', 3)], {
        1: Float32Array.from([1, 0]),
        2: Float32Array.from([0.95, 0.31]),
        3: Float32Array.from([0.8, 0.6]),
      });
      const svc = new SkillClusteringService(
        noopLogger,
        vecOn,
        store,
        makeSuggestionStore(),
      );
      const result = svc.partitionPool(makeSettings(), noExclusions);
      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0]).toHaveLength(3);
    });
  });
});
