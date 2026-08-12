/**
 * Test-only SQLite harness for the queue + budget stores.
 *
 * NOT production code and NOT a Jest test file: `*.test-support.ts` is excluded
 * from `tsconfig.lib.json`, included by `tsconfig.spec.json`, and does not match
 * Jest's `*.(spec|test).ts` pattern. It exists because four specs need the same
 * subtle opener, and four copies of it would drift.
 *
 * WHY A FALLBACK BINDING. `better-sqlite3` in this repo is rebuilt against
 * Electron's ABI by postinstall, so it cannot load in the Jest/Node runner on a
 * normal dev machine. Every migration spec here carries a native probe and skips
 * without it — but the assertions these specs exist for (the CAS claim race,
 * stale reaping, the guarded re-open) are exactly the ones that must not be
 * permanently skipped. So the opener falls back to Node's built-in `node:sqlite`:
 * the same SQLite engine behind a different binding. Only if BOTH are missing do
 * the behavioural tests skip.
 *
 * ONE ADAPTATION IS REQUIRED. `isUniqueConstraintError`
 * (`@ptah-extension/persistence-sqlite`) matches `err.code ===
 * 'SQLITE_CONSTRAINT_UNIQUE'`, which is better-sqlite3's surface. `node:sqlite`
 * reports the same violation as `code: 'ERR_SQLITE_ERROR'` with the detail in
 * the message. The wrapper below re-labels only that one case, so the store
 * under test keeps using the shared production predicate instead of growing a
 * binding-detection branch it would never need in production.
 */
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type { Logger } from '@ptah-extension/vscode-core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** The subset of the driver surface the stores touch. */
export interface TestDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

type RawDatabase = TestDatabase;
type DbOpener = (file: string) => RawDatabase;

export const sql0032 = MIGRATIONS.find((m) => m.version === 32)?.sql ?? '';

export const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

function relabelUniqueViolation(error: unknown): unknown {
  if (!error || typeof error !== 'object') return error;
  const err = error as { code?: unknown; message?: unknown };
  if (
    err.code === 'ERR_SQLITE_ERROR' &&
    /UNIQUE constraint failed/i.test(String(err.message ?? ''))
  ) {
    (err as { code: string }).code = 'SQLITE_CONSTRAINT_UNIQUE';
  }
  return error;
}

function adapt(db: RawDatabase): TestDatabase {
  return {
    exec: (sql: string) => db.exec(sql),
    close: () => db.close(),
    prepare: (sql: string) => {
      const stmt = db.prepare(sql);
      return {
        run: (...params: unknown[]) => {
          try {
            return stmt.run(...params);
          } catch (error: unknown) {
            throw relabelUniqueViolation(error);
          }
        },
        get: (...params: unknown[]) => stmt.get(...params),
        all: (...params: unknown[]) => stmt.all(...params),
      };
    },
  };
}

/** `better-sqlite3` if it loads, else `node:sqlite`, else `null`. */
export function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => RawDatabase;
    new Database(':memory:').close();
    return (file) => new Database(file);
  } catch {
    // Falls through to the built-in binding.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => RawDatabase;
    };
    new DatabaseSync(':memory:').close();
    return (file) => new DatabaseSync(file);
  } catch {
    return null;
  }
}

/** A fresh file path under the OS temp dir. File-backed so two connections can share it. */
export function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-skill-queue-'));
  return path.join(dir, 'ptah.db');
}

/**
 * Open `file` and apply migration `0032`. Mirrors the production pragmas that
 * matter to these tests: foreign keys on (`depends_on` is a self-reference) and
 * a busy timeout (two connections share one file in the claim spec).
 */
export function openQueueDb(opener: DbOpener, file: string): TestDatabase {
  const db = adapt(opener(file));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(sql0032);
  return db;
}

/** The `SqliteConnectionService` shape the stores inject — only `.db` is used. */
export function asConnection(db: TestDatabase): SqliteConnectionService {
  return { db } as unknown as SqliteConnectionService;
}
