/**
 * ObservationRetentionStore — every SQL statement memory retention runs
 * against `observation_queue`, `observation_quarantine` and
 * `memory_retention_state` (TASK_2026_440). It holds no policy: budgets,
 * gates and ordering belong to `MemoryRetentionService`.
 *
 * ## One transaction per batch method, no batch loop
 *
 * better-sqlite3 runs on the calling thread, which in Electron owns every
 * window. Each batch method therefore does ONE bounded unit of work inside ONE
 * `BEGIN IMMEDIATE` … `COMMIT` and returns; the service yields to the event
 * loop between calls. The explicit `BEGIN IMMEDIATE` (not `db.transaction()`)
 * takes the write lock up front when two hosts share the file, and is
 * portable to `node:sqlite`, which has no `transaction()`.
 *
 * ## Plans that do not depend on `sqlite_stat1`
 *
 * The processed purge cannot use `idx_obs_queue_drain` (a partial index over
 * UNPROCESSED rows), and `processed_at` is not a leading key of
 * `idx_obs_queue_session`. Without statistics a bare `processed_at < ?` is a
 * full covering-index scan — measured at 766 ms per batch on the live file. So
 * the purge walks `idx_obs_queue_session` session by session with `INDEXED BY`:
 * a seek to the next session, then a range on `(session_id = ?, processed_at)`.
 * Id lists reach the DELETE as a bound JSON string through `json_each`, so the
 * delete is rowid lookups and the SQL text never changes shape.
 *
 * ## `processed_at` is never written here
 *
 * Only the curator's `markProcessed` may set it: a row marked processed without
 * being curated is a silently lost observation. Stuck rows are summarised into
 * the ledger and deleted instead. A spec asserts no statement in this file sets
 * the column.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
  type SqliteDatabase,
  type SqliteStatement,
} from '@ptah-extension/persistence-sqlite';

const NEXT_SESSION_SQL = `SELECT session_id FROM observation_queue INDEXED BY idx_obs_queue_session
 WHERE session_id > @after ORDER BY session_id LIMIT 1`;

const PROCESSED_IDS_FOR_SESSION_SQL = `SELECT id FROM observation_queue INDEXED BY idx_obs_queue_session
 WHERE session_id = @sid AND processed_at IS NOT NULL AND processed_at < @cutoff
 LIMIT @remaining`;

const DELETE_IDS_SQL = `DELETE FROM observation_queue
 WHERE id IN (SELECT value FROM json_each(@ids))`;

const STUCK_IDS_SQL = `SELECT id FROM observation_queue INDEXED BY idx_obs_queue_drain
 WHERE processed_at IS NULL AND captured_at < @cutoff
 ORDER BY captured_at LIMIT @limit`;

const STUCK_PAYLOAD_BYTES_SQL = `SELECT COALESCE(SUM(
   COALESCE(octet_length(q.tool_response_text),0) + COALESCE(octet_length(q.tool_input_json),0)
 + COALESCE(octet_length(q.assistant_message),0) + COALESCE(octet_length(q.user_prompt),0)
 + COALESCE(octet_length(q.file_path),0)), 0) AS bytes
 FROM observation_queue q
 WHERE q.id IN (SELECT value FROM json_each(@ids))`;

// The WHERE clause before ON CONFLICT is required: SQLite's upsert grammar
// needs the SELECT to carry one, or `ON` parses as a join constraint.
const QUARANTINE_UPSERT_SQL = `INSERT INTO observation_quarantine
  (session_id, kind, reason, row_count, payload_bytes,
   oldest_captured_at, newest_captured_at, first_quarantined_at, last_quarantined_at)
SELECT q.session_id, q.kind, 'stuck-unprocessed', COUNT(*),
       SUM(COALESCE(octet_length(q.tool_response_text),0) + COALESCE(octet_length(q.tool_input_json),0)
         + COALESCE(octet_length(q.assistant_message),0) + COALESCE(octet_length(q.user_prompt),0)
         + COALESCE(octet_length(q.file_path),0)),
       MIN(q.captured_at), MAX(q.captured_at), @now, @now
  FROM observation_queue q
 WHERE q.id IN (SELECT value FROM json_each(@ids))
 GROUP BY q.session_id, q.kind
ON CONFLICT(session_id, kind, reason) DO UPDATE SET
  row_count           = row_count + excluded.row_count,
  payload_bytes       = payload_bytes + excluded.payload_bytes,
  oldest_captured_at  = MIN(oldest_captured_at, excluded.oldest_captured_at),
  newest_captured_at  = MAX(newest_captured_at, excluded.newest_captured_at),
  last_quarantined_at = excluded.last_quarantined_at`;

// Re-checks `processed_at IS NULL`, so the never-delete-a-processed-row-as-stuck
// invariant is local to the statement rather than to the transaction around it.
const DELETE_STUCK_SQL = `DELETE FROM observation_queue
 WHERE id IN (SELECT value FROM json_each(@ids)) AND processed_at IS NULL`;

const PRUNE_LEDGER_BY_AGE_SQL = `DELETE FROM observation_quarantine WHERE last_quarantined_at < @olderThan`;

const PRUNE_LEDGER_BY_COUNT_SQL = `DELETE FROM observation_quarantine
 WHERE id NOT IN (SELECT id FROM observation_quarantine
                   ORDER BY last_quarantined_at DESC, id DESC LIMIT @maxRows)`;

const PENDING_SUMMARY_SQL = `SELECT COUNT(*) AS n, MIN(captured_at) AS oldest
 FROM observation_queue INDEXED BY idx_obs_queue_drain
 WHERE processed_at IS NULL`;

/**
 * Payload columns are absent from `idx_obs_queue_drain`, so every matching row
 * requires a base-table lookup. Measured at ~26 ms for ~5k pending rows; above
 * this bound diagnostics report pending bytes as null instead of running it.
 */
