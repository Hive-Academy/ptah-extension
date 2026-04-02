import { Injectable, inject } from '@angular/core';
import { VSCodeService } from './vscode.service';
import { AppStateManager } from './app-state.service';
import { MessageHandler } from './message-router.types';
import {
  SessionId,
  CorrelationId,
  RpcMethodName,
  RpcMethodParams,
  RpcMethodResult,
  SessionListResult,
  SessionLoadResult,
  FileOpenResult,
  MESSAGE_TYPES,
  // TASK_2025_109: SubagentResumeResult removed - now uses context injection
  SubagentQueryResult,
} from '@ptah-extension/shared';

/**
 * Options for RPC calls
 */
export interface RpcCallOptions {
  timeout?: number; // milliseconds, default: 30000
}

/**
 * Wrapper for RPC results (success/error state)
 */
export class RpcResult<T> {
  constructor(
    public readonly success: boolean,
    public readonly data?: T,
    public readonly error?: string,
    /**
     * Error code for programmatic handling (TASK_2025_124)
     * - 'LICENSE_REQUIRED': No valid license (subscription expired or not found)
     * - 'PRO_TIER_REQUIRED': Pro subscription required for this feature
     */
    public readonly errorCode?: 'LICENSE_REQUIRED' | 'PRO_TIER_REQUIRED',
  ) {}

  /**
   * Check if result is successful
   */
  isSuccess(): this is RpcResult<T> & { success: true; data: T } {
    return this.success && this.data !== undefined;
  }

  /**
   * Check if result is error
   */
  isError(): this is RpcResult<T> & { success: false; error: string } {
    return !this.success;
  }

  /**
   * Check if error is license-related (TASK_2025_124)
   */
  isLicenseError(): boolean {
    return (
      this.errorCode === 'LICENSE_REQUIRED' ||
      this.errorCode === 'PRO_TIER_REQUIRED'
    );
  }

  /**
   * Check if Pro tier is required (TASK_2025_124)
   */
  isProRequired(): boolean {
    return this.errorCode === 'PRO_TIER_REQUIRED';
  }
}

/**
 * RPC response from backend
 */
interface RpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  // Backend may send error as string or { message: string } depending on code path
  error?: string | { message: string };
  /**
   * Error code for programmatic handling (TASK_2025_124)
   * - 'LICENSE_REQUIRED': No valid license (subscription expired or not found)
   * - 'PRO_TIER_REQUIRED': Pro subscription required for this feature
   */
  errorCode?: 'LICENSE_REQUIRED' | 'PRO_TIER_REQUIRED';
  correlationId: string;
}

/**
 * ClaudeRpcService - Frontend service for RPC communication with backend
 *
 * Provides type-safe RPC calls to backend handlers using the RpcMethodRegistry.
 * Only methods defined in RpcMethodRegistry can be called - this is enforced at compile time.
 *
 * Usage:
 *   // Type-safe call (recommended)
 *   const result = await claudeRpc.call('session:list', { workspacePath: '/path' });
 *
 *   // Using typed method wrappers
 *   const result = await claudeRpc.listSessions(workspacePath);
 */
/**
 * RPC methods allowed for unlicensed users.
 * All other methods will be blocked when isLicensed=false.
 *
 * settings:import is allowed so users can import their license key
 * and credentials from another platform (e.g., VS Code → Electron)
 * directly from the welcome screen.
 */
const UNLICENSED_ALLOWED_METHODS: readonly string[] = [
  'license:getStatus',
  'license:setKey',
  'command:execute',
  'settings:import',
] as const;

@Injectable({ providedIn: 'root' })
export class ClaudeRpcService implements MessageHandler {
  private readonly vscode = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private pendingCalls = new Map<
    string,
    (response: RpcResponse<unknown>) => void
  >();

