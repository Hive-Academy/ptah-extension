/**
 * The work behind one checkpoint request, free of any transport so it can be
 * tested without a utility process or the native module.
 *
 * Each request opens its own READ-WRITE connection, runs
 * `PRAGMA wal_checkpoint(PASSIVE)` and closes it again. A read-only connection
 * cannot checkpoint (SQLite answers SQLITE_READONLY), which is why the search
 * and integrity workers cannot do this job. Holding no connection between
 * requests means this process never pins the file: a database reset can rename
 * it, and the main connection's close at quit is the only one left.
 *
 * Closing this connection never checkpoints or deletes the WAL by itself: the
 * main connection keeps its shared lock on the file for as long as it is open,
 * so this one is never the last.
 */
import {
  walCheckpointPragmaRowsSchema,
  walCheckpointRequestSchema,
  type WalCheckpointWorkerOutbound,
} from './wal-checkpoint-worker-protocol';

/** The slice of a better-sqlite3 `Database` a checkpoint needs. */
export interface CheckpointDatabase {
  pragma(source: string): unknown;
  close(): void;
}

/** Opens `dbPath` read-write; the file must already exist. */
export type CheckpointDatabaseOpener = (dbPath: string) => CheckpointDatabase;

/**
 * Bounds the wait for the schema read when another connection is mid-recovery.
 * PASSIVE itself never waits on readers or writers.
 */
const CHECKPOINT_BUSY_TIMEOUT_MS = 1000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Answer one inbound message. Never throws. */
export function runWalCheckpoint(
  raw: unknown,
  open: CheckpointDatabaseOpener,
  now: () => number = Date.now,
): WalCheckpointWorkerOutbound {
  const parsed = walCheckpointRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      type: 'checkpoint-error',
      requestId: -1,
      message: `invalid checkpoint request: ${parsed.error.message}`,
    };
  }
  const { requestId, dbPath } = parsed.data;
  const startedAt = now();
  let db: CheckpointDatabase | null = null;
  try {
    db = open(dbPath);
    db.pragma(`busy_timeout = ${CHECKPOINT_BUSY_TIMEOUT_MS}`);
    const rows = walCheckpointPragmaRowsSchema.parse(
      db.pragma('wal_checkpoint(PASSIVE)'),
    );
    const row = rows[0];
    return {
      type: 'checkpoint-result',
      requestId,
      busy: row.busy !== 0,
      walFrames: row.log,
      checkpointedFrames: row.checkpointed,
      durationMs: Math.max(0, now() - startedAt),
    };
  } catch (error: unknown) {
    return { type: 'checkpoint-error', requestId, message: describe(error) };
  } finally {
    closeQuietly(db);
  }
}

/**
 * A failed close after a finished checkpoint changes nothing the host can act
 * on; the process exits with the connection anyway.
 */
function closeQuietly(db: CheckpointDatabase | null): void {
  try {
    db?.close();
  } catch {
    // degradation-audit: optional-capability - the reply already carries the
    // checkpoint outcome; a close failure has no consumer in this process.
  }
}
