/**
 * The side tables of migration 0063 as a participant of the main store's
 * transactions (decisions.md RR1-3).
 *
 * Both stores share `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, so statements of
 * the participant run inside the better-sqlite3 transaction the main store
 * opened. Every method here is "caller owns the transaction": it never opens
 * one itself and throws on failure, which rolls the caller's whole
 * transaction back — link rows, suppressions and todo rows change together or
 * not at all.
 */
import type { SessionTodoProgress } from '@ptah-extension/shared';

export interface SessionOrganizationSideTables {
  /** Workspace roots that hold side-table rows of `sessionId`. */
  rootsOf(sessionId: string): string[];
  /** Remove every side-table row of a session in a workspace. */
  deleteSession(root: string, sessionId: string): number;
  /**
   * Move side-table rows from `oldId` to `newId` in a workspace. A
   * suppression already held by `newId` is kept; a todo snapshot of `newId`
   * wins over the old one.
   */
  rekeySession(root: string, oldId: string, newId: string): void;
  /** Record a user unlink so automatic rules never re-add the pair. */
  suppress(root: string, sessionId: string, taskId: string, now: number): void;
  /** An explicit link of the pair lifts its suppression. */
  clearSuppression(root: string, sessionId: string, taskId: string): void;
  /** Suppressed task ids of a session. */
  listSuppressed(root: string, sessionId: string): Set<string>;
  /** Todo snapshot per session id of a workspace. */
  listTodoProgress(root: string): Map<string, SessionTodoProgress>;
  /** Todo snapshot of one session; null when none was recorded. */
  getTodoProgress(root: string, sessionId: string): SessionTodoProgress | null;
  /**
   * Store a todo snapshot. Returns false (and writes nothing) when `done`,
   * `total` and `inProgress` equal the stored snapshot.
   */
  upsertTodoProgress(
    root: string,
    sessionId: string,
    progress: SessionTodoProgress,
  ): boolean;
}
