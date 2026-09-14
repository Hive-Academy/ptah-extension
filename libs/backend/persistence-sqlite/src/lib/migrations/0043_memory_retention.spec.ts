/**
 * Migration 0043 — memory retention ledger and run record (TASK_2026_440).
 *
 * Two constraints carry this migration, and each is asserted from both sides:
 *
 * - `memory_retention_state` is single-row: `id = 2` is REJECTED (a plain
 *   `id INTEGER PRIMARY KEY` would accept it) and two upserts at `id = 1`
 *   leave ONE row (a keyless table would accumulate two).
 * - `observation_quarantine` is one summary per `(session_id, kind, reason)`:
 *   a duplicate triple VIOLATES UNIQUE, while a different `reason` for the same
 *   session and kind is accepted — which is what lets the retention store
 *   upsert into an existing summary instead of appending a row per batch.
 *
 * The behavioural half applies EVERY bundled migration up to 42 first (base
 * `sql` only, the no-sqlite-vec path), so the DDL is proved against the real
 * schema lineage. Unlike older migration specs this file does NOT skip when no
 * SQLite binding loads: Node 24 always ships `node:sqlite`, so a missing opener
 * is an environment fault that must fail loudly, not a green run of nothing.
 *
 * Every database opened here is a fresh temp file. Nothing in this file may
 * ever touch `~/.ptah/state/ptah.sqlite`.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0043MemoryRetention } from './0043_memory_retention';
import { MIGRATIONS } from './index';

describe('migration 0043_memory_retention — registry entry', () => {
  it('is registered as version 43, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 43);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0043_memory_retention');
    expect(entry?.sql).toBe(sql0043MemoryRetention);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once and follows 42 with no gap', () => {
    expect(MIGRATIONS.filter((m) => m.version === 43)).toHaveLength(1);
    expect(MIGRATIONS.map((m) => m.version)).toContain(42);
  });

  it('is the highest bundled version', () => {
    // The ratchet: this moves forward with every appended migration.
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(43);
  });
});

describe('migration 0043_memory_retention — static SQL', () => {
  it('carries no template interpolation', () => {
    expect(sql0043MemoryRetention).not.toContain('${');
  });

  it('creates exactly two tables and one index, all guarded by IF NOT EXISTS', () => {
    const lines = sql0043MemoryRetention.split('\n');
    const tables = lines.filter((line) => /^CREATE\s+TABLE/i.test(line));
    const indexes = lines.filter((line) => /^CREATE\s+INDEX/i.test(line));
    expect(tables).toHaveLength(2);
    expect(indexes).toHaveLength(1);
    for (const line of [...tables, ...indexes]) {
      expect(line).toMatch(/IF NOT EXISTS/i);
    }
    expect(tables[0]).toContain('observation_quarantine');
    expect(tables[1]).toContain('memory_retention_state');
    expect(indexes[0]).toContain('idx_obs_quarantine_last');
  });

  it('never touches observation_queue and drops, inserts or rebuilds nothing', () => {
    // The boot-path cost of this migration must stay DDL on two empty tables.
    expect(sql0043MemoryRetention).not.toMatch(/\bobservation_queue\b/);
    expect(sql0043MemoryRetention).not.toMatch(/\bDROP\b/i);
    expect(sql0043MemoryRetention).not.toMatch(/\bINSERT\b/i);
    expect(sql0043MemoryRetention).not.toMatch(/\bUPDATE\b/i);
    expect(sql0043MemoryRetention).not.toMatch(/\bDELETE\b/i);
  });
});

// ── Behavioural half ────────────────────────────────────────────────────────

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

type DbOpener = (file: string) => DatabaseShape;

/** better-sqlite3 when its ABI loads under Jest, `node:sqlite` otherwise. */
function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    new Database(':memory:').close();
    return (file) => new Database(file);
  } catch {
    // Falls through to the built-in binding.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    new DatabaseSync(':memory:').close();
    return (file) => new DatabaseSync(file);
  } catch {
    return null;
  }
}

const tempDirs: string[] = [];

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0043-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'retention.db');
}

const STATE_UPSERT = `INSERT INTO memory_retention_state (id, last_started_at, last_outcome)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_started_at = excluded.last_started_at,
         last_outcome = excluded.last_outcome`;

