import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0003Skills } from './0003_skills';
import { sql as sql0026SkillResidency } from './0026_skill_residency';
import { MIGRATIONS } from './index';

describe('migration 0026_skill_residency — registry entry', () => {
  it('is registered as version 26, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 26);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0026_skill_residency');
    expect(entry?.sql).toBe(sql0026SkillResidency);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is the highest bundled version', () => {
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(26);
  });
});

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0026-test-'));
  return path.join(dir, 'ptah.db');
}

describe('migration 0026_skill_residency — schema shape (skipped without native)', () => {
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

  maybe('applies cleanly on top of the base skill_candidates table', () => {
    const Database = require('better-sqlite3') as new (file: string) => {
      exec(sql: string): void;
      close(): void;
    };
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    try {
      db.exec(sql0003Skills);
      expect(() => db.exec(sql0026SkillResidency)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe(
    'adds a residency column defaulting to resident with the expected CHECK',
    () => {
      interface DatabaseShape {
        exec(sql: string): void;
        prepare(sql: string): {
          all(...params: unknown[]): unknown[];
          get(...params: unknown[]): unknown;
          run(...params: unknown[]): { changes: number };
        };
        close(): void;
      }
      const Database = require('better-sqlite3') as new (
        file: string,
      ) => DatabaseShape;
      const dbPath = makeTempDbPath();
      const db = new Database(dbPath);
      try {
        db.exec(sql0003Skills);
        db.exec(sql0026SkillResidency);

        const cols = db
          .prepare('PRAGMA table_info(skill_candidates)')
          .all() as Array<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
        }>;
        const residency = cols.find((c) => c.name === 'residency');
        expect(residency).toBeDefined();
        expect(residency?.type).toBe('TEXT');
        expect(residency?.notnull).toBe(1);

        const insert = db.prepare(
          `INSERT INTO skill_candidates
             (id, name, description, body_path, source_session_ids,
              trajectory_hash, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?)`,
        );
        insert.run('c1', 'n1', 'd', '/tmp/SKILL.md', '[]', 'h1', 1);
        const row = db
          .prepare(`SELECT residency FROM skill_candidates WHERE id = ?`)
          .get('c1') as { residency: string };
        expect(row.residency).toBe('resident');
      } finally {
        db.close();
      }
    },
  );

  maybe('rejects an invalid residency via the CHECK constraint', () => {
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
      db.exec(sql0003Skills);
      db.exec(sql0026SkillResidency);
      const insert = db.prepare(
        `INSERT INTO skill_candidates
           (id, name, description, body_path, source_session_ids,
            trajectory_hash, status, created_at, residency)
         VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?, ?)`,
      );
      expect(() =>
        insert.run('c2', 'n2', 'd', '/tmp/SKILL.md', '[]', 'h2', 1, 'bogus'),
      ).toThrow(/CHECK constraint failed/i);
      expect(() =>
        insert.run('c3', 'n3', 'd', '/tmp/SKILL.md', '[]', 'h3', 1, 'dormant'),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });
});
