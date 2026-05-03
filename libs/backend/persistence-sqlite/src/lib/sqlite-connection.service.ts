/**
 * SqliteConnectionService — owns the single shared ~/.ptah/ptah.db handle.
 *
 * Single connection per app instance. better-sqlite3 is synchronous and
 * thread-safe under WAL; spawning multiple connections to the same file
 * defeats the WAL fast-path, so every consumer (memory-curator,
 * skill-synthesis, cron-scheduler, messaging-gateway) injects this service
 * rather than constructing its own `Database`.
 *
 * Pragmas are applied on every open. `sqlite-vec` is loaded best-effort —
 * a missing native binary degrades gracefully (BM25 still works; vector
 * search consumers must check {@link SqliteConnectionService.vecExtensionLoaded}).
 */
import { inject, injectable } from 'tsyringe';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from './di/tokens';
import { SqliteMigrationRunner } from './migration-runner';
import { MIGRATIONS } from './migrations';

/**
 * Minimal subset of better-sqlite3's `Database` surface that this lib uses.
 * Kept structural so the service can be exercised in tests without the
 * native module installed.
 */
export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  pragma(pragma: string, options?: { simple?: boolean }): unknown;
  loadExtension?(file: string): void;
  close(): void;
  readonly open: boolean;
  readonly inTransaction: boolean;
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
}

export interface SqliteStatement {
  /** Positional-parameter form: `stmt.run(val1, val2, ...)` */
  run(...params: unknown[]): {
    changes: number;
    lastInsertRowid: number | bigint;
  };
  /** Named-parameter form: `stmt.run({ '@id': id, '@name': name })` */
  run(params: Record<string, unknown>): {
    changes: number;
    lastInsertRowid: number | bigint;
  };
  get(...params: unknown[]): unknown;
  get(params: Record<string, unknown>): unknown;
  all(...params: unknown[]): unknown[];
  all(params: Record<string, unknown>): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
}

/** Factory signature — returns a Database opened at the given path. */
export type SqliteDatabaseFactory = (filePath: string) => SqliteDatabase;

/** Resolver for the sqlite-vec loadable extension path. */
export type SqliteVecPathResolver = () => string;

/**
 * Lifecycle pragmas applied on every connection open. The full set is
 * mandated by architecture §3 (TASK_2026_HERMES) — `temp_store = MEMORY`
 * and `mmap_size = 256 MiB` are required so vec0 + FTS5 scratch tables stay
 * off-disk and large workspaces benefit from zero-copy reads.
 */
const PRAGMAS_ON_OPEN = [
  'journal_mode = WAL',
  'foreign_keys = ON',
  'synchronous = NORMAL',
  'temp_store = MEMORY',
  'mmap_size = 268435456', // 256 MiB — matches architecture §3
] as const;

@injectable()
export class SqliteConnectionService {
  private database: SqliteDatabase | null = null;
  private migrationRunner: SqliteMigrationRunner | null = null;
  private vecLoaded = false;