const LEDGER_INSERT = `INSERT INTO observation_quarantine (
         session_id, kind, reason, row_count, payload_bytes,
         oldest_captured_at, newest_captured_at,
         first_quarantined_at, last_quarantined_at
       ) VALUES (?, ?, ?, 1, 10, 100, 200, 300, 300)`;

describe('migration 0043_memory_retention — behaviour', () => {
  const opener = resolveOpener();

  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  function openAtVersion42(): DatabaseShape {
    if (!opener) {
      throw new Error(
        'No SQLite binding loaded (neither better-sqlite3 nor node:sqlite)',
      );
    }
    const db = opener(makeTempDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of [...MIGRATIONS]
      .filter((m) => m.version <= 42)
      .sort((a, b) => a.version - b.version)) {
      if (migration.sql) {
        db.exec(migration.sql);
      }
    }
    return db;
  }

  it('applies cleanly onto a database at version 42, and a second apply is a no-op that keeps rows', () => {
    const db = openAtVersion42();
    try {
      expect(() => db.exec(sql0043MemoryRetention)).not.toThrow();
      db.prepare(STATE_UPSERT).run(1000, 'completed');
      db.prepare(LEDGER_INSERT).run('s1', 'tool-use', 'stuck-unprocessed');

      expect(() => db.exec(sql0043MemoryRetention)).not.toThrow();

      expect(
        db
          .prepare('SELECT id, last_started_at FROM memory_retention_state')
          .all(),
      ).toEqual([{ id: 1, last_started_at: 1000 }]);
      expect(
        db.prepare('SELECT session_id FROM observation_quarantine').all(),
      ).toEqual([{ session_id: 's1' }]);
    } finally {
      db.close();
    }
  });

  it('memory_retention_state rejects id = 2 and keeps exactly one row at id = 1', () => {
    const db = openAtVersion42();
    try {
      db.exec(sql0043MemoryRetention);
      expect(() =>
        db.prepare('INSERT INTO memory_retention_state (id) VALUES (2)').run(),
      ).toThrow();

      const upsert = db.prepare(STATE_UPSERT);
      upsert.run(1000, 'completed');
      upsert.run(2000, 'partial');

      const rows = db
        .prepare(
          'SELECT id, last_started_at, last_outcome, processed_purged, backlog_remaining FROM memory_retention_state',
        )
        .all();
      // The counters default to 0 so an upsert naming none of them still
      // leaves readable numbers.
      expect(rows).toEqual([
        {
          id: 1,
          last_started_at: 2000,
          last_outcome: 'partial',
          processed_purged: 0,
          backlog_remaining: 0,
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('observation_quarantine rejects a duplicate (session_id, kind, reason) and accepts a different reason', () => {
    const db = openAtVersion42();
    try {
      db.exec(sql0043MemoryRetention);
      const insert = db.prepare(LEDGER_INSERT);
      insert.run('s1', 'tool-use', 'stuck-unprocessed');

      expect(() => insert.run('s1', 'tool-use', 'stuck-unprocessed')).toThrow(
        /UNIQUE/i,
      );
      expect(() => insert.run('s1', 'tool-use', 'other-reason')).not.toThrow();
      expect(() =>
        insert.run('s1', 'prompt', 'stuck-unprocessed'),
      ).not.toThrow();

      expect(
        db.prepare('SELECT COUNT(*) AS n FROM observation_quarantine').all(),
      ).toEqual([{ n: 3 }]);
    } finally {
      db.close();
    }
  });

  it('declares the ledger columns NOT NULL and the prune index on last_quarantined_at', () => {
    const db = openAtVersion42();
    try {
      db.exec(sql0043MemoryRetention);
      const cols = db
        .prepare('PRAGMA table_info(observation_quarantine)')
        .all() as Array<{ name: string; notnull: number; pk: number }>;
      for (const col of cols.filter((c) => c.name !== 'id')) {
        expect({ name: col.name, notnull: col.notnull }).toEqual({
          name: col.name,
          notnull: 1,
        });
      }
      const indexCols = db
        .prepare("PRAGMA index_info('idx_obs_quarantine_last')")
        .all() as Array<{ name: string }>;
      expect(indexCols.map((c) => c.name)).toEqual(['last_quarantined_at']);
    } finally {
      db.close();
    }
  });
});
