import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0014BootScanState } from './0014_boot_scan_state';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0014-test-'));
  return path.join(dir, 'ptah.db');
}

describe('migration 0014_boot_scan_state — schema shape (skipped without native)', () => {
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
      expect(() => db.exec(sql0014BootScanState)).not.toThrow();
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
      db.exec(sql0014BootScanState);
      expect(() => db.exec(sql0014BootScanState)).not.toThrow();
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
        db.exec(sql0014BootScanState);
        const cols = db
          .prepare('PRAGMA table_info(boot_scan_state)')
          .all() as Array<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }>;
        const byName = new Map(cols.map((c) => [c.name, c]));

        expect(byName.size).toBe(4);

        const pipeline = byName.get('pipeline');
        expect(pipeline).toBeDefined();
        expect(pipeline?.type).toBe('TEXT');
        expect(pipeline?.notnull).toBe(1);
        expect(pipeline?.pk).toBeGreaterThan(0);

        const fingerprint = byName.get('workspace_fingerprint');
        expect(fingerprint).toBeDefined();
        expect(fingerprint?.type).toBe('TEXT');
        expect(fingerprint?.notnull).toBe(1);
        expect(fingerprint?.pk).toBeGreaterThan(0);

        const watermark = byName.get('last_scanned_session_mtime');
        expect(watermark).toBeDefined();
        expect(watermark?.type).toBe('INTEGER');
        expect(watermark?.notnull).toBe(1);
        expect(watermark?.dflt_value).toBe('0');
        expect(watermark?.pk).toBe(0);

        const lastRunAt = byName.get('last_run_at');
        expect(lastRunAt).toBeDefined();
        expect(lastRunAt?.type).toBe('INTEGER');
        expect(lastRunAt?.notnull).toBe(1);
        expect(lastRunAt?.dflt_value).toBe('0');
        expect(lastRunAt?.pk).toBe(0);
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'enforces composite PRIMARY KEY on (pipeline, workspace_fingerprint)',
    () => {
      interface DatabaseShape {
        exec(sql: string): void;
        prepare(sql: string): {
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
        db.exec(sql0014BootScanState);
        const insert = db.prepare(
          'INSERT INTO boot_scan_state(pipeline, workspace_fingerprint, last_scanned_session_mtime, last_run_at) VALUES (?, ?, ?, ?)',
        );
        insert.run('memory', 'wsfp-abc', 1000, 2000);
        expect(() => insert.run('memory', 'wsfp-abc', 1500, 2500)).toThrow(
          /UNIQUE constraint failed|PRIMARY KEY/i,
        );
        expect(() =>
          insert.run('skills', 'wsfp-abc', 1500, 2500),
        ).not.toThrow();
        expect(() =>
          insert.run('memory', 'wsfp-xyz', 1500, 2500),
        ).not.toThrow();
      } finally {
        db.close();
      }
    },
  );
});
