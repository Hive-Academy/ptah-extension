import { Injectable, inject } from '@angular/core';
import { VSCodeService } from './vscode.service';
import {
  SessionId,
  CorrelationId,
  RpcMethodName,
  RpcMethodParams,
  RpcMethodResult,
  SessionListParams,
  SessionListResult,
  SessionLoadParams,
  SessionLoadResult,
  FileOpenParams,
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
    public readonly error?: string
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
}

/**
 * RPC response from backend
 */
interface RpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
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
@Injectable({ providedIn: 'root' })
export class ClaudeRpcService {
  private readonly vscode = inject(VSCodeService);
  private pendingCalls = new Map<
    string,
    (response: RpcResponse<unknown>) => void
  >();

  constructor() {
    // Register this service with VSCodeService for RPC response routing
    this.vscode.setRpcService(this);
    console.log(
      '[ClaudeRpcService] Registered with VSCodeService for RPC routing'
    );
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
    options?: RpcCallOptions
  ): Promise<RpcResult<RpcMethodResult<T>>> {
    const correlationId = CorrelationId.create();
    const timeout = options?.timeout ?? 30000;

    return new Promise<RpcResult<RpcMethodResult<T>>>((resolve) => {
      // Store resolver for this correlation ID
      this.pendingCalls.set(
        correlationId,
        (response: RpcResponse<RpcMethodResult<T>>) => {
          this.pendingCalls.delete(correlationId);
          clearTimeout(timer);
          resolve(
            new RpcResult(response.success, response.data, response.error)
          );
        }
      );

      // Set timeout to prevent hanging calls
      const timer = setTimeout(() => {
        if (this.pendingCalls.has(correlationId)) {
          this.pendingCalls.delete(correlationId);
          console.error(`[ClaudeRpcService] RPC timeout for method: ${method}`);
          resolve(
            new RpcResult<RpcMethodResult<T>>(
              false,
              undefined,
              `RPC timeout: ${method}`
            )
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
    offset?: number
  ): Promise<RpcResult<SessionListResult>> {
    console.log(
      '🔵 [ClaudeRpcService] listSessions() called - Sending RPC request...'
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
    sessionId: SessionId
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
    line?: number
  ): Promise<RpcResult<FileOpenResult>> {
    return this.call('file:open', { path, line });
  }

  /**
   * Delete a chat session from storage (TASK_2025_086)
   * @param sessionId - Session ID to delete
   * @returns Promise with success status
   */
  async deleteSession(
    sessionId: SessionId
  ): Promise<RpcResult<{ success: boolean; error?: string }>> {
    console.log(
      '🗑️ [ClaudeRpcService] deleteSession() called - Sending RPC request...'
    );
    const result = await this.call('session:delete', { sessionId });
    console.log('✅ [ClaudeRpcService] deleteSession() response:', {
      success: result.success,
      error: result.error,
    });
    return result;
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
      '🔍 [ClaudeRpcService] querySubagents() called - Sending RPC request...'
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
