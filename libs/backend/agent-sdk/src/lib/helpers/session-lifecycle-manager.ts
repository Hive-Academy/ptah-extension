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
  InlineImageAttachment,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import {
  SDKUserMessage,
  SDKMessage,
  ContentBlock,
  Options,
} from '../types/sdk-types/claude-sdk.types';
import type { SdkModuleLoader } from './sdk-module-loader';
import type { SdkQueryOptionsBuilder } from './sdk-query-options-builder';
import type { SdkMessageFactory } from './sdk-message-factory';
import type { CompactionStartCallback } from './compaction-hook-handler';
import type { SessionClearedCallback } from './session-start-hook-handler';

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
  /** Stream input messages to the query (TASK_2025_181: accepts string for slash command parsing) */
  streamInput(stream: AsyncIterable<string | SDKUserMessage>): Promise<void>;
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
  // Mutable: Message queue for streaming input mode (TASK_2025_181: supports string for slash commands)
  messageQueue: (string | SDKUserMessage)[];
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
  initialPrompt?: {
    content: string;
    files?: string[];
    images?: InlineImageAttachment[];
  };
  /**
   * Callback for compaction start events (TASK_2025_098)
   * Called when SDK begins compacting conversation history
   */
  onCompactionStart?: CompactionStartCallback;
  /**
   * Premium user flag - enables MCP server and Ptah system prompt (TASK_2025_108)
   * Passed through to SdkQueryOptionsBuilder for conditional feature enabling
   */
  isPremium?: boolean;
  /**
   * Whether the MCP server is currently running (TASK_2025_108)
   * When false, MCP config will not be included even for premium users.
   * This prevents configuring Claude with a dead MCP endpoint.
   * Defaults to true for backward compatibility.
   */
  mcpServerRunning?: boolean;
  /**
   * Enhanced prompt content to use as system prompt (TASK_2025_151)
   * When provided, this AI-generated guidance is appended to the system prompt
   * instead of the default PTAH_CORE_SYSTEM_PROMPT.
   * Resolved by the caller (ChatRpcHandlers) from EnhancedPromptsService.
   */
  enhancedPromptsContent?: string;
  /**
   * Plugin paths to load for this session (TASK_2025_153)
   * Absolute paths to plugin directories resolved by PluginLoaderService.
   * Passed through to SdkQueryOptionsBuilder.
   */
  pluginPaths?: string[];
  /**
   * Callback when /clear resets the session (TASK_2025_181)
   * Passed through to SdkQueryOptionsBuilder for SessionStart hook creation.
   */
  onSessionCleared?: SessionClearedCallback;
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
 * Sessions are pre-registered with the frontend tab ID (e.g., `tab_xxx`)
 * before the SDK query starts. Once the SDK returns the real session UUID
 * from the system 'init' message, resolveRealSessionId() records the mapping.
 * getActiveSessionIds() then returns the real UUIDs so that spawned CLI
 * agents receive the correct parentSessionId for session persistence.
 */
@injectable()
export class SessionLifecycleManager {
  private activeSessions = new Map<string, ActiveSession>();

  /**
   * Mapping from tab ID → real SDK session UUID.
   * Populated by resolveRealSessionId() when the SDK init message arrives.
   * Used by getActiveSessionIds() to return real UUIDs instead of tab IDs.
   */
  private tabIdToRealId = new Map<string, string>();

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
   * Record the mapping from tab ID to real SDK session UUID.
   * Called when the SDK system 'init' message resolves the real session ID.
   * After this, getActiveSessionIds() returns the real UUID instead of the tab ID.
   */
  resolveRealSessionId(tabId: string, realSessionId: string): void {
    if (this.activeSessions.has(tabId)) {
      this.tabIdToRealId.set(tabId, realSessionId);
      this.logger.info(
        `[SessionLifecycle] Resolved real session ID: ${tabId} -> ${realSessionId}`
      );
    }
  }

