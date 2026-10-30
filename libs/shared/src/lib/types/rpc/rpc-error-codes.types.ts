/**
 * Single source of truth for the structured RPC error code union.
 *
 * Shared between backend (RpcUserError, RpcHandler) and frontend (ClaudeRpcService)
 * so the two never drift apart.
 */
export type RpcUserErrorCode =
  | 'WORKSPACE_NOT_OPEN'
  | 'UNAUTHORIZED_WORKSPACE'
  | 'MESSAGE_ID_NOT_FOUND'
  | 'MODEL_NOT_AVAILABLE'
  | 'AUTH_REQUIRED'
  | 'PERSISTENCE_UNAVAILABLE'
  | 'SESSION_NOT_FOUND'
  /** The session exists but none of its saved folders is open, safe and present. */
  | 'SESSION_FOLDER_UNAVAILABLE'
  /**
   * A `git:*` call named a root that is no longer a registered workspace
   * folder or a live worktree of one (removed, pruned, or git failed to
   * confirm it). Never falls back to the active folder.
   */
  | 'GIT_ROOT_UNAVAILABLE'
  | 'INVALID_PARAMS'
  | 'TASK_NOT_FOUND'
  | 'SESSION_ENDED'
  | 'SEND_TIMEOUT'
  | 'SESSION_ATTACHED_TO_GATEWAY'
  | 'OUTPUT_CURSOR_STALE'
  | 'HISTORY_CURSOR_STALE'
  /** The connection is the main agent's current driver and cannot be removed. */
  | 'CONNECTION_IN_USE'
  /**
   * The feature's background-learning switch (`memory.enabled` or
   * `skillSynthesis.enabled`) is off, so a manual run that would do the same
   * model work is refused until the user resumes it.
   */
  | 'PAUSED';
