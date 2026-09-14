/**
 * SqlitePageReclaimer — the one owner of free-page statistics and incremental
 * page reclamation for the shared database file (TASK_2026_440).
 *
 * Deleting rows does not shrink a SQLite file: the pages go onto the freelist.
 * With `auto_vacuum = INCREMENTAL` (mode 2, set by migration `0009`) those pages
 * can be handed back to the filesystem a bounded number at a time with
 * `PRAGMA incremental_vacuum(N)`. That bound is the whole point — this class
 * never issues a full vacuum, which rewrites the entire file on the calling
 * thread (the Electron main thread) and would freeze the app for seconds on a
 * 1 GB database.
 *
 * EVERY METHOD DEGRADES INSTEAD OF THROWING. `connection.db` throws
 * `RpcUserError('PERSISTENCE_UNAVAILABLE')` when the database is closed; a
 * pragma can fail with `SQLITE_BUSY`. Both return zeros and log, because a
 * reclaim that did not happen costs nothing but disk space until the next run.
 *
 * The `maxPages` validation is the INJECTION GUARD: a pragma argument cannot
 * be bound as a parameter, so the integer is interpolated into the pragma text
 * and must be proved to be a finite integer in range before any SQL runs.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from './di/tokens';
import type {
  SqliteConnectionService,
  SqliteDatabase,
} from './sqlite-connection.service';

/** `PRAGMA auto_vacuum` value meaning INCREMENTAL. */
const AUTO_VACUUM_INCREMENTAL = 2;

/** Largest `maxPages` one reclaim step accepts. */
const MAX_PAGES_PER_STEP = 65_536;

/** Page statistics of the open database file. */
export interface SqlitePageStats {
  /** `PRAGMA page_size`, bytes. */
  readonly pageSize: number;
  /** `PRAGMA page_count`. */
  readonly pageCount: number;
  /** `PRAGMA freelist_count` — pages held free inside the file. */
  readonly freelistCount: number;
  /** `PRAGMA auto_vacuum`: 0 none, 1 full, 2 incremental. */
  readonly autoVacuumMode: number;
}

/** Result of one bounded reclaim step. */
export interface SqliteReclaimStepResult {
  /** Pages handed back to the filesystem (freelist before minus after). */
  readonly pagesReclaimed: number;
  /** Wall-clock cost of the step, ms. `0` when no SQL ran. */
  readonly durationMs: number;
}

const ZERO_STATS: SqlitePageStats = {
  pageSize: 0,
  pageCount: 0,
  freelistCount: 0,
  autoVacuumMode: 0,
};

const NO_STEP: SqliteReclaimStepResult = { pagesReclaimed: 0, durationMs: 0 };

/** `true` when `value` is a finite integer in `1..MAX_PAGES_PER_STEP`. */
function isValidMaxPages(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_PAGES_PER_STEP;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@injectable()
export class SqlitePageReclaimer {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  /**
   * Current page statistics. All zeros when the connection is closed or a
   * pragma fails — never throws.
   */
  readPageStats(): SqlitePageStats {
    const db = this.openDb();
    if (!db) return ZERO_STATS;
    try {
      return this.statsOf(db);
    } catch (error: unknown) {
      this.logger.warn('[persistence-sqlite] page stats read failed', {
        error: errorText(error),
      });
      return ZERO_STATS;
    }
  }

  /**
   * Hand back at most `maxPages` free pages to the filesystem.
   *
   * Runs no SQL at all when `maxPages` is not a finite integer in
   * `1..65,536`. Reclaims nothing (returns 0) when the file is not in
   * incremental auto-vacuum mode, when a transaction is open on the shared
   * connection, when the freelist is empty, or when the connection is closed.
   * Never throws.
   */
  reclaimStep(maxPages: number): SqliteReclaimStepResult {
    if (!isValidMaxPages(maxPages)) {
      this.logger.warn(
        '[persistence-sqlite] reclaimStep refused an invalid maxPages',
        { maxPages: String(maxPages) },
      );
      return NO_STEP;
    }
    const db = this.openDb();
    if (!db) return NO_STEP;

    const startedAt = Date.now();
    try {
      if (db.inTransaction) {
        this.logger.debug(
          '[persistence-sqlite] reclaimStep skipped: a transaction is open',
        );
        return NO_STEP;
      }
      const before = this.statsOf(db);
      if (before.autoVacuumMode !== AUTO_VACUUM_INCREMENTAL) {
        return NO_STEP;
      }
      if (before.freelistCount <= 0) {
        return { pagesReclaimed: 0, durationMs: Date.now() - startedAt };
      }
      const pages = Math.min(before.freelistCount, maxPages);
      // `pages` is a validated integer in 1..65,536 — the pragma argument
      // cannot be bound, so this check above is what keeps the text static in
      // shape. `pragma()` steps the statement to completion, which matters:
      // incremental_vacuum frees ONE page per step, so a single `step()` would
      // reclaim a single page.
      db.pragma(`incremental_vacuum(${pages})`);
      const freelistAfter = Number(
        db.pragma('freelist_count', { simple: true }),
      );
      return {
        pagesReclaimed: Math.max(0, before.freelistCount - freelistAfter),
        durationMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      this.logger.warn('[persistence-sqlite] reclaimStep failed (non-fatal)', {
        error: errorText(error),
      });
      return { pagesReclaimed: 0, durationMs: Date.now() - startedAt };
    }
  }

  /**
   * `PRAGMA wal_checkpoint(PASSIVE)` so the WAL does not keep holding the pages
   * a reclaim just relocated. PASSIVE never waits on readers or writers.
   * Never throws.
   */
  checkpointPassive(): void {
    const db = this.openDb();
    if (!db) return;
    try {
      db.pragma('wal_checkpoint(PASSIVE)');
    } catch (error: unknown) {
      this.logger.warn(
        '[persistence-sqlite] passive WAL checkpoint failed (non-fatal)',
        { error: errorText(error) },
      );
    }
  }

  /** The open handle, or `null` when the connection is closed. */
  private openDb(): SqliteDatabase | null {
    try {
      return this.connection.db;
    } catch (error: unknown) {
      // Debug, not warn: on a host whose database is closed this fires on every
      // call, and returning zeros is the correct outcome.
      this.logger.debug(
        '[persistence-sqlite] page reclaimer: connection unavailable',
        { error: errorText(error) },
      );
      return null;
    }
  }

  private statsOf(db: SqliteDatabase): SqlitePageStats {
    return {
      pageSize: Number(db.pragma('page_size', { simple: true })),
      pageCount: Number(db.pragma('page_count', { simple: true })),
      freelistCount: Number(db.pragma('freelist_count', { simple: true })),
      autoVacuumMode: Number(db.pragma('auto_vacuum', { simple: true })),
    };
  }
}
