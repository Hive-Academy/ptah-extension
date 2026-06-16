import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0025SkillSuggestions } from './0025_skill_suggestions';
import { MIGRATIONS } from './index';

describe('migration 0025_skill_suggestions — registry entry', () => {
  it('is registered as version 25, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 25);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0025_skill_suggestions');
    expect(entry?.sql).toBe(sql0025SkillSuggestions);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is the highest bundled version', () => {
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(25);
  });
});

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0025-test-'));
  return path.join(dir, 'ptah.db');
}

describe('migration 0025_skill_suggestions — schema shape (skipped without native)', () => {
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

  maybe('applies cleanly on a fresh database', () => {
    const Database = require('better-sqlite3') as new (file: string) => {
      exec(sql: string): void;
      close(): void;
    };
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    try {
      expect(() => db.exec(sql0025SkillSuggestions)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe('is idempotent — running twice does not throw (IF NOT EXISTS)', () => {
    const Database = require('better-sqlite3') as new (file: string) => {
      exec(sql: string): void;
      close(): void;
    };
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    try {
      db.exec(sql0025SkillSuggestions);
      expect(() => db.exec(sql0025SkillSuggestions)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe('creates the expected columns with correct NOT NULL flags', () => {
    interface DatabaseShape {
      exec(sql: string): void;
      prepare(sql: string): {
        all(...params: unknown[]): unknown[];
      };
      close(): void;
    }
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    try {
      db.exec(sql0025SkillSuggestions);
      const cols = db
        .prepare('PRAGMA table_info(skill_suggestions)')
        .all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));

      expect(byName.size).toBe(12);

      const id = byName.get('id');
      expect(id?.type).toBe('TEXT');
      expect(id?.pk).toBeGreaterThan(0);

      for (const notNull of [
        'name',
        'description',
        'body',
        'member_session_ids',
        'member_candidate_ids',
        'cluster_size',
        'technology_fingerprint',
        'judge_score',
        'status',
        'created_at',
      ]) {
        expect(byName.get(notNull)?.notnull).toBe(1);
      }

      expect(byName.get('decided_at')?.notnull).toBe(0);
      expect(byName.get('cluster_size')?.type).toBe('INTEGER');
      expect(byName.get('judge_score')?.type).toBe('REAL');
    } finally {
      db.close();
    }
  });

  maybe('rejects an invalid status via CHECK constraint', () => {
    interface DatabaseShape {
      exec(sql: string): void;
      prepare(sql: string): { run(...params: unknown[]): { changes: number } };
      close(): void;
    }
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    try {
      db.exec(sql0025SkillSuggestions);
      const insert = db.prepare(
        `INSERT INTO skill_suggestions
           (id, name, description, body, member_session_ids, member_candidate_ids,
            cluster_size, technology_fingerprint, judge_score, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      expect(() =>
        insert.run('s1', 'n', 'd', 'b', '[]', '[]', 2, 'tool', 7, 'bogus', 1),
      ).toThrow(/CHECK constraint failed/i);
      expect(() =>
        insert.run('s2', 'n', 'd', 'b', '[]', '[]', 2, 'tool', 7, 'pending', 1),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });
});
