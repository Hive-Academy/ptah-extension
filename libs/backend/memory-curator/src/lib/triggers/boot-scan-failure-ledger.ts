import type { Logger } from '@ptah-extension/vscode-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';

/**
 * Failed attempts a session gets in total — the boot-scan pass that first
 * failed plus the retries on later boots — before it is marked `given_up`
 * (TASK_2026_621).
 */
export const BOOT_SCAN_MAX_ATTEMPTS = 3;

/** Pending rows retried per boot, oldest failure first. */
export const BOOT_SCAN_RETRIES_PER_BOOT = 20;

export type BootScanGiveUpReason = 'max-attempts' | 'session-file-missing';

export interface BootScanFailureEntry {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly sessionPath: string;
  readonly attemptCount: number;
}

export interface BootScanGivenUpEntry extends BootScanFailureEntry {
  readonly sessionMtimeMs: number | null;
}

export interface BootScanFailureRecord {
  readonly attemptCount: number;
  readonly status: 'pending' | 'given_up';
}

// A `given_up` row stays terminal while the session file is the same
// generation (same mtime). A changed file is a new generation: its failure
// reopens the row as `pending` with a fresh attempt count (migration 0053).
// In DO UPDATE every right-hand side reads the row as it was before the update.
const RECORD_FAILURE_SQL = `INSERT INTO memory_boot_scan_failures
  (workspace_fingerprint, session_id, workspace_root, session_path,
   first_failed_at, last_failed_at, attempt_count, status, give_up_reason,
   session_mtime_ms)
VALUES (@fp, @sessionId, @workspaceRoot, @sessionPath, @now, @now, 1,
        CASE WHEN @max <= 1 THEN 'given_up' ELSE 'pending' END,
        CASE WHEN @max <= 1 THEN 'max-attempts' ELSE NULL END,
        @mtime)
ON CONFLICT(workspace_fingerprint, session_id) DO UPDATE SET
  attempt_count   = CASE WHEN status = 'given_up' THEN 1 ELSE attempt_count + 1 END,
  first_failed_at = CASE WHEN status = 'given_up' THEN excluded.first_failed_at ELSE first_failed_at END,
  last_failed_at  = excluded.last_failed_at,
  workspace_root  = excluded.workspace_root,
  session_path    = excluded.session_path,
  session_mtime_ms = excluded.session_mtime_ms,
  status = CASE WHEN (CASE WHEN status = 'given_up' THEN 1 ELSE attempt_count + 1 END) >= @max
                THEN 'given_up' ELSE 'pending' END,
  give_up_reason = CASE WHEN (CASE WHEN status = 'given_up' THEN 1 ELSE attempt_count + 1 END) >= @max
                        THEN 'max-attempts' ELSE NULL END
WHERE status = 'pending' OR session_mtime_ms IS NOT excluded.session_mtime_ms`;

const READ_ONE_SQL = `SELECT attempt_count, status FROM memory_boot_scan_failures
 WHERE workspace_fingerprint = ? AND session_id = ?`;

const LIST_PENDING_SQL = `SELECT session_id, workspace_root, session_path, attempt_count
  FROM memory_boot_scan_failures
 WHERE workspace_fingerprint = ? AND status = 'pending'
 ORDER BY last_failed_at, session_id
  LIMIT ?`;

const LIST_GIVEN_UP_SQL = `SELECT session_id, workspace_root, session_path, attempt_count, session_mtime_ms
  FROM memory_boot_scan_failures
  WHERE workspace_fingerprint = ? AND status = 'given_up'
  ORDER BY last_failed_at, session_id
  LIMIT ? OFFSET ?`;

const GIVE_UP_SQL = `UPDATE memory_boot_scan_failures
   SET status = 'given_up', give_up_reason = ?, last_failed_at = ?
 WHERE workspace_fingerprint = ? AND session_id = ?`;

const REMOVE_SQL = `DELETE FROM memory_boot_scan_failures
 WHERE workspace_fingerprint = ? AND session_id = ?`;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The memory boot scan's per-session failure ledger (migration 0052,
 * TASK_2026_621). A session whose boot-scan pass failed is recorded here so the
 * scan's watermark can advance past it without losing it; later boots retry
 * `pending` rows until one succeeds (row removed) or the attempts run out
 * (`given_up`).
 *
 * Every method degrades instead of throwing: a write that failed returns
 * `null`/`false` and is warned, and the runner then keeps the watermark below
 * the session rather than advancing over a failure it could not record.
 */
