/**
 * The backup COPY: one read snapshot, optionally paced (main-loop-sync-blocks
 * fix-12).
 *
 * WHY ONE SNAPSHOT. `better-sqlite3`'s `db.backup()` drives
 * `sqlite3_backup_step` in slices of 100 pages, one `setImmediate` apart
 * (`node_modules/better-sqlite3/lib/methods/backup.js` `runBackup`). Each slice
 * opens and closes its own read transaction on the source unless the source is
 * already inside one. When ANOTHER connection writes the source between two
 * slices, the source pager is reset and SQLite restarts the copy from page 1.
 * The host process writes constantly while chats stream, so the daily backup of
 * a 1.4 GB database restarted again and again for ~10 minutes (measured
 * 562-605 s, against ~12 s for the same file with no writer), and the
 * destination was rewritten each time. Measured here with the real binary: 19
 * restarts and 1152 slices without a snapshot, 0 restarts and 201 slices with
 * one, for the same file and the same writes.
 *
 * Opening a read transaction FIRST (`BEGIN` + one read) makes every slice use
 * that one snapshot: no slice opens its own transaction, the pager is never
 * reset, and the copy never restarts. It is also a consistent image of one
 * moment. In WAL mode a reader does not block the writer; it only keeps the
 * checkpointer from moving past its snapshot, and only for the copy's duration.
 *
 * WHY PACED. A copy at full disk speed dirties gigabytes of OS write cache and
 * ends with one huge flush. On Windows that can throttle every other writer on
 * the machine, including the host's small WAL commit on the main thread. A
 * paced copy (daily backups only; the host decides through `BackupPacing`)
 * moves `PACED_STEP_BYTES` per slice, flushes the staging file every
 * `flushEveryBytes`, and sleeps whenever it runs ahead of `maxBytesPerSecond`.
 * The sleep is synchronous because `runBackup` calls the progress callback
 * synchronously and offers no async hook; it blocks only this worker, never the
 * host.
 *
 * This file imports nothing: the integrity worker bundle must stay a leaf.
 */

/** What `better-sqlite3` passes to the backup progress callback. */
export interface BackupStepProgress {
  readonly totalPages: number;
  readonly remainingPages: number;
}

/** How fast a paced copy may write, and how often it flushes the staging file. */
export interface BackupPacing {
  /** Average copy rate ceiling, in bytes per second. */
  readonly maxBytesPerSecond: number;
  /** Flush (fsync) the staging file each time this many more bytes are copied. */
  readonly flushEveryBytes: number;
}

/** The slice of a source connection the snapshot copy uses. */
export interface SnapshotBackupSource {
  exec(sql: string): unknown;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  backup?(
    destination: string,
    options?: { progress?: (info: BackupStepProgress) => number },
  ): Promise<unknown>;
}

/** An open handle on the staging file, used only to flush it. */
export interface BackupFlushHandle {
  flush(): void;
  close(): void;
}

/** The non-pure parts of a paced copy; injected so a spec can drive them. */
export interface SnapshotCopyIo {
  now(): number;
  /** Block this worker for `ms` milliseconds. */
  sleep(ms: number): void;
  openFlushHandle(target: string): BackupFlushHandle;
}

/** What one copy did. `restarts` is 0 whenever the snapshot held. */
export interface SnapshotCopyStats {
  readonly steps: number;
  readonly restarts: number;
  readonly flushes: number;
  readonly pausedMs: number;
}

/**
 * "Copy every remaining page in this slice." Not `-1`: `runBackup` clamps a
 * negative return to 0, and a 0-page slice copies nothing, forever.
 */
export const WHOLE_DATABASE_STEP_PAGES = 0x7fffffff;

/** Bytes per slice of a paced copy. */
export const PACED_STEP_BYTES = 4 * 1024 * 1024;

/** Longest single pause, so one bad clock reading cannot stall the copy. */
export const MAX_PACING_SLEEP_MS = 1_000;

/** Any read takes the snapshot; the schema table always exists. */
const SNAPSHOT_READ_SQL = 'SELECT count(*) FROM sqlite_schema';

function readPageSize(source: SnapshotBackupSource): number {
  const pageSize = source.pragma('page_size', { simple: true });
  if (typeof pageSize !== 'number' || !Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(`unexpected page_size from the source: ${String(pageSize)}`);
  }
  return pageSize;
}

