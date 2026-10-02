/**
 * Turn change-set types (TASK_2026_576, Requirement 4).
 *
 * One change set is the record of the files a single agent turn changed in a
 * session's working directory: recorded by the backend at turn end, persisted
 * per session, pushed live as `git:turnChangeSet` and re-read on session open
 * with `git:turnChangeSets`. Every field is plain JSON, because the record is
 * stored as-is in workspace state.
 */

/**
 * How a file changed relative to HEAD: added, modified, deleted, renamed or
 * unmerged (conflicted).
 */
export type TurnChangeSetFileStatus = 'A' | 'M' | 'D' | 'R' | 'U';

/** One file a turn changed. */
export interface TurnChangeSetFile {
  /** Repository-relative path, forward slashes. */
  path: string;
  /** Pre-rename source path; present only when `status` is `'R'`. */
  origPath?: string;
  status: TurnChangeSetFileStatus;
  /** Lines added against HEAD, or null when the count is unknown. */
  additions: number | null;
  /** Lines deleted against HEAD, or null when the count is unknown. */
  deletions: number | null;
  /**
   * True when git reports the file as binary: it has no line counts, so
   * `additions`/`deletions` are null and the card shows "binary" for it.
   * Absent on text files and on records written before the field existed.
   */
  binary?: boolean;
}

/** Header totals of a change set. */
export interface TurnChangeSetTotals {
  /** Every changed file, including the ones past the stored-file bound. */
  files: number;
  /** Sum of the known `additions` of the stored files. */
  additions: number;
  /** Sum of the known `deletions` of the stored files. */
  deletions: number;
}

/** The files one agent turn changed. */
export interface TurnChangeSet {
  sessionId: string;
  /** Absolute working directory the turn ran in. */
  workspaceRoot: string;
  /** Epoch milliseconds of the prompt submission that started the turn. */
  turnStartedAt: number;
  /** Epoch milliseconds of the turn end. */
  turnEndedAt: number;
  /** At most 500 files; the rest are counted in `truncatedCount`. */
  files: TurnChangeSetFile[];
  /** Changed files left out of `files` by the 500-file bound. */
  truncatedCount: number;
  totals: TurnChangeSetTotals;
  /**
   * True when git could not produce line counts for the turn; the card shows
   * "counts unavailable" instead of numbers, never zeros.
   */
  countsUnavailable: boolean;
  /**
   * True when no baseline was captured at turn start (the app started
   * mid-turn): `files` is every dirty file, not only the turn's own changes.
   */
  baselineMissing?: boolean;
}

/** Parameters for the `git:turnChangeSets` RPC method. */
export interface GitTurnChangeSetsParams {
  sessionId: string;
}

/** Result of the `git:turnChangeSets` RPC method, oldest first. */
export interface GitTurnChangeSetsResult {
  changeSets: TurnChangeSet[];
}

/** Payload of the `git:turnChangeSet` push: one newly recorded change set. */
export interface GitTurnChangeSetPayload {
  changeSet: TurnChangeSet;
}