  /** Test seam: injectable factory for the underlying Database. */
  private factory: SqliteDatabaseFactory = defaultBetterSqlite3Factory;
  /** Test seam: resolver for the sqlite-vec extension path. */
  private vecPathResolver: SqliteVecPathResolver | null =
    defaultSqliteVecPathResolver;

  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_DB_PATH) private readonly dbPath: string,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Test/integration seam — override the Database factory and (optionally)
   * the sqlite-vec extension path resolver before calling
   * {@link openAndMigrate}. Production callers never need this.
   */
  configure(options: {
    factory?: SqliteDatabaseFactory;
    vecPathResolver?: SqliteVecPathResolver | null;
  }): void {
    if (options.factory) this.factory = options.factory;
    if (options.vecPathResolver !== undefined)
      this.vecPathResolver = options.vecPathResolver;
  }

  /**
   * Open the database, apply pragmas, attempt to load sqlite-vec, then run
   * any pending migrations. Idempotent: a second call with an already-open
   * connection is a no-op.
   */
  async openAndMigrate(): Promise<void> {
    if (this.database?.open) {
      this.logger.debug(
        '[persistence-sqlite] openAndMigrate called while already open — skipping',
      );
      return;
    }
    this.ensureParentDirectory(this.dbPath);
    const db = this.factory(this.dbPath);
    this.applyPragmas(db);
    this.loadVecExtension(db);
    this.database = db;
    this.migrationRunner = new SqliteMigrationRunner(db, this.logger);
    const result = this.migrationRunner.applyAll(MIGRATIONS);
    this.logger.info('[persistence-sqlite] openAndMigrate complete', {
      dbPath: this.dbPath,
      vecExtensionLoaded: this.vecLoaded,
      applied: result.appliedVersions,
      finalVersion: result.finalVersion,
    });
  }

  /** Throws if the connection isn't open — protects callers from silent nulls. */
  get db(): SqliteDatabase {
    if (!this.database || !this.database.open) {
      throw new Error(
        'SqliteConnectionService: database is not open. Call openAndMigrate() first.',
      );
    }
    return this.database;
  }

  /** True if `sqlite-vec` was loaded successfully on the current connection. */
  get vecExtensionLoaded(): boolean {
    return this.vecLoaded;
  }

  /** True iff the underlying connection is open. */
  get isOpen(): boolean {
    return Boolean(this.database?.open);
  }

  /** Close the connection. Idempotent — calling twice is safe. */
  close(): void {
    if (!this.database) return;
    if (this.database.open) {
      try {
        this.database.close();
      } catch (err) {
        this.logger.warn('[persistence-sqlite] error closing database', {
          error: stringifyError(err),
        });
      }
    }
    this.database = null;
    this.migrationRunner = null;
    this.vecLoaded = false;
  }

  private ensureParentDirectory(filePath: string): void {
    const dir = path.dirname(filePath);
    if (filePath !== ':memory:' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private applyPragmas(db: SqliteDatabase): void {
    for (const pragma of PRAGMAS_ON_OPEN) {
      try {
        db.pragma(pragma);
      } catch (err) {
        this.logger.warn('[persistence-sqlite] failed to apply pragma', {
          pragma,
          error: stringifyError(err),
        });
      }
    }
  }

  private loadVecExtension(db: SqliteDatabase): void {
    if (typeof db.loadExtension !== 'function') {
      this.logger.warn(
        '[persistence-sqlite] loadExtension unavailable on this Database — vector search disabled',
      );
      this.vecLoaded = false;
      return;
    }
    if (!this.vecPathResolver) {
      this.logger.warn(
        '[persistence-sqlite] no sqlite-vec path resolver — vector search disabled',
      );
      this.vecLoaded = false;
      return;
    }
    try {
      const extPath = this.vecPathResolver();
      db.loadExtension(extPath);
      this.vecLoaded = true;
      this.logger.info('[persistence-sqlite] sqlite-vec loaded', { extPath });
    } catch (err) {
      this.vecLoaded = false;
      this.logger.warn(
        '[persistence-sqlite] sqlite-vec load failed; vector search disabled',
        {
          error: stringifyError(err),
        },
      );
    }
  }
}

/** Lazy default factory that requires better-sqlite3 only when invoked. */
const defaultBetterSqlite3Factory: SqliteDatabaseFactory = (
  filePath: string,
) => {
  const Database = require('better-sqlite3') as new (
    file: string,
  ) => SqliteDatabase;
  return new Database(filePath);
};

/** Lazy resolver that requires sqlite-vec only when invoked. */
const defaultSqliteVecPathResolver: SqliteVecPathResolver = () => {
  const sqliteVec = require('sqlite-vec') as { getLoadablePath: () => string };
  return sqliteVec.getLoadablePath();
};

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