  /**
   * Get all active session IDs.
   * Returns real SDK UUIDs when resolved, tab IDs otherwise.
   */
  getActiveSessionIds(): SessionId[] {
    return Array.from(this.activeSessions.keys()).map(
      (key) => (this.tabIdToRealId.get(key) || key) as SessionId
    );
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
  async endSession(sessionId: SessionId): Promise<void> {
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

    // TASK_2025_175: Await interrupt() with timeout BEFORE abort()
    // SDK best practice: interrupt() must complete before abort() is called.
    // abort() kills the underlying process, so calling it before interrupt()
    // means the graceful stop signal is never processed.
    if (session.query) {
      try {
        let timedOut = false;
        await Promise.race([
          session.query.interrupt(),
          new Promise<void>((resolve) =>
            setTimeout(() => {
              timedOut = true;
              resolve();
            }, 5000)
          ),
        ]);
        this.logger.info(
          `[SessionLifecycle] Interrupt ${
            timedOut ? 'timed out (5s)' : 'completed'
          } for session: ${sessionId}`
        );
      } catch (err) {
        // TASK_2025_175: Log at WARN level so failures are visible
        this.logger.warn(
          `[SessionLifecycle] Interrupt failed for session ${sessionId}`,
          err instanceof Error ? err : new Error(String(err))
        );
      }
    }

    // Abort the session AFTER interrupt completes or times out
    session.abortController.abort();

    // Remove from active sessions and clean up tab-to-real mapping
    this.activeSessions.delete(sessionId as string);
    this.tabIdToRealId.delete(sessionId as string);

    this.logger.info(`[SessionLifecycle] Session ended: ${sessionId}`);
  }

  /**
   * Cleanup all active sessions
   * TASK_2025_102: Now calls cleanupPendingPermissions to prevent unhandled promise rejections
   * TASK_2025_103: Now marks all running subagents as interrupted for each session
   */
  async disposeAllSessions(): Promise<void> {
    this.logger.info('[SessionLifecycle] Disposing all active sessions...');

    // TASK_2025_102: Cleanup all pending permissions FIRST
    this.permissionHandler.cleanupPendingPermissions();

    // TASK_2025_175: Interrupt all sessions first, then abort
    const interruptPromises: Promise<void>[] = [];

    for (const [sessionId, session] of this.activeSessions.entries()) {
      this.logger.debug(`[SessionLifecycle] Ending session: ${sessionId}`);

      // TASK_2025_103: Mark all running subagents as interrupted for this session
      this.subagentRegistry.markAllInterrupted(sessionId);

      // TASK_2025_175: Interrupt BEFORE abort, with timeout
      if (session.query) {
        interruptPromises.push(
          Promise.race([
            session.query.interrupt(),
            new Promise<void>((resolve) => setTimeout(resolve, 5000)),
          ]).catch((err) => {
            this.logger.warn(
              `[SessionLifecycle] Failed to interrupt session ${sessionId}`,
              err instanceof Error ? err : new Error(String(err))
            );
          })
        );
      }
    }

    // Wait for all interrupts to complete or time out
    await Promise.allSettled(interruptPromises);

    // Now abort all sessions
    for (const [, session] of this.activeSessions.entries()) {
      session.abortController.abort();
    }

    this.activeSessions.clear();
    this.tabIdToRealId.clear();
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
  ): AsyncIterable<string | SDKUserMessage> {
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
    const {
      sessionId,
      sessionConfig,
      resumeSessionId,
      initialPrompt,
      onCompactionStart,
      isPremium = false,
      mcpServerRunning = true,
      enhancedPromptsContent,
      pluginPaths,
      onSessionCleared,
    } = config;

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
    // TASK_2025_181: Determine if initial prompt has attachments
    // If plain text only, we pass as string prompt to SDK (enables slash command parsing)
    // If has attachments, queue as SDKUserMessage (attachments need structured format)
    const hasAttachments =
      initialPrompt &&
      ((initialPrompt.files && initialPrompt.files.length > 0) ||
        (initialPrompt.images && initialPrompt.images.length > 0));

    if (initialPrompt && initialPrompt.content.trim() && hasAttachments) {
      // Has attachments - queue as SDKUserMessage (existing flow)
      const session = this.getActiveSession(sessionId);
      if (session) {
        const sdkUserMessage = await this.messageFactory.createUserMessage({
          content: initialPrompt.content,
          sessionId,
          files: initialPrompt.files,
          images: initialPrompt.images,
        });
        session.messageQueue.push(sdkUserMessage);
        this.logger.info(
          `[SessionLifecycle] Queued initial prompt with attachments for session ${sessionId}`
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
    // TASK_2025_098: Pass sessionId and onCompactionStart for compaction hooks
    // TASK_2025_108: Pass isPremium and mcpServerRunning for premium feature gating (MCP + system prompt)
    // Resolve initial SDK permission mode from current autopilot config
    const currentLevel = this.permissionHandler.getPermissionLevel();
    const initialPermissionMode =
      currentLevel === 'ask'
        ? 'default'
        : (SessionLifecycleManager.PERMISSION_MODE_MAP[currentLevel] as
            | 'default'
            | 'acceptEdits'
            | 'bypassPermissions'
            | 'plan');

    // TASK_2025_181: Pass initial prompt string separately when no attachments
    // This enables SDK slash command parsing for /clear, /compact, /help, plugin commands
    const initialPromptString =
      !hasAttachments && initialPrompt?.content.trim()
        ? initialPrompt.content
        : undefined;

    const queryOptions = await this.queryOptionsBuilder.build({
      userMessageStream,
      abortController,
      sessionConfig,
      resumeSessionId,
      sessionId: sessionId as string,
      onCompactionStart,
      isPremium,
      mcpServerRunning,
      enhancedPromptsContent,
      pluginPaths,
      permissionMode: initialPermissionMode,
      initialPromptString,
      onSessionCleared,
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

    // Step 7b: For string prompt, connect follow-up stream via streamInput (TASK_2025_181)
    // When the initial prompt is a plain string, the userMessageStream is NOT the prompt.
    // We need to connect it via streamInput() so follow-up messages can be delivered.
    if (queryOptions.promptIsString) {
      sdkQuery.streamInput(userMessageStream).catch((err) => {
        this.logger.warn('[SessionLifecycle] streamInput error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      this.logger.info(
        `[SessionLifecycle] Connected streamInput for string-prompt session: ${sessionId}`
      );
    }

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
   * @param images - Optional inline images (pasted/dropped)
   */
  async sendMessage(
    sessionId: SessionId,
    content: string,
    files?: string[],
    images?: InlineImageAttachment[]
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.logger.info(`[SessionLifecycle] Sending message to ${sessionId}`, {
      contentLength: content.length,
      fileCount: files?.length || 0,
      imageCount: images?.length || 0,
    });

    // TASK_2025_181: Determine if message has attachments
    const hasAttachments =
      (files && files.length > 0) || (images && images.length > 0);

    if (hasAttachments) {
      // Messages with attachments need SDKUserMessage format
      const sdkUserMessage = await this.messageFactory.createUserMessage({
        content,
        sessionId,
        files,
        images,
      });
      session.messageQueue.push(sdkUserMessage);
    } else {
      // Plain text messages (including slash commands) sent as strings
      // This enables SDK slash command parsing for /clear, /compact, /help, plugin commands
      session.messageQueue.push(content);
    }

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
    plan: 'plan',
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
      | 'plan'
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
