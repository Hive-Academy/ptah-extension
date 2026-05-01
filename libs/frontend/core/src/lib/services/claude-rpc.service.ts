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
  SessionForkResult,
  SessionRewindResult,
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
  /**
   * Optional AbortSignal — when fired, the pending call is dropped and the
   * promise resolves with `success=false, error='RPC aborted: <method>'`.
   *
   * TASK_2026_103 Wave E2: drives the chat tab-close → stream-cancel flow.
   * The webview-side timeout/lookup remains the source of truth for response
   * correlation; aborting here only releases the caller's awaited promise.
   * The matching backend cancellation (e.g. `chat:abort`) MUST be issued
   * separately by the caller — this signal does NOT itself stop the
   * extension-host work.
   */
  signal?: AbortSignal;
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
  // Read-only config endpoints needed to render the welcome/license shell.
  // Both return user preferences only — no AI feature surface — so safe to
  // expose pre-license. Without these, AutopilotStateService and
  // ModelStateService log RPC-blocked errors during webview bootstrap.
  'config:autopilot-get',
  'config:models-list',
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
    const signal = options?.signal;

    // TASK_2026_103 Wave E2: short-circuit if caller pre-aborted.
    if (signal?.aborted) {
      return new RpcResult<RpcMethodResult<T>>(
        false,
        undefined,
        `RPC aborted: ${method}`,
      );
    }

    return new Promise<RpcResult<RpcMethodResult<T>>>((resolve) => {
      // Mutable abort-listener handle so the resolver/timeout closures can
      // detach it on completion. Wrapped in a single-property object so it
      // can be rebinding-free (`const`) per ESLint prefer-const, while still
      // allowing the inner property to be cleared after detach.
      const abortRef: { listener: (() => void) | null } = { listener: null };

      const detachAbortListener = (): void => {
        if (signal && abortRef.listener) {
          signal.removeEventListener('abort', abortRef.listener);
          abortRef.listener = null;
        }
      };

      // Set timeout to prevent hanging calls. Declared first so the resolver
      // and abort listener can both clear it.
      const timer = setTimeout(() => {
        if (this.pendingCalls.has(correlationId)) {
          this.pendingCalls.delete(correlationId);
          detachAbortListener();
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

      // Store resolver for this correlation ID.
      // The map stores callbacks as RpcResponse<unknown> for type erasure;
      // at call-site we know the concrete type so the cast is safe.
      this.pendingCalls.set(correlationId, ((
        response: RpcResponse<RpcMethodResult<T>>,
      ) => {
        this.pendingCalls.delete(correlationId);
        clearTimeout(timer);
        detachAbortListener();
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

      // TASK_2026_103 Wave E2: bridge AbortSignal → promise resolution.
      // We only release the caller's promise; backend cancellation must be
      // issued separately (e.g. via chat:abort RPC).
      if (signal) {
        abortRef.listener = () => {
          if (this.pendingCalls.has(correlationId)) {
            this.pendingCalls.delete(correlationId);
            clearTimeout(timer);
            resolve(
              new RpcResult<RpcMethodResult<T>>(
                false,
                undefined,
                `RPC aborted: ${method}`,
              ),
            );
          }
        };
        signal.addEventListener('abort', abortRef.listener, { once: true });
      }

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
    return this.call('session:list', {
      workspacePath,
      limit,
      offset,
    });
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
    return this.call('session:delete', { sessionId });
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

  /**
   * Fork a session at an optional message boundary, producing a new session.
   *
   * Backend slices the JSONL transcript up to (and including) `upToMessageId`
   * when provided, then materializes a new session UUID. Disk I/O justifies
   * the 15s timeout — larger than the default RPC timeout but still bounded.
   *
   * @param sessionId - Source session UUID to fork from
   * @param upToMessageId - Optional message UUID to slice transcript at (inclusive)
   * @param title - Optional title for the fork (defaults to "<original> (fork)")
   * @returns RpcResult containing the new session's UUID
   */
  async forkSession(
    sessionId: SessionId,
    upToMessageId?: string,
    title?: string,
  ): Promise<RpcResult<SessionForkResult>> {
    return this.call(
      'session:forkSession',
      { sessionId, upToMessageId, title },
      { timeout: 15000 },
    );
  }

  /**
   * Rewind on-disk file state to the checkpoint captured at a given user
   * message. Pass `dryRun: true` to preview affected files without modifying
   * anything. The 15s timeout matches forkSession — both touch disk and may
   * involve git checkpoint resolution.
   *
   * Surfacing tip: when the backend returns an error code beginning with
   * `'session-not-active:*'`, the session must be resumed before rewind can
   * proceed. UI callers should offer a "Resume & retry" affordance.
   *
   * @param sessionId - Active session whose tracked files should be rewound
   * @param userMessageId - UUID of the user message to rewind file state to
   * @param dryRun - When true, returns planned changes without touching disk
   * @returns RpcResult with rewind plan/outcome (filesChanged, insertions, deletions)
   */
  async rewindFiles(
    sessionId: SessionId,
    userMessageId: string,
    dryRun?: boolean,
  ): Promise<RpcResult<SessionRewindResult>> {
    return this.call(
      'session:rewindFiles',
      { sessionId, userMessageId, dryRun },
      { timeout: 15000 },
    );
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
    return this.call('chat:subagent-query', {});
  }
}
