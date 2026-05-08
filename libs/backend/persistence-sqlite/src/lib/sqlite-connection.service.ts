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
import { TOKENS, type Logger, RpcUserError } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from './di/tokens';
import { SqliteMigrationRunner } from './migration-runner';
import { MIGRATIONS } from './migrations';
import type { IBackupService } from './backup.service';

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
  /**
   * better-sqlite3 Online Backup API. Optional — test fakes omit this to
   * trigger the non-fatal guard in `SqliteBackupService.backup()`.
   */
  backup?(destPath: string): Promise<void>;
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
 *
 * D4: `busy_timeout = 5000` goes last — it is a connection-level pragma with
 * no ordering dependency on WAL/FK/sync.
 */
const PRAGMAS_ON_OPEN = [
  'journal_mode = WAL',
  'foreign_keys = ON',
  'synchronous = NORMAL',
  'temp_store = MEMORY',
  'mmap_size = 268435456', // 256 MiB — matches architecture §3
  'busy_timeout = 5000', // D4 — prevents SQLITE_BUSY on concurrent access
] as const;

/**
 * Why the SQLite connection isn't currently open. Used by the typed
 * {@link RpcUserError} thrown from the `db` getter so callers (and the
 * UI) get a structured, actionable signal instead of a raw stack trace.
 */
export type SqliteUnavailableReason =
  | 'not_initialized'
  | 'native_abi_mismatch'
  | 'native_module_missing'
  | 'open_failed'
  | 'closed';

@injectable()
export class SqliteConnectionService {
  private database: SqliteDatabase | null = null;
  private migrationRunner: SqliteMigrationRunner | null = null;
  private vecLoaded = false;
  private unavailableReason: SqliteUnavailableReason = 'not_initialized';
  private unavailableDetail: string | null = null;

