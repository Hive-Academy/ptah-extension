/**
 * Test-only real-SQLite harness for the retention specs (TASK_2026_440).
 *
 * NOT production code and NOT a Jest test file (it does not match
 * `*.(spec|test).ts`), and nothing in the lib barrel imports it. It exists
 * because three specs — the store spec, the integration spec and the DI
 * register spec — need the same opener, and three copies would drift.
 *
 * WHY A FALLBACK BINDING. `better-sqlite3` in this repo is rebuilt against
 * Electron's ABI by postinstall, so it often cannot load under Jest. The opener
 * falls back to Node's built-in `node:sqlite` — the same SQLite engine behind a
 * different binding. WHEN NEITHER LOADS, {@link requireSqliteOpener} THROWS, so
 * every spec using it FAILS instead of skipping: a skipped retention spec is a
 * green tick for delete code that never ran.
 *
 * Every database lives in a fresh `os.tmpdir()` directory. Nothing here opens
 * `~/.ptah`.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MIGRATIONS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';

export interface RawStatement {
  run(...params: unknown[]): {
    changes: number | bigint;
    lastInsertRowid?: number | bigint;
  };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
}

export interface RawDb {
  exec(sql: string): void;
  prepare(sql: string): RawStatement;
  close(): void;
  pragma?: (sql: string, options?: { simple?: boolean }) => unknown;
  inTransaction?: boolean;
  isTransaction?: boolean;
}

export type SqliteOpener = (file: string) => RawDb;

/** better-sqlite3 when its native binary loads, else `node:sqlite`, else `null`. */
export function resolveSqliteOpener(): {
  readonly name: 'better-sqlite3' | 'node:sqlite';
  readonly open: SqliteOpener;
} | null {
  try {
    const Database = require('better-sqlite3') as new (file: string) => RawDb;
    new Database(':memory:').close();
    return { name: 'better-sqlite3', open: (file) => new Database(file) };
  } catch {
    // Falls through to the built-in binding.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => RawDb;
    };
    new DatabaseSync(':memory:').close();
    return { name: 'node:sqlite', open: (file) => new DatabaseSync(file) };
  } catch {
    return null;
  }
}

/** The opener, or a thrown error that fails the calling spec. */
export function requireSqliteOpener(): {
  readonly name: 'better-sqlite3' | 'node:sqlite';
  readonly open: SqliteOpener;
} {
  const opener = resolveSqliteOpener();
  if (opener === null) {
    throw new Error(
      'No SQLite binding loads (neither better-sqlite3 nor node:sqlite). ' +
        'The retention specs must run against real SQLite; they fail rather than skip.',
    );
  }
  return opener;
}

/**
 * Complete a raw handle so it satisfies `SqliteDatabase`, recording every SQL
 * text it is asked to prepare, exec or pragma into `issued`.
 *
 * `node:sqlite` has no `pragma()` (run as `PRAGMA <text>` through
 * `prepare().all()`, which steps to completion as better-sqlite3's does), no
 * `transaction()` and names its transaction flag `isTransaction`.
 */
export function adaptSqliteDatabase(
  raw: RawDb,
  issued: string[] = [],
): SqliteDatabase {
  const pragma = (text: string, options?: { simple?: boolean }): unknown => {
    issued.push(`PRAGMA ${text}`);
    if (typeof raw.pragma === 'function') return raw.pragma(text, options);
    const rows = raw.prepare(`PRAGMA ${text}`).all() as Array<
      Record<string, unknown>
    >;
    if (options?.simple) {
      const first = rows[0];
      return first === undefined ? undefined : Object.values(first)[0];
    }
    return rows;
  };
  return {
    exec: (sql: string) => {
      issued.push(sql);
      raw.exec(sql);
    },
    prepare: (sql: string) => {
      issued.push(sql);
      return raw.prepare(sql) as never;
    },
    pragma,
    close: () => raw.close(),
    open: true,
    get inTransaction(): boolean {
      return Boolean(raw.inTransaction ?? raw.isTransaction);
    },
    transaction: (<T extends (...args: unknown[]) => unknown>(fn: T): T =>
      ((...args: unknown[]) => {
        raw.exec('BEGIN');
        try {
          const out = fn(...args);
          raw.exec('COMMIT');
          return out;
        } catch (error: unknown) {
          raw.exec('ROLLBACK');
          throw error;
        }
      }) as T) as SqliteDatabase['transaction'],
  };
}