export const PENDING_BYTES_MAX_ROWS = 5_000;

const PENDING_BYTES_SQL = `SELECT COALESCE(SUM(
   COALESCE(octet_length(tool_response_text),0) + COALESCE(octet_length(tool_input_json),0)
 + COALESCE(octet_length(assistant_message),0) + COALESCE(octet_length(user_prompt),0)
 + COALESCE(octet_length(file_path),0)), 0) AS bytes
 FROM observation_queue INDEXED BY idx_obs_queue_drain
 WHERE processed_at IS NULL`;

const STUCK_ELIGIBLE_COUNT_SQL = `SELECT COUNT(*) AS n
 FROM observation_queue INDEXED BY idx_obs_queue_drain
 WHERE processed_at IS NULL AND captured_at < @cutoff`;

const LEDGER_COUNT_SQL = `SELECT COUNT(*) AS n FROM observation_quarantine`;

// Deliberately unfiltered and therefore only called at the END of a run, never
// on a diagnostics poll (measured 72 ms warm, 1.4 s cold on the live file).
const TOTAL_ROWS_SQL = `SELECT COUNT(*) AS n FROM observation_queue`;

const READ_STATE_SQL = `SELECT * FROM memory_retention_state WHERE id = 1`;

const WRITE_RUN_SQL = `INSERT INTO memory_retention_state
  (id, last_started_at, last_finished_at, last_outcome, last_reason, last_error,
   last_duration_ms, processed_purged, stuck_quarantined, ledger_pruned,
   freed_bytes, pages_reclaimed, backlog_remaining, last_completed_at,
   processed_rows_after, avg_processed_row_bytes)
VALUES
  (1, @startedAt, @finishedAt, @outcome, @reason, @error,
   @durationMs, @processedPurged, @stuckQuarantined, @ledgerPruned,
   @freedBytes, @pagesReclaimed, @backlogRemaining, @completedAt,
   @processedRowsAfter, @avgProcessedRowBytes)
ON CONFLICT(id) DO UPDATE SET
  last_started_at         = excluded.last_started_at,
  last_finished_at        = excluded.last_finished_at,
  last_outcome            = excluded.last_outcome,
  last_reason             = excluded.last_reason,
  last_error              = excluded.last_error,
  last_duration_ms        = excluded.last_duration_ms,
  processed_purged        = excluded.processed_purged,
  stuck_quarantined       = excluded.stuck_quarantined,
  ledger_pruned           = excluded.ledger_pruned,
  freed_bytes             = excluded.freed_bytes,
  pages_reclaimed         = excluded.pages_reclaimed,
  backlog_remaining       = excluded.backlog_remaining,
  last_completed_at       = COALESCE(excluded.last_completed_at, last_completed_at),
  processed_rows_after    = excluded.processed_rows_after,
  avg_processed_row_bytes = COALESCE(excluded.avg_processed_row_bytes, avg_processed_row_bytes)`;