  /** Test seam: injectable factory for the underlying Database. */
  private factory: SqliteDatabaseFactory = defaultBetterSqlite3Factory;
  /** Test seam: resolver for the sqlite-vec extension path. */
  private vecPathResolver: SqliteVecPathResolver | null =
    defaultSqliteVecPathResolver;
  /** Optional backup service — set via configure() or DI post-construction. */
  private backupService: IBackupService | undefined = undefined;

  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_DB_PATH) private readonly dbPath: string,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {
    this.logger.info(
      '[persistence-sqlite] SqliteConnectionService constructed',
      { dbPath },
    );
  }

  /**
   * Test/integration seam — override the Database factory, vec path resolver,
   * and backup service before calling {@link openAndMigrate}.
   * Production callers use `setBackupService()` instead of this method.
   */
  configure(options: {
    factory?: SqliteDatabaseFactory;
    vecPathResolver?: SqliteVecPathResolver | null;
    backupService?: IBackupService;
  }): void {
    if (options.factory) this.factory = options.factory;
    if (options.vecPathResolver !== undefined)
      this.vecPathResolver = options.vecPathResolver;
    if (options.backupService !== undefined)
      this.backupService = options.backupService;
  }

  /**
   * Wire the backup service after construction. Called by the DI registration
   * helper after both `SqliteConnectionService` and `SqliteBackupService` are
   * resolved from the container.
   */
  setBackupService(svc: IBackupService): void {
    this.backupService = svc;
  }

  /**
   * Open the database, apply pragmas, attempt to load sqlite-vec, then run
   * any pending migrations. Idempotent: a second call with an already-open
   * connection is a no-op.
   *
   * Migrations marked `requiresVec: true` are skipped gracefully when
   * sqlite-vec is unavailable, so cron / gateway / basic memory operations
   * still work even without vector search support.
   */
  async openAndMigrate(): Promise<void> {
    if (this.database?.open) {
      this.logger.debug(
        '[persistence-sqlite] openAndMigrate called while already open — skipping',
      );
      return;
    }
    this.logger.info('[persistence-sqlite] Starting openAndMigrate...', {
      dbPath: this.dbPath,
    });
    this.ensureParentDirectory(this.dbPath);
    this.logger.debug('[persistence-sqlite] Parent directory ensured');

    let db: SqliteDatabase;
    try {
      db = this.factory(this.dbPath);
      this.logger.debug('[persistence-sqlite] Database factory created');
    } catch (err: unknown) {
      this.classifyOpenFailure(err);
      throw err;
    }

    this.applyPragmas(db);
    this.logger.debug('[persistence-sqlite] Pragmas applied');
    this.loadVecExtension(db);
    this.logger.debug('[persistence-sqlite] Vec extension loaded (or skipped)');
    this.database = db;
    this.unavailableReason = 'not_initialized';
    this.unavailableDetail = null;
    this.logConnectionHealth(db);
    this.runBootChecks(db);
    this.migrationRunner = new SqliteMigrationRunner(
      db,
      this.logger,
      this.backupService,
    );
    this.logger.debug(
      '[persistence-sqlite] Migration runner created, applying migrations...',
    );
    const result = await this.migrationRunner.applyAll(MIGRATIONS, {
      vecExtensionLoaded: this.vecLoaded,
    });
    this.logger.info('[persistence-sqlite] openAndMigrate complete', {
      dbPath: this.dbPath,
      vecExtensionLoaded: this.vecLoaded,
      applied: result.appliedVersions,
      finalVersion: result.finalVersion,
    });
  }

  /**
   * Inspect a Database-construction failure and stash a typed reason so
   * the `db` getter can emit a {@link RpcUserError} with an actionable
   * message instead of a raw stack trace.
   *
   * The most common failure on Electron is `NODE_MODULE_VERSION` mismatch
   * — surfaced as `dlopen` reporting "compiled against a different Node.js
   * version". We detect that string and tell the user exactly which
   * command rebuilds the native module.
   */
  private classifyOpenFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /NODE_MODULE_VERSION|compiled against a different Node\.js version/i.test(
        message,
      )
    ) {
      this.unavailableReason = 'native_abi_mismatch';
      this.unavailableDetail =
        'better-sqlite3 was built for a different Node ABI than the host runtime. Run `npm run electron:rebuild` and restart.';
    } else if (/Cannot find module|MODULE_NOT_FOUND/i.test(message)) {
      this.unavailableReason = 'native_module_missing';
      this.unavailableDetail =
        'better-sqlite3 native binary is missing. Run `npm install` followed by `npm run electron:rebuild`.';
    } else if (/SQLITE_FULL|ENOSPC|no space left on device/i.test(message)) {
      this.unavailableReason = 'open_failed';
      this.unavailableDetail =
        'Disk is full. Free space at ~/.ptah and restart.';
    } else if (/EPERM|permission denied|access is denied/i.test(message)) {
      this.unavailableReason = 'open_failed';
      this.unavailableDetail =
        'Permission denied opening ~/.ptah/state/ptah.sqlite. Check antivirus exclusions for the ~/.ptah directory.';
    } else {
      this.unavailableReason = 'open_failed';
      this.unavailableDetail = message;
    }
    this.logger.error(
      '[persistence-sqlite] openAndMigrate failed — persistence disabled',
      { reason: this.unavailableReason, detail: this.unavailableDetail },
    );
  }

  /**
   * Called by write-path callers when they encounter a fatal write error.
   * If the error indicates a full disk, closes the connection and marks it
   * unavailable so subsequent `db` getter calls surface a clear message.
   * Returns `true` if action was taken, `false` otherwise.
   * EPERM at write-time: the DB is still readable, so the connection is NOT
   * closed — log and let the caller surface the error.
   */
  handleFatalWriteError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    if (/SQLITE_FULL|ENOSPC|no space left on device/i.test(message)) {
      this.unavailableDetail =
        'Disk full — persistence suspended. Free space and restart Ptah.';
      this.close(); // sets unavailableReason = 'closed'
      this.logger.error(
        '[persistence-sqlite] fatal write error — connection closed',
        { detail: this.unavailableDetail },
      );
      return true;
    }
    return false;
  }

  /**
   * Throws a typed {@link RpcUserError} if the connection isn't open.
   *
   * RPC handlers that hit this path will get a structured
   * `{ success: false, errorCode: 'PERSISTENCE_UNAVAILABLE' }` response —
   * the frontend can render an actionable message instead of a generic
   * stack trace, and Sentry skips the report (this is an expected
   * environment failure, not a bug).
   */
  get db(): SqliteDatabase {
    if (!this.database || !this.database.open) {
      throw new RpcUserError(
        this.buildUnavailableMessage(),
        'PERSISTENCE_UNAVAILABLE',
      );
    }
    return this.database;
  }

  /**
   * Why the connection isn't open. `'not_initialized'` while booting,
   * a more specific reason after a failed {@link openAndMigrate}, or
   * `null` once the connection is healthy.
   */
  get unavailable(): {
    reason: SqliteUnavailableReason;
    detail: string | null;
  } | null {
    if (this.database?.open) return null;
    return {
      reason: this.unavailableReason,
      detail: this.unavailableDetail,
    };
  }

  private buildUnavailableMessage(): string {
    switch (this.unavailableReason) {
      case 'native_abi_mismatch':
        return (
          this.unavailableDetail ??
          'Persistence is offline: native module ABI mismatch. Run `npm run electron:rebuild` and restart.'
        );
      case 'native_module_missing':
        return (
          this.unavailableDetail ??
          'Persistence is offline: better-sqlite3 native binary is missing.'
        );
      case 'open_failed':
        return `Persistence is offline: ${this.unavailableDetail ?? 'failed to open SQLite database.'}`;
      case 'closed':
        return 'Persistence is offline: SQLite connection has been closed.';
      case 'not_initialized':
      default:
        return 'Persistence is offline: SQLite connection has not been initialized yet.';
    }
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
      // D1: Truncate the WAL before closing so the DB file is self-contained.
      // Non-fatal — a checkpoint failure must not prevent the close.
      try {
        this.database.pragma('wal_checkpoint(TRUNCATE)');
        this.logger.debug(
          '[persistence-sqlite] WAL checkpoint (TRUNCATE) completed',
        );
      } catch (err: unknown) {
        this.logger.warn(
          '[persistence-sqlite] WAL checkpoint failed (non-fatal)',
          {
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
      try {
        this.database.close();
      } catch (err: unknown) {
        this.logger.warn('[persistence-sqlite] error closing database', {
          error: stringifyError(err),
        });
      }
    }
    this.database = null;
    this.migrationRunner = null;
    this.vecLoaded = false;
    this.unavailableReason = 'closed';
    this.unavailableDetail = null;
  }

  private ensureParentDirectory(filePath: string): void {
    const dir = path.dirname(filePath);
    this.logger.debug('[persistence-sqlite] ensureParentDirectory', {
      filePath,
      dir,
    });
    if (filePath !== ':memory:' && !fs.existsSync(dir)) {
      this.logger.info('[persistence-sqlite] Creating directory', { dir });
      fs.mkdirSync(dir, { recursive: true });
      this.logger.info('[persistence-sqlite] Directory created', { dir });
    } else {
      this.logger.debug('[persistence-sqlite] Directory already exists', {
        dir,
      });
    }
  }

  private applyPragmas(db: SqliteDatabase): void {
    for (const pragma of PRAGMAS_ON_OPEN) {
      try {
        db.pragma(pragma);
      } catch (err: unknown) {
        this.logger.warn('[persistence-sqlite] failed to apply pragma', {
          pragma,
          error: stringifyError(err),
        });
      }
    }
  }

  /**
   * D6 — Emit one structured info log with key DB file statistics.
   * Called after vec extension load so `vecExtensionLoaded` is accurate.
   * Failure is non-fatal: logs a warn and returns.
   */
  private logConnectionHealth(db: SqliteDatabase): void {
    try {
      const pageCount = db.pragma('page_count', { simple: true }) as number;
      const pageSize = db.pragma('page_size', { simple: true }) as number;
      const freelist = db.pragma('freelist_count', { simple: true }) as number;
      const journalMode = db.pragma('journal_mode', { simple: true }) as string;
      const dbSizeMb = (pageCount * pageSize) / (1024 * 1024);
      this.logger.info('[persistence-sqlite] connection health', {
        dbSizeMb: Math.round(dbSizeMb * 100) / 100,
        pageCount,
        pageSize,
        freelistCount: freelist,
        journalMode,
        vecExtensionLoaded: this.vecLoaded,
      });
    } catch (err: unknown) {
      this.logger.warn('[persistence-sqlite] logConnectionHealth failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * D3 — Run `quick_check` (and in a later batch, FK check) after pragmas
   * and before migrations. Non-fatal: any failure logs and returns without
   * throwing or marking the connection unavailable.
   */
  private runBootChecks(db: SqliteDatabase): void {
    try {
      const result = db.pragma('quick_check', { simple: true }) as string;
      if (result === 'ok') {
        this.logger.info('[persistence-sqlite] quick_check passed');
      } else {
        this.logger.error('[persistence-sqlite] quick_check FAILED', {
          result,
        });
        // Non-fatal: log only; do NOT throw; do NOT set unavailableReason.
      }
    } catch (err: unknown) {
      this.logger.warn('[persistence-sqlite] quick_check error', {
        error: err instanceof Error ? err.message : String(err),
      });
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
    } catch (err: unknown) {
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
