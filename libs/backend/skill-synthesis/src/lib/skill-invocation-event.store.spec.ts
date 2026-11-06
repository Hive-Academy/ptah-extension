import 'reflect-metadata';
import { join, sep } from 'node:path';
import { SkillInvocationEventStore } from './skill-invocation-event.store';
import type { TestDatabase } from './queue/queue-db.test-support';

/** `reconcileTaskEvents` runs in a transaction, which `node:sqlite` lacks. */
interface TransactionalDatabase extends TestDatabase {
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
}

function resolveTransactionalOpener(): ((file: string) => TransactionalDatabase) | null {
  try {
    const Database = require('better-sqlite3') as new (file: string) => TransactionalDatabase;
    new Database(':memory:').close();
    return (file) => new Database(file);
  } catch {
    // Native module unavailable (ABI mismatch): the store specs are skipped.
    return null;
  }
}

const opener = resolveTransactionalOpener();
const maybe = opener ? it : it.skip;

function createStore() {
  if (!opener) throw new Error('SQLite binding unavailable');
  const db = opener(':memory:');
  db.exec(`
    CREATE TABLE skill_invocation_events (
      id TEXT PRIMARY KEY,
      skill_slug TEXT NOT NULL,
      session_id TEXT NOT NULL,
      context_id TEXT,
      source TEXT NOT NULL,
      succeeded INTEGER,
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
      task_id TEXT,
      workspace_root TEXT,
      run_id TEXT
    );
    CREATE INDEX idx_skill_inv_events_task
      ON skill_invocation_events(skill_slug, task_id);
  `);
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const store = new SkillInvocationEventStore(logger as never, { db } as never);
  return { db, store };
}

const ROOT = join(process.cwd(), 'workspace-a');
const OTHER_ROOT = join(process.cwd(), 'workspace-b');

function record(
  store: SkillInvocationEventStore,
  taskId: string | null,
  invokedAt: number,
  inputTokens?: number,
  options: { workspaceRoot?: string | null; source?: string; slug?: string } = {},
): void {
  store.recordSkillEvent({
    skillSlug: options.slug ?? 'agent',
    sessionId: `session-${invokedAt}`,
    contextId: null,
    source: options.source ?? 'subagent',
    succeeded: true,
    isError: false,
    invokedAt,
    taskId,
    workspaceRoot: options.workspaceRoot === undefined ? ROOT : options.workspaceRoot,
    metrics: inputTokens === undefined ? null : {
      inputTokens,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costUsd: null,
      durationMs: null,
      toolCount: null,
    },
  });
}

interface ReconcileRow {
  invoked_at: number;
  succeeded: number | null;
  reconciled_at: number | null;
  verdict_source: string | null;
}

function rows(db: TransactionalDatabase): ReconcileRow[] {
  return db.prepare(`SELECT invoked_at, succeeded, reconciled_at, verdict_source
    FROM skill_invocation_events ORDER BY invoked_at`).all() as ReconcileRow[];
}

const verdict = {
  taskId: 'TASK_A', workspaceRoot: ROOT, succeeded: false,
  verdictSource: 'spec:TASK_A', reconciledAt: 5000,
};

