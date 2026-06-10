import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0022SkillRegistry } from './0022_skill_registry';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0022-test-'));
  return path.join(dir, 'ptah.db');
}

describe('migration 0022_skill_registry — schema shape (skipped without native)', () => {
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
      expect(() => db.exec(sql0022SkillRegistry)).not.toThrow();
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
      db.exec(sql0022SkillRegistry);
      expect(() => db.exec(sql0022SkillRegistry)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe(
    'creates the expected columns with correct types, NOT NULL flags and defaults',
    () => {
      interface DatabaseShape {
        exec(sql: string): void;
        prepare(sql: string): {
          all(...params: unknown[]): unknown[];
          get(...params: unknown[]): unknown;
        };
        close(): void;
      }
      const Database = require('better-sqlite3') as new (
        file: string,
      ) => DatabaseShape;
      const dbPath = makeTempDbPath();
      const db = new Database(dbPath);
      try {
        db.exec(sql0022SkillRegistry);
        const cols = db
          .prepare('PRAGMA table_info(skill_registry)')
          .all() as Array<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }>;
        const byName = new Map(cols.map((c) => [c.name, c]));

        expect(byName.size).toBe(13);

        const slug = byName.get('slug');
        expect(slug?.type).toBe('TEXT');
        expect(slug?.notnull).toBe(1);
        expect(slug?.pk).toBeGreaterThan(0);

        const kind = byName.get('kind');
        expect(kind?.type).toBe('TEXT');
        expect(kind?.notnull).toBe(1);
        expect(kind?.pk).toBeGreaterThan(0);

        const userPath = byName.get('user_path');
        expect(userPath?.type).toBe('TEXT');
        expect(userPath?.notnull).toBe(1);
        expect(userPath?.pk).toBe(0);

        const cloneStatus = byName.get('clone_status');
        expect(cloneStatus?.type).toBe('TEXT');
        expect(cloneStatus?.notnull).toBe(1);

        const diverged = byName.get('diverged');
        expect(diverged?.type).toBe('INTEGER');
        expect(diverged?.notnull).toBe(1);
        expect(diverged?.dflt_value).toBe('0');

        for (const nullable of [
          'origin_plugin_id',
          'origin_version',
          'source_hash',
          'history_dir',
          'last_enhanced_at',
          'candidate_id',
        ]) {
          expect(byName.get(nullable)?.notnull).toBe(0);
        }

        const createdAt = byName.get('created_at');
        expect(createdAt?.type).toBe('INTEGER');
        expect(createdAt?.notnull).toBe(1);

        const updatedAt = byName.get('updated_at');
        expect(updatedAt?.type).toBe('INTEGER');
        expect(updatedAt?.notnull).toBe(1);
      } finally {
        db.close();
      }
    },
  );

  maybe('creates idx_skill_registry_status index', () => {
    interface DatabaseShape {
      exec(sql: string): void;
      prepare(sql: string): { all(...params: unknown[]): unknown[] };
      close(): void;
    }
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    try {
      db.exec(sql0022SkillRegistry);
      const indexes = db
        .prepare('PRAGMA index_list(skill_registry)')
        .all() as Array<{ name: string }>;
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_skill_registry_status');
    } finally {
      db.close();
    }
  });

  maybe('enforces composite PRIMARY KEY on (kind, slug)', () => {
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
      db.exec(sql0022SkillRegistry);
      const insert = db.prepare(
        `INSERT INTO skill_registry
           (slug, kind, user_path, clone_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      insert.run('deep-research', 'skill', '/p', 'clone', 1, 1);
      expect(() =>
        insert.run('deep-research', 'skill', '/p2', 'clone', 2, 2),
      ).toThrow(/UNIQUE constraint failed|PRIMARY KEY/i);
      expect(() =>
        insert.run('deep-research', 'command', '/p3', 'authored', 2, 2),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe('rejects an invalid kind via CHECK constraint', () => {
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
      db.exec(sql0022SkillRegistry);
      const insert = db.prepare(
        `INSERT INTO skill_registry
           (slug, kind, user_path, clone_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      expect(() => insert.run('x', 'plugin', '/p', 'clone', 1, 1)).toThrow(
        /CHECK constraint failed/i,
      );
    } finally {
      db.close();
    }
  });

  maybe('rejects an invalid clone_status via CHECK constraint', () => {
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
      db.exec(sql0022SkillRegistry);
      const insert = db.prepare(
        `INSERT INTO skill_registry
           (slug, kind, user_path, clone_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      expect(() => insert.run('x', 'skill', '/p', 'unknown', 1, 1)).toThrow(
        /CHECK constraint failed/i,
      );
    } finally {
      db.close();
    }
  });
});