export class BootScanFailureLedger {
  constructor(
    private readonly sqlite: SqliteConnectionService,
    private readonly logger: Logger,
    private readonly maxAttempts: number = BOOT_SCAN_MAX_ATTEMPTS,
  ) {}

  /**
   * Record one failed attempt; `null` when the write failed. `sessionMtimeMs`
   * is the session file's generation: a `given_up` row reopens only when it
   * differs from the stored one.
   */
  recordFailure(
    fp: string,
    entry: Omit<BootScanFailureEntry, 'attemptCount'> & {
      readonly sessionMtimeMs: number | null;
    },
    nowMs: number,
  ): BootScanFailureRecord | null {
    try {
      const db = this.sqlite.db;
      db.prepare(RECORD_FAILURE_SQL).run({
        fp,
        sessionId: entry.sessionId,
        workspaceRoot: entry.workspaceRoot,
        sessionPath: entry.sessionPath,
        now: nowMs,
        max: this.maxAttempts,
        mtime: entry.sessionMtimeMs,
      });
      const row = db.prepare(READ_ONE_SQL).get(fp, entry.sessionId) as
        { attempt_count: number; status: 'pending' | 'given_up' } | undefined;
      if (!row) return null;
      return { attemptCount: Number(row.attempt_count), status: row.status };
    } catch (error: unknown) {
      // degradation-audit: reported - ledger recording failure keeps the watermark below the session
      this.warn('record', entry.sessionId, error);
      return null;
    }
  }

  /** Pending rows of this workspace, oldest failure first; `[]` on failure. */
  listPending(fp: string, limit: number): BootScanFailureEntry[] {
    try {
      const rows = this.sqlite.db
        .prepare(LIST_PENDING_SQL)
        .all(fp, limit) as Array<{
        session_id: string;
        workspace_root: string;
        session_path: string;
        attempt_count: number;
      }>;
      return rows.map((r) => ({
        sessionId: r.session_id,
        workspaceRoot: r.workspace_root,
        sessionPath: r.session_path,
        attemptCount: Number(r.attempt_count),
      }));
    } catch (error: unknown) {
      // degradation-audit: reported - unavailable retry ledger degrades to no retries for this boot
      this.warn('list', null, error);
      return [];
    }
  }

  /** Terminal rows, used to admit a changed file generation below the watermark. */
  listGivenUp(fp: string, limit: number, offset = 0): BootScanGivenUpEntry[] {
    try {
      const rows = this.sqlite.db
        .prepare(LIST_GIVEN_UP_SQL)
        .all(fp, limit, offset) as Array<{
        session_id: string;
        workspace_root: string;
        session_path: string;
        attempt_count: number;
        session_mtime_ms: number | null;
      }>;
      return rows.map((row) => ({
        sessionId: row.session_id,
        workspaceRoot: row.workspace_root,
        sessionPath: row.session_path,
        attemptCount: Number(row.attempt_count),
        sessionMtimeMs: row.session_mtime_ms,
      }));
    } catch (error: unknown) {
      // degradation-audit: reported - unavailable terminal ledger rows defer changed-generation recovery
      this.warn('list-given-up', null, error);
      return [];
    }
  }

  giveUp(
    fp: string,
    sessionId: string,
    reason: BootScanGiveUpReason,
    nowMs: number,
  ): boolean {
    try {
      this.sqlite.db.prepare(GIVE_UP_SQL).run(reason, nowMs, fp, sessionId);
      return true;
    } catch (error: unknown) {
      // degradation-audit: reported - ledger status update failure leaves the row retryable on a later boot
      this.warn('give-up', sessionId, error);
      return false;
    }
  }

  /**
   * A pass curated the session — a retry, or the normal scan reaching a newer
   * generation of it: forget its failures, whatever their status.
   */
  remove(fp: string, sessionId: string): boolean {
    try {
      this.sqlite.db.prepare(REMOVE_SQL).run(fp, sessionId);
      return true;
    } catch (error: unknown) {
      // degradation-audit: reported - ledger cleanup failure is harmless because later scans retry removal
      this.warn('remove', sessionId, error);
      return false;
    }
  }

  private warn(op: string, sessionId: string | null, error: unknown): void {
    this.logger.warn('[memory-curator] boot-scan failure ledger write failed', {
      op,
      sessionId,
      error: errorText(error),
    });
  }
}
