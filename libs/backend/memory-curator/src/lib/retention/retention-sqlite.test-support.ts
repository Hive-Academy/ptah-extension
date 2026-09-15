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
  loadExtension?(file: string): void;
}

export type SqliteOpener = (file: string, allowExtension?: boolean) => RawDb;

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
      DatabaseSync: new (
        file: string,
        options?: { allowExtension?: boolean },
      ) => RawDb;
    };
    new DatabaseSync(':memory:').close();
    return {
      name: 'node:sqlite',
      open: (file, allowExtension = false) =>
        new DatabaseSync(file, { allowExtension }),
    };
  } catch {
    // degradation-audit: optional-capability - no SQLite binding loads here;
    // requireSqliteOpener turns the null into a thrown spec failure.
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

export function migrationVecSql(version: number): string | null {
  const migration = MIGRATIONS.find((m) => m.version === version);
  return migration?.vecSql ?? null;
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
  /** Close and reopen the primary handle without loading sqlite-vec. */
  reopenWithoutVec(): void;
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
  options: {
    autoVacuum?: 'incremental' | 'none';
    memorySchema?: boolean;
    vec?: boolean;
  } = {},
): RetentionTestDb {
  const opener = requireSqliteOpener();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-retention-test-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'retention.db');
  let raw = opener.open(file, options.vec === true);
  raw.exec(
    options.autoVacuum === 'none'
      ? 'PRAGMA auto_vacuum = NONE'
      : 'PRAGMA auto_vacuum = INCREMENTAL',
  );
  raw.prepare('PRAGMA journal_mode = WAL').all();
  raw.exec('PRAGMA foreign_keys = ON');
  if (options.vec === true) {
    if (typeof raw.loadExtension !== 'function') {
      throw new Error(`${opener.name} does not expose loadExtension`);
    }
    const sqliteVec = require('sqlite-vec') as { getLoadablePath(): string };
    raw.loadExtension(sqliteVec.getLoadablePath());
  }
  const versions = options.memorySchema
    ? [2, 7, 10, 15, 16, 17, 18, 19, 43, 44]
    : [16, 43];
  for (const version of versions) {
    const migration = MIGRATIONS.find((item) => item.version === version);
    if (migration?.sql) raw.exec(migrationSql(version));
    const vecSql = migrationVecSql(version);
    if (options.vec === true && vecSql !== null) {
      raw.exec(vecSql);
    }
  }
  const issued: string[] = [];
  let db = adaptSqliteDatabase(raw, issued);
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
    get raw() {
      return raw;
    },
    get db() {
      return db;
    },
    issued,
    connection,
    openSecondHandle: () => opener.open(file),
    reopenWithoutVec: () => {
      raw.close();
      raw = opener.open(file, false);
      raw.exec('PRAGMA foreign_keys = ON');
      db = adaptSqliteDatabase(raw, issued);
    },
    close: () => {
      if (closed) return;
      closed = true;
      raw.close();
    },
  };
}

export interface SeedMemoryOptions {
  readonly id: string;
  readonly workspaceRoot?: string | null;
  readonly tier?: 'core' | 'recall' | 'archival';
  readonly pinned?: boolean;
  readonly lastUsedAt?: number;
  readonly archivedAt?: number | null;
  readonly sessionId?: string | null;
  readonly salience?: number;
  readonly chunks?: number;
  readonly concepts?: readonly string[];
  readonly token?: string;
}

/** Seed one complete memory row, including FTS, vec and concept dependants. */
export function seedMemory(raw: RawDb, options: SeedMemoryOptions): void {
  const now = options.lastUsedAt ?? 1_000;
  const concepts = options.concepts ?? [];
  raw
    .prepare(
      `INSERT INTO memories (
       id, session_id, workspace_root, tier, kind, subject, content,
       source_message_ids, salience, decay_rate, hits, pinned,
       created_at, updated_at, last_used_at, expires_at,
       request, investigated, learned, completed, next_steps,
       type, concepts_json, files_json, archived_at
     ) VALUES (?, ?, ?, ?, 'fact', NULL, ?, '[]', ?, 0.01, 0, ?,
       ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 'discovery', ?, '[]', ?)`,
    )
    .run(
      options.id,
      options.sessionId ?? null,
      options.workspaceRoot ?? null,
      options.tier ?? 'recall',
      options.token ?? `memory ${options.id}`,
      options.salience ?? 0.6,
      options.pinned ? 1 : 0,
      now,
      now,
      now,
      JSON.stringify(concepts),
      options.archivedAt ?? null,
    );
  const insertChunk = raw.prepare(
    `INSERT INTO memory_chunks (id, memory_id, ord, text, token_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertVec = raw.prepare(
    'INSERT INTO memory_chunks_vec(rowid, embedding) VALUES (?, ?)',
  );
  for (let ord = 0; ord < (options.chunks ?? 1); ord++) {
    const id = `${options.id}-chunk-${ord}`;
    insertChunk.run(
      id,
      options.id,
      ord,
      `${options.token ?? options.id} ${ord}`,
      1,
      now,
    );
    const row = raw
      .prepare('SELECT rowid FROM memory_chunks WHERE id = ?')
      .get(id) as { rowid: number };
    insertVec.run(BigInt(row.rowid), Buffer.from(new Float32Array(384).buffer));
  }
  const insertConcept = raw.prepare(
    'INSERT INTO memory_concepts_fts(memory_id, concept) VALUES (?, ?)',
  );
  for (const concept of concepts) insertConcept.run(options.id, concept);
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
