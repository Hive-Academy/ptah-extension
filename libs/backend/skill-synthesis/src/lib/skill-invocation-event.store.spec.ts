import 'reflect-metadata';
import { SkillInvocationEventStore } from './skill-invocation-event.store';
import { resolveOpener } from './queue/queue-db.test-support';

const opener = resolveOpener();
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

function record(
  store: SkillInvocationEventStore,
  taskId: string | null,
  invokedAt: number,
  inputTokens?: number,
): void {
  store.recordSkillEvent({
    skillSlug: 'agent',
    sessionId: `session-${invokedAt}`,
    contextId: null,
    source: 'subagent',
    succeeded: true,
    isError: false,
    invokedAt,
    taskId,
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

describe('SkillInvocationEventStore reconciliation and scorecards', () => {
  maybe('prefers exact task attribution and is idempotent', () => {
    const { db, store } = createStore();
    try {
      record(store, 'TASK_A', 10000);
      record(store, 'TASK_B', 1000);
      const input = {
        slug: 'agent', taskId: 'TASK_A', succeeded: false, isError: true,
        windowStart: 0, windowEnd: 2000, verdictSource: 'spec:TASK_A',
        reconciledAt: 5000,
      };
      expect(store.reconcileSubagentEvent(input)).toBe(true);
      expect(store.reconcileSubagentEvent(input)).toBe(false);
      expect(db.prepare('SELECT succeeded, is_error, verdict_source FROM skill_invocation_events WHERE task_id = ?')
        .get('TASK_A')).toMatchObject({ succeeded: 0, is_error: 1, verdict_source: 'spec:TASK_A' });
      expect(db.prepare('SELECT reconciled_at FROM skill_invocation_events WHERE task_id = ?')
        .get('TASK_B')).toMatchObject({ reconciled_at: null });
    } finally {
      db.close();
    }
  });

  maybe('falls back only to an unstamped event and records heuristic provenance', () => {
    const { db, store } = createStore();
    try {
      record(store, 'TASK_OTHER', 1000);
      record(store, null, 1100);
      expect(store.reconcileSubagentEvent({
        slug: 'agent', taskId: 'TASK_MISSING', succeeded: false,
        windowStart: 0, windowEnd: 2000, verdictSource: 'spec:TASK_MISSING',
        reconciledAt: 5000,
      })).toBe(true);
      expect(db.prepare('SELECT verdict_source FROM skill_invocation_events WHERE task_id IS NULL')
        .get()).toMatchObject({ verdict_source: 'spec-window:TASK_MISSING' });
      expect(db.prepare('SELECT reconciled_at FROM skill_invocation_events WHERE task_id = ?')
        .get('TASK_OTHER')).toMatchObject({ reconciled_at: null });
    } finally {
      db.close();
    }
  });

  maybe('aggregates graded runs and excludes null usage from averages', () => {
    const { db, store } = createStore();
    try {
      record(store, 'TASK_A', 1000, 100);
      record(store, 'TASK_B', 1100);
      store.reconcileSubagentEvent({
        slug: 'agent', taskId: 'TASK_A', succeeded: true,
        windowStart: 0, windowEnd: 2000, verdictSource: 'spec:TASK_A',
        reconciledAt: 5000,
      });
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
