/**
 * Unit tests for SqliteMigrationRunner.
 *
 * Uses an in-memory FakeSqliteDatabase so the suite runs without
 * better-sqlite3 native bindings — this matches the Track 0 exit
 * criteria (tests must pass before tracks 1–4 install deps).
 */
import { SqliteMigrationRunner } from './migration-runner';
import type { Migration } from './migrations';
import { FakeSqliteDatabase } from './testing/fake-sqlite-database';
import { createMockLogger } from './testing/mock-logger';

const FIXTURE_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: '0001_init',
    sql: 'CREATE TABLE t1 (id INTEGER PRIMARY KEY);',
  },
  {
    version: 2,
    name: '0002_add_t2',
    sql: 'CREATE TABLE t2 (id INTEGER PRIMARY KEY);',
  },
  {
    version: 3,
    name: '0003_add_t3',
    sql: 'CREATE TABLE t3 (id INTEGER PRIMARY KEY);',
  },
];

describe('SqliteMigrationRunner', () => {
  it('applies all migrations on a fresh DB', () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());

    const result = runner.applyAll(FIXTURE_MIGRATIONS);

    expect(result.appliedVersions).toEqual([1, 2, 3]);
    expect(result.skippedVersions).toEqual([]);
    expect(result.finalVersion).toBe(3);
    expect(db.tables.has('t1')).toBe(true);
    expect(db.tables.has('t2')).toBe(true);
    expect(db.tables.has('t3')).toBe(true);
    expect(runner.readAppliedVersions()).toEqual(new Set([1, 2, 3]));
  });

  it('is a no-op on second run', () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());

    runner.applyAll(FIXTURE_MIGRATIONS);
    const second = runner.applyAll(FIXTURE_MIGRATIONS);

    expect(second.appliedVersions).toEqual([]);
    expect(second.skippedVersions).toEqual([1, 2, 3]);
    expect(second.finalVersion).toBe(3);
  });

  it('applies only the new migration when one is added later', () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());

    runner.applyAll(FIXTURE_MIGRATIONS.slice(0, 2));
    expect(runner.readAppliedVersions()).toEqual(new Set([1, 2]));

    const result = runner.applyAll(FIXTURE_MIGRATIONS);
    expect(result.appliedVersions).toEqual([3]);
    expect(result.skippedVersions).toEqual([1, 2]);
  });

  it('refuses to start when the DB version exceeds the bundled max', () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    // Pre-seed schema_migrations with a "future" version row.
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );
    db.prepare(
      'INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)',
    ).run(99, Date.now());

    expect(() => runner.applyAll(FIXTURE_MIGRATIONS)).toThrow(
      /version 99.*bundles up to 3/,
    );
  });

  it('rolls back a failing migration and leaves earlier ones intact', () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    const broken: Migration[] = [
      FIXTURE_MIGRATIONS[0],
      { version: 2, name: 'broken', sql: 'NOT VALID SQL;' },
    ];

    expect(() => runner.applyAll(broken)).toThrow(/migration 2.*failed/);
    expect(runner.readAppliedVersions()).toEqual(new Set([1]));
  });

  it('returns an empty result for an empty migration list', () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());

    const result = runner.applyAll([]);
    expect(result.appliedVersions).toEqual([]);
    expect(result.finalVersion).toBe(0);
  });

  it('records applied_at timestamps as epoch ms integers', () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    const before = Date.now();

    runner.applyAll(FIXTURE_MIGRATIONS);

    const rows = db
      .prepare('SELECT version, applied_at FROM schema_migrations')
      .all() as Array<{ version: number; applied_at: number }>;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(typeof row.applied_at).toBe('number');
      expect(row.applied_at).toBeGreaterThanOrEqual(before);
    }
  });
});