  // MessageHandler implementation
  readonly handledMessageTypes = [MESSAGE_TYPES.RPC_RESPONSE] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    console.log('[ClaudeRpcService] Received RPC response:', message);
    this.handleResponse(message as unknown as RpcResponse);
  }

  /**
   * Check if the given RPC method is allowed based on license status.
   * Unlicensed users can only call methods in UNLICENSED_ALLOWED_METHODS.
   */
  private isMethodAllowed(method: string): boolean {
    if (this.appState.isLicensed()) {
      return true; // Licensed users can call any method
    }
    return UNLICENSED_ALLOWED_METHODS.includes(method);
  }

  /**
   * Type-safe RPC call using RpcMethodRegistry
   *
   * This method enforces compile-time type safety:
   * - Method name must be a valid key in RpcMethodRegistry
   * - Params must match the method's params type
   * - Result is typed as the method's result type
   *
   * @param method - Method name (must be in RpcMethodRegistry)
   * @param params - Method parameters (type-checked)
   * @param options - Call options (timeout, etc.)
   * @returns RpcResult with typed data
   *
   * @example
   * // Compile-time type checking
   * const result = await rpc.call('session:list', { workspacePath: '/path' });
   * // result.data is typed as SessionListResult
   *
   * // Compile error - invalid method name
   * await rpc.call('invalid:method', {});
   *
   * // Compile error - wrong params type
   * await rpc.call('session:list', { wrongParam: true });
   */
  async call<T extends RpcMethodName>(
    method: T,
    params: RpcMethodParams<T>,
    options?: RpcCallOptions,
  ): Promise<RpcResult<RpcMethodResult<T>>> {
    // Check license before making RPC call
    if (!this.isMethodAllowed(method)) {
      console.warn(
        `[ClaudeRpcService] RPC blocked - method "${method}" requires license`,
      );
      return new RpcResult<RpcMethodResult<T>>(
        false,
        undefined,
        `License required: ${method}`,
        'LICENSE_REQUIRED',
      );
    }

    const correlationId = CorrelationId.create();
    const timeout = options?.timeout ?? 30000;

    return new Promise<RpcResult<RpcMethodResult<T>>>((resolve) => {
      // Store resolver for this correlation ID.
      // The map stores callbacks as RpcResponse<unknown> for type erasure;
      // at call-site we know the concrete type so the cast is safe.
      this.pendingCalls.set(correlationId, ((
        response: RpcResponse<RpcMethodResult<T>>,
      ) => {
        this.pendingCalls.delete(correlationId);
        clearTimeout(timer);
        // Normalize error: backend may send string or { message: string }
        const errorStr = this.normalizeError(response.error);
        // TASK_2025_124: Pass errorCode for license-related errors
        resolve(
          new RpcResult(
            response.success,
            response.data,
            errorStr,
            response.errorCode,
          ),
        );
      }) as (response: RpcResponse<unknown>) => void);

      // Set timeout to prevent hanging calls
      const timer = setTimeout(() => {
        if (this.pendingCalls.has(correlationId)) {
          this.pendingCalls.delete(correlationId);
          console.error(`[ClaudeRpcService] RPC timeout for method: ${method}`);
          resolve(
            new RpcResult<RpcMethodResult<T>>(
              false,
              undefined,
              `RPC timeout: ${method}`,
            ),
          );
        }
      }, timeout);

      // Send RPC call to backend
      this.postRpcMessage({
        type: MESSAGE_TYPES.RPC_CALL,
        payload: { method, params, correlationId },
      });
    });
  }

  /**
   * Normalize error from backend response.
   * Backend may send error as a string or as { message: string } depending on code path.
   */
  private normalizeError(
    error: string | { message: string } | undefined,
  ): string | undefined {
    if (error === undefined) return undefined;
    if (typeof error === 'string') return error;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String(error.message);
    }
    return String(error);
  }

  /**
   * Post RPC message to VS Code extension
   * @private
   */
  private postRpcMessage(message: { type: string; payload: unknown }): void {
    // Access the private vscode API via type assertion
    // This is safe because VSCodeService.postStrictMessage does the same internally
    const vscodeService = this.vscode as unknown as {
      vscode?: { postMessage: (msg: unknown) => void };
    };
    if (vscodeService.vscode) {
      vscodeService.vscode.postMessage(message);
    }
  }

  /**
   * Handle RPC response from backend
   * Called by message handler when MESSAGE_TYPES.RPC_RESPONSE message arrives
   * @param response - RPC response with correlation ID
   */
  handleResponse(response: RpcResponse): void {
    const resolver = this.pendingCalls.get(response.correlationId);
    if (resolver) {
      resolver(response);
    }
  }

  // ===== Type-Safe RPC Method Wrappers =====
  // These are convenience methods that wrap call() with proper types.
  // They use the RpcMethodRegistry types automatically.

  /**
   * List all chat sessions for a workspace
   * @param workspacePath - Workspace path to list sessions for
   * @param limit - Maximum number of sessions to return (default: 10)
   * @param offset - Pagination offset (default: 0)
   * @returns Array of session summaries with pagination info
   */
  async listSessions(
    workspacePath: string,
    limit?: number,
    offset?: number,
  ): Promise<RpcResult<SessionListResult>> {
    console.log(
      '🔵 [ClaudeRpcService] listSessions() called - Sending RPC request...',
    );
    const result = await this.call('session:list', {
      workspacePath,
      limit,
      offset,
    });
    console.log('✅ [ClaudeRpcService] listSessions() response:', {
      success: result.success,
      sessionCount: result.data?.sessions?.length ?? 0,
      total: result.data?.total ?? 0,
      error: result.error,
    });
    return result;
  }

  /**
   * Load a session with its messages
   * @param sessionId - Session ID to load
   * @returns Session with messages
   */
  async loadSession(
    sessionId: SessionId,
  ): Promise<RpcResult<SessionLoadResult>> {
    return this.call('session:load', { sessionId });
  }

  /**
   * Open a file in VS Code editor
   * @param path - Absolute file path to open
   * @param line - Optional line number to navigate to
   * @returns Promise that resolves when file is opened
   */
  async openFile(
    path: string,
    line?: number,
  ): Promise<RpcResult<FileOpenResult>> {
    return this.call('file:open', { path, line });
  }

  /**
   * Delete a chat session from storage (TASK_2025_086)
   * @param sessionId - Session ID to delete
   * @returns Promise with success status
   */
  async deleteSession(
    sessionId: SessionId,
  ): Promise<RpcResult<{ success: boolean; error?: string }>> {
    console.log(
      '🗑️ [ClaudeRpcService] deleteSession() called - Sending RPC request...',
    );
    const result = await this.call('session:delete', { sessionId });
    console.log('✅ [ClaudeRpcService] deleteSession() response:', {
      success: result.success,
      error: result.error,
    });
    return result;
  }

  /**
   * Rename a chat session
   * @param sessionId - Session ID to rename
   * @param name - New session name
   * @returns Promise with success status
   */
  async renameSession(
    sessionId: SessionId,
    name: string,
  ): Promise<RpcResult<{ success: boolean; error?: string }>> {
    return this.call('session:rename', { sessionId, name });
  }

  // ============================================================================
  // SUBAGENT RPC METHODS (TASK_2025_103)
  // ============================================================================

  // TASK_2025_109: resumeSubagent method removed - now uses context injection
  // Subagent resumption is handled via context injection in chat:continue RPC.
  // Users can type "resume agent {agentId}" to trigger natural resumption.

  /**
   * Query subagents from the registry
   * Returns all resumable subagents if no params provided
   * @returns Promise with array of SubagentRecord
   */
  async querySubagents(): Promise<RpcResult<SubagentQueryResult>> {
    console.log(
      '🔍 [ClaudeRpcService] querySubagents() called - Sending RPC request...',
    );
    const result = await this.call('chat:subagent-query', {});
    console.log('✅ [ClaudeRpcService] querySubagents() response:', {
      success: result.success,
      count: result.data?.subagents?.length ?? 0,
      error: result.error,
    });
    return result;
  }
}
