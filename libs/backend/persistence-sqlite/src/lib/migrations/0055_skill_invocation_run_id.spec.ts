/**
 * Migration 0055 — per-run key on skill invocation events (TASK_2026_646,
 * part B Component 6). Real schema lineage on isolated in-memory databases;
 * fails instead of skipping when neither SQLite binding loads.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { sql } from './0055_skill_invocation_run_id';
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

type DbOpener = () => DatabaseShape;

function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    new Database(':memory:').close();
    return () => new Database(':memory:');
  } catch {
    // Electron's native ABI may not load in Jest; fall through to node:sqlite.
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
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

interface EventColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

function eventColumns(db: DatabaseShape): Map<string, EventColumn> {
  const rows = db
    .prepare('PRAGMA table_info(skill_invocation_events)')
    .all() as EventColumn[];
  return new Map(rows.map((r) => [r.name, r]));
}

describe('migration 0055_skill_invocation_run_id — registry and static SQL', () => {
  it('is registered once as version 55, after 0054, plain static SQL', () => {
    expect(MIGRATIONS.filter((m) => m.version === 55)).toEqual([
      { version: 55, name: '0055_skill_invocation_run_id', sql },
    ]);
    const position = MIGRATIONS.findIndex((m) => m.version === 55);
    expect(MIGRATIONS.slice(position - 1, position + 1).map((m) => m.version))
      .toEqual([54, 55]);
    expect(sql).not.toContain('${');
    expect(sql).not.toMatch(/\b(DELETE|UPDATE|INSERT|DROP TABLE)\b/i);
  });

  it('keeps the bundled-version ratchet current', () => {
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(56);
  });
});

describe('migration 0055_skill_invocation_run_id — behaviour', () => {
  const opener = resolveOpener();

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  function openAtVersion54(): DatabaseShape {
    if (!opener) throw new Error('No SQLite binding loaded');
    const db = opener();
    for (const migration of MIGRATIONS.filter((m) => m.version < 55)) {
      if (migration.sql) db.exec(migration.sql);
    }
    const insertApplied = db.prepare(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, 0)',
    );
    for (const m of MIGRATIONS.filter((x) => x.version < 55)) {
      insertApplied.run(m.version);
    }
    return db;
  }

  it('applies on an existing events table, keeps its rows, and leaves their run_id NULL', async () => {
    const db = openAtVersion54();
    try {
      // A pre-0055 install's event: the fixed column list has no run_id.
      db.prepare(
        `INSERT INTO skill_invocation_events
           (id, skill_slug, session_id, source, succeeded, is_error, invoked_at)
         VALUES ('e1', 'deep-research', 's1', 'tool-use', 1, 0, 1000)`,
      ).run();

      const result = await new SqliteMigrationRunner(
        db as unknown as SqliteDatabase,
        logger,
      ).applyAll(MIGRATIONS.filter((m) => m.version <= 55));
      expect(result.appliedVersions).toEqual([55]);

      expect(
        db
          .prepare('SELECT run_id FROM skill_invocation_events WHERE id = ?')
          .get('e1'),
      ).toEqual({ run_id: null });

      // The widened column list writes the per-run key; the join reads it back.
      db.prepare(
        `INSERT INTO skill_invocation_events
           (id, skill_slug, session_id, source, succeeded, is_error, invoked_at, run_id)
         VALUES ('e2', 'deep-research', 's1', 'tool-use', 1, 0, 2000, 'subagent:a1')`,
      ).run();
      expect(
        db
          .prepare('SELECT run_id FROM skill_invocation_events WHERE id = ?')
          .get('e2'),
      ).toEqual({ run_id: 'subagent:a1' });
    } finally {
      db.close();
    }
  });

  it('adds run_id as a nullable TEXT column with no default', () => {
    const db = openAtVersion54();
    try {
      // Absent before, present after — proving 0055 is what added it.
      expect(eventColumns(db).has('run_id')).toBe(false);
      db.exec(sql);

      const col = eventColumns(db).get('run_id');
      expect(col).toBeDefined();
      expect(col?.type).toBe('TEXT');
      expect(col?.notnull).toBe(0);
      expect(col?.dflt_value).toBeNull();

      // session_id is untouched: still the NOT NULL column 0021 declared.
      expect(eventColumns(db).get('session_id')?.notnull).toBe(1);
    } finally {
      db.close();
    }
  });

  it('stays non-unique and serves the run lookup from the index', () => {
    const db = openAtVersion54();
    try {
      db.exec(sql);
      const insert = db.prepare(
        `INSERT INTO skill_invocation_events
           (id, skill_slug, session_id, source, succeeded, is_error, invoked_at, run_id)
         VALUES (?, 'deep-research', 's1', 'tool-use', 1, 0, ?, ?)`,
      );
      insert.run('e2', 2000, 'subagent:a1');
      insert.run('e3', 3000, 'subagent:a1');

      // The index is non-unique by design: the seam reports `ambiguous`
      // when two rows ever share a run_id, instead of hiding one.
      expect(
        db
          .prepare('SELECT id FROM skill_invocation_events WHERE run_id = ?')
          .all('subagent:a1'),
      ).toEqual([{ id: 'e2' }, { id: 'e3' }]);

      const plan = (
        db
          .prepare(
            'EXPLAIN QUERY PLAN SELECT id FROM skill_invocation_events WHERE run_id = ?',
          )
          .all('subagent:a1') as Array<{ detail: string }>
      )
        .map((r) => r.detail)
        .join('|');
      expect(plan).toContain('idx_skill_inv_events_run (run_id=?)');
      expect(plan).not.toMatch(/TEMP B-TREE/);
    } finally {
      db.close();
    }
  });
});
