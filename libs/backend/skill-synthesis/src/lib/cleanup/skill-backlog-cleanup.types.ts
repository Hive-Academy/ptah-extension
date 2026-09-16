export const SKILL_BACKLOG_CLEANUP_VERSION = 1;

export type BacklogCleanupSkipReason =
  | 'disabled'
  | 'complete'
  | 'boot-deferred'
  | 'on-battery'
  | 'foreground-active'
  | 'aborted';

export type BacklogCleanupStopReason =
  | 'aborted'
  | 'time-budget'
  | 'row-budget'
  | 'unexpected-error';

export interface BacklogCleanupCounters {
  examined: number;
  keptEvidence: number;
  keptVerdict: number;
  keptDegradedVerdict: number;
  rejectedNoEvidence: number;
  rejectedTranscriptUnreadable: number;
  invocationsDeleted: number;
}

/** Per-run counters that are intentionally not persisted in migration 0045. */
export interface BacklogCleanupRunCounters extends BacklogCleanupCounters {
  /**
   * Per-run, not persisted. Candidates kept because no source session resolved
   * a workspace root, so no transcript read was attempted. Persisted kept and
   * rejected counters therefore sum to examined minus the run-summed
   * keptRootUnknown and deferredOnError counters.
   */
  keptRootUnknown: number;
  /** Candidates left untouched because inspecting them threw. */
  deferredOnError: number;
}

export interface BacklogCleanupState extends BacklogCleanupCounters {
  version: number;
  cutoffCreatedAt: number;
  cursorCreatedAt: number | null;
  cursorId: string | null;
  startedAt: number;
  finishedAt: number | null;
  lastRunAt: number | null;
  lastOutcome: string | null;
  lastReason: string | null;
}

export interface BacklogCleanupSkippedReport {
  status: 'skipped';
  reason: BacklogCleanupSkipReason;
}

export interface BacklogCleanupRunReport extends BacklogCleanupRunCounters {
  status: 'completed' | 'partial' | 'failed';
  reason: BacklogCleanupStopReason | string | null;
  durationMs: number;
  error: string | null;
}

export type BacklogCleanupReport =
  | BacklogCleanupSkippedReport
  | BacklogCleanupRunReport;

export interface BacklogCleanupRunOptions {
  signal: AbortSignal;
  isOnBattery: () => boolean;
  now?: () => number;
}

export interface BacklogCleanupCandidate {
  id: string;
  createdAt: number;
  sourceSessionIds: string[];
  workspaceRoot: string | null;
}

export interface BacklogCleanupRejection {
  id: string;
  reason: string;
}