export function migrationSql(version: number): string {
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration || typeof migration.sql !== 'string') {
    throw new Error(`migration ${version} has no static SQL`);
  }
  return migration.sql;
}

export interface RetentionTestDb {
  readonly openerName: 'better-sqlite3' | 'node:sqlite';
  readonly file: string;
  readonly raw: RawDb;
  readonly db: SqliteDatabase;
  /** Every SQL text issued through {@link db}. */
  readonly issued: string[];
  /** A `SqliteConnectionService` stand-in whose `db` getter returns {@link db}. */
  readonly connection: SqliteConnectionService;
  /** Open a second, independent handle to the same file. */
  openSecondHandle(): RawDb;
  close(): void;
}

const tempDirs: string[] = [];

/**
 * A temp-file database with `auto_vacuum = INCREMENTAL` set BEFORE the first
 * table (the mode cannot change on a populated file without a VACUUM), WAL
 * journaling as in production, and migrations `0016` (observation_queue) and
 * `0043` (quarantine ledger + run record) applied.
 */
export function openRetentionTestDb(
  options: { autoVacuum?: 'incremental' | 'none' } = {},
): RetentionTestDb {
  const opener = requireSqliteOpener();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-retention-test-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'retention.db');
  const raw = opener.open(file);
  raw.exec(
    options.autoVacuum === 'none'
      ? 'PRAGMA auto_vacuum = NONE'
      : 'PRAGMA auto_vacuum = INCREMENTAL',
  );
  raw.prepare('PRAGMA journal_mode = WAL').all();
  raw.exec(migrationSql(16));
  raw.exec(migrationSql(43));
  const issued: string[] = [];
  const db = adaptSqliteDatabase(raw, issued);
  let closed = false;
  const connection = {
    get db(): SqliteDatabase {
      if (closed) throw new Error('database closed');
      return db;
    },
  } as unknown as SqliteConnectionService;
  return {
    openerName: opener.name,
    file,
    raw,
    db,
    issued,
    connection,
    openSecondHandle: () => opener.open(file),
    close: () => {
      if (closed) return;
      closed = true;
      raw.close();
    },
  };
}

/** Remove every temp directory created by {@link openRetentionTestDb}. */
export function removeRetentionTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // A handle still open on Windows keeps the file; the OS temp cleaner owns it.
    }
  }
}

export interface SeedRow {
  readonly sessionId: string;
  readonly kind: string;
  readonly capturedAt: number;
  readonly processedAt: number | null;
  readonly toolResponseText?: string | null;
}

/** Insert rows straight into `observation_queue` in one transaction; returns their ids. */
export function seedObservations(
  raw: RawDb,
  rows: readonly SeedRow[],
): number[] {
  const stmt = raw.prepare(
    `INSERT INTO observation_queue
       (session_id, workspace_root, kind, tool_response_text, captured_at, processed_at)
     VALUES (?, NULL, ?, ?, ?, ?)`,
  );
  const ids: number[] = [];
  raw.exec('BEGIN');
  try {
    for (const row of rows) {
      const result = stmt.run(
        row.sessionId,
        row.kind,
        row.toolResponseText ?? null,
        row.capturedAt,
        row.processedAt,
      );
      ids.push(Number(result.lastInsertRowid));
    }
    raw.exec('COMMIT');
  } catch (error: unknown) {
    raw.exec('ROLLBACK');
    throw error;
  }
  return ids;
}

/** `PRAGMA <name>` as a number, read on the raw handle (not recorded). */
export function pragmaNumber(raw: RawDb, name: string): number {
  const row = raw.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
  return Number(Object.values(row)[0]);
}
