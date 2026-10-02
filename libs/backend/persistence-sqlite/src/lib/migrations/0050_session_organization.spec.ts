/**
 * Migration 0050 — session organization (TASK_2026_580).
 *
 * Applies 0050 on top of the real 1..49 schema lineage in isolated in-memory
 * databases and pins the shape the session-organization store relies on:
 * tables, column types, nullability and defaults, the three indexes, the
 * partial unique index that allows one 'primary' task link per session, the
 * absence of CHECK constraints and foreign keys (lane L1), and the ledger that
 * prevents a re-run. This spec never opens a user database, and fails instead
 * of skipping when neither SQLite binding loads.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { sql } from './0050_session_organization';
import { MIGRATIONS } from './index';
import { SqliteMigrationRunner } from '../migration-runner';
import type { SqliteDatabase } from '../sqlite-connection.service';

interface StatementShape {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): StatementShape;
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

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

const fakeLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

const WS = 'D:/projects/fixture-workspace';
const TABLES = [
  'session_organization',
  'session_task_links',
  'session_pr_links',
] as const;

describe('migration 0050_session_organization — registry and static SQL', () => {
  it('is registered once as plain, static SQL', () => {
    expect(MIGRATIONS.filter((m) => m.version === 50)).toEqual([
      { version: 50, name: '0050_session_organization', sql },
    ]);
    expect(sql).not.toContain('${');
  });

  it('follows 49 with no gap', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions.indexOf(50)).toBe(versions.indexOf(49) + 1);
  });

  it('only creates tables and indexes: no CHECK, no foreign key, no data change', () => {
    expect(sql).not.toMatch(/\bCHECK\b/i);
    expect(sql).not.toMatch(/\b(REFERENCES|FOREIGN\s+KEY)\b/i);
    expect(sql).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|VACUUM|PRAGMA)\b/i,
    );
    expect(sql.match(/\bCREATE TABLE IF NOT EXISTS\b/g)).toHaveLength(3);
    expect(sql.match(/\bCREATE (UNIQUE )?INDEX IF NOT EXISTS\b/g)).toHaveLength(
      3,
    );
  });
});

describe('migration 0050_session_organization — applied on top of 1..49', () => {
  const opener = resolveOpener();

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  function openAtVersion49(): DatabaseShape {
    if (!opener) {
      throw new Error(
        'No SQLite binding loaded (neither better-sqlite3 nor node:sqlite)',
      );
    }
    const db = opener();
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of MIGRATIONS.filter((m) => m.version < 50)) {
      if (migration.sql) db.exec(migration.sql);
    }
    return db;
  }

  function openAtVersion50(): DatabaseShape {
    const db = openAtVersion49();
    db.exec(sql);
    return db;
  }

  function columns(db: DatabaseShape, table: string): ColumnInfo[] {
    return db.prepare('PRAGMA table_info(' + table + ')').all() as ColumnInfo[];
  }

  /** name, type, NOT NULL, default, primary-key position — one row per column. */
  function shape(db: DatabaseShape, table: string): unknown[] {
    return columns(db, table).map((c) => [
      c.name,
      c.type,
      Number(c.notnull),
      c.dflt_value ?? null,
      Number(c.pk),
    ]);
  }

  function indexColumns(db: DatabaseShape, index: string): string[] {
    return (
      db.prepare('PRAGMA index_info(' + index + ')').all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
  }

  function count(db: DatabaseShape, table: string): number {
    const row = db.prepare('SELECT COUNT(*) AS n FROM ' + table).get() as {
      n: number;
    };
    return Number(row.n);
  }

  it('applies cleanly to a 1..49 database and creates the three tables', () => {
    const db = openAtVersion49();
    try {
      for (const table of TABLES) {
        expect(columns(db, table)).toEqual([]);
      }
      expect(() => db.exec(sql)).not.toThrow();
      for (const table of TABLES) {
        expect(count(db, table)).toBe(0);
      }
    } finally {
      db.close();
    }
  });

  it('declares session_organization exactly, with nullable lineage and the defaults', () => {
    const db = openAtVersion50();
    try {
      expect(shape(db, 'session_organization')).toEqual([
        ['workspace_root', 'TEXT', 1, null, 1],
        ['session_id', 'TEXT', 1, null, 2],
        ['priority', 'TEXT', 1, "'normal'", 0],
        ['status', 'TEXT', 1, "'active'", 0],
        ['pinned', 'INTEGER', 1, '0', 0],
        ['worktree_path', 'TEXT', 0, null, 0],
        ['branch', 'TEXT', 0, null, 0],
        ['parent_session_id', 'TEXT', 0, null, 0],
        ['fork_of_session_id', 'TEXT', 0, null, 0],
        ['started_by', 'TEXT', 1, "'user'", 0],
        ['updated_at', 'INTEGER', 1, null, 0],
      ]);
    } finally {
      db.close();
    }
  });

  it('declares session_task_links and session_pr_links exactly', () => {
    const db = openAtVersion50();
    try {
      expect(shape(db, 'session_task_links')).toEqual([
        ['workspace_root', 'TEXT', 1, null, 1],
        ['session_id', 'TEXT', 1, null, 2],
        ['task_id', 'TEXT', 1, null, 3],
        ['role', 'TEXT', 1, null, 0],
        ['source', 'TEXT', 1, null, 0],
        ['created_at', 'INTEGER', 1, null, 0],
      ]);
      expect(shape(db, 'session_pr_links')).toEqual([
        ['workspace_root', 'TEXT', 1, null, 1],
        ['session_id', 'TEXT', 1, null, 2],
        ['url', 'TEXT', 1, null, 3],
        ['number', 'INTEGER', 0, null, 0],
        ['repo', 'TEXT', 0, null, 0],
        ['state', 'TEXT', 0, null, 0],
        ['source', 'TEXT', 1, null, 0],
        ['created_at', 'INTEGER', 1, null, 0],
      ]);
    } finally {
      db.close();
    }
  });

  it('creates the parent, task and partial primary indexes on the declared columns', () => {
    const db = openAtVersion50();
    try {
      expect(indexColumns(db, 'idx_session_org_parent')).toEqual([
        'workspace_root',
        'parent_session_id',
      ]);
      expect(indexColumns(db, 'idx_session_task_links_task')).toEqual([
        'workspace_root',
        'task_id',
      ]);
      expect(indexColumns(db, 'ux_session_task_links_primary')).toEqual([
        'workspace_root',
        'session_id',
      ]);

      const linkIndexes = db
        .prepare('PRAGMA index_list(session_task_links)')
        .all() as Array<{ name: string; unique: number; partial: number }>;
      const primary = linkIndexes.find(
        (i) => i.name === 'ux_session_task_links_primary',
      );
      expect(primary).toBeDefined();
      expect(Number(primary?.unique)).toBe(1);
      expect(Number(primary?.partial)).toBe(1);
    } finally {
      db.close();
    }
  });

  it('has no foreign keys on any of the three tables', () => {
    const db = openAtVersion50();
    try {
      for (const table of TABLES) {
        expect(
          db.prepare('PRAGMA foreign_key_list(' + table + ')').all(),
        ).toEqual([]);
      }
    } finally {
      db.close();
    }
  });

  it('fills the defaults for a lazily created row and requires updated_at', () => {
    const db = openAtVersion50();
    try {
      db.prepare(
        `INSERT INTO session_organization (workspace_root, session_id, updated_at)
         VALUES (?, ?, ?)`,
      ).run(WS, 'session-1', 1_000);
      const row = db
        .prepare(
          `SELECT priority, status, pinned, worktree_path, branch,
                  parent_session_id, fork_of_session_id, started_by, updated_at
             FROM session_organization
            WHERE workspace_root = ? AND session_id = ?`,
        )
        .get(WS, 'session-1') as Record<string, unknown>;
      expect({
        ...row,
        pinned: Number(row['pinned']),
        updated_at: Number(row['updated_at']),
      }).toEqual({
        priority: 'normal',
        status: 'active',
        pinned: 0,
        worktree_path: null,
        branch: null,
        parent_session_id: null,
        fork_of_session_id: null,
        started_by: 'user',
        updated_at: 1_000,
      });

      expect(() =>
        db
          .prepare(
            'INSERT INTO session_organization (workspace_root, session_id) VALUES (?, ?)',
          )
          .run(WS, 'session-2'),
      ).toThrow(/NOT NULL/);
    } finally {
      db.close();
    }
  });

  it('accepts out-of-vocabulary enum values (vocabulary is enforced at the boundary, L1)', () => {
    const db = openAtVersion50();
    try {
      expect(() =>
        db
          .prepare(
            `INSERT INTO session_organization
               (workspace_root, session_id, priority, status, started_by, updated_at)
             VALUES (?, ?, 'future-priority', 'future-status', 'future-agent', 1)`,
          )
          .run(WS, 'session-1'),
      ).not.toThrow();
      expect(() =>
        db
          .prepare(
            `INSERT INTO session_task_links
               (workspace_root, session_id, task_id, role, source, created_at)
             VALUES (?, 'session-1', 'TASK_2026_001', 'future-role', 'future-source', 1)`,
          )
          .run(WS),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('records a child whose parent has no row (lineage is not a foreign key)', () => {
    const db = openAtVersion50();
    try {
      db.prepare(
        `INSERT INTO session_organization
           (workspace_root, session_id, parent_session_id, fork_of_session_id, started_by, updated_at)
         VALUES (?, 'child-1', 'parent-without-row', 'fork-source-without-row', 'agent', 1)`,
      ).run(WS);
      expect(
        db
          .prepare(
            `SELECT session_id FROM session_organization
              WHERE workspace_root = ? AND parent_session_id = ?`,
          )
          .all(WS, 'parent-without-row'),
      ).toEqual([{ session_id: 'child-1' }]);
    } finally {
      db.close();
    }
  });

  it('rejects a second primary link for the same session, and only that', () => {
    const db = openAtVersion50();
    try {
      const insertLink = db.prepare(
        `INSERT INTO session_task_links
           (workspace_root, session_id, task_id, role, source, created_at)
         VALUES (?, ?, ?, ?, 'user', 1)`,
      );
      insertLink.run(WS, 'session-1', 'TASK_2026_001', 'primary');

      expect(() =>
        insertLink.run(WS, 'session-1', 'TASK_2026_002', 'primary'),
      ).toThrow(/UNIQUE constraint failed/);

      // Non-primary links for the same session are unconstrained.
      insertLink.run(WS, 'session-1', 'TASK_2026_002', 'related');
      insertLink.run(WS, 'session-1', 'TASK_2026_003', 'related');
      // Another session, or the same session id in another workspace, may
      // have its own primary.
      insertLink.run(WS, 'session-2', 'TASK_2026_001', 'primary');
      insertLink.run(
        'D:/projects/other',
        'session-1',
        'TASK_2026_001',
        'primary',
      );
      // The same (session, task) pair twice violates the primary key.
      expect(() =>
        insertLink.run(WS, 'session-1', 'TASK_2026_003', 'related'),
      ).toThrow(/UNIQUE constraint failed/);

      // Demote then promote — the store's one-transaction swap — succeeds.
      db.exec('BEGIN IMMEDIATE');
      db.prepare(
        `UPDATE session_task_links SET role = 'related'
          WHERE workspace_root = ? AND session_id = ? AND role = 'primary'`,
      ).run(WS, 'session-1');
      db.prepare(
        `UPDATE session_task_links SET role = 'primary'
          WHERE workspace_root = ? AND session_id = ? AND task_id = ?`,
      ).run(WS, 'session-1', 'TASK_2026_002');
      db.exec('COMMIT');

      expect(
        db
          .prepare(
            `SELECT task_id FROM session_task_links
              WHERE workspace_root = ? AND session_id = ? AND role = 'primary'`,
          )
          .all(WS, 'session-1'),
      ).toEqual([{ task_id: 'TASK_2026_002' }]);
      expect(count(db, 'session_task_links')).toBe(5);
    } finally {
      db.close();
    }
  });

  it('keys PR links by URL per session and keeps number, repo and state optional', () => {
    const db = openAtVersion50();
    try {
      const insertPr = db.prepare(
        `INSERT INTO session_pr_links
           (workspace_root, session_id, url, number, repo, state, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'user', 1)`,
      );
      const url = 'https://github.com/example/repo/pull/7';
      insertPr.run(WS, 'session-1', url, null, null, null);
      insertPr.run(WS, 'session-2', url, 7, 'example/repo', 'open');
      expect(() =>
        insertPr.run(WS, 'session-1', url, 7, 'example/repo', 'open'),
      ).toThrow(/UNIQUE constraint failed/);
      expect(count(db, 'session_pr_links')).toBe(2);
    } finally {
      db.close();
    }
  });

  it('is harmless as raw SQL a second time (IF NOT EXISTS) and keeps rows', () => {
    const db = openAtVersion50();
    try {
      db.prepare(
        `INSERT INTO session_organization (workspace_root, session_id, updated_at)
         VALUES (?, 'session-1', 1)`,
      ).run(WS);
      expect(() => db.exec(sql)).not.toThrow();
      expect(count(db, 'session_organization')).toBe(1);
    } finally {
      db.close();
    }
  });

  it('re-run is a no-op via the runner ledger', async () => {
    const db = openAtVersion49();
    try {
      const runner = new SqliteMigrationRunner(
        db as unknown as SqliteDatabase,
        fakeLogger,
      );
      const migration50 = MIGRATIONS.filter((m) => m.version === 50);

      const first = await runner.applyAll(migration50);
      expect(first.appliedVersions).toEqual([50]);
      expect(first.finalVersion).toBe(50);

      db.prepare(
        `INSERT INTO session_organization (workspace_root, session_id, updated_at)
         VALUES (?, 'session-1', 1)`,
      ).run(WS);

      const second = await runner.applyAll(migration50);
      expect(second.appliedVersions).toEqual([]);
      expect(second.skippedVersions).toEqual([50]);
      expect(count(db, 'session_organization')).toBe(1);
    } finally {
      db.close();
    }
  });
});
