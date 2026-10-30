import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { sql } from './0056_skill_nullable_grades';
import { MIGRATIONS } from './index';
import { SqliteMigrationRunner } from '../migration-runner';
import type { SqliteDatabase } from '../sqlite-connection.service';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

function resolveOpener(): (() => DatabaseShape) | null {
  try {
    const Database = require('better-sqlite3') as new (file: string) => DatabaseShape;
    new Database(':memory:').close();
    return () => new Database(':memory:');
  } catch {
    // The native module can have a different ABI under Jest.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    new DatabaseSync(':memory:').close();
    return () => new DatabaseSync(':memory:');
  } catch {
    return null;
  }
}

const logger = {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
} as unknown as Logger;

const columns = [
  'id', 'skill_slug', 'session_id', 'context_id', 'source', 'succeeded',
  'is_error', 'invoked_at', 'reconciled_at', 'verdict_source', 'input_tokens',
  'output_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'cost_usd',
  'duration_ms', 'tool_count', 'task_id', 'workspace_root', 'run_id',
];

function tableInfo(db: DatabaseShape): Array<{ name: string; notnull: number; type: string }> {
  return db.prepare('PRAGMA table_info(skill_invocation_events)').all() as Array<{
    name: string; notnull: number; type: string;
  }>;
}

function indexes(db: DatabaseShape): string[] {
  return (db.prepare('PRAGMA index_list(skill_invocation_events)').all() as Array<{
    name: string;
  }>).map((row) => row.name).filter((name) => name.startsWith('idx_')).sort();
}

function openAt55(): DatabaseShape {
  const opener = resolveOpener();
  if (!opener) throw new Error('No SQLite binding loaded');
  const db = opener();
  for (const migration of MIGRATIONS.filter((entry) => entry.version < 56)) {
    if (migration.sql) db.exec(migration.sql);
  }
  const mark = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, 0)',
  );
  for (const migration of MIGRATIONS.filter((entry) => entry.version < 56)) {
    mark.run(migration.version);
  }
  return db;
}

