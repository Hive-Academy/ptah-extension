import 'reflect-metadata';
import { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { noopLogger, resolveOpener } from './queue/queue-db.test-support';
import { SkillInvocationEventStore } from './skill-invocation-event.store';

const opener = resolveOpener();
const maybe = opener ? it : it.skip;

describe('SkillInvocationEventStore', () => {
  maybe('writes nullable grades independently from explicit error flags', () => {
    if (!opener) throw new Error('SQLite opener unavailable');
    const db = opener(':memory:');
    try {
      db.exec(`CREATE TABLE skill_invocation_events (
        id TEXT PRIMARY KEY, skill_slug TEXT, session_id TEXT, context_id TEXT,
        source TEXT, succeeded INTEGER NULL, is_error INTEGER NOT NULL,
        invoked_at INTEGER, input_tokens INTEGER, output_tokens INTEGER,
        cache_read_tokens INTEGER, cache_creation_tokens INTEGER,
        cost_usd REAL, duration_ms INTEGER, tool_count INTEGER,
        task_id TEXT, workspace_root TEXT, run_id TEXT, verdict_source TEXT
      )`);
      const connection = Object.create(
        SqliteConnectionService.prototype,
      ) as SqliteConnectionService;
      Object.defineProperty(connection, 'db', { value: db });
      const store = new SkillInvocationEventStore(noopLogger, connection);
      const base = {
        skillSlug: 'reviewer', sessionId: 'session-1', contextId: null,
        source: 'subagent', invokedAt: 100, workspaceRoot: '/work',
        taskId: 'TASK_2026_662', runId: 'run-1',
      };
      store.recordSkillEvent({ ...base, isError: false });
      store.recordSkillEvent({ ...base, runId: 'run-2', succeeded: false, isError: false });
      store.recordSkillEvent({ ...base, runId: 'run-3', isError: true });
      const rows = db.prepare(`SELECT run_id, succeeded, is_error, workspace_root,
        task_id FROM skill_invocation_events ORDER BY run_id`).all() as Array<{
          run_id: string; succeeded: number | null; is_error: number;
          workspace_root: string; task_id: string;
        }>;
      expect(rows).toEqual([
        { run_id: 'run-1', succeeded: null, is_error: 0, workspace_root: '/work', task_id: 'TASK_2026_662' },
        { run_id: 'run-2', succeeded: 0, is_error: 0, workspace_root: '/work', task_id: 'TASK_2026_662' },
        { run_id: 'run-3', succeeded: null, is_error: 1, workspace_root: '/work', task_id: 'TASK_2026_662' },
      ]);
      expect(store.findSubagentRuns(['run-1', 'run-3'])).toMatchObject([
        { run_id: 'run-1', is_error: 0 }, { run_id: 'run-3', is_error: 1 },
      ]);
    } finally {
      db.close();
    }
  });

  maybe('looks up loaded skills and recent sessions from event rows', () => {
    if (!opener) throw new Error('SQLite opener unavailable');
    const db = opener(':memory:');
    try {
      db.exec(`CREATE TABLE skill_invocation_events (
        id TEXT PRIMARY KEY, skill_slug TEXT, session_id TEXT, context_id TEXT,
        source TEXT, succeeded INTEGER NULL, is_error INTEGER NOT NULL,
        invoked_at INTEGER, input_tokens INTEGER, output_tokens INTEGER,
        cache_read_tokens INTEGER, cache_creation_tokens INTEGER,
        cost_usd REAL, duration_ms INTEGER, tool_count INTEGER,
        task_id TEXT, workspace_root TEXT, run_id TEXT, verdict_source TEXT
      )`);
      const connection = Object.create(
        SqliteConnectionService.prototype,
      ) as SqliteConnectionService;
      Object.defineProperty(connection, 'db', { value: db });
      const store = new SkillInvocationEventStore(noopLogger, connection);
      store.recordSkillEvent({ skillSlug: 'loaded', sessionId: 's1', contextId: null,
        source: 'tool-use', isError: false, invokedAt: 10 });
      store.recordSkillEvent({ skillSlug: 'outside', sessionId: 's1', contextId: null,
        source: 'tool-use', isError: false, invokedAt: 30 });
      store.recordSkillEvent({ skillSlug: 'loaded', sessionId: 's2', contextId: null,
        source: 'prompt-expansion', isError: false, invokedAt: 20 });
      store.recordSkillEvent({ skillSlug: 'command', sessionId: 's1', contextId: null,
        source: 'slash-command', isError: false, invokedAt: 15 });
      expect(store.listSkillsForScopes([
        { runId: 'r1', sessionId: 's1', fromMs: 0, toMs: 20 },
        { runId: 'r2', sessionId: 's2', fromMs: 0, toMs: 25 },
      ])).toEqual(new Map([['r1', ['command', 'loaded']], ['r2', ['loaded']]]));
      expect(store.getDominantSkillSlugForSessions(['s1', 's2'])).toBe('loaded');
      expect(store.getRecentSessionsForSlug('loaded')).toEqual(['s2', 's1']);
    } finally {
      db.close();
    }
  });
});