const WRITE_SKIP_SQL = `INSERT INTO memory_retention_state (id, last_skipped_at, last_skip_reason)
VALUES (1, @at, @reason)
ON CONFLICT(id) DO UPDATE SET
  last_skipped_at  = excluded.last_skipped_at,
  last_skip_reason = excluded.last_skip_reason`;

/**
 * Every statement this store can issue, exported for the spec that asserts
 * query plans and the never-write-`processed_at` invariant. Not part of the lib
 * barrel.
 */
export const OBSERVATION_RETENTION_SQL = {
  NEXT_SESSION_SQL,
  PROCESSED_IDS_FOR_SESSION_SQL,
  DELETE_IDS_SQL,
  STUCK_IDS_SQL,
  STUCK_PAYLOAD_BYTES_SQL,
  QUARANTINE_UPSERT_SQL,
  DELETE_STUCK_SQL,
  PRUNE_LEDGER_BY_AGE_SQL,
  PRUNE_LEDGER_BY_COUNT_SQL,
  PENDING_SUMMARY_SQL,
  PENDING_BYTES_SQL,
  STUCK_ELIGIBLE_COUNT_SQL,
  LEDGER_COUNT_SQL,
  TOTAL_ROWS_SQL,
  READ_STATE_SQL,
  WRITE_RUN_SQL,
  WRITE_SKIP_SQL,
} as const;

/** Failure token a batch method attaches to what it rethrows. */
export type RetentionStepErrorReason = 'database-busy' | 'sql-error';

/**
 * Thrown by a batch method after its transaction rolled back. Only
 * `MemoryRetentionService` catches it: `database-busy` stops a run `partial`,
 * `sql-error` fails it. Batches committed earlier stay committed.
 */
export class RetentionStepError extends Error {
  constructor(
    readonly reason: RetentionStepErrorReason,
    readonly step: string,
    original: unknown,
  ) {
    super(
      `${step}: ${original instanceof Error ? original.message : String(original)}`,
    );
    this.name = 'RetentionStepError';
  }
}

export interface PurgeProcessedBatchResult {
  readonly deleted: number;
  /** Last fully drained `session_id`; pass it back as `cursor`. */
  readonly nextCursor: string;
  /** No session after the cursor remains: the pass is over. */
  readonly exhausted: boolean;
}

export interface QuarantineStuckBatchResult {
  readonly quarantined: number;
  readonly payloadBytes: number;
}

export interface LiveStorageReading {
  readonly pendingRows: number | null;
  readonly pendingBytes: number | null;
  readonly oldestPendingAt: number | null;
  readonly stuckEligibleRows: number | null;
  readonly quarantineLedgerRows: number | null;
  /** `"<read>: <message>"` per failed read; empty when every read succeeded. */
  readonly readErrors: readonly string[];
}

/** The `memory_retention_state` row, camel-cased. */
export interface RetentionState {
  readonly lastStartedAt: number | null;
  readonly lastFinishedAt: number | null;
  readonly lastOutcome: string | null;
  readonly lastReason: string | null;
  readonly lastError: string | null;
  readonly lastDurationMs: number | null;
  readonly processedPurged: number;
  readonly stuckQuarantined: number;
  readonly ledgerPruned: number;
  readonly freedBytes: number;
  readonly pagesReclaimed: number;
  readonly backlogRemaining: boolean;
  readonly lastCompletedAt: number | null;
  readonly processedRowsAfter: number | null;
  readonly avgProcessedRowBytes: number | null;
  readonly lastSkippedAt: number | null;
  readonly lastSkipReason: string | null;
}

