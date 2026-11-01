/**
 * Real-SQLite harness for the session-organization specs (test-only; excluded
 * from the lib build).
 *
 * Opens an isolated `:memory:` database with the shipped migrations 1..50 and
 * 0063, so the stores run against the exact schema they ship with.
 * better-sqlite3 is tried first; when its native ABI cannot load under Jest,
 * Node's built-in `node:sqlite` (same engine) is used, with `transaction`
 * supplied the way better-sqlite3 provides it.
 */
import 'reflect-metadata';
import {
  MIGRATIONS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import type { IDisposable } from '@ptah-extension/platform-core';

export interface TestStatement {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface TestDatabase {
  exec(sql: string): void;
  prepare(sql: string): TestStatement;
  close(): void;
  transaction?: (fn: (...args: unknown[]) => unknown) => unknown;
}

/** The connection fields the stores read, plus a way to open / close it. */
export interface TestConnection {
  db: TestDatabase;
  isOpen: boolean;
  lastMigrationVersion: number;
  onDidOpen(listener: () => void): IDisposable;
  /** Mark the connection open and fire the open listeners. */
  open(): void;
  /** Mark the connection closed (reads through `isReady` turn false). */
  close(): void;
}

type DbOpener = () => TestDatabase;

function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => TestDatabase;
    new Database(':memory:').close();
    return () => new Database(':memory:');
  } catch {
    // Electron's native ABI may not load in Jest; fall through to node:sqlite.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => TestDatabase;
    };
    new DatabaseSync(':memory:').close();
    return () => new DatabaseSync(':memory:');
  } catch {
    // degradation-audit: optional-capability - test-only driver probe; null
    // sets sqliteAvailable=false and openTestConnection throws a clear error.
    return null;
  }
}

function withTransaction(db: TestDatabase): TestDatabase {
  if (typeof db.transaction === 'function') return db;
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
    close: () => db.close(),
    transaction:
      (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) => {
        db.exec('BEGIN');
        try {
          const out = fn(...args);
          db.exec('COMMIT');
          return out;
        } catch (error: unknown) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
  };
}

const opener = resolveOpener();

/** Whether a binding loaded; suites assert this instead of skipping. */
export const sqliteAvailable = opener !== null;

/** A fresh migrated database behind a controllable fake connection. */
export function openTestConnection(
  options: { open?: boolean } = {},
): TestConnection {
  if (!opener) {
    throw new Error(
      'No SQLite binding loaded (neither better-sqlite3 nor node:sqlite)',
    );
  }
  const db = withTransaction(opener());
  for (const migration of MIGRATIONS.filter(
    (m) => m.version <= 50 || m.version === 63,
  )) {
    if (migration.sql) db.exec(migration.sql);
  }
  const listeners = new Set<() => void>();
  const isOpen = options.open ?? true;
  const connection: TestConnection = {
    db,
    isOpen,
    lastMigrationVersion: isOpen ? 63 : 0,
    onDidOpen(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    open() {
      connection.isOpen = true;
      connection.lastMigrationVersion = 63;
      for (const listener of [...listeners]) listener();
    },
    close() {
      connection.isOpen = false;
      connection.lastMigrationVersion = 0;
    },
  };
  return connection;
}

/** The fake connection as the stores' constructor parameter type. */
export function asConnectionService(
  connection: TestConnection,
): SqliteConnectionService {
  return connection as unknown as SqliteConnectionService;
}

/** Plain-object copies of every row of a query. */
export function rowsOf(
  db: TestDatabase,
  sql: string,
  ...params: unknown[]
): Array<Record<string, unknown>> {
  return db
    .prepare(sql)
    .all(...params)
    .map((r) => ({ ...(r as Record<string, unknown>) }));
}
