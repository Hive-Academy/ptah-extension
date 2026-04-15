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
import type {
  SubagentRegistryService,
  AgentSessionWatcherService,
} from '@ptah-extension/vscode-core';
import {
  SessionId,
  AISessionConfig,
  ISdkPermissionHandler,
  InlineImageAttachment,
  type AuthEnv,
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
import type {
  WorktreeCreatedCallback,
  WorktreeRemovedCallback,
} from './worktree-hook-handler';
import { SlashCommandInterceptor } from './slash-command-interceptor';
import { resolveModelIdStatic } from './sdk-model-service';

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
  /** Stream input messages to the query */
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
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
  /** Callback when SDK creates a worktree (TASK_2025_236) */
  onWorktreeCreated?: WorktreeCreatedCallback;
  /** Callback when SDK removes a worktree (TASK_2025_236) */
  onWorktreeRemoved?: WorktreeRemovedCallback;
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
   * Explicit path to Claude Code CLI executable (cli.js).
   * TASK_2025_194: Passed through to SdkQueryOptionsBuilder to override
   * the default import.meta.url-based resolution baked at bundle time.
   */
  pathToClaudeCodeExecutable?: string;
}

/**
 * Configuration for slash command execution.
 * Shared between SessionLifecycleManager and SdkAgentAdapter.
 * @see TASK_2025_184
 */
export interface SlashCommandConfig {
  sessionConfig?: AISessionConfig;
  isPremium?: boolean;
  mcpServerRunning?: boolean;
  enhancedPromptsContent?: string;
  pluginPaths?: string[];
  onCompactionStart?: CompactionStartCallback;
  onWorktreeCreated?: WorktreeCreatedCallback;
  onWorktreeRemoved?: WorktreeRemovedCallback;
  /** TASK_2025_194: Explicit path to cli.js */
  pathToClaudeCodeExecutable?: string;
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

  /**
   * Tracks the most recently active tab ID.
   * Updated on session registration and message send.
   * Used by getActiveSessionIds() to return the most recently active
   * session first, so MCP tool calls (e.g., ptah_agent_spawn) attribute
   * agents to the correct session in multi-session scenarios.
   */
  private _lastActiveTabId: string | null = null;

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
    private subagentRegistry: SubagentRegistryService,
    // TASK_2025_264: AgentSessionWatcherService for stopping file watchers on session end
    @inject(TOKENS.AGENT_SESSION_WATCHER_SERVICE)
    private agentSessionWatcher: AgentSessionWatcherService,
    @inject(SDK_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
  ) {}

  /**
   * Pre-register active session (before SDK query is created)
   * This allows createUserMessageStream to find the session and queue messages
   * before the SDK query object exists.
   */
  preRegisterActiveSession(
    sessionId: SessionId,
    config: AISessionConfig,
    abortController: AbortController,
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
    this._lastActiveTabId = sessionId as string;
    this.logger.info(
      `[SessionLifecycle] Pre-registered active session: ${sessionId}`,
    );
  }

  /**
   * Set the SDK query for a pre-registered session
   */
  setSessionQuery(sessionId: SessionId, query: Query): void {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      this.logger.error(
        `[SessionLifecycle] Cannot set query - session not found: ${sessionId}`,
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
    abortController: AbortController,
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
    this._lastActiveTabId = sessionId as string;
    this.logger.info(
      `[SessionLifecycle] Registered active session: ${sessionId}`,
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
        `[SessionLifecycle] Resolved real session ID: ${tabId} -> ${realSessionId}`,
      );
    }
  }

