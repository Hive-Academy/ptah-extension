/**
 * Migration 0052 — memory boot-scan failure ledger (TASK_2026_621). Real
 * schema lineage on isolated in-memory databases; fails instead of skipping
 * when neither SQLite binding loads.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { sql } from './0052_memory_boot_scan_failures';
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

describe('migration 0052_memory_boot_scan_failures — registry and static SQL', () => {
  it('is registered once as version 52, plain static SQL', () => {
    expect(MIGRATIONS.filter((m) => m.version === 52)).toEqual([
      { version: 52, name: '0052_memory_boot_scan_failures', sql },
    ]);
    expect(sql).not.toContain('${');
    expect(sql).not.toMatch(/\b(DROP|DELETE|UPDATE|INSERT)\b/i);
  });

  it('keeps the bundled-version ratchet current', () => {
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(53);
  });
});

describe('migration 0052_memory_boot_scan_failures — behaviour', () => {
  const opener = resolveOpener();

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  function openAtVersion51(): DatabaseShape {
    if (!opener) throw new Error('No SQLite binding loaded');
    const db = opener();
    for (const migration of MIGRATIONS.filter((m) => m.version < 52)) {
      if (migration.sql) db.exec(migration.sql);
    }
    return db;
  }

  it('applies through the runner on an existing database without touching its data', async () => {
    const db = openAtVersion51();
    try {
      // An install at version 51: every earlier version is in the ledger.
      const insertApplied = db.prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, 0)',
      );
      for (const m of MIGRATIONS.filter((x) => x.version < 52)) {
        insertApplied.run(m.version);
      }
      db.prepare(
        `INSERT INTO boot_scan_state (pipeline, workspace_fingerprint, last_scanned_session_mtime, last_run_at)
         VALUES ('memory', 'fp', 123, 456)`,
      ).run();

      const result = await new SqliteMigrationRunner(
        db as unknown as SqliteDatabase,
        logger,
      ).applyAll(MIGRATIONS.filter((m) => m.version <= 52));
      expect(result.appliedVersions).toEqual([52]);

      expect(db.prepare('SELECT * FROM boot_scan_state').all()).toEqual([
        {
          pipeline: 'memory',
          workspace_fingerprint: 'fp',
          last_scanned_session_mtime: 123,
          last_run_at: 456,
        },
      ]);
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM memory_boot_scan_failures').get(),
      ).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it('defaults a new row to pending with one attempt and rejects an unknown status', () => {
    const db = openAtVersion51();
    try {
      db.exec(sql);
      db.prepare(
        `INSERT INTO memory_boot_scan_failures
           (workspace_fingerprint, session_id, workspace_root, session_path, first_failed_at, last_failed_at)
         VALUES ('fp', 's1', '/ws', '/sessions/s1.jsonl', 10, 10)`,
      ).run();
      expect(
        db
          .prepare(
            'SELECT status, attempt_count, give_up_reason FROM memory_boot_scan_failures',
          )
          .get(),
      ).toEqual({ status: 'pending', attempt_count: 1, give_up_reason: null });
      expect(() =>
        db
          .prepare(
            `INSERT INTO memory_boot_scan_failures
               (workspace_fingerprint, session_id, workspace_root, session_path, first_failed_at, last_failed_at, status)
             VALUES ('fp', 's2', '/ws', '/p', 1, 1, 'done')`,
          )
          .run(),
      ).toThrow(/CHECK/i);
    } finally {
      db.close();
    }
  });
});
