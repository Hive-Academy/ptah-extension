/**
 * RPC Types - Type definitions for RPC messaging system
 * Phase 2: RPC Migration (TASK_2025_021)
 *
 * These types replace the old event-based messaging system (deleted in Phase 0).
 * Instead of 94 message types and EventBus subscriptions, we use simple RPC method routing.
 */

/**
 * RPC message from frontend to backend
 * Sent via webview.postMessage() and received by extension host
 */
export interface RpcMessage<TParams = unknown> {
  /** Method name (e.g., 'session:list', 'chat:sendMessage') */
  method: string;
  /** Method parameters */
  params: TParams;
  /** Correlation ID for matching requests with responses */
  correlationId: string;
}

/**
 * RPC response from backend to frontend
 * Sent back via webview.postMessage() after method execution
 */
export interface RpcResponse<T = unknown> {
  /** Whether the RPC method execution succeeded */
  success: boolean;
  /** Response data (if success=true) */
  data?: T;
  /** Error message (if success=false) */
  error?: string;
  /**
   * Error code for programmatic handling by frontend.
   * Used to distinguish license-related errors from other failures.
   *
   * - 'LICENSE_REQUIRED': No valid license (subscription expired or not found)
   * - 'PRO_TIER_REQUIRED': Pro subscription required for this feature
   * - 'WORKSPACE_NOT_OPEN': No workspace folder is open (expected, not a bug)
   *
   * @example
   * ```typescript
   * if (response.errorCode === 'LICENSE_REQUIRED') {
   *   showLicensePrompt();
   * } else if (response.errorCode === 'PRO_TIER_REQUIRED') {
   *   showUpgradePrompt();
   * } else if (response.errorCode === 'WORKSPACE_NOT_OPEN') {
   *   showOpenFolderPrompt();
   * }
   * ```
   */
  errorCode?: 'LICENSE_REQUIRED' | 'PRO_TIER_REQUIRED' | 'WORKSPACE_NOT_OPEN';
  /** Correlation ID matching the original request */
  correlationId: string;
}

/**
 * RPC method handler function signature (generic version)
 * Allows type-safe parameter and return types
 */
export type RpcMethodHandler<TParams = unknown, TResult = unknown> = (
  params: TParams,
) => Promise<TResult>;

/**
 * Base RPC method handler (for internal Map storage)
 * Used internally by RpcHandler - external code should use typed handlers
 */
export type BaseRpcMethodHandler = (params: unknown) => Promise<unknown>;

/**
 * RpcUserError — a typed, user-recoverable RPC error.
 *
 * Throw this (instead of a plain Error) inside an RPC handler when the
 * failure is an expected user-facing condition, not a bug.  The RpcHandler
 * will:
 *   1. Convert it to a structured { success: false, error, errorCode } response
 *      (so the frontend can render an actionable message), and
 *   2. **Skip** Sentry reporting — because the error is expected and already
 *      surfaced to the user.
 *
 * @example
 * throw new RpcUserError(
 *   'Open a folder first to configure agents.',
 *   'WORKSPACE_NOT_OPEN',
 * );
 */
export class RpcUserError extends Error {
  readonly errorCode:
    | 'LICENSE_REQUIRED'
    | 'PRO_TIER_REQUIRED'
    | 'WORKSPACE_NOT_OPEN';

  constructor(
    message: string,
    errorCode: 'LICENSE_REQUIRED' | 'PRO_TIER_REQUIRED' | 'WORKSPACE_NOT_OPEN',
  ) {
    super(message);
    this.name = 'RpcUserError';
    this.errorCode = errorCode;
  }
}
