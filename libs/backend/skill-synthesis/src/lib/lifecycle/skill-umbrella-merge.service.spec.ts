/**
 * SkillUmbrellaMergeService — umbrella merge, R7 rejection, singletons and the
 * one-time backlog purge, on a real migrated in-memory database.
 *
 * The candidate, suggestion, clustering and purge-state collaborators are the
 * real classes on one connection. `skill_candidates_vec` is a plain
 * `(rowid, embedding BLOB)` table, so embeddings round-trip without the
 * sqlite-vec extension. The synthesizer, judge and rate limiter are mocks: they
 * are the LLM boundary and the shared bucket.
 */
import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import { SkillCandidateStore } from '../skill-candidate.store';
import { SkillSuggestionStore } from '../skill-suggestion.store';
import { SkillClusteringService } from '../skill-clustering.service';
import type {
  SkillSynthesizerService,
  UmbrellaMemberInput,
} from '../skill-synthesizer.service';
import type { SkillJudgeService } from '../skill-judge.service';
import {
  BACKLOG_PURGE_REASON,
  MERGED_INTO_PREFIX,
  type SkillCandidateRow,
  type SkillSuggestionRow,
  type SkillSynthesisSettings,
} from '../types';
import {
  resolveOpener,
  type TestDatabase,
} from '../queue/queue-db.test-support';
import { SkillBacklogPurgeStateStore } from './skill-backlog-purge-state.store';
import {
  BELOW_JUDGE_SCORE_UMBRELLA_PREFIX,
  SkillUmbrellaMergeService,
} from './skill-umbrella-merge.service';

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;

const sqlFor = (version: number): string =>
  MIGRATIONS.find((m) => m.version === version)?.sql ?? '';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const DIM = 16;

function createDb(): TestDatabase {
  if (!opener) throw new Error('no sqlite binding available');
  const db = opener(':memory:');
  db.exec(`
    CREATE TABLE skill_candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      body_path TEXT NOT NULL,
      source_session_ids TEXT NOT NULL DEFAULT '[]',
      trajectory_hash TEXT NOT NULL UNIQUE,
      embedding_rowid INTEGER,
      status TEXT NOT NULL CHECK(status IN ('candidate','promoted','rejected')) DEFAULT 'candidate',
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      promoted_at INTEGER,
      rejected_at INTEGER,
      rejected_reason TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      residency TEXT NOT NULL DEFAULT 'resident' CHECK(residency IN ('resident','dormant'))
    );

    CREATE TABLE skill_candidates_vec (
      rowid INTEGER PRIMARY KEY,
      embedding BLOB
    );

    CREATE TABLE skill_invocations (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skill_candidates(id),
      session_id TEXT NOT NULL,
      succeeded INTEGER NOT NULL,
      invoked_at INTEGER NOT NULL,
      notes TEXT,
      context_id TEXT
    );

    CREATE TABLE skill_invocation_events (
      id TEXT PRIMARY KEY,
      skill_slug TEXT NOT NULL,
      session_id TEXT NOT NULL,
      context_id TEXT,
      source TEXT NOT NULL,
      succeeded INTEGER NOT NULL,
      is_error INTEGER NOT NULL,
      invoked_at INTEGER NOT NULL,
      reconciled_at INTEGER,
      verdict_source TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      cost_usd REAL,
      duration_ms INTEGER,
      tool_count INTEGER,
      task_id TEXT
    );
  `);
  for (const version of [33, 36, 37, 32, 40, 25, 51]) {
    db.exec(sqlFor(version));
  }
  return db;
}

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

/** Unit vector on `axis`, nudged by `jitter` along the last axis. */
function vec(axis: number, jitter = 0, extra?: [number, number]): Float32Array {
  const v = new Float32Array(DIM);
  v[axis] = 1;
  v[DIM - 1] += jitter;
  if (extra) v[extra[0]] += extra[1];
  return v;
}