  /**
   * Get all active session IDs, most recently active first.
   * Returns real SDK UUIDs when resolved, tab IDs otherwise.
   * The ordering ensures that getActiveSessionIds()[0] returns the session
   * the user most recently interacted with, which is critical for MCP tools
   * like ptah_agent_spawn that pick ids[0] as the parentSessionId.
   */
  getActiveSessionIds(): SessionId[] {
    const keys = Array.from(this.activeSessions.keys());

    // Sort so that the most recently active tab ID comes first
    if (this._lastActiveTabId && keys.length > 1) {
      const idx = keys.indexOf(this._lastActiveTabId);
      if (idx > 0) {
        keys.splice(idx, 1);
        keys.unshift(this._lastActiveTabId);
      }
    }

    return keys.map((key) => (this.tabIdToRealId.get(key) || key) as SessionId);
  }

  /**
   * Get the workspace root (projectPath) for the most recently active session.
   * Used by MCP tools to resolve workspace per-session instead of globally.
   * In multi-workspace scenarios (e.g., Electron with multiple folders open),
   * this ensures CLI agents and subagents inherit the correct workspace
   * from the session that spawned them, not whichever workspace is globally active.
   */
  getActiveSessionWorkspace(): string | undefined {
    if (this._lastActiveTabId) {
      const session = this.activeSessions.get(this._lastActiveTabId);
      if (session?.config?.projectPath) {
        return session.config.projectPath;
      }
    }
    // Fallback: check any active session
    for (const session of this.activeSessions.values()) {
      if (session.config?.projectPath) {
        return session.config.projectPath;
      }
    }
    return undefined;
  }

  /**
   * Resolve a tab ID or session ID to the real SDK UUID.
   * If the input is a known tab ID, returns the resolved real UUID.
   * Otherwise returns the input as-is (it may already be a real UUID).
   */
  getResolvedSessionId(tabIdOrSessionId: string): string {
    return this.tabIdToRealId.get(tabIdOrSessionId) ?? tabIdOrSessionId;
  }

  /**
   * Check if session is active
   */
  isSessionActive(sessionId: SessionId): boolean {
    return this.activeSessions.has(sessionId as string);
  }