describe('migration 0056_skill_nullable_grades', () => {
  it('is registered after 0055 and advances the bundled ratchet', () => {
    expect(MIGRATIONS.filter((migration) => migration.version === 55 || migration.version === 56)
      .map((migration) => migration.version)).toEqual([55, 56]);
    expect(MIGRATIONS.filter((migration) => migration.version === 56)).toEqual([
      { version: 56, name: '0056_skill_nullable_grades', sql },
    ]);
    expect(Math.max(...MIGRATIONS.map((migration) => migration.version))).toBe(63);
    expect(sql).not.toContain('${');
  });

  it('has a SQLite binding to run against', () => {
    expect(resolveOpener()).not.toBeNull();
  });

  it('preserves all columns, indexes, ids and metric values while resetting only ungraded rows', async () => {
    const db = openAt55();
    try {
      const beforeColumns = tableInfo(db);
      const beforeIndexes = indexes(db);
      const insert = db.prepare(`INSERT INTO skill_invocation_events (
        id, skill_slug, session_id, context_id, source, succeeded, is_error,
        invoked_at, reconciled_at, verdict_source, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms, tool_count,
        task_id, workspace_root, run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      insert.run('optimistic', 'agent-a', 'session-a', null, 'subagent', 1, 1,
        100, null, null, 12, 34, 5, 6, 0.25, 99, 7, 'TASK_A', null, 'run-a');
      insert.run('pass', 'agent-b', 'session-b', 'context-b', 'subagent', 1, 0,
        200, 300, 'spec:TASK_B', 2, 3, null, null, 0.5, 10, 1, 'TASK_B',
        'workspace-b', 'run-b');
      insert.run('fail', 'agent-c', 'session-c', null, 'subagent', 0, 1,
        400, 500, 'spec:TASK_C', null, null, null, null, null, null, null,
        'TASK_C', '', 'run-c');
      const beforeRows = db.prepare('SELECT id FROM skill_invocation_events ORDER BY id').all();

      const result = await new SqliteMigrationRunner(
        db as unknown as SqliteDatabase, logger,
      ).applyAll(MIGRATIONS.filter((migration) => migration.version <= 56));
      expect(result.appliedVersions).toEqual([56]);

      const afterColumns = tableInfo(db);
      expect(afterColumns.map((column) => column.name)).toEqual(columns);
      expect(afterColumns.map((column) => column.name)).toEqual(
        beforeColumns.map((column) => column.name),
      );
      expect(afterColumns.find((column) => column.name === 'succeeded')).toMatchObject({
        type: 'INTEGER', notnull: 0,
      });
      expect(afterColumns.filter((column) => column.name !== 'succeeded')).toEqual(
        beforeColumns.filter((column) => column.name !== 'succeeded'),
      );
      expect(indexes(db)).toEqual(beforeIndexes);
      expect(indexes(db)).toEqual(expect.arrayContaining([
        'idx_skill_inv_events_slug', 'idx_skill_inv_events_ctx',
        'idx_skill_inv_events_reconcile', 'idx_skill_inv_events_task',
        'idx_skill_inv_events_session', 'idx_skill_inv_events_run',
      ]));
      expect(db.prepare('SELECT id FROM skill_invocation_events ORDER BY id').all())
        .toEqual(beforeRows);
      expect(db.prepare('SELECT COUNT(*) AS total FROM skill_invocation_events').get())
        .toEqual({ total: 3 });
      expect(db.prepare(`SELECT succeeded, is_error, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms,
        tool_count, task_id, workspace_root, run_id
        FROM skill_invocation_events WHERE id = ?`).get('optimistic')).toEqual({
        succeeded: null, is_error: 0, input_tokens: 12, output_tokens: 34,
        cache_read_tokens: 5, cache_creation_tokens: 6, cost_usd: 0.25,
        duration_ms: 99, tool_count: 7, task_id: 'TASK_A',
        workspace_root: null, run_id: 'run-a',
      });
      expect(db.prepare('SELECT succeeded, is_error FROM skill_invocation_events WHERE id = ?')
        .get('pass')).toEqual({ succeeded: 1, is_error: 0 });
      expect(db.prepare('SELECT succeeded, is_error FROM skill_invocation_events WHERE id = ?')
        .get('fail')).toEqual({ succeeded: 0, is_error: 1 });
      expect(db.prepare(`SELECT task_id, subject_kind, subject_slug,
        attribution_key, verdict, workspace_root FROM skill_task_grades
        ORDER BY task_id`).all()).toEqual([
        { task_id: 'TASK_B', subject_kind: 'agent', subject_slug: 'agent-b',
          attribution_key: 'run:run-b', verdict: 'pass', workspace_root: 'workspace-b' },
        { task_id: 'TASK_C', subject_kind: 'agent', subject_slug: 'agent-c',
          attribution_key: 'run:run-c', verdict: 'fail', workspace_root: '' },
      ]);
      expect(db.prepare('SELECT id FROM skill_invocation_events WHERE run_id = ?')
        .all('run-b')).toEqual([{ id: 'pass' }]);
    } finally {
      db.close();
    }
  });

  it('leaves ambiguous and window-matched events ungraded; accepts new NULL successes', () => {
    const db = openAt55();
    try {
      const insert = db.prepare(`INSERT INTO skill_invocation_events
        (id, skill_slug, session_id, source, succeeded, invoked_at,
         reconciled_at, verdict_source, task_id, run_id)
        VALUES (?, ?, 'session', 'subagent', ?, 100, 200, ?, ?, ?)`);
      insert.run('duplicate-a', 'agent', 1, 'spec:TASK_D', 'TASK_D', null);
      insert.run('duplicate-b', 'agent', 0, 'spec:TASK_D', 'TASK_D', null);
      insert.run('window', 'agent', 1, 'spec-window:TASK_E', 'TASK_E', null);
      insert.run('missing-task', 'agent', 1, 'spec:TASK_F', null, null);
      db.exec(sql);
      expect(db.prepare('SELECT COUNT(*) AS total FROM skill_task_grades').get())
        .toEqual({ total: 0 });
      const newInsert = db.prepare(`INSERT INTO skill_invocation_events
        (id, skill_slug, session_id, source, is_error, invoked_at)
        VALUES (?, ?, 'session', ?, 0, 900)`);
      newInsert.run('new-agent', 'agent', 'subagent');
      newInsert.run('new-skill', 'skill', 'tool-use');
      newInsert.run('new-command', 'command', 'prompt-expansion');
      expect(db.prepare(`SELECT id, succeeded, is_error FROM skill_invocation_events
        WHERE id LIKE 'new-%' ORDER BY id`).all()).toEqual([
        { id: 'new-agent', succeeded: null, is_error: 0 },
        { id: 'new-command', succeeded: null, is_error: 0 },
        { id: 'new-skill', succeeded: null, is_error: 0 },
      ]);
    } finally {
      db.close();
    }
  });
});
