/**
 * Migration 0042 — the database integrity-check record (TASK_2026_380 B1).
 *
 * THE POINT OF THIS FILE IS THE SINGLE-ROW KEY, not "the table exists".
 *
 * `id INTEGER PRIMARY KEY CHECK (id = 1)` is what makes a second record
 * impossible. The record describes THE FILE IT LIVES IN, so there is exactly
 * one of it; a plain unconstrained table would let a writer that forgot the
 * constant accumulate a row per check, and `IntegrityCheckStateStore.read` —
 * which does a bare `SELECT … LIMIT 1` — would then answer with whichever row
 * SQLite handed back first. That reads as a stale verdict and skips a check
 * that was due, the one direction this whole subsystem must never fail in.
 *
 * The behavioural half therefore asserts BOTH halves of the constraint, because
 * either one alone passes against a wrong schema: that `id = 2` is REJECTED
 * (a plain `id INTEGER PRIMARY KEY` table passes without the CHECK), and that
 * writing twice at `id = 1` leaves ONE row carrying the second write (a table
 * with no primary key at all would accumulate two).
 *
 * Idempotency is asserted by applying the SQL twice, because `CREATE TABLE IF
 * NOT EXISTS` is the whole of the migration and a second apply must be a no-op
 * that also preserves the row already written.
 *
 * The behavioural half applies EVERY bundled migration up to 41 first, so the
 * acceptance condition is proved against the real schema lineage rather than a
 * hand-picked subset — the `0040` / `0041` shape, for the same reasons,
 * including the `better-sqlite3` → `node:sqlite` opener fallback (the repo's
 * `better-sqlite3` is rebuilt against Electron's ABI by postinstall and cannot
 * load in the Jest runner).
 *
 * Every database opened here is `:memory:` or a fresh temp file. Nothing in
 * this file may ever touch `~/.ptah/state/ptah.sqlite`: a boot migrates
 * whatever file it opens and migrations are forward-only, so writing 42 into
 * the real database would leave an older installed build unable to open it.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0042DbIntegrityCheckState } from './0042_db_integrity_check_state';
import { MIGRATIONS } from './index';

describe('migration 0042_db_integrity_check_state — registry entry', () => {
  it('is registered as version 42, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 42);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0042_db_integrity_check_state');
    expect(entry?.sql).toBe(sql0042DbIntegrityCheckState);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once and follows 41 with no gap', () => {
    expect(MIGRATIONS.filter((m) => m.version === 42)).toHaveLength(1);
    expect(MIGRATIONS.map((m) => m.version)).toContain(41);
  });

  it('is the highest bundled version', () => {
    // Migrations are forward-only and APPENDED, never inserted. This assertion
    // tracks the current highest version and moves forward with every appended
    // migration — that movement is the ratchet, not a failure (0028 / 0030 /
    // 0038 / 0039 / 0040 / 0041 carry the identical test for the same reason).
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(42);
  });
});

describe('migration 0042_db_integrity_check_state — static SQL', () => {
  it('carries no template interpolation', () => {
    // The ESLint and Semgrep rules target the SOURCE; this asserts the shipped
    // string, which is what actually reaches the database.
    expect(sql0042DbIntegrityCheckState).not.toContain('${');
  });

  it('creates exactly one table, guarded by IF NOT EXISTS', () => {
    const creates = sql0042DbIntegrityCheckState
      .split('\n')
      .filter((line) => /^CREATE\s+TABLE/i.test(line));
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatch(/IF NOT EXISTS/i);
    expect(creates[0]).toContain('db_integrity_check_state');
  });

  it('drops nothing and rebuilds nothing', () => {
    // A rebuild is not re-runnable and this migration has nothing to rebuild:
    // the table is new, so `IF NOT EXISTS` is the whole of it.
    expect(sql0042DbIntegrityCheckState).not.toMatch(/\bDROP\b/i);
    expect(sql0042DbIntegrityCheckState).not.toMatch(/\bINSERT\b/i);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0042-test-'));
  return path.join(dir, 'ptah.db');
}

/** The exact upsert `IntegrityCheckStateStore.write` runs. */
const STATE_UPSERT = `INSERT INTO db_integrity_check_state (
         id, checked_at, quick_check_ok, foreign_key_violations,
         duration_ms, page_count, detail
       ) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         checked_at = excluded.checked_at,
         quick_check_ok = excluded.quick_check_ok,
         foreign_key_violations = excluded.foreign_key_violations,
         duration_ms = excluded.duration_ms,
         page_count = excluded.page_count,
         detail = excluded.detail`;

