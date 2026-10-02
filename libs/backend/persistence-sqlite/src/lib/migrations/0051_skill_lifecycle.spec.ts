/**
 * Migration 0051 — skill suggestion lineage and backlog purge marker.
 *
 * Real schema lineage on isolated in-memory or temp databases.
 * Fails loudly when neither SQLite binding loads.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sql as sql0051SkillLifecycle } from './0051_skill_lifecycle';
import { MIGRATIONS } from './index';

describe('migration 0051_skill_lifecycle — registry entry', () => {
  it('is registered as version 51, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((migration) => migration.version === 51);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0051_skill_lifecycle');
    expect(entry?.sql).toBe(sql0051SkillLifecycle);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once and follows version 49', () => {
    expect(
      MIGRATIONS.filter((migration) => migration.version === 51),
    ).toHaveLength(1);
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toContain(49);
    expect(Math.max(...versions)).toBe(51);
  });
});

describe('migration 0051_skill_lifecycle — static SQL', () => {
  it('carries no template interpolation', () => {
    expect(sql0051SkillLifecycle).not.toContain('${');
  });

  it('declares 3 alter statements and 1 create table without data mutations', () => {
    const alters = sql0051SkillLifecycle
      .split('\n')
      .filter((line) => /^\s*ALTER\s+TABLE/i.test(line));
    expect(alters).toHaveLength(3);
    for (const alter of alters) {
      expect(alter).toMatch(
        /ALTER\s+TABLE\s+skill_suggestions\s+ADD\s+COLUMN/i,
      );
    }

    const creates = sql0051SkillLifecycle
      .split('\n')
      .filter((line) => /^\s*CREATE\s+TABLE/i.test(line));
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatch(/IF NOT EXISTS\s+skill_backlog_purge_state/i);

    expect(sql0051SkillLifecycle).not.toMatch(/\bINSERT\b/i);
    expect(sql0051SkillLifecycle).not.toMatch(/\bUPDATE\b/i);
    expect(sql0051SkillLifecycle).not.toMatch(/\bDELETE\b/i);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0051-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'lifecycle.db');
}

describe('migration 0051_skill_lifecycle — behaviour', () => {
  const opener = resolveOpener();

  afterAll(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup on Windows file handles
      }
    }
  });

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  function openAtVersion49(): DatabaseShape {
    if (!opener) {
      throw new Error(
        'No SQLite binding loaded (neither better-sqlite3 nor node:sqlite)',
      );
    }
    const db = opener(makeTempDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of [...MIGRATIONS]
      .filter((candidate) => candidate.version <= 49)
      .sort((a, b) => a.version - b.version)) {
      if (migration.sql) {
        db.exec(migration.sql);
      }
    }
    return db;
  }

  it('applies cleanly over schema <= 49 without 0050 dependency', () => {
    const db = openAtVersion49();
    try {
      expect(() => db.exec(sql0051SkillLifecycle)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('adds nullable columns to skill_suggestions and leaves pre-existing rows with NULL', () => {
    const db = openAtVersion49();
    try {
      // Seed pre-existing suggestion row before applying 0051
      db.prepare(
        `INSERT INTO skill_suggestions (
           id, name, description, body, member_session_ids, member_candidate_ids,
           cluster_size, technology_fingerprint, judge_score, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'sugg-legacy-1',
        'legacy-name',
        'legacy-desc',
        'legacy-body',
        '["sess-1"]',
        '["cand-1"]',
        1,
        'fp-test',
        0.85,
        'pending',
        1700000000000,
      );

      db.exec(sql0051SkillLifecycle);

      // Verify column metadata
      const columns = db
        .prepare('PRAGMA table_info(skill_suggestions)')
        .all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>;
      const byName = new Map(columns.map((c) => [c.name, c]));

      for (const colName of [
        'merged_into',
        'promoted_candidate_id',
        'references_json',
      ]) {
        const col = byName.get(colName);
        expect(col).toBeDefined();
        expect(col?.type).toBe('TEXT');
        expect(col?.notnull).toBe(0);
        expect(col?.dflt_value).toBeNull();
        expect(col?.pk).toBe(0);
      }

      // Verify pre-existing row reads NULL for all 3 columns
      const row = db
        .prepare(
          'SELECT id, merged_into, promoted_candidate_id, references_json FROM skill_suggestions WHERE id = ?',
        )
        .all('sugg-legacy-1') as Array<{
        id: string;
        merged_into: string | null;
        promoted_candidate_id: string | null;
        references_json: string | null;
      }>;
      expect(row).toEqual([
        {
          id: 'sugg-legacy-1',
          merged_into: null,
          promoted_candidate_id: null,
          references_json: null,
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('creates skill_backlog_purge_state table with single-row check and default rejected counter', () => {
    const db = openAtVersion49();
    try {
      db.exec(sql0051SkillLifecycle);

      const columns = db
        .prepare('PRAGMA table_info(skill_backlog_purge_state)')
        .all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>;
      const byName = new Map(columns.map((c) => [c.name, c]));

      expect(columns.map((c) => c.name)).toEqual([
        'id',
        'cutoff_created_at',
        'completed_at',
        'rejected',
      ]);

      expect(byName.get('id')).toMatchObject({
        type: 'INTEGER',
        pk: 1,
        notnull: 0, // In SQLite, INTEGER PRIMARY KEY columns report notnull: 0 in PRAGMA table_info unless NOT NULL is explicit
      });

      expect(byName.get('cutoff_created_at')).toMatchObject({
        type: 'INTEGER',
        notnull: 1,
        dflt_value: null,
      });

      expect(byName.get('completed_at')).toMatchObject({
        type: 'INTEGER',
        notnull: 1,
        dflt_value: null,
      });

      expect(byName.get('rejected')).toMatchObject({
        type: 'INTEGER',
        notnull: 1,
        dflt_value: '0',
      });

      // Insert valid row (id = 1) omitting rejected to verify default
      db.prepare(
        `INSERT INTO skill_backlog_purge_state (id, cutoff_created_at, completed_at)
         VALUES (?, ?, ?)`,
      ).run(1, 1000, 2000);

      const rows = db
        .prepare(
          'SELECT id, cutoff_created_at, completed_at, rejected FROM skill_backlog_purge_state',
        )
        .all();
      expect(rows).toEqual([
        {
          id: 1,
          cutoff_created_at: 1000,
          completed_at: 2000,
          rejected: 0,
        },
      ]);

      // Rejects id = 2 via CHECK constraint
      expect(() =>
        db
          .prepare(
            `INSERT INTO skill_backlog_purge_state (id, cutoff_created_at, completed_at, rejected)
             VALUES (?, ?, ?, ?)`,
          )
          .run(2, 1000, 2000, 5),
      ).toThrow(/CHECK/i);
    } finally {
      db.close();
    }
  });

  it('rejects duplicate column addition when replayed raw (runner owns exactly-once)', () => {
    const db = openAtVersion49();
    try {
      db.exec(sql0051SkillLifecycle);
      expect(() => db.exec(sql0051SkillLifecycle)).toThrow(/duplicate column/i);
    } finally {
      db.close();
    }
  });
});
