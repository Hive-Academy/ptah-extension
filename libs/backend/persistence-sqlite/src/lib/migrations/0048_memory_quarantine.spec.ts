/**
 * Migration 0048 — reversible memory quarantine columns. Real schema lineage on
 * isolated in-memory databases; this spec never opens a user database or a
 * pre-migration snapshot. It fails instead of skipping when neither SQLite
 * binding loads.
 */
import 'reflect-metadata';
import { sql } from './0048_memory_quarantine';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
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

describe('migration 0048_memory_quarantine — registry and static SQL', () => {
  it('is registered once as plain, static SQL that only adds two columns', () => {
    expect(MIGRATIONS.filter((m) => m.version === 48)).toEqual([
      { version: 48, name: '0048_memory_quarantine', sql },
    ]);
    expect(sql).not.toContain('${');
    expect(sql.match(/ALTER TABLE memories ADD COLUMN/g)).toHaveLength(2);
    expect(sql).not.toMatch(
      /\b(CREATE|DROP|INSERT|UPDATE|DELETE|SELECT|DEFAULT)\b/i,
    );
  });
});

describe('migration 0048_memory_quarantine — behaviour', () => {
  const opener = resolveOpener();

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  function openAtVersion47(): DatabaseShape {
    if (!opener) {
      throw new Error(
        'No SQLite binding loaded (neither better-sqlite3 nor node:sqlite)',
      );
    }
    const db = opener();
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of MIGRATIONS.filter((m) => m.version < 48)) {
      if (migration.sql) db.exec(migration.sql);
    }
    return db;
  }

  it('adds nullable columns and leaves pre-existing rows active (NULL)', () => {
    const db = openAtVersion47();
    try {
      db.prepare(
        `INSERT INTO memories (
           id, session_id, workspace_root, tier, kind, subject, content,
           created_at, updated_at, last_used_at
         ) VALUES (?, NULL, ?, 'recall', 'fact', 'subject', 'content', 1, 1, 1)`,
      ).run('named', '/ws');
      db.prepare(
        `INSERT INTO memories (
           id, session_id, workspace_root, tier, kind, subject, content,
           created_at, updated_at, last_used_at
         ) VALUES (?, NULL, NULL, 'recall', 'fact', 'subject', 'content', 1, 1, 1)`,
      ).run('no-workspace');

      db.exec(sql);

      const columns = db.prepare('PRAGMA table_info(memories)').all();
      expect(columns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'quarantined_at',
            type: 'INTEGER',
            notnull: 0,
            dflt_value: null,
          }),
          expect.objectContaining({
            name: 'quarantine_reason',
            type: 'TEXT',
            notnull: 0,
            dflt_value: null,
          }),
        ]),
      );
      expect(
        db
          .prepare(
            'SELECT id, quarantined_at, quarantine_reason FROM memories ORDER BY id',
          )
          .all(),
      ).toEqual([
        { id: 'named', quarantined_at: null, quarantine_reason: null },
        { id: 'no-workspace', quarantined_at: null, quarantine_reason: null },
      ]);
      // Exactly-once application belongs to the runner; replaying raw DDL is
      // deliberately not silently accepted.
      expect(() => db.exec(sql)).toThrow(/duplicate column/i);
    } finally {
      db.close();
    }
  });

  it('keeps the merge-candidate lookup on idx_memories_ws_normalized_subject with the quarantine predicate', () => {
    const db = openAtVersion47();
    try {
      db.exec(sql);

      // The WHERE clause of MemoryStore.findMergeCandidates plus the
      // quarantine predicate the store adds on top of this migration.
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT m.id, m.subject, m.content
             FROM memories m
            WHERE m.workspace_root IS ?
              AND m.subject IS NOT NULL
              AND TRIM(LOWER(m.subject)) IN (?, ?)
              AND m.quarantined_at IS NULL`,
        )
        .all('/ws', 'first-subject', 'second-subject') as Array<{
        detail: string;
      }>;

      expect(plan.map((row) => row.detail).join('\n')).toContain(
        'idx_memories_ws_normalized_subject',
      );
    } finally {
      db.close();
    }
  });
});
