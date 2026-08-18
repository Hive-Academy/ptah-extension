/**
 * Migration 0031 — applied onto a real 0029-shaped table.
 *
 * Two failures are guarded here, and both only ever surface at RUNTIME on a
 * user's existing database:
 *
 *  1. `ALTER TABLE ... ADD COLUMN ... NOT NULL` is legal in SQLite only when a
 *     default is supplied. Get it wrong and the migration throws on the first
 *     workspace that already has task rows — never on an empty dev machine.
 *  2. `ADD COLUMN IF NOT EXISTS` does not exist in SQLite, so re-running this
 *     migration WOULD throw. The `schema_migrations` ledger is what makes that
 *     unreachable, and the last test proves the ledger actually does it rather
 *     than assuming so — the same proof 0028 carries for the same reason.
 *
 * The native-module probe follows the house pattern: skip rather than fake.
 * A stubbed SQLite would not be testing SQLite's DDL rules, which is the whole
 * point of this file.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { Logger } from '@ptah-extension/vscode-core';
import { sql as sql0029TaskSpecs } from './0029_task_specs';
import { sql as sql0031TaskSpecsMetadata } from './0031_task_specs_metadata';
import { MIGRATIONS } from './index';
import { SqliteMigrationRunner } from '../migration-runner';
import type { SqliteDatabase } from '../sqlite-connection.service';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number };
  };
  close(): void;
}

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0031-test-'));
  return path.join(dir, 'ptah.db');
}

const fakeLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

describe('migration 0031_task_specs_metadata — registry entry', () => {
  it('is registered as version 31, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 31);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0031_task_specs_metadata');
    expect(entry?.sql).toBe(sql0031TaskSpecsMetadata);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once and follows 30 with no gap', () => {
    expect(MIGRATIONS.filter((m) => m.version === 31)).toHaveLength(1);
    expect(MIGRATIONS.map((m) => m.version)).toContain(30);
    // 0031 is no longer the tail — TASK_2026_180 appended 0032. The invariant
    // that survives is "31 exists exactly once and 30 precedes it"; the highest
    // version is asserted by whichever migration is currently last.
    expect(MIGRATIONS.map((m) => m.version)).toContain(32);
  });

  it('carries STATIC SQL and does not repurpose the reserved `claim` column', () => {
    // The ESLint and Semgrep rules target the SOURCE; this asserts the shipped
    // string, which is what actually reaches the database.
    expect(sql0031TaskSpecsMetadata).not.toContain('${');
    expect(sql0031TaskSpecsMetadata).not.toContain('claim');
  });
});

describe('migration 0031_task_specs_metadata — behavior (skipped without native)', () => {
  let nativeAvailable = false;
  try {
    require.resolve('better-sqlite3');
    const Database = require('better-sqlite3') as new (file: string) => {
      close(): void;
    };
    const probe = new Database(':memory:');
    probe.close();
    nativeAvailable = true;
  } catch {
    nativeAvailable = false;
  }

  const maybe = nativeAvailable ? it : it.skip;

  function openDb(): DatabaseShape {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    return new Database(makeTempDbPath());
  }

  /** Insert one row using ONLY the 0029 column set. */
  function seedLegacyRow(db: DatabaseShape): void {
    db.prepare(
      `INSERT INTO task_specs (
         workspace_root, folder_name, task_id, status, type, title,
         depends_on, created_at, updated_at, frontmatter_valid,
         validation_issues, last_indexed_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      'd:/tmp/ws',
      'TASK_2026_001',
      'TASK_2026_001',
      'backlog',
      'FEATURE',
      'A task that predates the metadata columns',
      '["TASK_2026_002"]',
      '2026-07-10T00:00:00.000Z',
      '2026-07-10T00:00:00.000Z',
      1,
      '[]',
      1,
    );
  }

  maybe('adds five columns with the declared types and nullability', () => {
    const db = openDb();
    try {
      db.exec(sql0029TaskSpecs);
      expect(() => db.exec(sql0031TaskSpecsMetadata)).not.toThrow();

      const cols = db.prepare('PRAGMA table_info(task_specs)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));

      // The three array columns mirror what `depends_on` established in 0029:
      // NOT NULL with an empty-JSON-array default, so the store's
      // `parseJsonArray` handles all four identically.
      for (const name of ['labels', 'duplicates', 'relates_to']) {
        const col = byName.get(name);
        expect(col).toBeDefined();
        expect(col?.type).toBe('TEXT');
        expect(col?.notnull).toBe(1);
        expect(col?.dflt_value).toBe(`'[]'`);
      }

      // The two scalars are nullable with no default — absent means absent,
      // and an empty string would be a second way to say the same thing.
      for (const name of ['estimate', 'parent']) {
        const col = byName.get(name);
        expect(col).toBeDefined();
        expect(col?.type).toBe('TEXT');
        expect(col?.notnull).toBe(0);
        expect(col?.dflt_value).toBeNull();
      }
    } finally {
      db.close();
    }
  });

  maybe('leaves PRE-EXISTING 0029-era rows intact, with the defaults', () => {
    const db = openDb();
    try {
      db.exec(sql0029TaskSpecs);
      seedLegacyRow(db);

      db.exec(sql0031TaskSpecsMetadata);

      const row = db
        .prepare('SELECT * FROM task_specs WHERE folder_name = ?')
        .get('TASK_2026_001') as Record<string, unknown>;

      // Nothing the old row carried may have moved. Forward-only, no backfill.
      expect(row['title']).toBe('A task that predates the metadata columns');
      expect(row['status']).toBe('backlog');
      expect(row['depends_on']).toBe('["TASK_2026_002"]');

      expect(row['labels']).toBe('[]');
      expect(row['duplicates']).toBe('[]');
      expect(row['relates_to']).toBe('[]');
      expect(row['estimate']).toBeNull();
      expect(row['parent']).toBeNull();
    } finally {
      db.close();
    }
  });

  maybe('creates the (workspace_root, parent) index', () => {
    const db = openDb();
    try {
      db.exec(sql0029TaskSpecs);
      db.exec(sql0031TaskSpecsMetadata);

      const indexes = db
        .prepare('PRAGMA index_list(task_specs)')
        .all() as Array<{ name: string }>;
      expect(indexes.some((i) => i.name === 'idx_task_specs_ws_parent')).toBe(
        true,
      );

      const indexCols = db
        .prepare('PRAGMA index_info(idx_task_specs_ws_parent)')
        .all() as Array<{ name: string }>;
      expect(indexCols.map((c) => c.name)).toEqual([
        'workspace_root',
        'parent',
      ]);
    } finally {
      db.close();
    }
  });

  maybe('accepts a row written with every new column', () => {
    const db = openDb();
    try {
      db.exec(sql0029TaskSpecs);
      db.exec(sql0031TaskSpecsMetadata);

      db.prepare(
        `INSERT INTO task_specs (
           workspace_root, folder_name, task_id, status, type, title,
           depends_on, labels, estimate, parent, duplicates, relates_to,
           created_at, updated_at, frontmatter_valid, validation_issues,
           last_indexed_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        'd:/tmp/ws',
        'TASK_2026_010',
        'TASK_2026_010',
        'in_progress',
        'FEATURE',
        'A task using every metadata column',
        '[]',
        '["licensing","needs:design"]',
        'M',
        'TASK_2026_001',
        '["TASK_2026_011"]',
        '["TASK_2026_012"]',
        null,
        null,
        1,
        '[]',
        2,
      );

      const row = db
        .prepare('SELECT * FROM task_specs WHERE folder_name = ?')
        .get('TASK_2026_010') as Record<string, unknown>;
      expect(row['labels']).toBe('["licensing","needs:design"]');
      expect(row['estimate']).toBe('M');
      expect(row['parent']).toBe('TASK_2026_001');
      expect(row['duplicates']).toBe('["TASK_2026_011"]');
      expect(row['relates_to']).toBe('["TASK_2026_012"]');
    } finally {
      db.close();
    }
  });

  maybe('re-run is a no-op via the runner ledger', async () => {
    // This is the assertion that stands in for `ADD COLUMN IF NOT EXISTS`,
    // which SQLite does not have. Without the ledger, a second run throws
    // "duplicate column name" and takes the whole startup with it.
    const db = openDb();
    try {
      db.exec(sql0029TaskSpecs);
      const runner = new SqliteMigrationRunner(
        db as unknown as SqliteDatabase,
        fakeLogger,
      );
      const migration31 = [
        {
          version: 31,
          name: '0031_task_specs_metadata',
          sql: sql0031TaskSpecsMetadata,
        },
      ];

      const first = await runner.applyAll(migration31);
      expect(first.appliedVersions).toEqual([31]);

      const second = await runner.applyAll(migration31);
      expect(second.appliedVersions).toEqual([]);
      expect(second.skippedVersions).toEqual([31]);
    } finally {
      db.close();
    }
  });
});
