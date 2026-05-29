import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0015ObservationQueue } from './0015_observation_queue';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0015-test-'));
  return path.join(dir, 'ptah.db');
}

describe('migration 0015_observation_queue — schema shape (skipped without native)', () => {
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
      expect(() => db.exec(sql0015ObservationQueue)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe(
    'creates the expected columns with correct types and NOT NULL flags',
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
        db.exec(sql0015ObservationQueue);
        const cols = db
          .prepare('PRAGMA table_info(observation_queue)')
          .all() as Array<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }>;
        const byName = new Map(cols.map((c) => [c.name, c]));

        expect(byName.get('id')?.pk).toBeGreaterThan(0);
        expect(byName.get('session_id')?.notnull).toBe(1);
        expect(byName.get('workspace_root')?.notnull).toBe(0);
        expect(byName.get('kind')?.notnull).toBe(1);
        expect(byName.get('tool_name')?.notnull).toBe(0);
        expect(byName.get('tool_input_json')?.notnull).toBe(0);
        expect(byName.get('tool_response_text')?.notnull).toBe(0);
        expect(byName.get('assistant_message')?.notnull).toBe(0);
        expect(byName.get('user_prompt')?.notnull).toBe(0);
        expect(byName.get('file_path')?.notnull).toBe(0);
        expect(byName.get('prompt_number')?.notnull).toBe(0);
        expect(byName.get('captured_at')?.type).toBe('INTEGER');
        expect(byName.get('captured_at')?.notnull).toBe(1);
        expect(byName.get('processed_at')?.notnull).toBe(0);
      } finally {
        db.close();
      }
    },
  );

  maybe('creates the session + drain indexes', () => {
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
      db.exec(sql0015ObservationQueue);
      const indexes = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'observation_queue'`,
        )
        .all() as Array<{ name: string }>;
      const names = new Set(indexes.map((i) => i.name));
      expect(names.has('idx_obs_queue_session')).toBe(true);
      expect(names.has('idx_obs_queue_drain')).toBe(true);
    } finally {
      db.close();
    }
  });

  maybe('id column auto-increments on insert', () => {
    interface DatabaseShape {
      exec(sql: string): void;
      prepare(sql: string): {
        run(...params: unknown[]): { lastInsertRowid: number | bigint };
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
      db.exec(sql0015ObservationQueue);
      const insert = db.prepare(
        'INSERT INTO observation_queue(session_id, kind, captured_at) VALUES (?, ?, ?)',
      );
      const r1 = insert.run('s1', 'tool-use', 1000);
      const r2 = insert.run('s1', 'tool-use', 2000);
      expect(Number(r2.lastInsertRowid)).toBe(Number(r1.lastInsertRowid) + 1);
    } finally {
      db.close();
    }
  });
});
