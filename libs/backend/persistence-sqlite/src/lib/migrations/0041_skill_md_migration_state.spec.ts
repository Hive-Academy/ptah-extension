/**
 * Migration 0041 — the SKILL.md content-migration marker (TASK_2026_331 B4).
 *
 * THE POINT OF THIS FILE IS THE KEY, not "the table exists".
 *
 * `skills_root` is the PRIMARY KEY, so the at-most-one constraint is PER ROOT.
 * A degenerate single-row table (`id INTEGER PRIMARY KEY CHECK (id = 1)`) would
 * pass any test that only asked whether the table and its two data columns
 * exist, and it would be wrong: the two roots are walked back to back, so a
 * shared row written after the first walk would claim the second was migrated
 * even when it failed. The behavioural half therefore asserts that two DIFFERENT
 * roots coexist as two rows AND that the same root written twice stays one row.
 * Either assertion alone passes against a degenerate schema — the first passes
 * against a plain unconstrained table, the second against the single-row form.
 *
 * Idempotency is asserted by applying the SQL twice, because `CREATE TABLE IF
 * NOT EXISTS` is the whole of the migration and a second apply must be a no-op
 * that also preserves the rows already written.
 *
 * The behavioural half applies EVERY bundled migration up to 40 first, so the
 * acceptance condition is proved against the real schema lineage rather than a
 * hand-picked subset — the `0040` spec's shape, for the same reasons, including
 * its `better-sqlite3` → `node:sqlite` opener fallback (the repo's
 * `better-sqlite3` is rebuilt against Electron's ABI by postinstall and cannot
 * load in the Jest runner).
 */
import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0041SkillMdMigrationState } from './0041_skill_md_migration_state';
import { MIGRATIONS } from './index';

describe('migration 0041_skill_md_migration_state — registry entry', () => {
  it('is registered as version 41, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 41);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0041_skill_md_migration_state');
    expect(entry?.sql).toBe(sql0041SkillMdMigrationState);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once and follows 40 with no gap', () => {
    expect(MIGRATIONS.filter((m) => m.version === 41)).toHaveLength(1);
    expect(MIGRATIONS.map((m) => m.version)).toContain(40);
  });

  it('is the highest bundled version', () => {
    // Migrations are forward-only and APPENDED, never inserted. This assertion
    // tracks the current highest version and moves forward with every appended
    // migration — that movement is the ratchet, not a failure (0028 / 0038 /
    // 0039 / 0040 carry the identical test for the same reason).
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(41);
  });
});

describe('migration 0041_skill_md_migration_state — static SQL', () => {
  it('carries no template interpolation', () => {
    // The ESLint and Semgrep rules target the SOURCE; this asserts the shipped
    // string, which is what actually reaches the database.
    expect(sql0041SkillMdMigrationState).not.toContain('${');
  });

  it('creates exactly one table, guarded by IF NOT EXISTS', () => {
    const creates = sql0041SkillMdMigrationState
      .split('\n')
      .filter((line) => /^CREATE\s+TABLE/i.test(line));
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatch(/IF NOT EXISTS/i);
    expect(creates[0]).toContain('skill_md_migration_state');
  });

  it('adds no directory-mtime column', () => {
    // A directory's mtime does not change when a file inside a SUBdirectory is
    // edited, so a marker keyed on it would confidently skip real work. The
    // only decision inputs are the transform version and the wall-clock age.
    expect(sql0041SkillMdMigrationState).not.toMatch(/mtime/i);
  });
});

// ── Behavioural half ────────────────────────────────────────────────────────

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
}

type DbOpener = (file: string) => DatabaseShape;

function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    const probe = new Database(':memory:');
    probe.close();
    return (file) => new Database(file);
  } catch {
    // Falls through to the built-in binding.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    const probe = new DatabaseSync(':memory:');
    probe.close();
    return (file) => new DatabaseSync(file);
  } catch {
    return null;
  }
}

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0041-test-'));
  return path.join(dir, 'ptah.db');
}

/** The exact upsert `SkillMdMigrationStateStore.write` runs. */
const MARKER_UPSERT = `INSERT INTO skill_md_migration_state (
         skills_root, migration_version, last_scan_at
       ) VALUES (?, ?, ?)
       ON CONFLICT(skills_root) DO UPDATE SET
         migration_version = excluded.migration_version,
         last_scan_at = excluded.last_scan_at`;