describe('SkillInvocationEventStore reconciliation and scorecards', () => {
  maybe('reconciles every source of the task in the same workspace only', () => {
    const { db, store } = createStore();
    try {
      record(store, 'TASK_A', 1);
      record(store, 'TASK_A', 2, undefined, { source: 'tool-use', slug: 'skill-x' });
      record(store, 'TASK_A', 3, undefined, { source: 'slash-command', slug: 'cmd' });
      // Same workspace, spelled with a trailing separator.
      record(store, 'TASK_A', 4, undefined, { workspaceRoot: `${ROOT}${sep}` });
      // Excluded: another workspace, a NULL root, a NULL task, another task.
      record(store, 'TASK_A', 5, undefined, { workspaceRoot: OTHER_ROOT });
      record(store, 'TASK_A', 6, undefined, { workspaceRoot: null });
      record(store, null, 7);
      record(store, 'TASK_B', 8);

      expect(store.reconcileTaskEvents(verdict)).toBe(4);
      expect(rows(db)).toEqual([
        { invoked_at: 1, succeeded: 0, reconciled_at: 5000, verdict_source: 'spec:TASK_A' },
        { invoked_at: 2, succeeded: 0, reconciled_at: 5000, verdict_source: 'spec:TASK_A' },
        { invoked_at: 3, succeeded: 0, reconciled_at: 5000, verdict_source: 'spec:TASK_A' },
        { invoked_at: 4, succeeded: 0, reconciled_at: 5000, verdict_source: 'spec:TASK_A' },
        { invoked_at: 5, succeeded: 1, reconciled_at: null, verdict_source: null },
        { invoked_at: 6, succeeded: 1, reconciled_at: null, verdict_source: null },
        { invoked_at: 7, succeeded: 1, reconciled_at: null, verdict_source: null },
        { invoked_at: 8, succeeded: 1, reconciled_at: null, verdict_source: null },
      ]);
    } finally {
      db.close();
    }
  });

  maybe('is idempotent: a second call returns 0 and never re-flips a reconciled row', () => {
    const { db, store } = createStore();
    try {
      record(store, 'TASK_A', 1);
      record(store, 'TASK_A', 2);
      expect(store.reconcileTaskEvents(verdict)).toBe(2);
      expect(store.reconcileTaskEvents({ ...verdict, succeeded: true, reconciledAt: 9000 })).toBe(0);
      expect(rows(db).map((row) => [row.succeeded, row.reconciled_at])).toEqual([[0, 5000], [0, 5000]]);
      // The other workspace's own harvest still reconciles its rows once.
      record(store, 'TASK_A', 3, undefined, { workspaceRoot: OTHER_ROOT });
      expect(store.reconcileTaskEvents({ ...verdict, workspaceRoot: OTHER_ROOT, succeeded: true })).toBe(1);
      expect(store.reconcileTaskEvents({ ...verdict, workspaceRoot: OTHER_ROOT, succeeded: true })).toBe(0);
    } finally {
      db.close();
    }
  });

  maybe('the guarded UPDATE skips a row an overlapping harvest reconciled after the SELECT', () => {
    const { db, store } = createStore();
    try {
      record(store, 'TASK_A', 1);
      record(store, 'TASK_A', 2);
      // Simulate a concurrent harvest that reconciles invoked_at=1 between this
      // call's candidate SELECT and its UPDATE.
      const racing = {
        transaction: <T extends (...args: never[]) => unknown>(fn: T): T => db.transaction(fn),
        prepare: (sql: string) => {
          const statement = db.prepare(sql);
          if (!sql.includes('SELECT id, workspace_root')) return statement;
          return {
            all: (...params: unknown[]) => {
              const selected = statement.all(...params);
              db.prepare(`UPDATE skill_invocation_events SET succeeded = 1, reconciled_at = 1,
                verdict_source = 'spec:other-harvest' WHERE invoked_at = 1`).run();
              return selected;
            },
          };
        },
      };
      const racingStore = new SkillInvocationEventStore(
        { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
        { db: racing } as never,
      );
      expect(racingStore.reconcileTaskEvents(verdict)).toBe(1);
      expect(rows(db)).toEqual([
        { invoked_at: 1, succeeded: 1, reconciled_at: 1, verdict_source: 'spec:other-harvest' },
        { invoked_at: 2, succeeded: 0, reconciled_at: 5000, verdict_source: 'spec:TASK_A' },
      ]);
    } finally {
      db.close();
    }
  });

  maybe('returns 0 when the task has no eligible event', () => {
    const { db, store } = createStore();
    try {
      record(store, null, 1);
      record(store, 'TASK_A', 2, undefined, { workspaceRoot: null });
      expect(store.reconcileTaskEvents(verdict)).toBe(0);
      expect(rows(db).every((row) => row.reconciled_at === null)).toBe(true);
    } finally {
      db.close();
    }
  });

  maybe('aggregates graded runs and excludes null usage from averages', () => {
    const { db, store } = createStore();
    try {
      record(store, 'TASK_A', 1000, 100);
      record(store, 'TASK_B', 1100);
      store.reconcileTaskEvents({ ...verdict, succeeded: true });
      const cards = store.getScorecardAggregates(['agent', 'absent']);
      expect(cards.get('agent')).toMatchObject({
        total: 2, graded: 1, gradedSucceeded: 1,
        avgInputTokens: 100, totalInputTokens: 100,
      });
      expect(cards.get('absent')).toMatchObject({ total: 0, avgInputTokens: null });
      expect(store.getScorecardAggregates([]).size).toBe(0);
    } finally {
      db.close();
    }
  });
});
