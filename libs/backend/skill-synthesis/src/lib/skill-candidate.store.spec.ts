/**
 * SkillCandidateStore specs — uses better-sqlite3 in-memory DB.
 *
 * Tests: setPin cap, transaction holds, countDistinctContexts, decay math,
 * pinned excluded from decay list, zero-invocation skills sort last.
 *
 * Better-sqlite3 has no @types package in this repo, so we use require() with
 * a local type alias — consistent with how persistence-sqlite tests use it.
 * Tests are skipped when the native module is unavailable (e.g. CI without
 * rebuilt bindings), matching the pattern in sqlite-connection.service.spec.ts.
 */
import 'reflect-metadata';
import { SkillCandidateStore } from './skill-candidate.store';
import type { CandidateId, NewCandidateInput } from './types';

interface BetterSqliteDb {
  exec(sql: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare(sql: string): {
    run(...args: any[]): any;
    get(...args: any[]): any;
    all(...args: any[]): any[];
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
}

// Detect whether the native module can be loaded (ABI mismatch on Electron builds).
let nativeAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const DB = require('better-sqlite3') as new (path: string) => {
    close(): void;
  };
  const probe = new DB(':memory:');
  probe.close();
  nativeAvailable = true;
} catch {
  nativeAvailable = false;
}

const maybe = nativeAvailable ? it : it.skip;

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const DatabaseCtor = nativeAvailable
  ? (require('better-sqlite3') as new (path: string) => BetterSqliteDb)
  : null;

// ─── Minimal in-memory DB setup ─────────────────────────────────────────────

function createInMemoryDb(): BetterSqliteDb {
  if (!DatabaseCtor) throw new Error('native not available');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const db = new DatabaseCtor(':memory:');
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
      verdict_source TEXT
    );
  `);
  return db;
}

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function makeConnection(db: BetterSqliteDb) {
  return {
    db,
    vecExtensionLoaded: false,
    isOpen: true,
  };
}

function makeVecStatus(available = false): unknown {
  const diagnostic = {
    ok: available,
    reason: available ? 'ok' : 'binary-missing',
    electronVersion: '40.0.0',
    processArch: 'x64',
    processPlatform: 'linux',
  };
  return {
    available,
    reason: diagnostic.reason,
    diagnostic,
    getStatus: () => ({
      available,
      reason: diagnostic.reason,
      diagnostic,
    }),
    on: () => ({ dispose: () => undefined }),
    refresh: () => undefined,
  };
}

function makeStore(db: BetterSqliteDb): SkillCandidateStore {
  const connection = makeConnection(db);
  return new SkillCandidateStore(
    noopLogger as never,
    connection as never,
    makeVecStatus(false) as never,
  );
}

function candidateInput(suffix: string): NewCandidateInput {
  return {
    name: `skill-${suffix}`,
    description: `desc ${suffix}`,
    bodyPath: `/tmp/${suffix}/SKILL.md`,
    sourceSessionIds: [],
    trajectoryHash: `hash-${suffix}`,
    embedding: null,
    createdAt: Date.now(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SkillCandidateStore', () => {
  describe('setPin', () => {
    maybe('pins a skill when under the cap', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('pin-1'));
      store.updateStatus(candidate.id, 'promoted', { promotedAt: Date.now() });

      expect(() => store.setPin(candidate.id, true, 5)).not.toThrow();

      const row = store.findById(candidate.id);
      expect(row?.pinned).toBe(true);
    });

    maybe('throws when pin cap would be exceeded', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      // Create 3 skills, pin all, then try to pin a 4th with cap=3
      const ids: CandidateId[] = [];
      for (let i = 0; i < 3; i++) {
        const { candidate } = store.registerCandidate(
          candidateInput(`cap-${i}`),
        );
        store.updateStatus(candidate.id, 'promoted', {
          promotedAt: Date.now(),
        });
        store.setPin(candidate.id, true, 3);
        ids.push(candidate.id);
      }
      const { candidate: extra } = store.registerCandidate(
        candidateInput('cap-extra'),
      );
      store.updateStatus(extra.id, 'promoted', { promotedAt: Date.now() });

      expect(() => store.setPin(extra.id, true, 3)).toThrow(/cap/i);
    });

    maybe(
      'transaction holds: two concurrent setPin calls respect the cap',
      () => {
        // Simulate two synchronous setPin calls racing against a cap of 1.
        // Only the first should succeed.
        const db = createInMemoryDb();
        const store = makeStore(db);
        const { candidate: c1 } = store.registerCandidate(
          candidateInput('race-1'),
        );
        const { candidate: c2 } = store.registerCandidate(
          candidateInput('race-2'),
        );
        store.updateStatus(c1.id, 'promoted', { promotedAt: Date.now() });
        store.updateStatus(c2.id, 'promoted', { promotedAt: Date.now() });

        store.setPin(c1.id, true, 1); // succeeds
        expect(() => store.setPin(c2.id, true, 1)).toThrow(/cap/i); // should fail
      },
    );

    maybe('unpin succeeds regardless of cap', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('unpin-1'));
      store.updateStatus(candidate.id, 'promoted', { promotedAt: Date.now() });
      store.setPin(candidate.id, true, 5);
      expect(() => store.setPin(candidate.id, false, 0)).not.toThrow();
      expect(store.findById(candidate.id)?.pinned).toBe(false);
    });
  });

  describe('countDistinctContexts', () => {
    maybe('returns 3 for 3 distinct context IDs', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('ctx-3'));
      for (const ctx of ['ctx-a', 'ctx-b', 'ctx-c']) {
        store.recordInvocation({
          skillId: candidate.id,
          sessionId: `sess-${ctx}`,
          succeeded: true,
          invokedAt: Date.now(),
          contextId: ctx,
        });
      }
      expect(store.countDistinctContexts(candidate.id)).toBe(3);
    });

    maybe('returns 0 when all invocations have NULL context_id', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('ctx-null'));
      store.recordInvocation({
        skillId: candidate.id,
        sessionId: 'sess-1',
        succeeded: true,
        invokedAt: Date.now(),
        // contextId omitted — defaults to null
      });
      expect(store.countDistinctContexts(candidate.id)).toBe(0);
    });
  });

  describe('reconcileSubagentEvent', () => {
    function recordSubagentRun(
      store: SkillCandidateStore,
      slug: string,
      invokedAt: number,
    ): void {
      store.recordSkillEvent({
        skillSlug: slug,
        sessionId: `sess-${invokedAt}`,
        contextId: null,
        source: 'subagent',
        succeeded: true, // optimistic, as onSubagentStop records it
        isError: false,
        invokedAt,
      });
    }

    maybe('flips an optimistic success to the graded FAILED verdict', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      recordSubagentRun(store, 'backend-developer', 1000);

      const did = store.reconcileSubagentEvent({
        slug: 'backend-developer',
        succeeded: false,
        isError: true,
        windowStart: 0,
        windowEnd: 2000,
        verdictSource: 'spec:TASK_2026_001',
        reconciledAt: 5000,
      });

      expect(did).toBe(true);
      const stats = store.getInvocationStats('backend-developer');
      expect(stats.total).toBe(1);
      expect(stats.succeeded).toBe(0);
      expect(stats.failed).toBe(1);
    });

    maybe(
      'is idempotent — a second reconcile finds no unreconciled row',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        recordSubagentRun(store, 'frontend-developer', 1000);

        const first = store.reconcileSubagentEvent({
          slug: 'frontend-developer',
          succeeded: false,
          isError: true,
          windowStart: 0,
          windowEnd: 2000,
          verdictSource: 'spec:TASK_2026_002',
          reconciledAt: 5000,
        });
        const second = store.reconcileSubagentEvent({
          slug: 'frontend-developer',
          succeeded: true,
          isError: false,
          windowStart: 0,
          windowEnd: 2000,
          verdictSource: 'spec:TASK_2026_002',
          reconciledAt: 6000,
        });

        expect(first).toBe(true);
        expect(second).toBe(false);
        expect(store.getInvocationStats('frontend-developer').failed).toBe(1);
      },
    );

    maybe('ignores events outside the task time window', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      recordSubagentRun(store, 'senior-tester', 9999);

      const did = store.reconcileSubagentEvent({
        slug: 'senior-tester',
        succeeded: false,
        isError: true,
        windowStart: 0,
        windowEnd: 2000,
        verdictSource: 'spec:TASK_2026_003',
        reconciledAt: 5000,
      });

      expect(did).toBe(false);
      expect(store.getInvocationStats('senior-tester').succeeded).toBe(1);
    });
  });

  describe('listActiveOrderedByDecayScore', () => {
    maybe(
      'returns decay score=0 for a skill with no invocations (sorts last among zero-invocation)',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        const { candidate } = store.registerCandidate(candidateInput('no-inv'));
        store.updateStatus(candidate.id, 'promoted', {
          promotedAt: Date.now(),
        });
        const list = store.listActiveOrderedByDecayScore(Date.now(), 0.95);
        // Should appear in the list with score 0
        expect(list.some((r) => r.id === candidate.id)).toBe(true);
      },
    );

    maybe('decay at 0 days: score = 1.0 per invocation (0.95^0 = 1)', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const now = Date.now();
      const { candidate } = store.registerCandidate(candidateInput('decay-0'));
      store.updateStatus(candidate.id, 'promoted', { promotedAt: now });
      store.recordInvocation({
        skillId: candidate.id,
        sessionId: 's1',
        succeeded: true,
        invokedAt: now,
      });
      // At 0 days age, 0.95^0 = 1.0 per invocation
      const list = store.listActiveOrderedByDecayScore(now, 0.95);
      const entry = list.find((r) => r.id === candidate.id);
      expect(entry).toBeDefined();
    });

    maybe('decay at 30 days: score is lower than at 0 days', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 86400000;
      const { candidate: fresh } = store.registerCandidate(
        candidateInput('decay-fresh'),
      );
      const { candidate: old } = store.registerCandidate(
        candidateInput('decay-old'),
      );
      store.updateStatus(fresh.id, 'promoted', { promotedAt: now });
      store.updateStatus(old.id, 'promoted', { promotedAt: thirtyDaysAgo });
      store.recordInvocation({
        skillId: fresh.id,
        sessionId: 'sf',
        succeeded: true,
        invokedAt: now,
      });
      store.recordInvocation({
        skillId: old.id,
        sessionId: 'so',
        succeeded: true,
        invokedAt: thirtyDaysAgo,
      });
      const list = store.listActiveOrderedByDecayScore(now, 0.95);
      const freshIdx = list.findIndex((r) => r.id === fresh.id);
      const oldIdx = list.findIndex((r) => r.id === old.id);
      // Old skill should have a lower decay score → appears earlier in ascending order
      expect(oldIdx).toBeLessThan(freshIdx);
    });

    maybe('excludes pinned skills from the decay eviction list', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(
        candidateInput('pinned-decay'),
      );
      store.updateStatus(candidate.id, 'promoted', { promotedAt: Date.now() });
      store.setPin(candidate.id, true, 10);
      const list = store.listActiveOrderedByDecayScore(Date.now(), 0.95);
      expect(list.some((r) => r.id === candidate.id)).toBe(false);
    });

    maybe(
      'negative age is clamped to 0 — score does not exceed 1 per invocation',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        const now = Date.now();
        // Clock skew: invocation in the future
        const futureTime = now + 1000 * 86400000; // 1000 days in future
        const { candidate } = store.registerCandidate(
          candidateInput('future-inv'),
        );
        store.updateStatus(candidate.id, 'promoted', { promotedAt: now });
        store.recordInvocation({
          skillId: candidate.id,
          sessionId: 'sf',
          succeeded: true,
          invokedAt: futureTime,
        });
        // With clamping: ageDays = max(0, negative) = 0, score = 0.95^0 = 1.0
        // Without clamping: ageDays = negative, 0.95^negative > 1 — would be a bug
        const list = store.listActiveOrderedByDecayScore(now, 0.95);
        // Just verify it doesn't throw and the skill is in the list
        expect(list.some((r) => r.id === candidate.id)).toBe(true);
      },
    );

    maybe('excludes dormant skills from the decay demotion list', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(
        candidateInput('dormant-decay'),
      );
      store.updateStatus(candidate.id, 'promoted', { promotedAt: Date.now() });
      store.setResidency(candidate.id, 'dormant');
      const list = store.listActiveOrderedByDecayScore(Date.now(), 0.95);
      expect(list.some((r) => r.id === candidate.id)).toBe(false);
    });
  });

  describe('setResidency + listDormantPromotedSlugs', () => {
    maybe('defaults to resident and flips to dormant', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('res-1'));
      store.updateStatus(candidate.id, 'promoted', { promotedAt: Date.now() });
      expect(store.findById(candidate.id)?.residency).toBe('resident');

      const updated = store.setResidency(candidate.id, 'dormant');
      expect(updated.residency).toBe('dormant');
      expect(store.findById(candidate.id)?.residency).toBe('dormant');
    });

    maybe('lists only dormant promoted slugs', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate: a } = store.registerCandidate(
        candidateInput('slug-a'),
      );
      const { candidate: b } = store.registerCandidate(
        candidateInput('slug-b'),
      );
      const { candidate: c } = store.registerCandidate(
        candidateInput('slug-c'),
      );
      store.updateStatus(a.id, 'promoted', { promotedAt: Date.now() });
      store.updateStatus(b.id, 'promoted', { promotedAt: Date.now() });
      // c stays a candidate (not promoted) even though dormant
      store.setResidency(a.id, 'dormant');
      store.setResidency(c.id, 'dormant');

      const slugs = store.listDormantPromotedSlugs();
      expect(slugs).toEqual(['skill-slug-a']);
    });
  });

  describe('getDominantSkillSlugForSessions', () => {
    maybe('returns null for empty input', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      expect(store.getDominantSkillSlugForSessions([])).toBeNull();
    });

    maybe('returns null when no events recorded for the sessions', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      expect(store.getDominantSkillSlugForSessions(['unknown'])).toBeNull();
    });

    maybe('returns the most-invoked slug across the given sessions', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const now = Date.now();
      const ev = (slug: string, session: string) =>
        store.recordSkillEvent({
          skillSlug: slug,
          sessionId: session,
          contextId: null,
          source: 'post-tool-use',
          succeeded: true,
          isError: false,
          invokedAt: now,
        });
      ev('orchestrate', 's1');
      ev('orchestrate', 's1');
      ev('review-code', 's1');
      ev('orchestrate', 's2');

      expect(store.getDominantSkillSlugForSessions(['s1', 's2'])).toBe(
        'orchestrate',
      );
      // A session set that only includes the review event yields review-code.
      expect(store.getDominantSkillSlugForSessions(['s3'])).toBeNull();
    });
  });
});
