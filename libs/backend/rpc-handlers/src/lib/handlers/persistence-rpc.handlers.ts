/**
 * Persistence RPC Handlers (TASK_2026_THOTH_PERSISTENCE_HARDENING Batch 4).
 *
 * Surfaces two `db:*` maintenance methods backed by
 * `@ptah-extension/persistence-sqlite`:
 *
 *   - db:health  → inspect connection state, pragma stats, WAL size
 *   - db:reset   → backup → close → rename old file → reopen (5-step workflow)
 *
 * Both methods are license-exempt (maintenance / recovery surfaces) and
 * Electron-only (better-sqlite3 does not run in the VS Code extension host).
 *
 * Per architecture §7 the `db:health` handler MUST NOT throw — it always
 * returns a structured result even when the connection is unavailable.
 * Per architecture §8 the `db:reset` handler may throw `RpcUserError` for
 * user-recoverable guard conditions (wrong confirm token, write in progress).
 */

import { injectable, inject } from 'tsyringe';
import * as fs from 'node:fs';
import { TOKENS } from '@ptah-extension/vscode-core';
import { RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import type { IBackupService } from '@ptah-extension/persistence-sqlite';
import type { RpcMethodName } from '@ptah-extension/shared';

// ---- Public types ----------------------------------------------------------

/**
 * Shape returned by `db:health`. All nullable fields are null when the
 * connection is unavailable so the UI can render an offline badge without
 * special-casing every property individually.
 */
export interface DbHealthResult {
  /** Whether the SQLite connection is currently open. */
  isOpen: boolean;
  /** Result of PRAGMA quick_check. Null if connection is closed. */
  quickCheckPassed: boolean | null;
  /** Count of foreign-key violations. Null if connection is closed. */
  foreignKeyViolations: number | null;
  /** Sample of FK-violation rows (up to 3). Empty when none. */
  foreignKeyViolationSample: Array<{
    table: string;
    rowid: number;
    parent: string;
    fkid: number;
  }>;
  /** DB file size in megabytes. Null if connection is closed. */
  dbSizeMb: number | null;
  /** Ratio of freelist pages to total pages (0.0–1.0). Null if closed. */
  freelistRatio: number | null;
  /** WAL file size in kilobytes. Null if closed or WAL absent. */
  walSizeKb: number | null;
  /** Whether the sqlite-vec extension was successfully loaded. */
  vecExtensionLoaded: boolean;
  /** Highest migration version applied (PRAGMA user_version). 0 if none. */
  lastMigrationVersion: number;
  /** True when `fullCheck=true` was requested and integrity_check ran. */
  fullCheckRun: boolean;
  /** integrity_check result. Null unless fullCheckRun=true. */
  integrityCheckPassed: boolean | null;
}

/** Optional request params for `db:health`. */
export interface DbHealthParams {
  /** When true, runs the slow PRAGMA integrity_check in addition to quick_check. */
  fullCheck?: boolean;
}

/** Request params for `db:reset`. */
export interface DbResetParams {
  /** Must equal the string literal 'CONFIRM' to prevent accidental resets. */
  confirm: string;
}

/** Result shape returned by `db:reset`. */
export interface DbResetResult {
  /** Absolute path of the backup taken before reset. Null if backup failed. */
  backupPath: string | null;
  /** True if the 5-step reset workflow succeeded. */
  success: boolean;
  /** Human-readable message suitable for a notification. */
  message: string;
}

// ---- Handler class ---------------------------------------------------------

@injectable()
export class PersistenceRpcHandlers {
  static readonly METHODS = [
    'db:health',
    'db:reset',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(PERSISTENCE_TOKENS.BACKUP_SERVICE)
    private readonly backup: IBackupService,
  ) {}

  /** Register both `db:*` methods with the shared RpcHandler. */
  register(): void {
    this.rpcHandler.registerMethod<DbHealthParams, DbHealthResult>(
      'db:health',
      (params) => this.handleHealth(params),
    );

    this.rpcHandler.registerMethod<DbResetParams, DbResetResult>(
      'db:reset',
      (params) => this.handleReset(params),
    );

    this.logger.info('[persistence] RPC handlers registered');
  }

  // ---- db:health -----------------------------------------------------------

  /**
   * Return a structured snapshot of the SQLite connection's health.
   * Never throws — returns `{ isOpen: false }` with nulls when unavailable.
   */
  private async handleHealth(
    params: DbHealthParams | undefined,
  ): Promise<DbHealthResult> {
    const fullCheck = params?.fullCheck === true;

    // When the connection is offline return a minimal result so the UI can
    // render the "persistence offline" badge without further network calls.
    if (this.connection.unavailable !== null) {
      return {
        isOpen: false,
        quickCheckPassed: null,
        foreignKeyViolations: null,
        foreignKeyViolationSample: [],
        dbSizeMb: null,
        freelistRatio: null,
        walSizeKb: null,
        vecExtensionLoaded: false,
        lastMigrationVersion: 0,
        fullCheckRun: false,
        integrityCheckPassed: null,
      };
    }

    const result: DbHealthResult = {
      isOpen: true,
      quickCheckPassed: null,
      foreignKeyViolations: null,
      foreignKeyViolationSample: [],
      dbSizeMb: null,
      freelistRatio: null,
      walSizeKb: null,
      vecExtensionLoaded: this.connection.vecExtensionLoaded,
      lastMigrationVersion: this.connection.lastMigrationVersion,
      fullCheckRun: fullCheck,
      integrityCheckPassed: null,
    };

    try {
      const db = this.connection.db;

      // quick_check
      try {
        const qc = db.pragma('quick_check', { simple: true }) as string;
        result.quickCheckPassed = qc === 'ok';
      } catch (err: unknown) {
        this.logger.warn('[persistence] db:health quick_check failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // foreign_key_check
      try {
        const rows = db.pragma('foreign_key_check') as Array<{
          table: string;
          rowid: number;
          parent: string;
          fkid: number;
        }>;
        result.foreignKeyViolations = rows.length;
        result.foreignKeyViolationSample = rows.slice(0, 3);
      } catch (err: unknown) {
        this.logger.warn('[persistence] db:health foreign_key_check failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Page / size stats
      try {
        const pageCount = db.pragma('page_count', { simple: true }) as number;
        const pageSize = db.pragma('page_size', { simple: true }) as number;
        const freelist = db.pragma('freelist_count', {
          simple: true,
        }) as number;
        result.dbSizeMb =
          Math.round(((pageCount * pageSize) / (1024 * 1024)) * 100) / 100;
        result.freelistRatio =
          pageCount > 0
            ? Math.round((freelist / pageCount) * 10000) / 10000
            : 0;
      } catch (err: unknown) {
        this.logger.warn('[persistence] db:health page stats failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // WAL file size — read from fs, not from PRAGMA (PRAGMA wal_checkpoint
      // would mutate state; we only want to observe)
      try {
        const walPath = this.connection.dbPath + '-wal';
        const walStat = fs.statSync(walPath);
        result.walSizeKb = Math.round(walStat.size / 1024);
      } catch {
        // WAL file absent = fully checkpointed = effectively 0 bytes
        result.walSizeKb = null;
      }

      // Optional slow integrity_check
      if (fullCheck) {
        try {
          const ic = db.pragma('integrity_check', { simple: true }) as string;
          result.integrityCheckPassed = ic === 'ok';
        } catch (err: unknown) {
          this.logger.warn('[persistence] db:health integrity_check failed', {
            error: err instanceof Error ? err.message : String(err),
          });
          result.integrityCheckPassed = false;
        }
      }
    } catch (err: unknown) {
      // db getter can throw RpcUserError when connection closed between the
      // unavailable check above and now (race). Return the offline shape.
      this.logger.warn('[persistence] db:health lost connection during check', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        isOpen: false,
        quickCheckPassed: null,
        foreignKeyViolations: null,
        foreignKeyViolationSample: [],
        dbSizeMb: null,
        freelistRatio: null,
        walSizeKb: null,
        vecExtensionLoaded: false,
        lastMigrationVersion: 0,
        fullCheckRun: false,
        integrityCheckPassed: null,
      };
    }

    return result;
  }

  // ---- db:reset ------------------------------------------------------------

  /**
   * 5-step reset workflow:
   *  1. backup('reset')
   *  2. connection.close()
   *  3. fs.renameSync (EPERM retry after 200 ms on Windows)
   *  4. connection.openAndMigrate()
   *  5. Return success result
   *
   * Throws `RpcUserError('PERSISTENCE_UNAVAILABLE')` for user-recoverable
   * guard failures (wrong confirm token, write in flight). Other failures
   * are caught and returned as `{ success: false }`.
   */
  private async handleReset(
    params: DbResetParams | undefined,
  ): Promise<DbResetResult> {
    // Guard: require explicit confirmation token
    if (!params || params.confirm !== 'CONFIRM') {
      throw new RpcUserError(
        'Reset requires confirm = CONFIRM',
        'PERSISTENCE_UNAVAILABLE',
      );
    }

    // Best-effort guard: reject while a write transaction is open
    if (this.connection.isOpen) {
      try {
        const db = this.connection.db;
        if (db.inTransaction) {
          throw new RpcUserError(
            'A write is in progress. Please try again in a moment.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      } catch (err: unknown) {
        if (err instanceof RpcUserError) throw err;
        // Connection went offline between isOpen check and db getter — proceed
        // with reset since there cannot be an in-flight transaction.
      }
    }

    const dbPath = this.connection.dbPath;
    let backupPath: string | null = null;

    try {
      // Step 1: backup
      if (this.connection.isOpen) {
        try {
          backupPath = await this.backup.backup(this.connection.db, 'reset');
        } catch (err: unknown) {
          // backup() should never throw, but be defensive
          this.logger.warn('[persistence] db:reset backup error (non-fatal)', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Step 2: close (WAL checkpoint + close)
      this.connection.close();

      // Step 3: rename old file to .deleted-<ts>
      const deletedPath = `${dbPath}.deleted-${Date.now()}`;
      const renamed = this.tryRename(dbPath, deletedPath);
      if (!renamed.ok) {
        return {
          backupPath,
          success: false,
          message: `Could not rename old database: ${renamed.error}`,
        };
      }

      // Step 4: open fresh DB + run migrations
      await this.connection.openAndMigrate();

      // Step 5: return success
      const backupNote = backupPath
        ? `Backup at ${backupPath}.`
        : 'No backup was taken (backup service unavailable).';
      return {
        backupPath,
        success: true,
        message: `Database reset. ${backupNote}`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('[persistence] db:reset failed', { error: message });
      return {
        backupPath,
        success: false,
        message: `Reset failed: ${message}`,
      };
    }
  }

  /**
   * Attempt `fs.renameSync`. On EPERM (antivirus interference on Windows),
   * waits 200 ms and retries once. Returns `{ ok: true }` on success or
   * `{ ok: false, error: string }` after both attempts fail.
   */
  private tryRename(
    src: string,
    dest: string,
  ): { ok: true } | { ok: false; error: string } {
    const attempt = (): { ok: true } | { ok: false; error: string } => {
      try {
        fs.renameSync(src, dest);
        return { ok: true };
      } catch (err: unknown) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

    const first = attempt();
    if (first.ok) return first;

    // Only retry on EPERM (Windows AV interference)
    if (!first.error.includes('EPERM')) return first;

    // Synchronous 200 ms wait — acceptable here because we've already closed
    // the DB and the user is waiting for the reset to complete.
    const deadline = Date.now() + 200;
    while (Date.now() < deadline) {
      /* busy wait */ void 0;
    }

    return attempt();
  }
}
