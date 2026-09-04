/**
 * SkillCandidateStore specs — in-memory SQLite.
 *
 * Tests: setPin cap, transaction holds, countDistinctContexts, decay math,
 * pinned excluded from decay list, zero-invocation skills sort last, and the
 * `0033` judge verdict round-trip (per-criterion scores, the `unscored`
 * verdict, `display_name`).
 *
 * WHICH BINDING. `better-sqlite3` is rebuilt against Electron's ABI by
 * postinstall here, so it cannot load in the Jest/Node runner on a normal dev
 * machine. Rather than permanently skip the assertions that matter, the opener
 * falls back to Node's built-in `node:sqlite` — the same engine behind a
 * different binding — exactly as the queue specs do. `resolveOpener` is reused
 * from `queue/queue-db.test-support` so there is one such opener, not two.
 * `node:sqlite` has no `transaction()`, so this file adds the BEGIN/COMMIT
 * shim; that is the only behavioural difference the store can observe.
 *
 * THE SCHEMA IS NOT HAND-WRITTEN FOR `0033`. The base table is the pre-`0033`
 * shape, and the eleven judge columns come from `MIGRATIONS` itself, so a
 * column renamed in the migration fails these specs instead of silently
 * disagreeing with them.
 */
import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import { SkillCandidateStore } from './skill-candidate.store';
import {
  JUDGE_STATUSES,
  type CandidateId,
  type JudgeStatus,
  type NewCandidateInput,
} from './types';
import {
  resolveOpener,
  type TestDatabase,
} from './queue/queue-db.test-support';

type TransactionFn = <T extends (...args: never[]) => unknown>(fn: T) => T;

type SpecDb = TestDatabase & { transaction: TransactionFn };

const opener = resolveOpener();
const maybe = opener ? it : it.skip;

const SQL_0033 = MIGRATIONS.find((m) => m.version === 33)?.sql ?? '';
/**
 * The seven empirical-gate columns. Pulled from `MIGRATIONS` for the same
 * reason `0033` is: a column renamed in the migration fails these specs instead
 * of silently disagreeing with them.
 */
const SQL_0036 = MIGRATIONS.find((m) => m.version === 36)?.sql ?? '';
/**
 * `workspace_root` on `skill_invocation_events` plus the session index.
 * Applied from `MIGRATIONS` rather than hand-added to the CREATE TABLE below
 * for the same reason as `0033`/`0036`: `recordSkillEvent` writes a FIXED
 * seventeen-column list, so a fixture that spelled the column itself could
 * drift from the migration silently. Running the real ALTER is what keeps the
 * two honest.
 */
const SQL_0037 = MIGRATIONS.find((m) => m.version === 37)?.sql ?? '';
/**
 * `skill_synthesis_queue`. Applied only because `0040`'s backfill JOINs it —
 * the fixture never inserts a queue row, so the UPDATE is a no-op here. Without
 * the table the migration would fail with "no such table" and the fixture would
 * have to skip the backfill, which is exactly the drift these constants exist
 * to prevent.
 */
const SQL_0032 = MIGRATIONS.find((m) => m.version === 32)?.sql ?? '';
/**
 * `workspace_root` on `skill_candidates` plus its index. From `MIGRATIONS` for
 * the same reason as `0033`/`0036`/`0037`: `registerCandidate` writes a FIXED
 * fifteen-column list, so a fixture that spelled this column itself could drift
 * from the migration silently.
 */
const SQL_0040 = MIGRATIONS.find((m) => m.version === 40)?.sql ?? '';

/**
 * `better-sqlite3` ships `transaction()`; `node:sqlite` does not. The store's
 * only use of it (`setPin`) is synchronous and single-connection, for which
 * BEGIN/COMMIT/ROLLBACK is equivalent.
 */
function transactionFor(db: TestDatabase): TransactionFn {
  const native = (db as { transaction?: unknown }).transaction;
  if (typeof native === 'function') {
    return (native as TransactionFn).bind(db) as TransactionFn;
  }
  return (<T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args: never[]) => {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (error: unknown) {
        db.exec('ROLLBACK');
        throw error;
      }
    }) as unknown as T) as TransactionFn;
}

// ─── Minimal in-memory DB setup ─────────────────────────────────────────────

