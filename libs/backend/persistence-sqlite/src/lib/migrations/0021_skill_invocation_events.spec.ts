import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0021SkillInvocationEvents } from './0021_skill_invocation_events';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0021-test-'));
  return path.join(dir, 'ptah.db');
}

describe('migration 0021_skill_invocation_events — schema shape (skipped without native)', () => {
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
      expect(() => db.exec(sql0021SkillInvocationEvents)).not.toThrow();
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
      db.exec(sql0021SkillInvocationEvents);
      expect(() => db.exec(sql0021SkillInvocationEvents)).not.toThrow();
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
        db.exec(sql0021SkillInvocationEvents);
        const cols = db
          .prepare('PRAGMA table_info(skill_invocation_events)')
          .all() as Array<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }>;
        const byName = new Map(cols.map((c) => [c.name, c]));

        expect(byName.size).toBe(8);

        const id = byName.get('id');
        expect(id).toBeDefined();
        expect(id?.type).toBe('TEXT');
        expect(id?.pk).toBeGreaterThan(0);

        const slug = byName.get('skill_slug');
        expect(slug).toBeDefined();
        expect(slug?.type).toBe('TEXT');
        expect(slug?.notnull).toBe(1);

        const sessionId = byName.get('session_id');
        expect(sessionId).toBeDefined();
        expect(sessionId?.type).toBe('TEXT');
        expect(sessionId?.notnull).toBe(1);

        const contextId = byName.get('context_id');
        expect(contextId).toBeDefined();
        expect(contextId?.type).toBe('TEXT');
        expect(contextId?.notnull).toBe(0);

        const source = byName.get('source');
        expect(source).toBeDefined();
        expect(source?.type).toBe('TEXT');
        expect(source?.notnull).toBe(1);

        const succeeded = byName.get('succeeded');
        expect(succeeded).toBeDefined();
        expect(succeeded?.type).toBe('INTEGER');
        expect(succeeded?.notnull).toBe(1);

        const isError = byName.get('is_error');
        expect(isError).toBeDefined();
        expect(isError?.type).toBe('INTEGER');
        expect(isError?.notnull).toBe(1);
        expect(isError?.dflt_value).toBe('0');

        const invokedAt = byName.get('invoked_at');
        expect(invokedAt).toBeDefined();
        expect(invokedAt?.type).toBe('INTEGER');
        expect(invokedAt?.notnull).toBe(1);
      } finally {
        db.close();
      }
    },
  );

  maybe('creates both expected indexes on the table', () => {
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
      db.exec(sql0021SkillInvocationEvents);
      const indexes = db
        .prepare('PRAGMA index_list(skill_invocation_events)')
        .all() as Array<{ name: string }>;
      const names = new Set(indexes.map((i) => i.name));
      expect(names.has('idx_skill_inv_events_slug')).toBe(true);
      expect(names.has('idx_skill_inv_events_ctx')).toBe(true);
    } finally {
      db.close();
    }
  });

  maybe('persists succeeded/is_error as integer flags', () => {
    interface DatabaseShape {
      exec(sql: string): void;
      prepare(sql: string): {
        run(...params: unknown[]): { changes: number };
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
      db.exec(sql0021SkillInvocationEvents);
      db.prepare(
        `INSERT INTO skill_invocation_events
           (id, skill_slug, session_id, context_id, source, succeeded, is_error, invoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('e1', 'deep-research', 's1', 'fp-1', 'tool-use', 0, 1, 1000);
      const row = db
        .prepare(
          'SELECT succeeded, is_error FROM skill_invocation_events WHERE id = ?',
        )
        .get('e1') as { succeeded: number; is_error: number };
      expect(row.succeeded).toBe(0);
      expect(row.is_error).toBe(1);
    } finally {
      db.close();
    }
  });
});
