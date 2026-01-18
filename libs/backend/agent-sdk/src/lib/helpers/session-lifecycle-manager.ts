/**
 * Session Lifecycle Manager - Handles SDK session runtime management
 *
 * Responsibilities:
 * - Active session tracking (runtime only)
 * - Message queue management for streaming input
 * - Abort controller lifecycle
 * - Session cleanup
 * - SDK query execution orchestration (TASK_2025_102)
 * - Subagent interruption tracking on session abort (TASK_2025_103)
 *
 * NOTE: This manager does NOT handle session persistence.
 * The SDK handles message persistence natively to ~/.claude/projects/
 * UI metadata (names, timestamps, costs) is managed by SessionMetadataStore.
 *
 * @see TASK_2025_088 - Simplified to remove redundant storage layers
 * @see TASK_2025_102 - Added executeQuery for query orchestration
 * @see TASK_2025_103 - Added subagent interruption on abort
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import {
  SessionId,
  AISessionConfig,
  ISdkPermissionHandler,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import {
  SDKUserMessage,
  SDKMessage,
  UUID,
  UserMessageContent,
  ContentBlock,
  Options,
} from '../types/sdk-types/claude-sdk.types';
import type { SdkModuleLoader } from './sdk-module-loader';
import type { SdkQueryOptionsBuilder } from './sdk-query-options-builder';
import type { SdkMessageFactory } from './sdk-message-factory';

// Re-export for backward compatibility with other files
export type { SDKUserMessage, ContentBlock };

/**
 * Query interface - matches SDK's Query runtime structure
 * Properly typed with SDKMessage instead of any
 */
export interface Query {
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage, void>;
  next(): Promise<IteratorResult<SDKMessage, void>>;
  return?(value?: void): Promise<IteratorResult<SDKMessage, void>>;
  throw?(e?: unknown): Promise<IteratorResult<SDKMessage, void>>;
  interrupt(): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
}

/**
 * Active session tracking
 */
export interface ActiveSession {
  readonly sessionId: SessionId;
  // Query may be null during pre-registration (before SDK query is created)
  query: Query | null;
  readonly config: AISessionConfig;
  readonly abortController: AbortController;
  // Mutable: Message queue for streaming input mode
  messageQueue: SDKUserMessage[];
  // Mutable: Callback to wake iterator when message arrives
  resolveNext: (() => void) | null;
  // Mutable: Current model
  currentModel: string;
}

/**
 * Configuration for executeQuery method
 */
export interface ExecuteQueryConfig {
  /** Session ID to use (tabId for new sessions, real UUID for resume) */
  sessionId: SessionId;
  /** Session configuration (model, workspace, etc.) */
  sessionConfig?: AISessionConfig;
  /** If set, resume this session instead of creating new */
  resumeSessionId?: string;
  /** Initial prompt to queue before starting query */
  initialPrompt?: { content: string; files?: string[] };
}

/**
 * Result of executeQuery method
 */
export interface ExecuteQueryResult {
  /** The SDK query instance */
  sdkQuery: Query;
  /** The model being used */
  initialModel: string;
  /** Abort controller for this session */
  abortController: AbortController;
}

/**
 * Manages SDK session lifecycle (runtime only)
 *
 * Uses a single sessionId (the real SDK UUID) everywhere.
 * No placeholder IDs, no mapping needed.
 */