/** Turns progress callbacks into slice sizes, flushes and pauses. */
class BackupStepPacer {
  private steps = 0;
  private restarts = 0;
  private flushes = 0;
  private pausedMs = 0;
  private lastRemaining = Number.POSITIVE_INFINITY;
  private flushedBytes = 0;
  private readonly startedAt: number;

  constructor(
    private readonly pageSize: number,
    private readonly pacing: BackupPacing | null,
    private readonly io: SnapshotCopyIo,
    private readonly flushHandle: BackupFlushHandle | null,
  ) {
    this.startedAt = io.now();
  }

  onStep(progress: BackupStepProgress): number {
    this.steps += 1;
    if (progress.remainingPages > this.lastRemaining) this.restarts += 1;
    this.lastRemaining = progress.remainingPages;
    if (this.pacing === null) return WHOLE_DATABASE_STEP_PAGES;

    const copiedBytes =
      (progress.totalPages - progress.remainingPages) * this.pageSize;
    this.flushIfDue(copiedBytes, this.pacing.flushEveryBytes);
    this.pauseIfAhead(copiedBytes, this.pacing.maxBytesPerSecond);
    return Math.max(1, Math.floor(PACED_STEP_BYTES / this.pageSize));
  }

  stats(): SnapshotCopyStats {
    return {
      steps: this.steps,
      restarts: this.restarts,
      flushes: this.flushes,
      pausedMs: this.pausedMs,
    };
  }

  private flushIfDue(copiedBytes: number, flushEveryBytes: number): void {
    if (this.flushHandle === null) return;
    if (copiedBytes - this.flushedBytes < flushEveryBytes) return;
    this.flushHandle.flush();
    this.flushes += 1;
    this.flushedBytes = copiedBytes;
  }

  private pauseIfAhead(copiedBytes: number, maxBytesPerSecond: number): void {
    const dueMs = (copiedBytes / maxBytesPerSecond) * 1000;
    const aheadMs = dueMs - (this.io.now() - this.startedAt);
    if (aheadMs <= 0) return;
    const sleepMs = Math.min(Math.ceil(aheadMs), MAX_PACING_SLEEP_MS);
    this.io.sleep(sleepMs);
    this.pausedMs += sleepMs;
  }
}

/**
 * Copy `source` into `stagingPath` from ONE read snapshot.
 *
 * The snapshot is opened before the copy and committed after it. On a throw
 * the transaction is left to the caller's `close()`, which ends it; ending it
 * here as well would only add a second error that could hide the first.
 */
export async function copyFromSnapshot(
  source: SnapshotBackupSource,
  stagingPath: string,
  pacing: BackupPacing | null,
  io: SnapshotCopyIo,
): Promise<SnapshotCopyStats> {
  if (typeof source.backup !== 'function') {
    throw new Error('db.backup() is unavailable on this database instance');
  }
  source.exec('BEGIN');
  source.exec(SNAPSHOT_READ_SQL);
  const pageSize = readPageSize(source);
  const flushHandle = pacing === null ? null : io.openFlushHandle(stagingPath);
  const pacer = new BackupStepPacer(pageSize, pacing, io, flushHandle);
  try {
    await source.backup(stagingPath, {
      progress: (progress) => pacer.onStep(progress),
    });
  } catch (copyError: unknown) {
    // Close the flush handle without letting a close failure mask the copy error.
    closeFlushHandle(flushHandle, copyError);
    throw copyError;
  }
  // After a good copy a close failure still fails the backup: the staged file's
  // durability is then unknown, and the caller discards it.
  flushHandle?.close();
  source.exec('COMMIT');
  return pacer.stats();
}

/** Close `handle` after a failed copy; the copy error stays the one thrown. */
function closeFlushHandle(handle: BackupFlushHandle | null, copyError: unknown): void {
  try {
    handle?.close();
  } catch (closeError: unknown) {
    // degradation-audit: reported - the caller rethrows the copy error, which
    // fails the backup; the close failure is attached to it as context.
    if (copyError instanceof Error && copyError.cause === undefined) {
      copyError.cause = closeError;
    }
  }
}
