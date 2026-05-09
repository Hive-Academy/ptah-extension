/**
 * Single source of truth for the structured RPC error code union.
 *
 * Shared between backend (RpcUserError, RpcHandler) and frontend (ClaudeRpcService)
 * so the two never drift apart.
 */
export type RpcUserErrorCode =
  | 'LICENSE_REQUIRED'
  | 'PRO_TIER_REQUIRED'
  | 'WORKSPACE_NOT_OPEN'
  | 'UNAUTHORIZED_WORKSPACE'
  | 'MESSAGE_ID_NOT_FOUND'
  | 'MODEL_NOT_AVAILABLE'
  | 'PERSISTENCE_UNAVAILABLE'
  | 'SESSION_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'TASK_NOT_FOUND'
  | 'SESSION_ENDED';
