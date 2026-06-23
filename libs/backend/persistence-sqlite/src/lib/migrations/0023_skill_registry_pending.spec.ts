import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0022SkillRegistry } from './0022_skill_registry';
import { sql as sql0023SkillRegistryPending } from './0023_skill_registry_pending';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0023-test-'));
  return path.join(dir, 'ptah.db');
}

describe('migration 0023_skill_registry_pending — schema shape (skipped without native)', () => {
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

  maybe('applies cleanly on a database already at 0022', () => {
    const Database = require('better-sqlite3') as new (file: string) => {
      exec(sql: string): void;
      close(): void;
    };
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    try {
      db.exec(sql0022SkillRegistry);
      expect(() => db.exec(sql0023SkillRegistryPending)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe('adds a nullable pending_source_hash TEXT column', () => {
    interface DatabaseShape {
      exec(sql: string): void;
      prepare(sql: string): {
        all(...params: unknown[]): unknown[];
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
      db.exec(sql0022SkillRegistry);
      db.exec(sql0023SkillRegistryPending);
      const cols = db
        .prepare('PRAGMA table_info(skill_registry)')
        .all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));

      expect(byName.size).toBe(14);
      const pending = byName.get('pending_source_hash');
      expect(pending).toBeDefined();
      expect(pending?.type).toBe('TEXT');
      expect(pending?.notnull).toBe(0);
      expect(pending?.dflt_value).toBeNull();

      expect(() =>
        db
          .prepare(
            `INSERT INTO skill_registry
               (slug, kind, user_path, clone_status, created_at, updated_at)
             VALUES ('x', 'skill', '/p', 'clone', 1, 1)`,
          )
          .run(),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe('runner applies 0023 exactly once (no IF NOT EXISTS needed)', () => {
    interface DatabaseShape {
      exec(sql: string): void;
      close(): void;
    }
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    try {
      db.exec(sql0022SkillRegistry);
      db.exec(sql0023SkillRegistryPending);
      expect(() => db.exec(sql0023SkillRegistryPending)).toThrow(
        /duplicate column name/i,
      );
    } finally {
      db.close();
    }
  });
});