/** What `writeRun` persists. `completedAt: null` keeps the previous value. */
export interface RetentionRunRecord {
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: 'completed' | 'partial' | 'failed';
  readonly reason: string | null;
  readonly error: string | null;
  readonly durationMs: number;
  readonly processedPurged: number;
  readonly stuckQuarantined: number;
  readonly ledgerPruned: number;
  readonly freedBytes: number;
  readonly pagesReclaimed: number;
  readonly backlogRemaining: boolean;
  readonly completedAt: number | null;
  readonly processedRowsAfter: number | null;
  /** `null` keeps the previous value. */
  readonly avgProcessedRowBytes: number | null;
}

interface StateDbRow {
  last_started_at: number | null;
  last_finished_at: number | null;
  last_outcome: string | null;
  last_reason: string | null;
  last_error: string | null;
  last_duration_ms: number | null;
  processed_purged: number;
  stuck_quarantined: number;
  ledger_pruned: number;
  freed_bytes: number;
  pages_reclaimed: number;
  backlog_remaining: number;
  last_completed_at: number | null;
  processed_rows_after: number | null;
  avg_processed_row_bytes: number | null;
  last_skipped_at: number | null;
  last_skip_reason: string | null;
}

/** better-sqlite3 `SQLITE_BUSY*` codes, or node:sqlite's primary result code 5. */
function isBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, errcode } = error as { code?: unknown; errcode?: unknown };
  if (typeof code === 'string' && code.startsWith('SQLITE_BUSY')) return true;
  return typeof errcode === 'number' && (errcode & 0xff) === 5;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

@injectable()
export class ObservationRetentionStore {
  /**
   * Prepared-statement cache keyed by SQL text, invalidated by connection
   * IDENTITY — the same guard `ObservationQueueStore.statement` uses, because
   * `openAndMigrate` builds a new handle on every open.
   */
  private readonly statements = new Map<string, SqliteStatement>();
  private cachedDb: SqliteDatabase | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  /**
   * Delete at most `limit` processed rows whose `processed_at` is older than
   * `cutoffMs`, walking sessions after `cursor` in `session_id` order.
   *
   * Keyed on `processed_at`, not `captured_at`: a row captured long ago and
   * processed yesterday is kept for the full window. The walk visits at most
   * `limit` sessions, so a table of many sessions with nothing eligible still
   * costs a bounded number of seeks per batch.
   */
  purgeProcessedBatch(
    cutoffMs: number,
    limit: number,
    cursor: string,
  ): PurgeProcessedBatchResult {
    return this.inTransaction('purge-processed', (db) => {
      const ids: number[] = [];
      let after = cursor;
      let exhausted = false;
      let sessionsVisited = 0;
      while (ids.length < limit && sessionsVisited < limit) {
        const next = this.statement(db, NEXT_SESSION_SQL).get({ after }) as
          | { session_id: string }
          | undefined;
        if (next === undefined) {
          exhausted = true;
          break;
        }
        sessionsVisited++;
        const remaining = limit - ids.length;
        const rows = this.statement(db, PROCESSED_IDS_FOR_SESSION_SQL).all({
          sid: next.session_id,
          cutoff: cutoffMs,
          remaining,
        }) as Array<{ id: number }>;
        for (const row of rows) ids.push(Number(row.id));
        if (rows.length >= remaining) {
          // The session may hold more eligible rows: leave the cursor before it
          // so the next batch re-reads it (the rows deleted below are gone).
          break;
        }
        after = next.session_id;
      }
      const deleted =
        ids.length === 0
          ? 0
          : Number(
              this.statement(db, DELETE_IDS_SQL).run({
                ids: JSON.stringify(ids),
              }).changes,
            );
      return { deleted, nextCursor: after, exhausted };
    });
  }