describe('migration 0041_skill_md_migration_state — behaviour (skipped without any SQLite binding)', () => {
  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;

  /**
   * Brings a fresh database all the way to version 40 the way the runner does
   * on a machine without sqlite-vec: every bundled migration in ascending
   * order, applying only the base `sql`.
   */
  function openAtVersion40(): DatabaseShape {
    const db = (opener as DbOpener)(makeTempDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of [...MIGRATIONS]
      .filter((m) => m.version <= 40)
      .sort((a, b) => a.version - b.version)) {
      if (migration.sql) {
        db.exec(migration.sql);
      }
    }
    return db;
  }

  maybe('applies cleanly onto a database already at version 40', () => {
    const db = openAtVersion40();
    try {
      expect(() => db.exec(sql0041SkillMdMigrationState)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe(
    'applying it twice is safe and preserves the rows already written',
    () => {
      const db = openAtVersion40();
      try {
        db.exec(sql0041SkillMdMigrationState);
        db.prepare(MARKER_UPSERT).run('C:\\Users\\a\\.ptah\\skills', 1, 1000);
        expect(() => db.exec(sql0041SkillMdMigrationState)).not.toThrow();
        const rows = db
          .prepare('SELECT skills_root FROM skill_md_migration_state')
          .all() as Array<{ skills_root: string }>;
        expect(rows.map((r) => r.skills_root)).toEqual([
          'C:\\Users\\a\\.ptah\\skills',
        ]);
      } finally {
        db.close();
      }
    },
  );

  maybe('declares both data columns NOT NULL with no default', () => {
    const db = openAtVersion40();
    try {
      db.exec(sql0041SkillMdMigrationState);
      const cols = db
        .prepare('PRAGMA table_info(skill_md_migration_state)')
        .all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));

      // Unlike 0033/0036/0040 this is a NEW table with no pre-existing rows and
      // no legacy INSERT to break, so there is no unknown value to represent:
      // "never scanned" is the ABSENCE of a row. A nullable `last_scan_at`
      // would let a marker exist while saying nothing about when it was taken.
      expect(byName.get('migration_version')?.notnull).toBe(1);
      expect(byName.get('migration_version')?.dflt_value).toBeNull();
      expect(byName.get('last_scan_at')?.notnull).toBe(1);
      expect(byName.get('last_scan_at')?.dflt_value).toBeNull();
      expect(byName.get('skills_root')?.pk).toBe(1);
    } finally {
      db.close();
    }
  });

  maybe('keys the at-most-one constraint PER ROOT, not per table', () => {
    const db = openAtVersion40();
    try {
      db.exec(sql0041SkillMdMigrationState);
      const upsert = db.prepare(MARKER_UPSERT);

      const activeRoot = 'C:\\Users\\a\\.ptah\\skills';
      const candidatesRoot = 'C:\\Users\\a\\.ptah\\skills\\_candidates';

      // Both halves are needed. A plain unconstrained table passes the first;
      // a single-row `CHECK (id = 1)` table passes the second. Only the pair
      // pins "one row per root".
      upsert.run(activeRoot, 1, 1000);
      upsert.run(candidatesRoot, 1, 2000);
      expect(
        (
          db
            .prepare(
              'SELECT skills_root FROM skill_md_migration_state ORDER BY skills_root',
            )
            .all() as Array<{ skills_root: string }>
        ).map((r) => r.skills_root),
      ).toEqual([activeRoot, candidatesRoot]);

      // Re-writing the SAME root replaces its row rather than accumulating.
      upsert.run(activeRoot, 2, 3000);
      const rows = db
        .prepare(
          'SELECT skills_root, migration_version, last_scan_at FROM skill_md_migration_state ORDER BY skills_root',
        )
        .all() as Array<{
        skills_root: string;
        migration_version: number;
        last_scan_at: number;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        skills_root: activeRoot,
        migration_version: 2,
        last_scan_at: 3000,
      });
      // The candidates root is UNTOUCHED by the active root's rewrite. This is
      // the partial-failure property the per-root key exists for.
      expect(rows[1]).toEqual({
        skills_root: candidatesRoot,
        migration_version: 1,
        last_scan_at: 2000,
      });
    } finally {
      db.close();
    }
  });
});
