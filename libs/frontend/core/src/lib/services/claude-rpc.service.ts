import { Injectable, inject } from '@angular/core';
import { VSCodeService } from './vscode.service';
import {
  SessionId,
  SessionSummary,
  StrictChatSession,
  CorrelationId,
  StrictChatMessage,
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
 * Replaces the old EventBus + MessageHandlerService pattern (deleted in Phase 0).
 * Instead of event subscriptions and message types, we use direct RPC method calls.
 *
 * Usage:
 *   const result = await claudeRpc.listSessions();
 *   if (result.isSuccess()) {
 *     console.log('Sessions:', result.data);
 *   }
 */
@Injectable({ providedIn: 'root' })
export class ClaudeRpcService {
  private readonly vscode = inject(VSCodeService);
  private pendingCalls = new Map<
    string,
    (response: RpcResponse<any>) => void
  >();

  /**
   * Call an RPC method on the backend
   * @param method - Method name (e.g., 'session:list', 'chat:sendMessage')
   * @param params - Method parameters
   * @param options - Call options (timeout, etc.)
   * @returns RpcResult with success/error state
   */
  async call<T>(
    method: string,
    params: unknown,
    options?: RpcCallOptions
  ): Promise<RpcResult<T>> {
    const correlationId = CorrelationId.create();
    const timeout = options?.timeout ?? 30000;

    return new Promise<RpcResult<T>>((resolve) => {
      // Store resolver for this correlation ID
      this.pendingCalls.set(correlationId, (response: RpcResponse<T>) => {
        this.pendingCalls.delete(correlationId);
        clearTimeout(timer);
        resolve(new RpcResult(response.success, response.data, response.error));
      });

      // Set timeout to prevent hanging calls
      const timer = setTimeout(() => {
        if (this.pendingCalls.has(correlationId)) {
          this.pendingCalls.delete(correlationId);
          resolve(new RpcResult<T>(false, undefined, `RPC timeout: ${method}`));
        }
      }, timeout);

      // Send RPC call to backend via generic message
      // NOTE: RPC message types will be added to MessagePayloadMap in Phase 1 (backend)
      // For now, we construct the message manually
      this.postRpcMessage({
        type: 'rpc:call',
        payload: { method, params, correlationId },
      });
    });
  }

  /**
   * Post RPC message to VS Code extension
   * Accesses the underlying VS Code API directly since RPC types
   * are not yet in MessagePayloadMap (added in Phase 1)
   * @private
   */
  private postRpcMessage(message: { type: string; payload: unknown }): void {
    // Access the private vscode API via type assertion
    // This is safe because VSCodeService.postStrictMessage does the same internally
    const vscodeService = this.vscode as any;
    if (vscodeService.vscode) {
      vscodeService.vscode.postMessage(message);
    }
  }

  /**
   * Handle RPC response from backend
   * Called by message handler when 'rpc:response' message arrives
   * @param response - RPC response with correlation ID
   */
  handleResponse(response: RpcResponse): void {
    const resolver = this.pendingCalls.get(response.correlationId);
    if (resolver) {
      resolver(response);
    }
  }

  // ===== Type-Safe RPC Method Wrappers =====

  /**
   * List all chat sessions
   * @returns Array of session summaries
   */
  listSessions(): Promise<RpcResult<SessionSummary[]>> {
    return this.call<SessionSummary[]>('session:list', {});
  }

  /**
   * Get full session with messages
   * @param id - Session ID
   * @returns Full session with messages
   */
  getSession(id: SessionId): Promise<RpcResult<StrictChatSession>> {
    return this.call<StrictChatSession>('session:get', { id });
  }

  /**
   * Create new chat session
   * @param name - Optional session name
   * @returns New session ID
   */
  createSession(name?: string): Promise<RpcResult<SessionId>> {
    return this.call<SessionId>('session:create', { name });
  }

  /**
   * Switch to different session
   * @param id - Session ID to switch to
   */
  switchSession(id: SessionId): Promise<RpcResult<void>> {
    return this.call<void>('session:switch', { id });
  }

  /**
   * Start chat session (initiates Claude CLI, streaming happens via postMessage)
   * @param sessionId - Session ID to send message in
   * @param content - Message content
   * @param files - Optional file paths
   * @returns Promise that resolves when CLI process starts (streaming handled separately)
   */
  startChat(
    sessionId: SessionId,
    content: string,
    files?: string[]
  ): Promise<RpcResult<void>> {
    return this.call<void>('chat:start', { sessionId, content, files });
  }

  /**
   * Pause current turn in interactive session (SIGTSTP)
   * @param sessionId - Session ID to pause
   * @returns Promise that resolves when pause signal is sent
   */
  pauseChat(sessionId: SessionId): Promise<RpcResult<void>> {
    return this.call<void>('chat:pause', { sessionId });
  }

  /**
   * Resume paused turn in interactive session (SIGCONT)
   * @param sessionId - Session ID to resume
   * @returns Promise that resolves when resume signal is sent
   */
  resumeChat(sessionId: SessionId): Promise<RpcResult<void>> {
    return this.call<void>('chat:resume', { sessionId });
  }

  /**
   * Stop current turn and clear message queue (SIGTERM)
   * @param sessionId - Session ID to stop
   * @returns Promise that resolves when stop signal is sent
   */
  stopChat(sessionId: SessionId): Promise<RpcResult<void>> {
    return this.call<void>('chat:stop', { sessionId });
  }
}
