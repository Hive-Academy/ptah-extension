/**
 * A minimal `{ db }` stand-in for `SqliteConnectionService`, the shape
 * `retention-sqlite.test-support.ts` builds in `openRetentionTestDb`
 * (`connection = { get db() { ... } } as unknown as SqliteConnectionService`)
 * over a handle completed by `adaptSqliteDatabase`.
 *
 * The harness runs under `ELECTRON_RUN_AS_NODE=1`, so the production
 * `better-sqlite3` binding loads and already satisfies `SqliteDatabase`
 * natively (`pragma`, `transaction`, `inTransaction`, `loadExtension`). The
 * wrapper below keeps the test-support conventions anyway — every SQL text is
 * recorded into `issued`, `inTransaction` falls back to `isTransaction`, and a
 * missing `pragma()` runs as `PRAGMA <text>` — so the same code would also run
 * on `node:sqlite` if ever needed.
 *
 * Every open goes through `assertSafeTarget`'s sibling check: the file must
 * live in `%TEMP%\mqs-563-eval\` and must not be named `ptah*`.
 */
import * as path from 'node:path';
import type {
  SqliteConnectionService,
  SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import { EVAL_DIR } from './copy-db';

/** The production pragmas (`sqlite-connection.service.ts` PRAGMAS_ON_OPEN). */
export const PRAGMAS_ON_OPEN = [
  'journal_mode = WAL',
  'foreign_keys = ON',
  'synchronous = NORMAL',
  'temp_store = MEMORY',
  'mmap_size = 268435456',
  'busy_timeout = 5000',
] as const;

interface RawStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
}

interface RawDb {
  exec(sql: string): void;
  prepare(sql: string): RawStatement;
  close(): void;
  pragma?: (sql: string, options?: { simple?: boolean }) => unknown;
  inTransaction?: boolean;
  isTransaction?: boolean;
  loadExtension?(file: string): void;
  /** better-sqlite3's native wrapper (handles nesting via savepoints). */
  transaction?: <T extends (...args: unknown[]) => unknown>(fn: T) => T;
}

export interface HarnessConnection {
  readonly file: string;
  readonly raw: RawDb;
  readonly db: SqliteDatabase;
  readonly connection: SqliteConnectionService;
  readonly vecExtensionLoaded: boolean;
  readonly issued: string[];
  close(): void;
}

/** Same shape and conventions as `adaptSqliteDatabase` (test-support). */
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
    transaction: (<T extends (...args: unknown[]) => unknown>(fn: T): T => {
      // better-sqlite3 ships a native wrapper (nested calls become savepoints);
      // use it whenever the raw handle has one, bound to the raw handle.
      if (typeof raw.transaction === 'function') {
        return raw.transaction.call(raw, fn) as T;
      }
      // Fallback for handles without one (node:sqlite): plain BEGIN/COMMIT.
      return ((...args: unknown[]) => {
        raw.exec('BEGIN');
        try {
          const out = fn(...args);
          raw.exec('COMMIT');
          return out;
        } catch (error: unknown) {
          try {
            raw.exec('ROLLBACK');
          } catch {
            // Deliberately swallowed: a failed ROLLBACK (e.g. SQLite already
            // rolled back) must not mask the error that aborted the body or
            // the COMMIT.
          }
          throw error;
        }
      }) as T;
    }) as SqliteDatabase['transaction'],
  } as SqliteDatabase;
}

function assertEvalCopy(file: string): string {
  const resolved = path.resolve(file);
  const lower = resolved.toLowerCase();
  if (!lower.startsWith(path.resolve(EVAL_DIR).toLowerCase() + path.sep)) {
    throw new Error(
      `refusing to open a database outside ${EVAL_DIR}: ${resolved}`,
    );
  }
  if (path.basename(lower).startsWith('ptah')) {
    throw new Error(`refusing to open a database named ptah*: ${resolved}`);
  }
  return resolved;
}

/**
 * Open a working copy with better-sqlite3, apply the production pragmas, and
 * (optionally) load sqlite-vec the way production does (`loadExtension` with
 * the platform binary path).
 */
export function openWorkingCopy(
  file: string,
  options: { loadVec?: boolean; readonly?: boolean } = {},
): HarnessConnection {
  const resolved = assertEvalCopy(file);
  const Database = require('better-sqlite3') as new (
    f: string,
    o?: { readonly?: boolean; fileMustExist?: boolean },
  ) => RawDb;
  const raw = new Database(resolved, {
    fileMustExist: true,
    readonly: options.readonly === true,
  });
  if (options.readonly !== true) {
    for (const p of PRAGMAS_ON_OPEN) raw.pragma?.(p);
  }
  let vecExtensionLoaded = false;
  if (options.loadVec === true) {
    const sqliteVec = require('sqlite-vec') as { getLoadablePath(): string };
    if (typeof raw.loadExtension !== 'function') {
      throw new Error('better-sqlite3 handle does not expose loadExtension');
    }
    raw.loadExtension(sqliteVec.getLoadablePath());
    vecExtensionLoaded = true;
  }
  const issued: string[] = [];
  const db = adaptSqliteDatabase(raw, issued);
  let closed = false;
  const connection = {
    get db(): SqliteDatabase {
      if (closed) throw new Error('database closed');
      return db;
    },
    get vecExtensionLoaded(): boolean {
      return vecExtensionLoaded;
    },
  } as unknown as SqliteConnectionService;
  return {
    file: resolved,
    raw,
    db,
    connection,
    vecExtensionLoaded,
    issued,
    close: () => {
      if (closed) return;
      closed = true;
      raw.close();
    },
  };
}

/** A console logger satisfying the `Logger` surface the services call. */
export function makeLogger(tag: string, quietDebug = true): never {
  const out =
    (level: string) =>
    (message: string, context?: unknown): void => {
      if (level === 'debug' && quietDebug) return;
      const ctx = context === undefined ? '' : ` ${safeJson(context)}`;
      process.stderr.write(`[${tag}] ${level} ${message}${ctx}\n`);
    };
  return {
    debug: out('debug'),
    info: out('info'),
    warn: out('warn'),
    error: out('error'),
    log: out('info'),
    trace: out('debug'),
  } as never;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(
      value instanceof Error ? { message: value.message } : value,
    );
  } catch {
    return String(value);
  }
}