  /**
   * Interrupt the current assistant turn without ending the session.
   *
   * Unlike endSession(), this does NOT abort the session or clean up resources.
   * The session remains active for continued use — the user's follow-up message
   * will start a new turn.
   *
   * Used when the user sends a message during autopilot (yolo/auto-edit) execution.
   * In these modes, tool calls are auto-approved, so the user has no checkpoint to
   * stop the agent. Calling interrupt() forces the SDK to stop the current turn,
   * ensuring the user's message is processed in a new turn.
   *
   * @param sessionId - Session whose current turn should be interrupted
   * @returns true if interrupt was called, false if session/query not found
   */
  async interruptCurrentTurn(sessionId: SessionId): Promise<boolean> {
    let session = this.activeSessions.get(sessionId as string);

    // Reverse lookup: frontend may send real SDK UUID but activeSessions is keyed by tab ID.
    // Same pattern as endSession() and setSessionModel().
    if (!session) {
      for (const [tabId, realId] of this.tabIdToRealId.entries()) {
        if (realId === (sessionId as string)) {
          session = this.activeSessions.get(tabId);
          if (session) {
            sessionId = tabId as SessionId;
            break;
          }
        }
      }
    }

    if (!session?.query) {
      this.logger.warn(
        `[SessionLifecycle] Cannot interrupt turn - session or query not found: ${sessionId}`,
      );
      return false;
    }

    this.logger.info(
      `[SessionLifecycle] Interrupting current turn for session: ${sessionId}`,
    );

    try {
      let timedOut = false;
      await Promise.race([
        session.query.interrupt(),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            timedOut = true;
            resolve();
          }, 3000),
        ),
      ]);
      if (timedOut) {
        this.logger.warn(
          `[SessionLifecycle] Turn interrupt timed out (3s) for session: ${sessionId}`,
        );
      } else {
        this.logger.info(
          `[SessionLifecycle] Turn interrupt completed for session: ${sessionId}`,
        );
      }
      return !timedOut;
    } catch (err) {
      this.logger.warn(
        `[SessionLifecycle] Turn interrupt failed for session ${sessionId}`,
        err instanceof Error ? err : new Error(String(err)),
      );
      return false;
    }
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
    let session = this.activeSessions.get(sessionId as string);

    // TASK_2025_211: Reverse lookup - if sessionId is a real SDK UUID, find the tab ID
    // The frontend sends the real SDK UUID but activeSessions is keyed by tab ID
    if (!session) {
      for (const [tabId, realId] of this.tabIdToRealId.entries()) {
        if (realId === (sessionId as string)) {
          session = this.activeSessions.get(tabId);
          if (session) {
            sessionId = tabId as SessionId;
            break;
          }
        }
      }
    }

    if (!session) {
      this.logger.warn(
        `[SessionLifecycle] Cannot end session - not found: ${sessionId}`,
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
    // TASK_2025_186: Use real UUID if resolved, since SubagentRegistryService records
    // may have been updated from tab ID to real UUID by resolveParentSessionId().
    const registrySessionId =
      this.tabIdToRealId.get(sessionId as string) || (sessionId as string);
    this.subagentRegistry.markAllInterrupted(registrySessionId);

    // TASK_2025_264: Stop all agent session file watchers for this session.
    // Prevents background agent watchers from tailing files and emitting
    // events to a dead session after abort.
    this.agentSessionWatcher.stopAllForSession(registrySessionId);

    this.logger.info(
      `[SessionLifecycle] Marked running subagents as interrupted and stopped watchers for session: ${sessionId}`,
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
            }, 5000),
          ),
        ]);
        this.logger.info(
          `[SessionLifecycle] Interrupt ${
            timedOut ? 'timed out (5s)' : 'completed'
          } for session: ${sessionId}`,
        );
      } catch (err) {
        // TASK_2025_175: Log at WARN level so failures are visible
        this.logger.warn(
          `[SessionLifecycle] Interrupt failed for session ${sessionId}`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    // Abort the session AFTER interrupt completes or times out
    session.abortController.abort();

    // Remove from active sessions and clean up tab-to-real mapping
    this.activeSessions.delete(sessionId as string);
    this.tabIdToRealId.delete(sessionId as string);

    // Clear last-active tracker if the ended session was the most recent
    if (this._lastActiveTabId === (sessionId as string)) {
      // Fall back to the next available active session (if any)
      const remaining = Array.from(this.activeSessions.keys());
      this._lastActiveTabId =
        remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }

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
      // TASK_2025_186: Use real UUID if resolved
      const registryId = this.tabIdToRealId.get(sessionId) || sessionId;
      this.subagentRegistry.markAllInterrupted(registryId);

      // TASK_2025_264: Stop all agent session file watchers for this session
      this.agentSessionWatcher.stopAllForSession(registryId);

      // TASK_2025_175: Interrupt BEFORE abort, with timeout
      if (session.query) {
        interruptPromises.push(
          Promise.race([
            session.query.interrupt(),
            new Promise<void>((resolve) => setTimeout(resolve, 5000)),
          ]).catch((err) => {
            this.logger.warn(
              `[SessionLifecycle] Failed to interrupt session ${sessionId}`,
              err instanceof Error ? err : new Error(String(err)),
            );
          }),
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
   * Creates an async iterable that yields user messages from the session queue
   *
   * @param sessionId - The session to create stream for
   * @param abortController - Controller to signal stream termination
   * @returns AsyncIterable that yields SDKUserMessage objects
   */
  createUserMessageStream(
    sessionId: SessionId,
    abortController: AbortController,
  ): AsyncIterable<SDKUserMessage> {
    const activeSessions = this.activeSessions;
    const logger = this.logger;

    return {
      async *[Symbol.asyncIterator]() {
        while (!abortController.signal.aborted) {
          const session = activeSessions.get(sessionId as string);
          if (!session) {
            logger.warn(
              `[SessionLifecycle] Session ${sessionId} not found - ending stream`,
            );
            return;
          }

          // Drain all queued messages
          while (session.messageQueue.length > 0) {
            const message = session.messageQueue.shift();
            if (message) {
              logger.debug(
                `[SessionLifecycle] Yielding message (${session.messageQueue.length} remaining)`,
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
                  abortHandler,
                );
                resolve('message');
                return;
              }

              // Set wake callback - called when new message arrives
              currentSession.resolveNext = () => {
                abortController.signal.removeEventListener(
                  'abort',
                  abortHandler,
                );
                resolve('message');
              };

              logger.debug(
                `[SessionLifecycle] Waiting for message (${sessionId})...`,
              );
            },
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
      onWorktreeCreated,
      onWorktreeRemoved,
      isPremium = false,
      mcpServerRunning = true,
      enhancedPromptsContent,
      pluginPaths,
      pathToClaudeCodeExecutable,
    } = config;

    this.logger.info(
      `[SessionLifecycle] Executing query for session: ${sessionId}`,
      {
        isResume: !!resumeSessionId,
        hasInitialPrompt: !!initialPrompt,
      },
    );

    // Step 1: Create abort controller
    const abortController = new AbortController();

    // Step 2: Pre-register session
    this.preRegisterActiveSession(
      sessionId,
      sessionConfig || {},
      abortController,
    );

    // Step 3: Determine if initial prompt is a slash command
    // SDK only parses slash commands from raw string prompts, not from SDKUserMessage objects
    // in the async iterable. So slash commands must be passed as string to query().
    // NOTE: If the message has file/image attachments, treat it as a regular message
    // even if it starts with `/` — files can't be passed alongside a string prompt.
    const initialContent = initialPrompt?.content.trim() || '';
    const hasAttachments =
      (initialPrompt?.files && initialPrompt.files.length > 0) ||
      (initialPrompt?.images && initialPrompt.images.length > 0);
    const isSlashCommand =
      SlashCommandInterceptor.isSlashCommand(initialContent) && !hasAttachments;

    // For non-slash-command messages, queue them in the iterable as SDKUserMessage
    if (initialContent && !isSlashCommand) {
      const session = this.getActiveSession(sessionId);
      if (session) {
        const sdkUserMessage = await this.messageFactory.createUserMessage({
          content: initialPrompt!.content,
          sessionId,
          files: initialPrompt!.files,
          images: initialPrompt!.images,
        });
        session.messageQueue.push(sdkUserMessage);
        this.logger.info(
          `[SessionLifecycle] Queued initial prompt for session ${sessionId}`,
        );
      }
    }

    // Step 4: Get SDK query function
    const queryFn = await this.moduleLoader.getQueryFunction();

    // Step 5: Create user message stream
    const userMessageStream = this.createUserMessageStream(
      sessionId,
      abortController,
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

    const queryOptions = await this.queryOptionsBuilder.build({
      userMessageStream,
      abortController,
      sessionConfig,
      resumeSessionId,
      sessionId: sessionId as string,
      onCompactionStart,
      onWorktreeCreated,
      onWorktreeRemoved,
      isPremium,
      mcpServerRunning,
      enhancedPromptsContent,
      pluginPaths,
      permissionMode: initialPermissionMode,
      pathToClaudeCodeExecutable,
    });

    // Determine the effective prompt for the SDK query:
    // - Resume sessions: idle prompt (messages via streamInput)
    // - Slash commands: raw string (SDK parses commands from string prompts only)
    // - Regular messages: iterable (messages queued as SDKUserMessage)
    const isResume = !!resumeSessionId;
    let effectivePrompt: string | AsyncIterable<SDKUserMessage>;
    let promptMode: string;

    if (isSlashCommand) {
      // TASK_2025_184: Slash commands MUST be passed as raw string prompt
      // even when resuming. The SDK only parses commands from string prompts.
      effectivePrompt = initialContent;
      promptMode = isResume
        ? 'string (slash command + resume)'
        : 'string (slash command)';
    } else if (isResume) {
      effectivePrompt = this.createIdlePromptStream(abortController);
      promptMode = 'idle+streamInput';
    } else {
      effectivePrompt = queryOptions.prompt;
      promptMode = 'iterable';
    }

    // NOTE: Do NOT set maxTurns: 1 for slash commands.
    // Built-in commands (/compact, /cost, /context) bypass the turn loop entirely
    // (SDK TerminalReason is "unset" for local slash commands), so maxTurns is
    // irrelevant. Setting maxTurns: 1 actually BREAKS command recognition — the
    // SDK sends the raw string to Claude as a regular message instead of parsing
    // it as a built-in command.
    // The session terminates naturally because streamInput is not connected
    // (see Step 7b below), so no further input can arrive after the command.

    this.logger.info('[SessionLifecycle] Starting SDK query with options', {
      model: queryOptions.options.model,
      cwd: queryOptions.options.cwd,
      permissionMode: queryOptions.options.permissionMode,
      maxTurns: queryOptions.options.maxTurns,
      isResume,
      isSlashCommand,
      promptMode,
    });

    // Step 7: Start SDK query
    const sdkQuery: Query = queryFn({
      prompt: effectivePrompt,
      options: queryOptions.options as Options,
    });
    const initialModel = queryOptions.options.model;

    // Step 7b: Connect streamInput for follow-up message delivery
    // Resume sessions: ALL messages come via streamInput (idle prompt)
    // Regular sessions: follow-up messages come from the iterable
    // Slash commands: Do NOT connect streamInput. The SDK processes the
    // command from the string prompt and terminates naturally. Connecting
    // streamInput would keep the query alive waiting for input that never
    // comes, preventing the for-await-of loop from exiting.
    if (isResume && !isSlashCommand) {
      sdkQuery.streamInput(userMessageStream).catch((err) => {
        this.logger.warn('[SessionLifecycle] streamInput error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      this.logger.info(
        `[SessionLifecycle] Connected streamInput for session: ${sessionId} (${promptMode})`,
      );
    }

    // Step 8: Set the query on the session
    this.setSessionQuery(sessionId, sdkQuery);

    this.logger.info(
      `[SessionLifecycle] Query started for session: ${sessionId}`,
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
    images?: InlineImageAttachment[],
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Mark this session as the most recently active so MCP tool calls
    // (e.g., ptah_agent_spawn) attribute agents to the correct session.
    this._lastActiveTabId = sessionId as string;

    this.logger.info(`[SessionLifecycle] Sending message to ${sessionId}`, {
      contentLength: content.length,
      fileCount: files?.length || 0,
      imageCount: images?.length || 0,
    });

    const sdkUserMessage = await this.messageFactory.createUserMessage({
      content,
      sessionId,
      files,
      images,
    });
    session.messageQueue.push(sdkUserMessage);

    // Wake iterator
    if (session.resolveNext) {
      session.resolveNext();
      session.resolveNext = null;
    }

    this.logger.info(`[SessionLifecycle] Message queued for ${sessionId}`);
  }

  /**
   * Execute a slash command as a new query within an existing session.
   * Used when follow-up messages contain slash commands (e.g., /compact, /ptah-core:orchestrate).
   * The SDK only parses slash commands from raw string prompts, not from SDKUserMessage objects,
   * so we must start a new query with resume to maintain conversation context.
   *
   * @see TASK_2025_184 - Follow-up slash command support
   */
  async executeSlashCommandQuery(
    sessionId: SessionId,
    command: string,
    config: SlashCommandConfig,
  ): Promise<ExecuteQueryResult> {
    this.logger.info(
      `[SessionLifecycle] Executing slash command query for session: ${sessionId}`,
      { command: command.substring(0, 50) },
    );

    // Resolve real SDK UUID before endSession deletes the tabIdToRealId mapping
    const realSessionId =
      this.tabIdToRealId.get(sessionId as string) || (sessionId as string);

    // Step 1: End the current session (abort existing query)
    await this.endSession(sessionId);

    // Step 2: Start a new query with resume using the REAL session ID
    // executeQuery will detect isSlashCommand and pass it as a raw string to query()
    return this.executeQuery({
      sessionId,
      sessionConfig: config.sessionConfig,
      resumeSessionId: realSessionId,
      initialPrompt: { content: command, files: [], images: [] },
      onCompactionStart: config.onCompactionStart,
      onWorktreeCreated: config.onWorktreeCreated,
      onWorktreeRemoved: config.onWorktreeRemoved,
      isPremium: config.isPremium,
      mcpServerRunning: config.mcpServerRunning,
      enhancedPromptsContent: config.enhancedPromptsContent,
      pluginPaths: config.pluginPaths,
      pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
    });
  }

  /**
   * Create an idle prompt stream for resume sessions.
   *
   * This iterable waits indefinitely without yielding any messages.
   * Used as the SDK prompt during resume so that actual user messages
   * are delivered via streamInput() instead. This avoids the SDK resume
   * code path validating message.type on iterable items.
   *
   * Completes when the abort controller signals session end.
   */
  private createIdlePromptStream(
    abortController: AbortController,
  ): AsyncIterable<SDKUserMessage> {
    return {
      [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
        let done = false;
        return {
          next(): Promise<IteratorResult<SDKUserMessage>> {
            if (done || abortController.signal.aborted) {
              return Promise.resolve({ done: true, value: undefined });
            }
            return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
              abortController.signal.addEventListener(
                'abort',
                () => {
                  done = true;
                  resolve({ done: true, value: undefined });
                },
                { once: true },
              );
            });
          },
        };
      },
    };
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
      | 'bypassPermissions',
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!session.query) {
      throw new Error(`Session query not initialized: ${sessionId}`);
    }

    this.logger.info(
      `[SessionLifecycle] Setting permission level for ${sessionId}: ${level}`,
    );

    // Map frontend names to SDK mode names
    const sdkMode = SessionLifecycleManager.PERMISSION_MODE_MAP[level] || level;

    try {
      await session.query.setPermissionMode(sdkMode);
      this.logger.info(
        `[SessionLifecycle] Permission level set for ${sessionId}`,
      );
    } catch (error) {
      this.logger.error(
        `[SessionLifecycle] Failed to set permission for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Set session model
   * Extracted from SdkAgentAdapter to consolidate session control
   *
   * Resolves bare tier names ('opus', 'sonnet', 'haiku') to full model IDs
   * before passing to the SDK. The SDK's setModel() requires full model IDs
   * like 'claude-opus-4-6' — bare tier names cause "can't access model" errors.
   *
   * @param sessionId - Session to update
   * @param model - Model ID or bare tier name to set
   */
  async setSessionModel(sessionId: SessionId, model: string): Promise<void> {
    let session = this.activeSessions.get(sessionId as string);

    // Reverse lookup: frontend sends real SDK UUID but activeSessions is keyed by tab ID
    if (!session) {
      for (const [tabId, realId] of this.tabIdToRealId.entries()) {
        if (realId === (sessionId as string)) {
          session = this.activeSessions.get(tabId);
          if (session) break;
        }
      }
    }

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!session.query) {
      throw new Error(`Session query not initialized: ${sessionId}`);
    }

    // Resolve model through provider overrides (e.g., claude-sonnet-4-6 → glm-5.1 on Z.AI)
    // and bare tier names (e.g., 'sonnet' → 'claude-sonnet-4-6' on direct Anthropic).
    const resolvedModel = resolveModelIdStatic(model, this.authEnv);
    if (resolvedModel !== model) {
      this.logger.info(
        `[SessionLifecycle] Model resolved: '${model}' → '${resolvedModel}'`,
      );
    }

    this.logger.info(
      `[SessionLifecycle] Setting model for ${sessionId}: ${resolvedModel}`,
    );

    try {
      await session.query.setModel(resolvedModel);
      session.currentModel = resolvedModel;
      this.logger.info(`[SessionLifecycle] Model set for ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `[SessionLifecycle] Failed to set model for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }
}