  /**
   * Summarise at most `limit` of the oldest unprocessed rows captured before
   * `cutoffMs` into `observation_quarantine`, then delete them. Never marks a
   * row processed.
   */
  quarantineStuckBatch(
    cutoffMs: number,
    limit: number,
    nowMs: number,
  ): QuarantineStuckBatchResult {
    return this.inTransaction('quarantine-stuck', (db) => {
      const rows = this.statement(db, STUCK_IDS_SQL).all({
        cutoff: cutoffMs,
        limit,
      }) as Array<{ id: number }>;
      if (rows.length === 0) return { quarantined: 0, payloadBytes: 0 };
      const ids = JSON.stringify(rows.map((r) => Number(r.id)));
      const bytesRow = this.statement(db, STUCK_PAYLOAD_BYTES_SQL).get({
        ids,
      }) as { bytes: number } | undefined;
      this.statement(db, QUARANTINE_UPSERT_SQL).run({ ids, now: nowMs });
      const quarantined = Number(
        this.statement(db, DELETE_STUCK_SQL).run({ ids }).changes,
      );
      return { quarantined, payloadBytes: Number(bytesRow?.bytes ?? 0) };
    });
  }

  /** Bound the ledger by age and by row count. */
  pruneLedger(olderThanMs: number, maxRows: number): { pruned: number } {
    return this.inTransaction('prune-ledger', (db) => {
      const byAge = Number(
        this.statement(db, PRUNE_LEDGER_BY_AGE_SQL).run({
          olderThan: olderThanMs,
        }).changes,
      );
      const byCount = Number(
        this.statement(db, PRUNE_LEDGER_BY_COUNT_SQL).run({ maxRows }).changes,
      );
      return { pruned: byAge + byCount };
    });
  }

  /**
   * Live, index-bounded storage reads for diagnostics. Never throws: a failed
   * read leaves its field `null` and records `"<read>: <message>"`.
   */
  readLiveStorage(stuckCutoffMs: number): LiveStorageReading {
    const readErrors: string[] = [];
    let db: SqliteDatabase;
    try {
      db = this.connection.db;
    } catch (error: unknown) {
      return {
        pendingRows: null,
        pendingBytes: null,
        oldestPendingAt: null,
        stuckEligibleRows: null,
        quarantineLedgerRows: null,
        readErrors: [`connection: ${errorText(error)}`],
      };
    }

    const read = <T>(name: string, fn: () => T): T | null => {
      try {
        return fn();
      } catch (error: unknown) {
        // degradation-audit: reported - a failed diagnostics read is warned and
        // surfaced in readErrors; the null field is the documented outcome.
        readErrors.push(`${name}: ${errorText(error)}`);
        this.logger.warn('[memory-curator] retention storage read failed', {
          read: name,
          error: errorText(error),
        });
        return null;
      }
    };

    const pending = read('pending', () => {
      const row = this.statement(db, PENDING_SUMMARY_SQL).get() as
        | { n: number; oldest: number | null }
        | undefined;
      return {
        rows: Number(row?.n ?? 0),
        oldest: toNumberOrNull(row?.oldest),
      };
    });
    let pendingBytes: number | null = null;
    if (pending !== null) {
      if (pending.rows <= PENDING_BYTES_MAX_ROWS) {
        pendingBytes = read('pendingBytes', () => {
          const row = this.statement(db, PENDING_BYTES_SQL).get() as
            | { bytes: number }
            | undefined;
          return Number(row?.bytes ?? 0);
        });
      } else {
        readErrors.push(
          `pendingBytes: not measured above ${PENDING_BYTES_MAX_ROWS} pending rows`,
        );
      }
    }
    const stuckEligibleRows = read('stuckEligible', () => {
      const row = this.statement(db, STUCK_ELIGIBLE_COUNT_SQL).get({
        cutoff: stuckCutoffMs,
      }) as { n: number } | undefined;
      return Number(row?.n ?? 0);
    });
    const quarantineLedgerRows = read('quarantineLedger', () => {
      const row = this.statement(db, LEDGER_COUNT_SQL).get() as
        | { n: number }
        | undefined;
      return Number(row?.n ?? 0);
    });

    return {
      pendingRows: pending?.rows ?? null,
      pendingBytes,
      oldestPendingAt: pending?.oldest ?? null,
      stuckEligibleRows,
      quarantineLedgerRows,
      readErrors,
    };
  }

