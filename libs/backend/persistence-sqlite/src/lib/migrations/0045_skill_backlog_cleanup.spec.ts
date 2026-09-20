/**
 * Migration 0045 — durable state for the one-time skill backlog cleanup.
 *
 * The behavioural tests use a fresh temp database and apply the complete base
 * SQL lineage through version 44 before this migration. They fail loudly when
 * neither SQLite binding loads; a skipped real-database spec is not evidence.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sql as sql0045SkillBacklogCleanup } from './0045_skill_backlog_cleanup';
import { MIGRATIONS } from './index';

describe('migration 0045_skill_backlog_cleanup — registry entry', () => {
  it('is registered as version 45, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((migration) => migration.version === 45);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0045_skill_backlog_cleanup');
    expect(entry?.sql).toBe(sql0045SkillBacklogCleanup);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once and follows version 44', () => {
    expect(
      MIGRATIONS.filter((migration) => migration.version === 45),
    ).toHaveLength(1);
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toContain(44);
    expect(Math.max(...versions)).toBe(46);
  });
});

describe('migration 0045_skill_backlog_cleanup — static SQL', () => {
  it('carries no template interpolation', () => {
    expect(sql0045SkillBacklogCleanup).not.toContain('${');
  });

  it('creates one guarded table and performs no data or index work', () => {
    const creates = sql0045SkillBacklogCleanup
      .split('\n')
      .filter((line) => /^CREATE\s+TABLE/i.test(line));
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatch(/IF NOT EXISTS/i);
    expect(creates[0]).toContain('skill_backlog_cleanup_state');
    expect(sql0045SkillBacklogCleanup).not.toMatch(/\bINSERT\b/i);
    expect(sql0045SkillBacklogCleanup).not.toMatch(/\bUPDATE\b/i);
    expect(sql0045SkillBacklogCleanup).not.toMatch(/\bDELETE\b/i);
    expect(sql0045SkillBacklogCleanup).not.toMatch(/\bCREATE\s+INDEX\b/i);
  });
});

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

type DbOpener = (file: string) => DatabaseShape;

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0045-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'cleanup.db');
}

describe('migration 0045_skill_backlog_cleanup — behaviour', () => {
  const opener = resolveOpener();

  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  function openAtVersion44(): DatabaseShape {
    if (!opener) {
      throw new Error(
        'No SQLite binding loaded (neither better-sqlite3 nor node:sqlite)',
      );
    }
    const db = opener(makeTempDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of [...MIGRATIONS]
      .filter((candidate) => candidate.version <= 44)
      .sort((a, b) => a.version - b.version)) {
      if (migration.sql) {
        db.exec(migration.sql);
      }
    }
    return db;
  }

  it('applies twice without changing the state row', () => {
    const db = openAtVersion44();
    try {
      db.exec(sql0045SkillBacklogCleanup);
      db.prepare(
        `INSERT INTO skill_backlog_cleanup_state
           (id, version, cutoff_created_at, started_at, last_outcome)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(1, 1, 1000, 1000, 'partial');

      expect(() => db.exec(sql0045SkillBacklogCleanup)).not.toThrow();
      expect(
        db
          .prepare(
            'SELECT id, version, cutoff_created_at, last_outcome FROM skill_backlog_cleanup_state',
          )
          .all(),
      ).toEqual([
        {
          id: 1,
          version: 1,
          cutoff_created_at: 1000,
          last_outcome: 'partial',
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('declares the complete state shape and zero-defaulted counters', () => {
    const db = openAtVersion44();
    try {
      db.exec(sql0045SkillBacklogCleanup);
      const columns = db
        .prepare('PRAGMA table_info(skill_backlog_cleanup_state)')
        .all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>;
      const byName = new Map(columns.map((column) => [column.name, column]));
      expect(columns.map((column) => column.name)).toEqual([
        'id',
        'version',
        'cutoff_created_at',
        'cursor_created_at',
        'cursor_id',
        'started_at',
        'finished_at',
        'last_run_at',
        'last_outcome',
        'last_reason',
        'examined',
        'kept_evidence',
        'kept_verdict',
        'kept_degraded_verdict',
        'rejected_no_evidence',
        'rejected_transcript_unreadable',
        'invocations_deleted',
      ]);
      expect(byName.get('id')?.pk).toBe(1);

      for (const name of ['version', 'cutoff_created_at', 'started_at']) {
        expect(byName.get(name)).toMatchObject({
          notnull: 1,
          dflt_value: null,
        });
      }

      for (const name of [
        'cursor_created_at',
        'cursor_id',
        'finished_at',
        'last_run_at',
        'last_outcome',
        'last_reason',
      ]) {
        expect(byName.get(name)).toMatchObject({
          notnull: 0,
          dflt_value: null,
        });
      }

      for (const name of [
        'examined',
        'kept_evidence',
        'kept_verdict',
        'kept_degraded_verdict',
        'rejected_no_evidence',
        'rejected_transcript_unreadable',
        'invocations_deleted',
      ]) {
        expect(byName.get(name)).toMatchObject({
          type: 'INTEGER',
          notnull: 1,
          dflt_value: '0',
        });
      }
    } finally {
      db.close();
    }
  });

  it('rejects id = 2 through the single-row CHECK', () => {
    const db = openAtVersion44();
    try {
      db.exec(sql0045SkillBacklogCleanup);
      expect(() =>
        db
          .prepare(
            `INSERT INTO skill_backlog_cleanup_state
               (id, version, cutoff_created_at, started_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(2, 1, 1000, 1000),
      ).toThrow(/CHECK/i);
    } finally {
      db.close();
    }
  });
});