function baseSettings(
  overrides: Partial<SkillSynthesisSettings> = {},
): SkillSynthesisSettings {
  return {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.85,
    maxActiveSkills: 50,
    candidatesDir: '',
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.9,
    prefilterMinEdits: 1,
    prefilterMinToolUses: 1,
    judgeEnabled: true,
    minJudgeScore: 6,
    judgeModel: 'inherit',
    maxPinnedSkills: 5,
    curatorEnabled: true,
    curatorIntervalHours: 24,
    suggestionMinClusterSize: 3,
    suggestionMaxCandidates: 1000,
    ...overrides,
  };
}

maybe('SkillUmbrellaMergeService', () => {
  let db: TestDatabase;
  let vecStatus: { available: boolean };
  let store: SkillCandidateStore;
  let suggestions: SkillSuggestionStore;
  let clustering: SkillClusteringService;
  let purgeState: SkillBacklogPurgeStateStore;
  let synthesizer: { synthesizeUmbrella: jest.Mock };
  let judge: { judge: jest.Mock };
  let rateLimiter: { tryAcquire: jest.Mock };
  let service: SkillUmbrellaMergeService;
  let seq: number;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDb();
    seq = 0;
    vecStatus = { available: true };
    const connection = { db, isOpen: true };
    store = new SkillCandidateStore(
      logger as never,
      connection as never,
      vecStatus as never,
    );
    suggestions = new SkillSuggestionStore(
      logger as never,
      connection as never,
    );
    clustering = new SkillClusteringService(
      logger as never,
      vecStatus as never,
      store,
      suggestions,
    );
    purgeState = new SkillBacklogPurgeStateStore(
      logger as never,
      connection as never,
    );
    synthesizer = {
      synthesizeUmbrella: jest.fn(async () => ({
        name: 'umbrella-skill',
        description: 'One umbrella over the cluster',
        body: '# Umbrella\nShared procedure.',
        references: [{ name: 'variant-a', body: '# Variant A' }],
      })),
    };
    judge = {
      judge: jest.fn(async () => ({
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'scored',
      })),
    };
    rateLimiter = { tryAcquire: jest.fn(() => ({ allowed: true })) };
    service = new SkillUmbrellaMergeService(
      logger as never,
      store,
      suggestions,
      clustering,
      synthesizer as unknown as SkillSynthesizerService,
      judge as unknown as SkillJudgeService,
      rateLimiter as never,
      purgeState,
    );
  });

  afterEach(() => {
    db.close();
  });

  function addCandidate(
    embedding: Float32Array | null,
    options: { createdAt?: number; sessions?: string[]; name?: string } = {},
  ): SkillCandidateRow {
    seq += 1;
    const name = options.name ?? `cand-${seq}`;
    return store.registerCandidate({
      name,
      description: `desc ${name}`,
      bodyPath: '',
      sourceSessionIds: options.sessions ?? [],
      trajectoryHash: `hash-${seq}`,
      embedding,
      // Newer rows get larger timestamps; all young unless overridden.
      createdAt: options.createdAt ?? NOW - DAY + seq,
    }).candidate;
  }

  function promote(row: SkillCandidateRow): SkillCandidateRow {
    return store.promoteAtomically(row.id, {
      promotedAt: NOW - DAY,
      bodyPath: '',
    });
  }

  function judgePass(row: SkillCandidateRow, score = 8): void {
    db.prepare(
      `UPDATE skill_candidates SET judge_status = 'scored', judge_score = ? WHERE id = ?`,
    ).run(score, row.id);
  }

  function addSuggestion(
    memberIds: string[],
    status: 'pending' | 'dismissed' = 'pending',
  ): SkillSuggestionRow {
    return suggestions.insert(
      {
        name: `suggestion-${memberIds.join('-')}`,
        description: 'an existing suggestion',
        body: '# Existing suggestion body',
        memberSessionIds: ['sugg-session'],
        memberCandidateIds: memberIds,
        clusterSize: memberIds.length,
        technologyFingerprint: 'general',
        judgeScore: 7,
      },
      status,
    );
  }

  function row(id: string): SkillCandidateRow {
    const found = store.findById(id as SkillCandidateRow['id']);
    if (!found) throw new Error(`missing candidate ${id}`);
    return found;
  }

  function allSuggestions(): SkillSuggestionRow[] {
    return [
      ...suggestions.listByStatus('pending'),
      ...suggestions.listByStatus('dismissed'),
      ...suggestions.listByStatus('accepted'),
    ];
  }

  function umbrellaRow(): SkillSuggestionRow {
    const found = allSuggestions().find((s) => s.name === 'umbrella-skill');
    if (!found) throw new Error('no umbrella row');
    return found;
  }

  const run = (settings = baseSettings(), exempt = new Set<string>()) =>
    service.runPass(settings, exempt, {}, NOW);

  describe('umbrella merge', () => {
    it('writes a pending umbrella and rejects candidate members merged-into:<id>', async () => {
      const members = [0.01, 0.02, 0.03].map((j) => addCandidate(vec(0, j)));

      const result = await run();

      const umbrella = umbrellaRow();
      expect(umbrella.status).toBe('pending');
      expect(umbrella.judgeScore).toBe(8);
      expect(umbrella.clusterSize).toBe(3);
      expect(umbrella.references).toEqual([
        { name: 'variant-a', body: '# Variant A' },
      ]);
      expect([...umbrella.memberCandidateIds].sort()).toEqual(
        members.map((m) => m.id).sort(),
      );
      for (const m of members) {
        expect(row(m.id).status).toBe('rejected');
        expect(row(m.id).rejectedReason).toBe(MERGED_INTO_PREFIX + umbrella.id);
      }
      expect(result).toMatchObject({
        umbrellasCreated: 1,
        candidatesMerged: 3,
        suggestionsMerged: 0,
        clustersRemaining: 0,
        rateLimited: false,
      });
      expect([...result.mergedIds].sort()).toEqual(
        members.map((m) => m.id).sort(),
      );
    });

    it('dismisses a merged pending suggestion with merged_into and merges its members', async () => {
      const a = addCandidate(vec(0, 0.01));
      const b = addCandidate(vec(0, 0.02));
      const m1 = addCandidate(vec(0, 0.03));
      const m2 = addCandidate(vec(0, 0.04));
      const pending = addSuggestion([m1.id, m2.id]);

      const result = await run();

      const umbrella = umbrellaRow();
      const merged = suggestions.findById(pending.id);
      expect(merged?.status).toBe('dismissed');
      expect(merged?.mergedInto).toBe(umbrella.id);
      expect(umbrella.status).toBe('pending');
      expect(umbrella.mergedInto).toBeNull();
      for (const id of [a.id, b.id, m1.id, m2.id]) {
        expect(row(id).rejectedReason).toBe(MERGED_INTO_PREFIX + umbrella.id);
      }
      expect(umbrella.memberSessionIds).toContain('sugg-session');
      const inputs = synthesizer.synthesizeUmbrella.mock
        .calls[0][0] as UmbrellaMemberInput[];
      expect(inputs.map((i) => i.kind).sort()).toEqual([
        'candidate',
        'candidate',
        'suggestion',
      ]);
      expect(result).toMatchObject({
        umbrellasCreated: 1,
        suggestionsMerged: 1,
        candidatesMerged: 4,
      });
    });

    it('leaves a promoted member untouched but records it on the umbrella', async () => {
      const a = addCandidate(vec(0, 0.01));
      const b = addCandidate(vec(0, 0.02));
      const live = promote(addCandidate(vec(0, 0.03)));

      const result = await run();

      const umbrella = umbrellaRow();
      expect(row(live.id).status).toBe('promoted');
      expect(umbrella.memberCandidateIds).toContain(live.id);
      expect(row(a.id).status).toBe('rejected');
      expect(row(b.id).status).toBe('rejected');
      expect(result.candidatesMerged).toBe(2);
      expect(result.mergedIds).not.toContain(live.id);
    });

    it('below the threshold: dismissed umbrella, candidate members rejected, promoted and suggestion members untouched (R7)', async () => {
      judge.judge.mockResolvedValueOnce({
        status: 'scored',
        score: 3,
        criteria: null,
        reason: 'scored',
      });
      const a = addCandidate(vec(0, 0.01));
      const b = addCandidate(vec(0, 0.02));
      const live = promote(addCandidate(vec(0, 0.03)));
      const m1 = addCandidate(vec(0, 0.04));
      const m2 = addCandidate(vec(0, 0.05));
      const pending = addSuggestion([m1.id, m2.id]);

      const result = await run();

      const umbrella = umbrellaRow();
      expect(umbrella.status).toBe('dismissed');
      expect(umbrella.judgeScore).toBe(3);
      for (const id of [a.id, b.id]) {
        expect(row(id).status).toBe('rejected');
        expect(row(id).rejectedReason).toBe(
          BELOW_JUDGE_SCORE_UMBRELLA_PREFIX + umbrella.id,
        );
      }
      expect(row(live.id).status).toBe('promoted');
      expect(suggestions.findById(pending.id)?.status).toBe('pending');
      expect(row(m1.id).status).toBe('candidate');
      expect(row(m2.id).status).toBe('candidate');
      expect(result).toMatchObject({
        umbrellasCreated: 0,
        umbrellasRejected: 1,
        judgeRejectedMembers: 2,
        candidatesMerged: 0,
      });
    });

    it('skips and does not count a member another writer already decided', async () => {
      const a = addCandidate(vec(0, 0.01));
      const b = addCandidate(vec(0, 0.02));
      const m1 = addCandidate(vec(0, 0.03));
      const m2 = addCandidate(vec(0, 0.04));
      addSuggestion([m1.id, m2.id]);
      expect(
        store.rejectIfStatus(m2.id, 'candidate', 'decided-elsewhere'),
      ).toBe(true);

      const result = await run();

      expect(result.candidatesMerged).toBe(3);
      expect([...result.mergedIds].sort()).toEqual([a.id, b.id, m1.id].sort());
      expect(row(m2.id).rejectedReason).toBe('decided-elsewhere');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('already decided by another writer'),
        expect.objectContaining({ skipped: 1 }),
      );
    });

    it.each([
      ['unscored', { status: 'unscored', score: null }],
      ['disabled', { status: 'disabled', score: null }],
    ])('writes nothing when the judge is %s', async (_label, verdict) => {
      judge.judge.mockResolvedValueOnce({
        ...verdict,
        criteria: null,
        reason: 'no score',
      });
      const members = [0.01, 0.02, 0.03].map((j) => addCandidate(vec(0, j)));

      const result = await run();

      expect(allSuggestions()).toHaveLength(0);
      for (const m of members) expect(row(m.id).status).toBe('candidate');
      expect(result.umbrellasCreated).toBe(0);
      expect(result.umbrellasRejected).toBe(0);
    });

    it('aborts the cluster when a candidate member changed before the commit', async () => {
      const members = [0.01, 0.02, 0.03].map((j) => addCandidate(vec(0, j)));
      judge.judge.mockImplementationOnce(async () => {
        store.rejectIfStatus(members[1].id, 'candidate', 'other-host');
        return { status: 'scored', score: 8, criteria: null, reason: 'scored' };
      });

      const result = await run();

      expect(allSuggestions()).toHaveLength(0);
      expect(row(members[0].id).status).toBe('candidate');
      expect(row(members[2].id).status).toBe('candidate');
      expect(result.umbrellasCreated).toBe(0);
      expect(result.candidatesMerged).toBe(0);
    });

    it('aborts the cluster when a suggestion member is no longer pending', async () => {
      const a = addCandidate(vec(0, 0.01));
      const b = addCandidate(vec(0, 0.02));
      const m1 = addCandidate(vec(0, 0.03));
      const pending = addSuggestion([m1.id]);
      judge.judge.mockImplementationOnce(async () => {
        suggestions.dismiss(pending.id);
        return { status: 'scored', score: 8, criteria: null, reason: 'scored' };
      });

      const result = await run();

      expect(allSuggestions().map((s) => s.id)).toEqual([pending.id]);
      expect(suggestions.findById(pending.id)?.mergedInto).toBeNull();
      for (const id of [a.id, b.id, m1.id]) {
        expect(row(id).status).toBe('candidate');
      }
      expect(result.umbrellasCreated).toBe(0);
    });

    it('R-n: rolls the whole cluster back when markMerged changes fewer suggestions than expected', async () => {
      const a = addCandidate(vec(0, 0.01));
      const m1 = addCandidate(vec(0, 0.02));
      const m2 = addCandidate(vec(0, 0.03));
      const s1 = addSuggestion([m1.id]);
      const s2 = addSuggestion([m2.id]);
      const original = suggestions.markMerged.bind(suggestions);
      const markMerged = jest
        .spyOn(suggestions, 'markMerged')
        .mockImplementation((ids, umbrellaId) => {
          // A member turns non-pending between the re-read and the UPDATE.
          db.prepare(
            `UPDATE skill_suggestions SET status = 'accepted' WHERE id = ?`,
          ).run(s2.id);
          return original(ids, umbrellaId);
        });

      const result = await run();

      const [ids, umbrellaId] = markMerged.mock.calls[0];
      expect(ids).not.toContain(umbrellaId);
      expect(
        allSuggestions()
          .map((s) => s.id)
          .sort(),
      ).toEqual([s1.id, s2.id].sort());
      expect(suggestions.findById(s1.id)?.status).toBe('pending');
      expect(suggestions.findById(s1.id)?.mergedInto).toBeNull();
      expect(suggestions.findById(s2.id)?.status).toBe('pending');
      for (const id of [a.id, m1.id, m2.id]) {
        expect(row(id).status).toBe('candidate');
      }
      expect(result.umbrellasCreated).toBe(0);
      expect(result.suggestionsMerged).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('umbrella merge failed for one cluster'),
        expect.objectContaining({
          error: expect.stringContaining('merged 1 of 2 pending suggestions'),
        }),
      );
    });

    it('R-f2: a throw mid-cluster leaves no umbrella row and no member merged', async () => {
      const a = addCandidate(vec(0, 0.01));
      const b = addCandidate(vec(0, 0.02));
      const m1 = addCandidate(vec(0, 0.03));
      const pending = addSuggestion([m1.id]);
      const original = store.rejectIfStatus.bind(store);
      let calls = 0;
      jest
        .spyOn(store, 'rejectIfStatus')
        .mockImplementation((...args: Parameters<typeof original>) => {
          calls += 1;
          if (calls === 2) throw new Error('disk I/O error');
          return original(...args);
        });

      const result = await run();

      expect(allSuggestions().map((s) => s.id)).toEqual([pending.id]);
      expect(suggestions.findById(pending.id)?.status).toBe('pending');
      expect(suggestions.findById(pending.id)?.mergedInto).toBeNull();
      for (const id of [a.id, b.id, m1.id]) {
        expect(row(id).status).toBe('candidate');
      }
      expect(result.umbrellasCreated).toBe(0);
      expect(result.candidatesMerged).toBe(0);
    });

    it('orders members closest to the centroid first so the 12-member cut drops the farthest', async () => {
      const near = Array.from({ length: 12 }, (_, i) =>
        addCandidate(vec(0, 0.001 * (i + 1)), { name: `near-${i}` }),
      );
      // Newest rows come first in the pool, so without ordering these two
      // would be inside the first twelve.
      const far = [
        addCandidate(vec(0, 0, [1, 0.3]), { name: 'far-a', createdAt: NOW }),
        addCandidate(vec(0, 0, [2, 0.3]), { name: 'far-b', createdAt: NOW }),
      ];

      await run();

      const inputs = synthesizer.synthesizeUmbrella.mock
        .calls[0][0] as UmbrellaMemberInput[];
      expect(inputs).toHaveLength(14);
      const kept = inputs.slice(0, 12).map((i) => i.description);
      expect(kept).not.toContain('desc far-a');
      expect(kept).not.toContain('desc far-b');
      expect(
        inputs
          .slice(12)
          .map((i) => i.description)
          .sort(),
      ).toEqual(far.map((f) => f.description).sort());
      expect(near).toHaveLength(12);
    });

    it('skips a cluster dominated by an exempt (authored) skill', async () => {
      [0.01, 0.02, 0.03].map((j, i) =>
        addCandidate(vec(0, j), { sessions: [`s-${i}`] }),
      );
      db.prepare(
        `INSERT INTO skill_invocation_events (id, skill_slug, session_id, source, succeeded, is_error, invoked_at)
         VALUES ('e1', 'authored-skill', 's-0', 'tool', 1, 0, ?)`,
      ).run(NOW);

      const result = await run(baseSettings(), new Set(['authored-skill']));

      expect(synthesizer.synthesizeUmbrella).not.toHaveBeenCalled();
      expect(rateLimiter.tryAcquire).not.toHaveBeenCalled();
      expect(result.umbrellasCreated).toBe(0);
      expect(result.clustersRemaining).toBe(0);
    });

    it('compares the dominant slug with the exempt slugs case-insensitively', async () => {
      [0.01, 0.02, 0.03].map((j, i) =>
        addCandidate(vec(0, j), { sessions: [`s-${i}`] }),
      );
      db.prepare(
        `INSERT INTO skill_invocation_events (id, skill_slug, session_id, source, succeeded, is_error, invoked_at)
         VALUES ('e1', 'my-skill', 's-0', 'tool', 1, 0, ?)`,
      ).run(NOW);

      const result = await run(baseSettings(), new Set(['My-Skill']));

      expect(synthesizer.synthesizeUmbrella).not.toHaveBeenCalled();
      expect(result.umbrellasCreated).toBe(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('dominated by an authored skill'),
        { dominant: 'my-skill' },
      );
    });

    describe('members with a different embedding dimension', () => {
      /** partitionPool never links mismatched dimensions, so feed one in. */
      function partitionWith(members: SkillCandidateRow[]): void {
        jest.spyOn(clustering, 'partitionPool').mockReturnValue({
          vecAvailable: true,
          truncated: false,
          clusters: [
            members.map((r) => ({
              kind: 'candidate' as const,
              row: r,
              embedding: store.getEmbedding(
                r.embeddingRowid as number,
              ) as Float32Array,
            })),
          ],
          orphans: [],
          unembedded: 0,
        });
      }

      it('are excluded from the synthesizer inputs and the merge set', async () => {
        const members = [0.01, 0.02, 0.03].map((j) => addCandidate(vec(0, j)));
        const odd = addCandidate(new Float32Array([1, 0, 0, 0]), {
          name: 'odd',
          createdAt: NOW,
        });
        partitionWith([odd, ...members]);

        const result = await run();

        const inputs = synthesizer.synthesizeUmbrella.mock
          .calls[0][0] as UmbrellaMemberInput[];
        expect(inputs.map((i) => i.description)).not.toContain('desc odd');
        expect(inputs).toHaveLength(3);
        const umbrella = umbrellaRow();
        expect(umbrella.memberCandidateIds).not.toContain(odd.id);
        expect(umbrella.clusterSize).toBe(3);
        expect(row(odd.id).status).toBe('candidate');
        expect(result.mergedIds).not.toContain(odd.id);
        expect(result.candidatesMerged).toBe(3);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('different embedding dimension excluded'),
          { clusterSize: 4, excluded: 1 },
        );
      });

      it('skip the cluster when the exclusion drops it below the minimum size', async () => {
        const members = [0.01, 0.02].map((j) => addCandidate(vec(0, j)));
        const odd = addCandidate(new Float32Array([1, 0, 0, 0]), {
          name: 'odd',
        });
        partitionWith([...members, odd]);

        const result = await run();

        expect(synthesizer.synthesizeUmbrella).not.toHaveBeenCalled();
        expect(rateLimiter.tryAcquire).not.toHaveBeenCalled();
        expect(allSuggestions()).toHaveLength(0);
        for (const r of [...members, odd]) {
          expect(row(r.id).status).toBe('candidate');
        }
        expect(result.umbrellasCreated).toBe(0);
        expect(logger.info).toHaveBeenCalledWith(
          expect.stringContaining('below the minimum size after exclusions'),
          { remaining: 2, excluded: 1 },
        );
      });
    });

    it('caps the pass at three clusters and reports the remainder', async () => {
      for (const axis of [0, 1, 2, 3]) {
        [0.01, 0.02, 0.03].map((j) => addCandidate(vec(axis, j)));
      }

      const result = await run();

      expect(synthesizer.synthesizeUmbrella).toHaveBeenCalledTimes(3);
      expect(result.clustersRemaining).toBe(1);
      expect(result.rateLimited).toBe(false);
    });

    it('stops at the rate limit with nothing written', async () => {
      rateLimiter.tryAcquire.mockReturnValue({
        allowed: false,
        resetAt: NOW + 1000,
      });
      [0.01, 0.02, 0.03].map((j) => addCandidate(vec(0, j)));

      const result = await run();

      expect(synthesizer.synthesizeUmbrella).not.toHaveBeenCalled();
      expect(allSuggestions()).toHaveLength(0);
      expect(result.rateLimited).toBe(true);
      expect(result.clustersRemaining).toBe(1);
    });
  });

  describe('singletons (R1)', () => {
    it('surfaces a judge-passed orphan as a pending suggestion without an LLM call', async () => {
      const passed = addCandidate(vec(1));
      judgePass(passed, 7.5);
      const unjudged = addCandidate(vec(2));

      const result = await run();

      const surfaced = suggestions.listByStatus('pending');
      expect(surfaced).toHaveLength(1);
      expect(surfaced[0]).toMatchObject({
        name: passed.name,
        memberCandidateIds: [passed.id],
        clusterSize: 1,
        judgeScore: 7.5,
      });
      expect(surfaced[0].body).toBe(`${passed.name}\n\n${passed.description}`);
      expect(suggestions.listMemberCandidateIds().has(unjudged.id)).toBe(false);
      expect(synthesizer.synthesizeUmbrella).not.toHaveBeenCalled();
      expect(judge.judge).not.toHaveBeenCalled();
      expect(result.singletonsSurfaced).toBe(1);
    });

    it('surfaces at most five per pass', async () => {
      for (let axis = 1; axis <= 7; axis++) judgePass(addCandidate(vec(axis)));

      const result = await run();

      expect(result.singletonsSurfaced).toBe(5);
      expect(suggestions.listByStatus('pending')).toHaveLength(5);
    });
  });

  describe('one-time backlog purge', () => {
    const OLD = NOW - 40 * DAY;

    it('rejects old unclustered orphans and keeps the young, judge-passed and unembedded ones; writes the marker', async () => {
      const oldOrphan = addCandidate(vec(1), { createdAt: OLD });
      const youngOrphan = addCandidate(vec(2), { createdAt: NOW - 5 * DAY });
      const oldUnembedded = addCandidate(null, { createdAt: OLD });
      // Judge-passed, and a dismissed-suggestion member so it is not surfaced
      // as a singleton: only the judge rule keeps it.
      const oldPassed = addCandidate(vec(3), { createdAt: OLD });
      judgePass(oldPassed);
      addSuggestion([oldPassed.id], 'dismissed');

      const result = await run();

      expect(row(oldOrphan.id).status).toBe('rejected');
      expect(row(oldOrphan.id).rejectedReason).toBe(BACKLOG_PURGE_REASON);
      expect(row(youngOrphan.id).status).toBe('candidate');
      expect(row(oldUnembedded.id).status).toBe('candidate');
      expect(row(oldPassed.id).status).toBe('candidate');
      expect(result.purgedIds).toEqual([oldOrphan.id]);
      expect(result.purged).toBe(1);
      expect(result.purgeSkippedReason).toBeNull();
      expect(purgeState.read()).toEqual({
        cutoffCreatedAt: NOW - 30 * DAY,
        completedAt: NOW,
        rejected: 1,
      });
    });

    it('purges a dismissed-suggestion member and keeps a pending-suggestion member (R5)', async () => {
      const dismissedMember = addCandidate(vec(1), { createdAt: OLD });
      addSuggestion([dismissedMember.id], 'dismissed');
      const pendingMember = addCandidate(vec(2), { createdAt: OLD });
      addSuggestion([pendingMember.id], 'pending');

      const result = await run();

      expect(row(dismissedMember.id).rejectedReason).toBe(BACKLOG_PURGE_REASON);
      expect(row(pendingMember.id).status).toBe('candidate');
      expect(result.purgedIds).toEqual([dismissedMember.id]);
    });

    it('keeps old candidates that are in a cluster this pass', async () => {
      rateLimiter.tryAcquire.mockReturnValue({ allowed: false, resetAt: NOW });
      const members = [0.01, 0.02, 0.03].map((j) =>
        addCandidate(vec(0, j), { createdAt: OLD }),
      );

      const result = await run();

      for (const m of members) expect(row(m.id).status).toBe('candidate');
      expect(result.purged).toBe(0);
      expect(purgeState.read()?.rejected).toBe(0);
    });

    it('is a no-op on the second run', async () => {
      addCandidate(vec(1), { createdAt: OLD });
      await run();
      const lateOrphan = addCandidate(vec(2), { createdAt: OLD });

      const second = await run();

      expect(second.purgeSkippedReason).toBe('already-complete');
      expect(second.purged).toBe(0);
      expect(row(lateOrphan.id).status).toBe('candidate');
      expect(purgeState.read()?.rejected).toBe(1);
    });

    it('skips with no-vec and writes no marker', async () => {
      const oldOrphan = addCandidate(vec(1), { createdAt: OLD });
      vecStatus.available = false;

      const result = await run();

      expect(result.purgeSkippedReason).toBe('no-vec');
      expect(row(oldOrphan.id).status).toBe('candidate');
      expect(purgeState.read()).toBeNull();
    });

    it('skips with pool-truncated and writes no marker', async () => {
      const a = addCandidate(vec(1), { createdAt: OLD });
      const b = addCandidate(vec(2), { createdAt: OLD });

      const result = await run(baseSettings({ suggestionMaxCandidates: 1 }));

      expect(result.purgeSkippedReason).toBe('pool-truncated');
      expect(row(a.id).status).toBe('candidate');
      expect(row(b.id).status).toBe('candidate');
      expect(purgeState.read()).toBeNull();
    });

    it('rolls the purge back with no marker when a write throws', async () => {
      const oldOrphan = addCandidate(vec(1), { createdAt: OLD });
      jest.spyOn(purgeState, 'markComplete').mockImplementation(() => {
        throw new Error('disk full');
      });

      const result = await run();

      expect(result.purgeSkippedReason).toBe('failed');
      expect(result.purged).toBe(0);
      expect(row(oldOrphan.id).status).toBe('candidate');
      expect(purgeState.read()).toBeNull();
    });
  });

  it('never throws into the caller when the pool cannot be read', async () => {
    jest.spyOn(clustering, 'partitionPool').mockImplementation(() => {
      throw new Error('database is locked');
    });

    const result = await run();

    expect(result).toMatchObject({
      umbrellasCreated: 0,
      singletonsSurfaced: 0,
      purged: 0,
      purgeSkippedReason: 'failed',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('pool partition failed'),
      expect.objectContaining({ error: 'database is locked' }),
    );
  });
});