  /** Unfiltered row count. End of a run only — never on a diagnostics poll. */
  countTotalRows(): number {
    const db = this.connection.db;
    const row = this.statement(db, TOTAL_ROWS_SQL).get() as
      | { n: number }
      | undefined;
    return Number(row?.n ?? 0);
  }

  /** The run record, or `null` when retention never ran or skipped. */
  readState(): RetentionState | null {
    const db = this.connection.db;
    const row = this.statement(db, READ_STATE_SQL).get() as
      | StateDbRow
      | undefined;
    if (row === undefined) return null;
    return {
      lastStartedAt: toNumberOrNull(row.last_started_at),
      lastFinishedAt: toNumberOrNull(row.last_finished_at),
      lastOutcome: row.last_outcome,
      lastReason: row.last_reason,
      lastError: row.last_error,
      lastDurationMs: toNumberOrNull(row.last_duration_ms),
      processedPurged: Number(row.processed_purged),
      stuckQuarantined: Number(row.stuck_quarantined),
      ledgerPruned: Number(row.ledger_pruned),
      freedBytes: Number(row.freed_bytes),
      pagesReclaimed: Number(row.pages_reclaimed),
      backlogRemaining: Number(row.backlog_remaining) === 1,
      lastCompletedAt: toNumberOrNull(row.last_completed_at),
      processedRowsAfter: toNumberOrNull(row.processed_rows_after),
      avgProcessedRowBytes: toNumberOrNull(row.avg_processed_row_bytes),
      lastSkippedAt: toNumberOrNull(row.last_skipped_at),
      lastSkipReason: row.last_skip_reason,
    };
  }

  /** Persist a finished run. Leaves `last_skipped_at` / `last_skip_reason` alone. */
  writeRun(record: RetentionRunRecord): void {
    const db = this.connection.db;
    this.statement(db, WRITE_RUN_SQL).run({
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      outcome: record.outcome,
      reason: record.reason,
      error: record.error,
      durationMs: record.durationMs,
      processedPurged: record.processedPurged,
      stuckQuarantined: record.stuckQuarantined,
      ledgerPruned: record.ledgerPruned,
      freedBytes: record.freedBytes,
      pagesReclaimed: record.pagesReclaimed,
      backlogRemaining: record.backlogRemaining ? 1 : 0,
      completedAt: record.completedAt,
      processedRowsAfter: record.processedRowsAfter,
      avgProcessedRowBytes: record.avgProcessedRowBytes,
    });
  }

  /** Record a closed gate. Touches ONLY `last_skipped_at` and `last_skip_reason`. */
  writeSkip(atMs: number, reason: string): void {
    const db = this.connection.db;
    this.statement(db, WRITE_SKIP_SQL).run({ at: atMs, reason });
  }

  /**
   * Run `work` inside one `BEGIN IMMEDIATE` … `COMMIT`. On any failure the
   * transaction is rolled back and a {@link RetentionStepError} is thrown.
   */
  private inTransaction<T>(step: string, work: (db: SqliteDatabase) => T): T {
    let db: SqliteDatabase;
    try {
      db = this.connection.db;
    } catch (error: unknown) {
      throw new RetentionStepError('sql-error', step, error);
    }
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (error: unknown) {
      throw new RetentionStepError(
        isBusyError(error) ? 'database-busy' : 'sql-error',
        step,
        error,
      );
    }
    try {
      const result = work(db);
      db.exec('COMMIT');
      return result;
    } catch (error: unknown) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackError: unknown) {
        // A failed COMMIT under SQLITE_BUSY can leave no transaction open, in
        // which case ROLLBACK itself errors; the original failure is what matters.
        this.logger.debug('[memory-curator] retention rollback failed', {
          step,
          error: errorText(rollbackError),
        });
      }
      throw new RetentionStepError(
        isBusyError(error) ? 'database-busy' : 'sql-error',
        step,
        error,
      );
    }
  }

  private statement(db: SqliteDatabase, sql: string): SqliteStatement {
    if (db !== this.cachedDb) {
      this.statements.clear();
      this.cachedDb = db;
    }
    let stmt = this.statements.get(sql);
    if (stmt === undefined) {
      stmt = db.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }
}
