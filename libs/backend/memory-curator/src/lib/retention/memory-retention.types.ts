/**
 * Memory retention — public report and option shapes (TASK_2026_440).
 *
 * `MemoryRetentionService.run` resolves to one of two report shapes and never
 * rejects: a `skipped` report when a gate closed before any row work, or a run
 * report (`completed` / `partial` / `failed`) once work started. The cron
 * handler in `thoth-runtime` maps these onto the scheduler's job result.
 */

/**
 * Why a retention tick did no row work. Ordered as the gates run.
 *
 * `not-due` and `persistence-unavailable` write nothing; every other token is
 * recorded through `ObservationRetentionStore.writeSkip`.
 */
export type RetentionSkipReason =
  | 'disabled'
  | 'already-running'
  | 'boot-deferred'
  | 'on-battery'
  | 'foreground-active'
  | 'not-due'
  | 'aborted'
  | 'persistence-unavailable';

/**
 * Why a started run ended `partial` (or, for `auto-vacuum-not-incremental`, why
 * a `completed` run reclaimed nothing). Persisted as `last_reason`.
 */
export type RetentionStopReason =
  | 'aborted'
  | 'on-battery'
  | 'foreground-active'
  | 'time-budget'
  | 'row-budget'
  | 'memory-row-budget'
  | 'reclaim-budget'
  | 'reclaim-stalled'
  | 'database-busy'
  | 'auto-vacuum-not-incremental';

/** Gate inputs supplied by the host seam for ONE run. */
export interface MemoryRetentionRunOptions {
  /** The cron run's abort signal; checked by gate 6 and between batches. */
  readonly signal: AbortSignal;
  /** Resolved per run by the host from its power monitor. */
  readonly isOnBattery: () => boolean;
  /** `Infinity` when the host has no foreground-activity tracker. */
  readonly msSinceForegroundActivity: () => number;
  /** Clock seam. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** A gate closed; no row work happened. */
export interface MemoryRetentionSkippedReport {
  readonly status: 'skipped';
  readonly reason: RetentionSkipReason;
}

/** A run that passed every gate. */
export interface MemoryRetentionRunReport {
  readonly status: 'completed' | 'partial' | 'failed';
  /** Stop token for `partial`, failure token for `failed`, else `null` or `auto-vacuum-not-incremental`. */
  readonly reason: string | null;
  readonly processedPurged: number;
  readonly stuckQuarantined: number;
  readonly ledgerPruned: number;
  /** Freelist growth caused by the processed purge, in bytes. */
  readonly freedBytes: number;
  readonly pagesReclaimed: number;
  /** `true` unless `completed` — the next hourly tick is then due. */
  readonly backlogRemaining: boolean;
  readonly durationMs: number;
  /** Sanitized failure text (absolute paths removed); `null` unless `failed`. */
  readonly error: string | null;
}

export type MemoryRetentionReport =
  | MemoryRetentionSkippedReport
  | MemoryRetentionRunReport;