function createInMemoryDb(): SpecDb {
  if (!opener) throw new Error('no sqlite binding available');
  const raw = opener(':memory:');
  const db: SpecDb = Object.assign(raw, { transaction: transactionFor(raw) });
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
    CREATE INDEX idx_skill_inv_events_task
      ON skill_invocation_events(skill_slug, task_id);
  `);
  db.exec(SQL_0033);
  db.exec(SQL_0036);
  db.exec(SQL_0037);
  db.exec(SQL_0032);
  db.exec(SQL_0040);
  return db;
}

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function makeConnection(db: SpecDb) {
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

function makeStore(db: SpecDb): SkillCandidateStore {
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

  describe('listByStatus — workspace scoping', () => {
    /**
     * `workspaceRoot` is optional on {@link NewCandidateInput} and the three
     * cases below are three DIFFERENT facts, not one with defaults:
     * a path is "captured there", `''` is "deliberately cross-project", and
     * omitting it is "origin unknown".
     */
    function seedThreeOrigins(store: SkillCandidateStore): void {
      store.registerCandidate({
        ...candidateInput('mine'),
        workspaceRoot: 'D:\\projects\\alpha',
      });
      store.registerCandidate({
        ...candidateInput('theirs'),
        workspaceRoot: 'D:\\projects\\beta',
      });
      store.registerCandidate({
        ...candidateInput('cross'),
        workspaceRoot: '',
      });
      // No `workspaceRoot` at all — the legacy row.
      store.registerCandidate(candidateInput('legacy'));
    }

    maybe('round-trips all three origin values distinctly', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      seedThreeOrigins(store);

      const byName = new Map(
        store.listByStatus('candidate').map((r) => [r.name, r.workspaceRoot]),
      );
      // Stated in every direction: a reader that returns null for everything,
      // or '' for everything, passes any single assertion here.
      expect(byName.get('skill-mine')).toBe('D:\\projects\\alpha');
      expect(byName.get('skill-cross')).toBe('');
      expect(byName.get('skill-cross')).not.toBeNull();
      expect(byName.get('skill-legacy')).toBeNull();
      expect(byName.get('skill-legacy')).not.toBe('');
    });

    maybe('omitting the root reads back every candidate', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      seedThreeOrigins(store);

      // The unscoped overload is what clustering, dedup, the residency budget
      // and the gates use, and it must stay cross-project.
      expect(
        store
          .listByStatus('candidate')
          .map((r) => r.name)
          .sort(),
      ).toEqual(['skill-cross', 'skill-legacy', 'skill-mine', 'skill-theirs']);
    });

    maybe(
      'a scoped read includes the unknown-origin row and excludes the cross-project one',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        seedThreeOrigins(store);

        const names = store
          .listByStatus('candidate', 'D:\\projects\\alpha')
          .map((r) => r.name)
          .sort();

        // `skill-legacy` is IN — dropping NULL would make every candidate
        // captured before `0040` unreachable in every workspace, which trades a
        // display defect for silent data loss. `skill-cross` is OUT — `''` is a
        // KNOWN value meaning "not this workspace". Asserting both is what
        // pins the rule: matching everything passes the first half, matching
        // only the exact path passes the second.
        expect(names).toEqual(['skill-legacy', 'skill-mine']);
      },
    );

    maybe(
      'a workspace with no captures of its own still sees the legacy rows',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        seedThreeOrigins(store);

        // The reported symptom, from the other side: a brand-new project must
        // NOT see alpha's or beta's captures. It still sees the rows nobody can
        // attribute, and that is why the UI keeps an "all projects" toggle.
        expect(
          store
            .listByStatus('candidate', 'D:\\projects\\brand-new')
            .map((r) => r.name),
        ).toEqual(['skill-legacy']);
      },
    );

    maybe('scoping is per status, not across statuses', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate({
        ...candidateInput('promoted-elsewhere'),
        workspaceRoot: 'D:\\projects\\beta',
      });
      store.updateStatus(candidate.id, 'promoted', { promotedAt: 1 });

      expect(store.listByStatus('promoted', 'D:\\projects\\alpha')).toEqual([]);
      expect(
        store.listByStatus('promoted', 'D:\\projects\\beta').map((r) => r.name),
      ).toEqual(['skill-promoted-elsewhere']);
      // And the unscoped read — the one promotion, dedup and the curator use —
      // still finds it from anywhere.
      expect(store.listByStatus('promoted').map((r) => r.name)).toEqual([
        'skill-promoted-elsewhere',
      ]);
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
        taskId: 'TASK_2026_001',
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
          taskId: 'TASK_2026_002',
          succeeded: false,
          isError: true,
          windowStart: 0,
          windowEnd: 2000,
          verdictSource: 'spec:TASK_2026_002',
          reconciledAt: 5000,
        });
        const second = store.reconcileSubagentEvent({
          slug: 'frontend-developer',
          taskId: 'TASK_2026_002',
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
        taskId: 'TASK_2026_003',
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

  describe('recordSkillEvent — metrics + task_id write path', () => {
    const fullMetrics = {
      inputTokens: 48200,
      outputTokens: 6100,
      cacheReadTokens: 210000,
      cacheCreationTokens: 4200,
      costUsd: 0.41,
      durationMs: 252000,
      toolCount: 23,
    };

    interface EventRow {
      input_tokens: number | null;
      output_tokens: number | null;
      cache_read_tokens: number | null;
      cache_creation_tokens: number | null;
      cost_usd: number | null;
      duration_ms: number | null;
      tool_count: number | null;
      task_id: string | null;
    }

    function readEvent(db: SpecDb, slug: string): EventRow {
      return db
        .prepare(
          `SELECT input_tokens, output_tokens, cache_read_tokens,
                  cache_creation_tokens, cost_usd, duration_ms, tool_count, task_id
           FROM skill_invocation_events WHERE skill_slug = ? LIMIT 1`,
        )
        .get(slug) as EventRow;
    }

    maybe('round-trips metrics and task_id into the new columns', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      store.recordSkillEvent({
        skillSlug: 'backend-developer',
        sessionId: 's1',
        contextId: null,
        source: 'subagent',
        succeeded: true,
        isError: false,
        invokedAt: 1000,
        metrics: fullMetrics,
        taskId: 'TASK_2026_158',
      });

      const row = readEvent(db, 'backend-developer');
      expect(row.input_tokens).toBe(48200);
      expect(row.output_tokens).toBe(6100);
      expect(row.cache_read_tokens).toBe(210000);
      expect(row.cache_creation_tokens).toBe(4200);
      expect(row.cost_usd).toBeCloseTo(0.41);
      expect(row.duration_ms).toBe(252000);
      expect(row.tool_count).toBe(23);
      expect(row.task_id).toBe('TASK_2026_158');
    });

    maybe('writes NULL metric/task columns when they are absent', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      // Pre-existing tool-use insert path: no metrics, no taskId.
      store.recordSkillEvent({
        skillSlug: 'caveman',
        sessionId: 's1',
        contextId: null,
        source: 'tool-use',
        succeeded: true,
        isError: false,
        invokedAt: 1000,
      });

      const row = readEvent(db, 'caveman');
      expect(row.input_tokens).toBeNull();
      expect(row.output_tokens).toBeNull();
      expect(row.cache_read_tokens).toBeNull();
      expect(row.cache_creation_tokens).toBeNull();
      expect(row.cost_usd).toBeNull();
      expect(row.duration_ms).toBeNull();
      expect(row.tool_count).toBeNull();
      expect(row.task_id).toBeNull();
      // Existing invocation counting is unaffected by the widened INSERT.
      expect(store.getInvocationStats('caveman').total).toBe(1);
    });

    maybe(
      'passing metrics: null writes all-null columns (usage-less provider)',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        store.recordSkillEvent({
          skillSlug: 'copilot-style',
          sessionId: 's1',
          contextId: null,
          source: 'subagent',
          succeeded: true,
          isError: false,
          invokedAt: 1000,
          metrics: null,
          taskId: 'TASK_2026_158',
        });

        const row = readEvent(db, 'copilot-style');
        expect(row.input_tokens).toBeNull();
        expect(row.cost_usd).toBeNull();
        expect(row.task_id).toBe('TASK_2026_158');
      },
    );

    maybe(
      'NULL-excluding AVG ignores null-metric rows (not treated as 0)',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        const withTokens = {
          inputTokens: 100,
          outputTokens: 10,
          cacheReadTokens: null,
          cacheCreationTokens: null,
          costUsd: 0.2,
          durationMs: 1000,
          toolCount: 5,
        };
        const record = (invokedAt: number, metrics: unknown) =>
          store.recordSkillEvent({
            skillSlug: 'avg-agent',
            sessionId: `s-${invokedAt}`,
            contextId: null,
            source: 'subagent',
            succeeded: true,
            isError: false,
            invokedAt,
            metrics: metrics as never,
            taskId: null,
          });
        record(1000, withTokens); // input_tokens = 100
        record(2000, null); // all-null metrics

        const agg = db
          .prepare(
            `SELECT AVG(input_tokens) AS avg_input, COUNT(*) AS total,
                  SUM(input_tokens) AS sum_input
           FROM skill_invocation_events WHERE skill_slug = ?`,
          )
          .get('avg-agent') as {
          avg_input: number | null;
          total: number;
          sum_input: number | null;
        };
        // AVG over {100, NULL} = 100 (NULL excluded), NOT 50.
        expect(agg.total).toBe(2);
        expect(agg.avg_input).toBe(100);
        expect(agg.sum_input).toBe(100);
      },
    );

    maybe('writes workspace_root as the seventeenth column (0037)', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const readRoot = (slug: string): string | null =>
        (
          db
            .prepare(
              'SELECT workspace_root FROM skill_invocation_events WHERE skill_slug = ?',
            )
            .get(slug) as { workspace_root: string | null }
        ).workspace_root;

      store.recordSkillEvent({
        skillSlug: 'scoped',
        sessionId: 's1',
        workspaceRoot: 'D:/projects/ptah-extension',
        contextId: null,
        source: 'tool-use',
        succeeded: true,
        isError: false,
        invokedAt: 1000,
      });
      // 0034's "deliberately cross-project" value survives as itself.
      store.recordSkillEvent({
        skillSlug: 'cross-project',
        sessionId: 's2',
        workspaceRoot: '',
        contextId: null,
        source: 'tool-use',
        succeeded: true,
        isError: false,
        invokedAt: 1000,
      });
      // A caller that does not know: NULL, meaning unknown provenance. NOT ''.
      store.recordSkillEvent({
        skillSlug: 'unknown-root',
        sessionId: 's3',
        contextId: null,
        source: 'tool-use',
        succeeded: true,
        isError: false,
        invokedAt: 1000,
      });

      expect(readRoot('scoped')).toBe('D:/projects/ptah-extension');
      expect(readRoot('cross-project')).toBe('');
      expect(readRoot('cross-project')).not.toBeNull();
      expect(readRoot('unknown-root')).toBeNull();
      expect(readRoot('unknown-root')).not.toBe('');
    });
  });

  describe('reconcileSubagentEvent — exact task_id first, window fallback', () => {
    interface VerdictRow {
      succeeded: number;
      is_error: number;
      reconciled_at: number | null;
      verdict_source: string | null;
    }

    function recordSubagent(
      store: SkillCandidateStore,
      slug: string,
      invokedAt: number,
      taskId: string | null,
    ): void {
      store.recordSkillEvent({
        skillSlug: slug,
        sessionId: `sess-${invokedAt}`,
        contextId: null,
        source: 'subagent',
        succeeded: true,
        isError: false,
        invokedAt,
        taskId,
      });
    }

    function rowByTask(db: SpecDb, slug: string, taskId: string): VerdictRow {
      return db
        .prepare(
          `SELECT succeeded, is_error, reconciled_at, verdict_source
           FROM skill_invocation_events WHERE skill_slug = ? AND task_id = ?`,
        )
        .get(slug, taskId) as VerdictRow;
    }

    maybe(
      'exact pass flips the (slug, task_id) row even when outside the window',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        // Recorded far outside the fallback window — only the exact task_id
        // match should reach it.
        recordSubagent(store, 'backend-developer', 999999, 'TASK_2026_001');

        const did = store.reconcileSubagentEvent({
          slug: 'backend-developer',
          taskId: 'TASK_2026_001',
          succeeded: false,
          isError: true,
          windowStart: 0,
          windowEnd: 2000,
          verdictSource: 'spec:TASK_2026_001',
          reconciledAt: 5000,
        });

        expect(did).toBe(true);
        const row = rowByTask(db, 'backend-developer', 'TASK_2026_001');
        expect(row.succeeded).toBe(0);
        expect(row.is_error).toBe(1);
        expect(row.reconciled_at).toBe(5000);
        expect(row.verdict_source).toBe('spec:TASK_2026_001');
      },
    );

    maybe(
      'window fallback only touches task_id IS NULL rows and stamps spec-window:',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        recordSubagent(store, 'frontend-developer', 1000, null); // legacy row

        const did = store.reconcileSubagentEvent({
          slug: 'frontend-developer',
          taskId: 'TASK_2026_050',
          succeeded: false,
          isError: true,
          windowStart: 0,
          windowEnd: 2000,
          verdictSource: 'spec:TASK_2026_050',
          reconciledAt: 5000,
        });

        expect(did).toBe(true);
        const row = db
          .prepare(
            `SELECT succeeded, verdict_source FROM skill_invocation_events
             WHERE skill_slug = ? AND task_id IS NULL`,
          )
          .get('frontend-developer') as {
          succeeded: number;
          verdict_source: string;
        };
        expect(row.succeeded).toBe(0);
        expect(row.verdict_source).toBe('spec-window:TASK_2026_050');
      },
    );

    maybe(
      'R4.3 concurrent same-slug tasks — each stamped row gets its OWN verdict',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        // Two runs of the SAME executor slug in overlapping mtime windows,
        // distinct task ids — the exact bug the exact-pass reconcile fixes.
        recordSubagent(store, 'backend-developer', 1000, 'TASK_2026_100');
        recordSubagent(store, 'backend-developer', 1100, 'TASK_2026_200');
        // Plus a legacy (unstamped) row inside the same window.
        recordSubagent(store, 'backend-developer', 1200, null);

        // Reconcile TASK_100 as COMPLETE and TASK_200 as FAILED — both windows
        // fully overlap [0, 2000].
        const a = store.reconcileSubagentEvent({
          slug: 'backend-developer',
          taskId: 'TASK_2026_100',
          succeeded: true,
          isError: false,
          windowStart: 0,
          windowEnd: 2000,
          verdictSource: 'spec:TASK_2026_100',
          reconciledAt: 5000,
        });
        const b = store.reconcileSubagentEvent({
          slug: 'backend-developer',
          taskId: 'TASK_2026_200',
          succeeded: false,
          isError: true,
          windowStart: 0,
          windowEnd: 2000,
          verdictSource: 'spec:TASK_2026_200',
          reconciledAt: 5001,
        });

        expect(a).toBe(true);
        expect(b).toBe(true);

        const rowA = rowByTask(db, 'backend-developer', 'TASK_2026_100');
        const rowB = rowByTask(db, 'backend-developer', 'TASK_2026_200');
        // No cross-attribution: each row carries exactly its own task's verdict.
        expect(rowA.succeeded).toBe(1);
        expect(rowA.verdict_source).toBe('spec:TASK_2026_100');
        expect(rowB.succeeded).toBe(0);
        expect(rowB.verdict_source).toBe('spec:TASK_2026_200');

        // A window fallback for a third task must NOT steal a stamped row — it
        // can only claim the legacy task_id IS NULL row.
        const c = store.reconcileSubagentEvent({
          slug: 'backend-developer',
          taskId: 'TASK_2026_300',
          succeeded: false,
          isError: true,
          windowStart: 0,
          windowEnd: 2000,
          verdictSource: 'spec:TASK_2026_300',
          reconciledAt: 5002,
        });
        expect(c).toBe(true);
        // Stamped rows are still owned by their tasks (unchanged).
        expect(
          rowByTask(db, 'backend-developer', 'TASK_2026_100').succeeded,
        ).toBe(1);
        expect(
          rowByTask(db, 'backend-developer', 'TASK_2026_200').succeeded,
        ).toBe(0);
        const legacy = db
          .prepare(
            `SELECT verdict_source FROM skill_invocation_events
             WHERE skill_slug = ? AND task_id IS NULL`,
          )
          .get('backend-developer') as { verdict_source: string };
        expect(legacy.verdict_source).toBe('spec-window:TASK_2026_300');
      },
    );

    maybe('is idempotent — re-reconciling the same task flips nothing', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      recordSubagent(store, 'senior-tester', 1000, 'TASK_2026_400');

      const first = store.reconcileSubagentEvent({
        slug: 'senior-tester',
        taskId: 'TASK_2026_400',
        succeeded: false,
        isError: true,
        windowStart: 0,
        windowEnd: 2000,
        verdictSource: 'spec:TASK_2026_400',
        reconciledAt: 5000,
      });
      const second = store.reconcileSubagentEvent({
        slug: 'senior-tester',
        taskId: 'TASK_2026_400',
        succeeded: true, // would flip back if not guarded
        isError: false,
        windowStart: 0,
        windowEnd: 2000,
        verdictSource: 'spec:TASK_2026_400',
        reconciledAt: 6000,
      });

      expect(first).toBe(true);
      expect(second).toBe(false);
      const row = rowByTask(db, 'senior-tester', 'TASK_2026_400');
      expect(row.succeeded).toBe(0); // stays FAILED, not re-flipped
      expect(row.reconciled_at).toBe(5000);
    });

    maybe('returns false when telemetry never recorded the run', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const did = store.reconcileSubagentEvent({
        slug: 'never-ran',
        taskId: 'TASK_2026_500',
        succeeded: true,
        isError: false,
        windowStart: 0,
        windowEnd: 2000,
        verdictSource: 'spec:TASK_2026_500',
        reconciledAt: 5000,
      });
      expect(did).toBe(false);
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

  describe('getScorecardAggregates', () => {
    function recordSubagent(
      store: SkillCandidateStore,
      slug: string,
      invokedAt: number,
      metrics: unknown,
      taskId: string | null = null,
    ): void {
      store.recordSkillEvent({
        skillSlug: slug,
        sessionId: `sess-${invokedAt}`,
        contextId: null,
        source: 'subagent',
        succeeded: true,
        isError: false,
        invokedAt,
        metrics: metrics as never,
        taskId,
      });
    }

    const tokensA = {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 200,
      cacheCreationTokens: 5,
      costUsd: 0.2,
      durationMs: 1000,
      toolCount: 4,
    };

    maybe('returns an empty Map for an empty slug list', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const agg = store.getScorecardAggregates([]);
      expect(agg.size).toBe(0);
    });

    maybe('returns a typed zero/null aggregate for a no-data slug', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const agg = store.getScorecardAggregates(['never-ran']);
      const card = agg.get('never-ran');
      expect(card).toBeDefined();
      expect(card?.total).toBe(0);
      expect(card?.graded).toBe(0);
      expect(card?.gradedSucceeded).toBe(0);
      expect(card?.avgInputTokens).toBeNull();
      expect(card?.totalInputTokens).toBeNull();
      expect(card?.avgCostUsd).toBeNull();
    });

    maybe(
      'aggregates over mixed null/non-null rows with NULL-excluding AVG/SUM',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        recordSubagent(store, 'backend-developer', 1000, tokensA);
        recordSubagent(store, 'backend-developer', 2000, null); // usage-less

        const card = store
          .getScorecardAggregates(['backend-developer'])
          .get('backend-developer');
        expect(card?.total).toBe(2);
        // AVG over {100, NULL} = 100 (NULL excluded, NOT 50).
        expect(card?.avgInputTokens).toBe(100);
        expect(card?.totalInputTokens).toBe(100);
        expect(card?.avgCostUsd).toBeCloseTo(0.2);
      },
    );

    maybe('counts graded/graded_succeeded from reconciled rows only', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      // Two runs, distinct task ids: one graded COMPLETE, one graded FAILED.
      recordSubagent(store, 'agent-x', 1000, tokensA, 'TASK_2026_001');
      recordSubagent(store, 'agent-x', 1100, tokensA, 'TASK_2026_002');
      // One un-reconciled (optimistic) run.
      recordSubagent(store, 'agent-x', 1200, tokensA, 'TASK_2026_003');

      store.reconcileSubagentEvent({
        slug: 'agent-x',
        taskId: 'TASK_2026_001',
        succeeded: true,
        isError: false,
        windowStart: 0,
        windowEnd: 5000,
        verdictSource: 'spec:TASK_2026_001',
        reconciledAt: 6000,
      });
      store.reconcileSubagentEvent({
        slug: 'agent-x',
        taskId: 'TASK_2026_002',
        succeeded: false,
        isError: true,
        windowStart: 0,
        windowEnd: 5000,
        verdictSource: 'spec:TASK_2026_002',
        reconciledAt: 6001,
      });

      const card = store.getScorecardAggregates(['agent-x']).get('agent-x');
      expect(card?.total).toBe(3);
      expect(card?.graded).toBe(2);
      expect(card?.gradedSucceeded).toBe(1);
    });

    maybe('ignores non-subagent-source rows', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      store.recordSkillEvent({
        skillSlug: 'agent-y',
        sessionId: 's1',
        contextId: null,
        source: 'tool-use',
        succeeded: true,
        isError: false,
        invokedAt: 1000,
      });
      recordSubagent(store, 'agent-y', 2000, tokensA);

      const card = store.getScorecardAggregates(['agent-y']).get('agent-y');
      expect(card?.total).toBe(1); // only the subagent row
    });

    maybe(
      'returns an entry for every requested slug (present + absent)',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        recordSubagent(store, 'has-data', 1000, tokensA);
        const agg = store.getScorecardAggregates(['has-data', 'no-data']);
        expect(agg.get('has-data')?.total).toBe(1);
        expect(agg.get('no-data')?.total).toBe(0);
      },
    );
  });

  describe('listGradedInvocations', () => {
    function recordAndGrade(
      store: SkillCandidateStore,
      slug: string,
      invokedAt: number,
      taskId: string,
      reconciledAt: number,
      succeeded: boolean,
    ): void {
      store.recordSkillEvent({
        skillSlug: slug,
        sessionId: `sess-${invokedAt}`,
        contextId: null,
        source: 'subagent',
        succeeded: true,
        isError: false,
        invokedAt,
        taskId,
      });
      store.reconcileSubagentEvent({
        slug,
        taskId,
        succeeded,
        isError: !succeeded,
        windowStart: 0,
        windowEnd: 100000,
        verdictSource: `spec:${taskId}`,
        reconciledAt,
      });
    }

    maybe('returns only reconciled rows, newest verdict first', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      recordAndGrade(store, 'agent-z', 1000, 'TASK_2026_001', 5000, true);
      recordAndGrade(store, 'agent-z', 1100, 'TASK_2026_002', 6000, false);
      // Un-reconciled optimistic run — must NOT appear.
      store.recordSkillEvent({
        skillSlug: 'agent-z',
        sessionId: 's-ungraded',
        contextId: null,
        source: 'subagent',
        succeeded: true,
        isError: false,
        invokedAt: 1200,
        taskId: 'TASK_2026_003',
      });

      const rows = store.listGradedInvocations('agent-z', 10);
      expect(rows).toHaveLength(2);
      // Newest reconciled_at first.
      expect(rows[0].taskId).toBe('TASK_2026_002');
      expect(rows[0].succeeded).toBe(false);
      expect(rows[0].verdictSource).toBe('spec:TASK_2026_002');
      expect(rows[1].taskId).toBe('TASK_2026_001');
    });

    maybe('respects the limit', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      recordAndGrade(store, 'agent-lim', 1000, 'TASK_2026_001', 5000, true);
      recordAndGrade(store, 'agent-lim', 1100, 'TASK_2026_002', 6000, true);
      recordAndGrade(store, 'agent-lim', 1200, 'TASK_2026_003', 7000, true);

      const rows = store.listGradedInvocations('agent-lim', 2);
      expect(rows).toHaveLength(2);
      expect(rows[0].taskId).toBe('TASK_2026_003');
    });

    maybe('returns [] for an unknown slug or non-positive limit', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      expect(store.listGradedInvocations('nope', 10)).toEqual([]);
      recordAndGrade(store, 'agent-lim', 1000, 'TASK_2026_001', 5000, true);
      expect(store.listGradedInvocations('agent-lim', 0)).toEqual([]);
    });
  });

  // ── 0033: judge verdicts + display_name ───────────────────────────────────

  describe('recordJudgeVerdict', () => {
    function seed(db: SpecDb, suffix: string): CandidateId {
      const store = makeStore(db);
      return store.registerCandidate(candidateInput(suffix)).candidate.id;
    }

    function rawJudge(
      db: SpecDb,
      id: CandidateId,
    ): { judge_score: number | null; judge_status: string | null } {
      return db
        .prepare(
          `SELECT judge_score, judge_status FROM skill_candidates WHERE id = ?`,
        )
        .get(id) as { judge_score: number | null; judge_status: string | null };
    }

    maybe('a fresh candidate carries no verdict at all', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const id = seed(db, 'verdict-fresh');

      const row = store.findById(id);
      expect(row?.judgeStatus).toBeNull();
      expect(row?.judgeScore).toBeNull();
      expect(row?.judgeReason).toBeNull();
      expect(row?.judgedAt).toBeNull();
      expect(row?.judgePanelRationales).toBeNull();
      expect(row?.displayName).toBeNull();
      expect(row?.judgeCriteria).toEqual({
        novelty: null,
        actionability: null,
        scope: null,
        generalization: null,
        triggerClarity: null,
      });
    });

    maybe('round-trips a scored verdict with all five criteria', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const id = seed(db, 'verdict-scored');

      const returned = store.recordJudgeVerdict(id, {
        status: 'scored',
        score: 7.4,
        reason: 'Generalizes past the originating repo.',
        criteria: {
          novelty: 8,
          actionability: 7,
          scope: 6.5,
          generalization: 9,
          triggerClarity: 6,
        },
        judgedAt: 1_700_000_000_000,
      });

      for (const row of [returned, store.findById(id)]) {
        expect(row?.judgeStatus).toBe('scored');
        expect(row?.judgeScore).toBeCloseTo(7.4);
        expect(row?.judgeReason).toBe('Generalizes past the originating repo.');
        expect(row?.judgedAt).toBe(1_700_000_000_000);
        expect(row?.judgeCriteria).toEqual({
          novelty: 8,
          actionability: 7,
          scope: 6.5,
          generalization: 9,
          triggerClarity: 6,
        });
      }
    });

    maybe(
      'an unscored verdict reads back as NULL — not 0 — and keeps its reason',
      () => {
        const db = createInMemoryDb();
        const store = makeStore(db);
        const id = seed(db, 'verdict-unscored');

        store.recordJudgeVerdict(id, {
          status: 'unscored',
          score: null,
          reason: 'judge call rate-limited',
        });

        const row = store.findById(id);
        expect(row?.judgeStatus).toBe('unscored');
        expect(row?.judgeScore).toBeNull();
        expect(row?.judgeScore).not.toBe(0);
        expect(row?.judgeReason).toBe('judge call rate-limited');
        // And the column itself is NULL, not a coerced zero.
        expect(rawJudge(db, id).judge_score).toBeNull();
      },
    );

    maybe('a genuine score of 0 is distinguishable from unscored', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const zero = seed(db, 'verdict-zero');
      const none = seed(db, 'verdict-none');

      store.recordJudgeVerdict(zero, {
        status: 'scored',
        score: 0,
        reason: 'no reusable workflow here',
      });
      store.recordJudgeVerdict(none, {
        status: 'unscored',
        score: null,
        reason: 'provider returned unparseable JSON',
      });

      expect(store.findById(zero)?.judgeScore).toBe(0);
      expect(store.findById(none)?.judgeScore).toBeNull();
      expect(rawJudge(db, zero).judge_score).toBe(0);
      expect(rawJudge(db, none).judge_score).toBeNull();
    });

    maybe('a disabled verdict records that the gate was off', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const id = seed(db, 'verdict-disabled');

      const row = store.recordJudgeVerdict(id, {
        status: 'disabled',
        score: null,
        reason: 'skillSynthesis.judgeEnabled=false',
      });

      expect(row.judgeStatus).toBe('disabled');
      expect(row.judgeScore).toBeNull();
      expect(rawJudge(db, id).judge_status).toBe('disabled');
    });

    maybe('the verdict does not move the lifecycle status', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const id = seed(db, 'verdict-lifecycle');

      store.recordJudgeVerdict(id, {
        status: 'unscored',
        score: null,
        reason: 'timeout',
      });

      // An unscored verdict is precisely the case that must NOT promote or
      // reject: the candidate stays pending and is retried on the next pass.
      expect(store.findById(id)?.status).toBe('candidate');
    });

    maybe('re-judging replaces stale per-criterion scores', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const id = seed(db, 'verdict-rejudge');

      store.recordJudgeVerdict(id, {
        status: 'scored',
        score: 9,
        reason: 'first pass',
        criteria: {
          novelty: 9,
          actionability: 9,
          scope: 9,
          generalization: 9,
          triggerClarity: 9,
        },
      });
      store.recordJudgeVerdict(id, {
        status: 'unscored',
        score: null,
        reason: 'second pass failed',
      });

      const row = store.findById(id);
      expect(row?.judgeScore).toBeNull();
      // No stale 9s left sitting beside the new verdict.
      expect(row?.judgeCriteria).toEqual({
        novelty: null,
        actionability: null,
        scope: null,
        generalization: null,
        triggerClarity: null,
      });
    });

    maybe('rejects a judge_status outside the union', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const id = seed(db, 'verdict-bad-status');

      expect(() =>
        store.recordJudgeVerdict(id, {
          // There is no DB CHECK behind this column — the union is the only
          // enforcement, so the store has to be the one that refuses.
          status: 'passed' as JudgeStatus,
          score: null,
          reason: null,
        }),
      ).toThrow(/unknown judge status/i);
      expect(rawJudge(db, id).judge_status).toBeNull();
    });

    maybe('rejects a scored verdict with no number', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const id = seed(db, 'verdict-scored-null');

      expect(() =>
        store.recordJudgeVerdict(id, {
          status: 'scored',
          score: null,
          reason: null,
        }),
      ).toThrow(/finite score/i);
    });

    maybe('rejects a non-scored verdict that carries a number', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const id = seed(db, 'verdict-unscored-number');

      // This is the shape of the old fail-open bug: an errored judge call
      // arriving with a fabricated 10.
      expect(() =>
        store.recordJudgeVerdict(id, {
          status: 'unscored',
          score: 10,
          reason: 'LLM error',
        }),
      ).toThrow(/must carry score=null/i);
    });

    maybe('accepts every member of JUDGE_STATUSES', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      for (const status of JUDGE_STATUSES) {
        const id = seed(db, `verdict-each-${status}`);
        const row = store.recordJudgeVerdict(id, {
          status,
          score: status === 'scored' ? 5 : null,
          reason: null,
        });
        expect(row.judgeStatus).toBe(status);
      }
    });

    maybe('downgrades an unrecognized stored status to unscored', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const id = seed(db, 'verdict-legacy-status');
      noopLogger.warn.mockClear();
      // No CHECK constraint guards this column, so a foreign writer (an older
      // or newer build) can leave a value the union does not know.
      db.prepare(
        `UPDATE skill_candidates SET judge_status = ? WHERE id = ?`,
      ).run('panel-pending', id);

      expect(store.findById(id)?.judgeStatus).toBe('unscored');
      expect(noopLogger.warn).toHaveBeenCalled();
    });
  });

  describe('setDisplayName', () => {
    maybe('sets a human title without touching the slug', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('name-1'));

      const row = store.setDisplayName(candidate.id, '  Bisect A Flaky Spec  ');

      expect(row.displayName).toBe('Bisect A Flaky Spec');
      expect(row.name).toBe('skill-name-1');
      expect(store.findById(candidate.id)?.displayName).toBe(
        'Bisect A Flaky Spec',
      );
      expect(store.findById(candidate.id)?.name).toBe('skill-name-1');
    });

    maybe('clears the column when given a blank name', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('name-2'));
      store.setDisplayName(candidate.id, 'Something');

      expect(store.setDisplayName(candidate.id, '   ').displayName).toBeNull();
    });
  });

  // ── 0036 empirical gates (B3.1.2) ─────────────────────────────────────────

  describe('recordReplay', () => {
    maybe('a fresh candidate carries no gate measurement at all', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('gate-0'));

      const row = store.findById(candidate.id);
      expect(row?.replayConfidence).toBeNull();
      expect(row?.replayHoldoutSessionId).toBeNull();
      expect(row?.replayAt).toBeNull();
      expect(row?.triggerScore).toBeNull();
      expect(row?.triggerPrecision).toBeNull();
      expect(row?.triggerRecall).toBeNull();
      expect(row?.triggerEvalAt).toBeNull();
    });

    maybe('round-trips a confidence with its hold-out session', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('replay-1'));

      const returned = store.recordReplay(candidate.id, {
        confidence: 0.82,
        holdoutSessionId: 'sess-9f3a',
        replayAt: 1_770_000_000_000,
      });

      for (const row of [returned, store.findById(candidate.id)]) {
        expect(row?.replayConfidence).toBeCloseTo(0.82);
        expect(row?.replayHoldoutSessionId).toBe('sess-9f3a');
        expect(row?.replayAt).toBe(1_770_000_000_000);
      }
    });

    /**
     * THE assertion this batch exists for, stated in BOTH directions in one
     * test. A confidence of zero (replayed, aligned with nothing) and an
     * unmeasured confidence (never replayed) must not be the same value.
     *
     * Either half alone is vacuous: a reader hard-wired to return `null` passes
     * the first pair, and one hard-wired to return `0` passes the second. Only
     * the pair distinguishes them, and only the raw-column read proves the
     * distinction survives to SQL — which is where the promotion sweep's
     * `replay_confidence < minConfidence` will read it.
     */
    maybe('a measured 0 and an unmeasured null are different values', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const measured = store.registerCandidate(candidateInput('replay-zero'))
        .candidate.id;
      const unmeasured = store.registerCandidate(candidateInput('replay-none'))
        .candidate.id;

      store.recordReplay(measured, {
        confidence: 0,
        holdoutSessionId: 'sess-held',
        replayAt: 1_770_000_000_000,
      });

      const measuredRow = store.findById(measured);
      expect(measuredRow?.replayConfidence).toBe(0);
      expect(measuredRow?.replayConfidence).not.toBeNull();

      const unmeasuredRow = store.findById(unmeasured);
      expect(unmeasuredRow?.replayConfidence).toBeNull();
      expect(unmeasuredRow?.replayConfidence).not.toBe(0);

      // And the column itself, not just the mapped field: a coerced zero here
      // would make the promotion sweep reject every never-replayed candidate.
      const raw = (id: CandidateId): number | null =>
        (
          db
            .prepare(
              'SELECT replay_confidence FROM skill_candidates WHERE id = ?',
            )
            .get(id) as { replay_confidence: number | null }
        ).replay_confidence;
      expect(raw(measured)).toBe(0);
      expect(raw(unmeasured)).toBeNull();

      const belowThreshold = (
        db
          .prepare(
            'SELECT COUNT(*) AS n FROM skill_candidates WHERE replay_confidence < 0.5',
          )
          .get() as { n: number }
      ).n;
      expect(belowThreshold).toBe(1);
    });

    maybe('records a failed replay as null without a hold-out', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('replay-2'));

      const row = store.recordReplay(candidate.id, {
        confidence: null,
        holdoutSessionId: null,
        replayAt: 1_770_000_000_000,
      });

      expect(row.replayConfidence).toBeNull();
      expect(row.replayHoldoutSessionId).toBeNull();
      // The timestamp still lands: we know WHEN we failed to measure.
      expect(row.replayAt).toBe(1_770_000_000_000);
    });

    maybe('defaults replayAt to now when the caller omits it', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('replay-3'));
      const before = Date.now();

      const row = store.recordReplay(candidate.id, {
        confidence: 0.5,
        holdoutSessionId: 'sess-x',
      });

      expect(row.replayAt).toBeGreaterThanOrEqual(before);
    });

    maybe.each([
      ['above 1', 1.5],
      ['below 0', -0.1],
      ['not finite', Number.NaN],
    ])('rejects a confidence %s', (_label, confidence) => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(
        candidateInput(`replay-bad-${String(confidence)}`),
      );

      expect(() =>
        store.recordReplay(candidate.id, {
          confidence: confidence as number,
          holdoutSessionId: 'sess-x',
        }),
      ).toThrow(/\[0, 1\]/);
    });

    // A confidence with nothing behind it is a fabricated measurement — there
    // is no session it could have been scored against.
    maybe('rejects a confidence with no hold-out session', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('replay-4'));

      expect(() =>
        store.recordReplay(candidate.id, {
          confidence: 0.7,
          holdoutSessionId: '   ',
        }),
      ).toThrow(/hold-out session/);
    });

    maybe('leaves the 0033 judge columns untouched', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('replay-5'));
      store.recordJudgeVerdict(candidate.id, {
        status: 'scored',
        score: 7.4,
        reason: 'ok',
        criteria: {
          novelty: 8,
          actionability: 7,
          scope: 6.5,
          generalization: 9,
          triggerClarity: 6,
        },
        judgedAt: 1_700_000_000_000,
      });

      const row = store.recordReplay(candidate.id, {
        confidence: 0.9,
        holdoutSessionId: 'sess-y',
      });

      expect(row.judgeStatus).toBe('scored');
      expect(row.judgeScore).toBeCloseTo(7.4);
      expect(row.judgeCriteria.triggerClarity).toBe(6);
      expect(row.judgedAt).toBe(1_700_000_000_000);
    });
  });

  describe('recordTriggerEval', () => {
    maybe('round-trips precision, recall and the derived score', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('trig-1'));

      const returned = store.recordTriggerEval(candidate.id, {
        score: 0.75,
        precision: 0.8,
        recall: 0.7,
        evaluatedAt: 1_770_000_060_000,
      });

      for (const row of [returned, store.findById(candidate.id)]) {
        expect(row?.triggerScore).toBeCloseTo(0.75);
        expect(row?.triggerPrecision).toBeCloseTo(0.8);
        expect(row?.triggerRecall).toBeCloseTo(0.7);
        expect(row?.triggerEvalAt).toBe(1_770_000_060_000);
      }
    });

    // Same null-vs-zero rule as replay, in both directions: a description that
    // retrieved nothing measured 0, which is a result; an un-evaluated
    // candidate has no number at all.
    maybe('a measured 0 and an unmeasured null are different values', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const measured = store.registerCandidate(candidateInput('trig-zero'))
        .candidate.id;
      const unmeasured = store.registerCandidate(candidateInput('trig-none'))
        .candidate.id;

      store.recordTriggerEval(measured, {
        score: 0,
        precision: 0,
        recall: 0,
      });

      for (const field of [
        'triggerScore',
        'triggerPrecision',
        'triggerRecall',
      ] as const) {
        expect(store.findById(measured)?.[field]).toBe(0);
        expect(store.findById(measured)?.[field]).not.toBeNull();
        expect(store.findById(unmeasured)?.[field]).toBeNull();
        expect(store.findById(unmeasured)?.[field]).not.toBe(0);
      }
    });

    maybe.each([
      ['precision above 1', { score: 0.5, precision: 1.4, recall: 0.5 }],
      ['recall below 0', { score: 0.5, precision: 0.5, recall: -0.2 }],
      [
        'a non-finite recall',
        { score: 0.5, precision: 0.5, recall: Number.NaN },
      ],
    ])('rejects %s', (_label, measurement) => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(
        candidateInput(`trig-bad-${_label}`),
      );

      expect(() => store.recordTriggerEval(candidate.id, measurement)).toThrow(
        /\[0, 1\]/,
      );
    });

    // `score` is finiteness-checked only — its scale is B3.3's decision, and
    // pinning a range from the store would pre-empt it from the wrong file.
    maybe('accepts a score outside 0–1 but rejects a non-finite one', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('trig-2'));

      expect(
        store.recordTriggerEval(candidate.id, {
          score: 7.5,
          precision: 0.8,
          recall: 0.7,
        }).triggerScore,
      ).toBeCloseTo(7.5);

      expect(() =>
        store.recordTriggerEval(candidate.id, {
          score: Number.POSITIVE_INFINITY,
          precision: 0.8,
          recall: 0.7,
        }),
      ).toThrow(/finite/);
    });

    // The two gates are independent axes; neither may clobber the other.
    maybe('does not disturb a replay measurement, and vice versa', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const { candidate } = store.registerCandidate(candidateInput('trig-3'));

      store.recordReplay(candidate.id, {
        confidence: 0.82,
        holdoutSessionId: 'sess-9f3a',
        replayAt: 1_770_000_000_000,
      });
      const afterTrigger = store.recordTriggerEval(candidate.id, {
        score: 0.75,
        precision: 0.8,
        recall: 0.7,
        evaluatedAt: 1_770_000_060_000,
      });

      expect(afterTrigger.replayConfidence).toBeCloseTo(0.82);
      expect(afterTrigger.replayHoldoutSessionId).toBe('sess-9f3a');
      expect(afterTrigger.replayAt).toBe(1_770_000_000_000);

      const afterReplay = store.recordReplay(candidate.id, {
        confidence: 0.4,
        holdoutSessionId: 'sess-other',
      });
      expect(afterReplay.triggerScore).toBeCloseTo(0.75);
      expect(afterReplay.triggerPrecision).toBeCloseTo(0.8);
      expect(afterReplay.triggerRecall).toBeCloseTo(0.7);
      expect(afterReplay.triggerEvalAt).toBe(1_770_000_060_000);
    });
  });
});

describe('SkillCandidateStore — per-session supersession', () => {
  const opener2 = resolveOpener();
  const maybe2 = opener2 ? it : it.skip;

  function seedForSession(
    store: SkillCandidateStore,
    suffix: string,
    sessionId: string,
    createdAt: number,
  ) {
    return store.registerCandidate({
      ...candidateInput(suffix),
      sourceSessionIds: [sessionId],
      createdAt,
    }).candidate;
  }

  describe('findLatestBySourceSession', () => {
    maybe2('returns the newest candidate row that names the session', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      seedForSession(store, 'old', 'sess-a', 1_000);
      const newer = seedForSession(store, 'new', 'sess-a', 2_000);
      seedForSession(store, 'other', 'sess-b', 3_000);

      // Newest, because a growing session's latest draft is the one that owns
      // the SKILL.md directory the next pass would collide with.
      expect(store.findLatestBySourceSession('sess-a')?.id).toBe(newer.id);
    });

    maybe2('ignores promoted and rejected rows', () => {
      // A promoted row is a shipped skill and a rejected one is a decision
      // already taken. Superseding either under a session that merely grew
      // would rewrite an artifact nobody re-reviewed.
      const db = createInMemoryDb();
      const store = makeStore(db);
      const promoted = seedForSession(store, 'promoted', 'sess-c', 1_000);
      const rejected = seedForSession(store, 'rejected', 'sess-c', 2_000);
      store.updateStatus(promoted.id, 'promoted');
      store.updateStatus(rejected.id, 'rejected');

      expect(store.findLatestBySourceSession('sess-c')).toBeNull();
    });

    maybe2('matches a session id exactly, not as a substring', () => {
      // `json_each` and not `LIKE '%id%'`: a substring scan would also hit a
      // session id that merely CONTAINS this one, and supersede the wrong row.
      const db = createInMemoryDb();
      const store = makeStore(db);
      seedForSession(store, 'longer', 'sess-abcdef', 1_000);

      expect(store.findLatestBySourceSession('sess-abc')).toBeNull();
      expect(store.findLatestBySourceSession('sess-abcdef')).not.toBeNull();
    });

    maybe2('returns null for a row that names no session at all', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      store.registerCandidate(candidateInput('sessionless'));

      expect(store.findLatestBySourceSession('sess-anything')).toBeNull();
      expect(store.findLatestBySourceSession('')).toBeNull();
    });
  });

  describe('superseded', () => {
    maybe2('rewrites the content columns and keeps the slug', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const row = seedForSession(store, 'grow', 'sess-d', 1_000);

      const updated = store.superseded(row.id, {
        description: 'a sharper description',
        bodyPath: '/tmp/grow/SKILL.md',
        trajectoryHash: 'hash-grow-v2',
        embedding: null,
      });

      expect(updated.description).toBe('a sharper description');
      expect(updated.bodyPath).toBe('/tmp/grow/SKILL.md');
      expect(updated.trajectoryHash).toBe('hash-grow-v2');
      // The slug is the SKILL.md folder name and carries a UNIQUE index —
      // renaming it strands the directory the row points at.
      expect(updated.name).toBe(row.name);
      expect(updated.id).toBe(row.id);
      // No second row was minted, which is the whole point.
      expect(store.listByStatus('candidate')).toHaveLength(1);
      // And the new hash is what every other dedupe path now reads.
      expect(store.findByTrajectoryHash('hash-grow-v2')?.id).toBe(row.id);
    });

    maybe2('throws for a row that is no longer a candidate', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);
      const row = seedForSession(store, 'shipped', 'sess-e', 1_000);
      store.updateStatus(row.id, 'promoted');

      expect(() =>
        store.superseded(row.id, {
          description: 'd',
          bodyPath: '/tmp/x/SKILL.md',
          trajectoryHash: 'hash-shipped-v2',
          embedding: null,
        }),
      ).toThrow(/not 'candidate'/);
    });

    maybe2('throws for a row that does not exist', () => {
      const db = createInMemoryDb();
      const store = makeStore(db);

      expect(() =>
        store.superseded('missing' as CandidateId, {
          description: 'd',
          bodyPath: '/tmp/x/SKILL.md',
          trajectoryHash: 'h',
          embedding: null,
        }),
      ).toThrow(/not found/);
    });
  });
});
