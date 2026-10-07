/**
 * Migration 0053 — boot-scan failure ledger generation column and retry index
 * (TASK_2026_621). Real schema lineage on isolated in-memory databases; fails
 * instead of skipping when neither SQLite binding loads.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { sql } from './0053_memory_boot_scan_failure_generation';
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

/** The ledger's retry query (`BootScanFailureLedger` LIST_PENDING_SQL). */
const RETRY_QUERY = `SELECT session_id, workspace_root, session_path, attempt_count
  FROM memory_boot_scan_failures
 WHERE workspace_fingerprint = ? AND status = 'pending'
 ORDER BY last_failed_at, session_id
 LIMIT ?`;

describe('migration 0053_memory_boot_scan_failure_generation — registry and static SQL', () => {
  it('is registered once as version 53, plain static SQL, and is the highest version', () => {
    expect(MIGRATIONS.filter((m) => m.version === 53)).toEqual([
      { version: 53, name: '0053_memory_boot_scan_failure_generation', sql },
    ]);
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(53);
    expect(sql).not.toContain('${');
    expect(sql).not.toMatch(/\b(DELETE|UPDATE|INSERT|DROP TABLE)\b/i);
  });
});

describe('migration 0053_memory_boot_scan_failure_generation — behaviour', () => {
  const opener = resolveOpener();

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  function openAtVersion52(): DatabaseShape {
    if (!opener) throw new Error('No SQLite binding loaded');
    const db = opener();
    for (const migration of MIGRATIONS.filter((m) => m.version < 53)) {
      if (migration.sql) db.exec(migration.sql);
    }
    const insertApplied = db.prepare(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, 0)',
    );
    for (const m of MIGRATIONS.filter((x) => x.version < 53)) {
      insertApplied.run(m.version);
    }
    return db;
  }

  it('applies on an existing ledger, keeps its rows, and leaves their generation NULL', async () => {
    const db = openAtVersion52();
    try {
      db.prepare(
        `INSERT INTO memory_boot_scan_failures
           (workspace_fingerprint, session_id, workspace_root, session_path, first_failed_at, last_failed_at, status, give_up_reason)
         VALUES ('fp', 's1', '/ws', '/sessions/s1.jsonl', 10, 20, 'given_up', 'max-attempts')`,
      ).run();

      const result = await new SqliteMigrationRunner(
        db as unknown as SqliteDatabase,
        logger,
      ).applyAll(MIGRATIONS);
      expect(result.appliedVersions).toEqual([53]);

      expect(
        db
          .prepare(
            'SELECT session_id, status, session_mtime_ms FROM memory_boot_scan_failures',
          )
          .all(),
      ).toEqual([
        { session_id: 's1', status: 'given_up', session_mtime_ms: null },
      ]);
      const indexes = (
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'memory_boot_scan_failures' AND sql IS NOT NULL ORDER BY name`,
          )
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(indexes).toEqual(['idx_memory_boot_scan_failures_retry']);
    } finally {
      db.close();
    }
  });

  it('serves the retry query from the composite index with no separate sort', () => {
    const db = openAtVersion52();
    try {
      db.exec(sql);
      const plan = (
        db.prepare('EXPLAIN QUERY PLAN ' + RETRY_QUERY).all('fp', 20) as Array<{
          detail: string;
        }>
      ).map((r) => r.detail);
      expect(plan.join('|')).toContain(
        'USING INDEX idx_memory_boot_scan_failures_retry (workspace_fingerprint=? AND status=?)',
      );
      expect(plan.join('|')).not.toMatch(/TEMP B-TREE/);
    } finally {
      db.close();
    }
  });
});