describe('migration 0042_db_integrity_check_state — behaviour (skipped without any SQLite binding)', () => {
  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;

  /**
   * Brings a fresh database all the way to version 41 the way the runner does
   * on a machine without sqlite-vec: every bundled migration in ascending
   * order, applying only the base `sql`.
   */
  function openAtVersion41(): DatabaseShape {
    const db = (opener as DbOpener)(makeTempDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of [...MIGRATIONS]
      .filter((m) => m.version <= 41)
      .sort((a, b) => a.version - b.version)) {
      if (migration.sql) {
        db.exec(migration.sql);
      }
    }
    return db;
  }

  maybe('applies cleanly onto a database already at version 41', () => {
    const db = openAtVersion41();
    try {
      expect(() => db.exec(sql0042DbIntegrityCheckState)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe(
    'applying it twice is safe and preserves the row already written',
    () => {
      const db = openAtVersion41();
      try {
        db.exec(sql0042DbIntegrityCheckState);
        db.prepare(STATE_UPSERT).run(1000, 1, 0, 1868, 256183, null);
        expect(() => db.exec(sql0042DbIntegrityCheckState)).not.toThrow();
        const rows = db
          .prepare('SELECT id, checked_at FROM db_integrity_check_state')
          .all() as Array<{ id: number; checked_at: number }>;
        expect(rows).toEqual([{ id: 1, checked_at: 1000 }]);
      } finally {
        db.close();
      }
    },
  );

  maybe('declares every data column NOT NULL except `detail`', () => {
    const db = openAtVersion41();
    try {
      db.exec(sql0042DbIntegrityCheckState);
      const cols = db
        .prepare('PRAGMA table_info(db_integrity_check_state)')
        .all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));

      // This is a NEW table with no pre-existing rows and no legacy INSERT to
      // break, so there is no unknown value to represent: "never checked" is
      // the ABSENCE of a row. A nullable `checked_at` would let a record exist
      // while saying nothing about when it was taken.
      for (const name of [
        'checked_at',
        'quick_check_ok',
        'foreign_key_violations',
        'duration_ms',
        'page_count',
      ]) {
        expect(byName.get(name)?.notnull).toBe(1);
        expect(byName.get(name)?.dflt_value).toBeNull();
        expect(byName.get(name)?.type).toBe('INTEGER');
      }

      // `detail` is the one genuinely unknown value: a clean `quick_check` has
      // nothing to say, and NULL says that without inventing an empty string.
      expect(byName.get('detail')?.notnull).toBe(0);
      expect(byName.get('detail')?.type).toBe('TEXT');

      expect(byName.get('id')?.pk).toBe(1);
    } finally {
      db.close();
    }
  });

  maybe('permits exactly one row, keyed at id = 1', () => {
    const db = openAtVersion41();
    try {
      db.exec(sql0042DbIntegrityCheckState);
      const upsert = db.prepare(STATE_UPSERT);

      // Both halves are needed. A plain `id INTEGER PRIMARY KEY` table passes
      // the second (the upsert re-writes the same key) but NOT the first;
      // a table with no key at all passes the first but not the second.
      expect(() =>
        db
          .prepare(
            'INSERT INTO db_integrity_check_state (id, checked_at, quick_check_ok, foreign_key_violations, duration_ms, page_count, detail) VALUES (2, 1, 1, 0, 1, 1, NULL)',
          )
          .run(),
      ).toThrow();

      upsert.run(1000, 1, 0, 1868, 256183, null);
      upsert.run(2000, 0, 3, 42, 256183, 'quick_check reported 1 page error');

      const rows = db
        .prepare('SELECT * FROM db_integrity_check_state')
        .all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        id: 1,
        checked_at: 2000,
        quick_check_ok: 0,
        foreign_key_violations: 3,
        duration_ms: 42,
        page_count: 256183,
        detail: 'quick_check reported 1 page error',
      });
    } finally {
      db.close();
    }
  });
});