@injectable()
export class SessionLifecycleManager {
  private activeSessions = new Map<string, ActiveSession>();

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    private permissionHandler: ISdkPermissionHandler,
    // TASK_2025_102: Dependencies for executeQuery orchestration
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    private moduleLoader: SdkModuleLoader,
    @inject(SDK_TOKENS.SDK_QUERY_OPTIONS_BUILDER)
    private queryOptionsBuilder: SdkQueryOptionsBuilder,
    @inject(SDK_TOKENS.SDK_MESSAGE_FACTORY)
    private messageFactory: SdkMessageFactory,
    // TASK_2025_103: SubagentRegistryService for marking subagents as interrupted
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private subagentRegistry: SubagentRegistryService
  ) {}

  /**
   * Pre-register active session (before SDK query is created)
   * This allows UserMessageStreamFactory to find the session and queue messages
   * before the SDK query object exists.
   */
  preRegisterActiveSession(
    sessionId: SessionId,
    config: AISessionConfig,
    abortController: AbortController
  ): void {
    const session: ActiveSession = {
      sessionId,
      query: null, // Will be set later via setSessionQuery
      config,
      abortController,
      messageQueue: [],
      resolveNext: null,
      currentModel: config.model || '', // Set from SDK via RPC layer
    };

    this.activeSessions.set(sessionId as string, session);
    this.logger.info(
      `[SessionLifecycle] Pre-registered active session: ${sessionId}`
    );
  }

  /**
   * Set the SDK query for a pre-registered session
   */
  setSessionQuery(sessionId: SessionId, query: Query): void {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      this.logger.error(
        `[SessionLifecycle] Cannot set query - session not found: ${sessionId}`
      );
      return;
    }

    session.query = query;
    this.logger.debug(`[SessionLifecycle] Set query for session: ${sessionId}`);
  }

  /**
   * Register active session (legacy - combines pre-register and set query)
   */
  registerActiveSession(
    sessionId: SessionId,
    query: Query,
    config: AISessionConfig,
    abortController: AbortController
  ): void {
    const session: ActiveSession = {
      sessionId,
      query,
      config,
      abortController,
      messageQueue: [],
      resolveNext: null,
      currentModel: config.model || '', // Set from SDK via RPC layer
    };

    this.activeSessions.set(sessionId as string, session);
    this.logger.info(
      `[SessionLifecycle] Registered active session: ${sessionId}`
    );
  }

  /**
   * Get active session by sessionId
   */
  getActiveSession(sessionId: SessionId): ActiveSession | undefined {
    return this.activeSessions.get(sessionId as string);
  }

  /**
   * Get all active session IDs
   */
  getActiveSessionIds(): SessionId[] {
    return Array.from(this.activeSessions.keys()) as SessionId[];
  }

  /**
   * Check if session is active
   */
  isSessionActive(sessionId: SessionId): boolean {
    return this.activeSessions.has(sessionId as string);
  }

  /**
   * End session and cleanup
   * TASK_2025_102: Now calls cleanupPendingPermissions to prevent unhandled promise rejections
   * TASK_2025_103: Now marks all running subagents as interrupted before session removal
   *
   * CRITICAL RISK MITIGATION: SubagentStop hook doesn't fire when a session is aborted.
   * This method is the ONLY reliable way to detect interrupted subagents. All running
   * subagents for this session are marked as 'interrupted' to enable resumption.
   */
  endSession(sessionId: SessionId): void {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      this.logger.warn(
        `[SessionLifecycle] Cannot end session - not found: ${sessionId}`
      );
      return;
    }

    this.logger.info(`[SessionLifecycle] Ending session: ${sessionId}`);

    // TASK_2025_102: Cleanup pending permissions FIRST to prevent unhandled promise rejections
    // This resolves any pending permission promises with deny before aborting the session
    this.permissionHandler.cleanupPendingPermissions(sessionId as string);

    // TASK_2025_103: Mark all running subagents as interrupted BEFORE aborting
    // This is the key mechanism for detecting interrupted subagents since
    // SubagentStop hook doesn't fire on abort. Running subagents become resumable.
    this.subagentRegistry.markAllInterrupted(sessionId as string);

    this.logger.info(
      `[SessionLifecycle] Marked running subagents as interrupted for session: ${sessionId}`
    );

    // Abort the session
    session.abortController.abort();

    // Interrupt the SDK query (if initialized)
    if (session.query) {
      session.query.interrupt().catch((err) => {
        this.logger.warn(
          `[SessionLifecycle] Failed to interrupt session ${sessionId}`,
          err
        );
      });
    }

    // Remove from active sessions
    this.activeSessions.delete(sessionId as string);

    this.logger.info(`[SessionLifecycle] Session ended: ${sessionId}`);
  }

  /**
   * Cleanup all active sessions
   * TASK_2025_102: Now calls cleanupPendingPermissions to prevent unhandled promise rejections
   * TASK_2025_103: Now marks all running subagents as interrupted for each session
   */
  disposeAllSessions(): void {
    this.logger.info('[SessionLifecycle] Disposing all active sessions...');

    // TASK_2025_102: Cleanup all pending permissions FIRST
    this.permissionHandler.cleanupPendingPermissions();

    for (const [sessionId, session] of this.activeSessions.entries()) {
      this.logger.debug(`[SessionLifecycle] Ending session: ${sessionId}`);

      // TASK_2025_103: Mark all running subagents as interrupted for this session
      this.subagentRegistry.markAllInterrupted(sessionId);

      session.abortController.abort();
      if (session.query) {
        session.query.interrupt().catch((err) => {
          this.logger.warn(
            `[SessionLifecycle] Failed to interrupt session ${sessionId}`,
            err
          );
        });
      }
    }

    this.activeSessions.clear();
    this.logger.info('[SessionLifecycle] All sessions disposed');
  }

  /**
   * Get session count
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  // ============================================================================
  // TASK_2025_102: Query Execution Orchestration
  // Extracted from SdkAgentAdapter to reduce its complexity
  // ============================================================================

  /**
   * Create a user message stream for SDK consumption
   * Merged from UserMessageStreamFactory to avoid circular dependencies
   *
   * @param sessionId - The session to create stream for
   * @param abortController - Controller to signal stream termination
   * @returns AsyncIterable that yields SDKUserMessage objects
   */
  createUserMessageStream(
    sessionId: SessionId,
    abortController: AbortController
  ): AsyncIterable<SDKUserMessage> {
    const activeSessions = this.activeSessions;
    const logger = this.logger;

    return {
      async *[Symbol.asyncIterator]() {
        while (!abortController.signal.aborted) {
          const session = activeSessions.get(sessionId as string);
          if (!session) {
            logger.warn(
              `[SessionLifecycle] Session ${sessionId} not found - ending stream`
            );
            return;
          }

          // Drain all queued messages
          while (session.messageQueue.length > 0) {
            const message = session.messageQueue.shift();
            if (message) {
              logger.debug(
                `[SessionLifecycle] Yielding message (${session.messageQueue.length} remaining)`
              );
              yield message;
            }
            if (abortController.signal.aborted) return;
          }

          // Wait for next message (no timeout - sessions run indefinitely)
          const waitResult = await new Promise<'message' | 'aborted'>(
            (resolve) => {
              const abortHandler = () => resolve('aborted');
              abortController.signal.addEventListener('abort', abortHandler);

              const currentSession = activeSessions.get(sessionId as string);
              if (!currentSession) {
                resolve('aborted');
                return;
              }

              // Check queue again before waiting
              if (currentSession.messageQueue.length > 0) {
                abortController.signal.removeEventListener(
                  'abort',
                  abortHandler
                );
                resolve('message');
                return;
              }

              // Set wake callback - called when new message arrives
              currentSession.resolveNext = () => {
                abortController.signal.removeEventListener(
                  'abort',
                  abortHandler
                );
                resolve('message');
              };

              logger.debug(
                `[SessionLifecycle] Waiting for message (${sessionId})...`
              );
            }
          );

          if (waitResult === 'aborted') {
            logger.debug(`[SessionLifecycle] Stream ended: ${waitResult}`);
            return;
          }
        }
      },
    };
  }

  /**
   * Execute an SDK query with all the orchestration steps
   * Consolidates the common flow between startChatSession and resumeSession
   *
   * @param config - Query execution configuration
   * @returns Query instance, model, and abort controller
   *
   * @example
   * ```typescript
   * const result = await sessionLifecycle.executeQuery({
   *   sessionId: trackingId,
   *   sessionConfig: config,
   *   initialPrompt: { content: 'Hello', files: [] },
   * });
   * return streamTransformer.transform({ sdkQuery: result.sdkQuery, ... });
   * ```
   */
  async executeQuery(config: ExecuteQueryConfig): Promise<ExecuteQueryResult> {
    const { sessionId, sessionConfig, resumeSessionId, initialPrompt } = config;

    this.logger.info(
      `[SessionLifecycle] Executing query for session: ${sessionId}`,
      {
        isResume: !!resumeSessionId,
        hasInitialPrompt: !!initialPrompt,
      }
    );

    // Step 1: Create abort controller
    const abortController = new AbortController();

    // Step 2: Pre-register session
    this.preRegisterActiveSession(
      sessionId,
      sessionConfig || {},
      abortController
    );

    // Step 3: Queue initial prompt if provided (for new sessions)
    if (initialPrompt && initialPrompt.content.trim()) {
      const session = this.getActiveSession(sessionId);
      if (session) {
        const sdkUserMessage = await this.messageFactory.createUserMessage({
          content: initialPrompt.content,
          sessionId,
          files: initialPrompt.files,
        });
        session.messageQueue.push(sdkUserMessage);
        this.logger.info(
          `[SessionLifecycle] Queued initial prompt for session ${sessionId}`
        );
      }
    }

    // Step 4: Get SDK query function
    const queryFn = await this.moduleLoader.getQueryFunction();

    // Step 5: Create user message stream
    const userMessageStream = this.createUserMessageStream(
      sessionId,
      abortController
    );

    // Step 6: Build query options
    const queryOptions = await this.queryOptionsBuilder.build({
      userMessageStream,
      abortController,
      sessionConfig,
      resumeSessionId,
    });

    this.logger.info('[SessionLifecycle] Starting SDK query with options', {
      model: queryOptions.options.model,
      cwd: queryOptions.options.cwd,
      permissionMode: queryOptions.options.permissionMode,
      isResume: !!resumeSessionId,
    });

    // Step 7: Start SDK query
    const sdkQuery: Query = queryFn({
      prompt: queryOptions.prompt,
      options: queryOptions.options as Options,
    });
    const initialModel = queryOptions.options.model;

    // Step 8: Set the query on the session
    this.setSessionQuery(sessionId, sdkQuery);

    this.logger.info(
      `[SessionLifecycle] Query started for session: ${sessionId}`
    );

    return {
      sdkQuery,
      initialModel,
      abortController,
    };
  }

  /**
   * Send a message to an active session
   * Extracted from SdkAgentAdapter to consolidate session operations
   *
   * @param sessionId - Session to send message to
   * @param content - Message content
   * @param files - Optional file attachments
   */
  async sendMessage(
    sessionId: SessionId,
    content: string,
    files?: string[]
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.logger.info(`[SessionLifecycle] Sending message to ${sessionId}`, {
      contentLength: content.length,
      fileCount: files?.length || 0,
    });

    // Create properly formatted SDK message
    const sdkUserMessage = await this.messageFactory.createUserMessage({
      content,
      sessionId,
      files,
    });

    // Queue for SDK - SDK will persist message to ~/.claude/projects/
    session.messageQueue.push(sdkUserMessage);

    // Wake iterator
    if (session.resolveNext) {
      session.resolveNext();
      session.resolveNext = null;
    }

    this.logger.info(`[SessionLifecycle] Message queued for ${sessionId}`);
  }

  /**
   * Permission level type - supports both frontend names and SDK mode names
   */
  static readonly PERMISSION_MODE_MAP: Record<string, string> = {
    ask: 'default',
    'auto-edit': 'acceptEdits',
    yolo: 'bypassPermissions',
    default: 'default',
    acceptEdits: 'acceptEdits',
    bypassPermissions: 'bypassPermissions',
  };

  /**
   * Set session permission level
   * Extracted from SdkAgentAdapter to consolidate session control
   *
   * @param sessionId - Session to update
   * @param level - Permission level (frontend or SDK name)
   */
  async setSessionPermissionLevel(
    sessionId: SessionId,
    level:
      | 'ask'
      | 'auto-edit'
      | 'yolo'
      | 'default'
      | 'acceptEdits'
      | 'bypassPermissions'
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!session.query) {
      throw new Error(`Session query not initialized: ${sessionId}`);
    }

    this.logger.info(
      `[SessionLifecycle] Setting permission level for ${sessionId}: ${level}`
    );

    // Map frontend names to SDK mode names
    const sdkMode = SessionLifecycleManager.PERMISSION_MODE_MAP[level] || level;

    try {
      await session.query.setPermissionMode(sdkMode);
      this.logger.info(
        `[SessionLifecycle] Permission level set for ${sessionId}`
      );
    } catch (error) {
      this.logger.error(
        `[SessionLifecycle] Failed to set permission for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Set session model
   * Extracted from SdkAgentAdapter to consolidate session control
   *
   * @param sessionId - Session to update
   * @param model - Model ID to set
   */
  async setSessionModel(sessionId: SessionId, model: string): Promise<void> {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!session.query) {
      throw new Error(`Session query not initialized: ${sessionId}`);
    }

    this.logger.info(
      `[SessionLifecycle] Setting model for ${sessionId}: ${model}`
    );

    try {
      await session.query.setModel(model);
      session.currentModel = model;
      this.logger.info(`[SessionLifecycle] Model set for ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `[SessionLifecycle] Failed to set model for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }
}
