/**
 * Session Lifecycle Manager - Handles SDK session runtime management
 *
 * Responsibilities:
 * - Active session tracking (runtime only)
 * - Message queue management for streaming input
 * - Abort controller lifecycle
 * - Session cleanup
 * - SDK query execution orchestration
 * - Subagent interruption tracking on session abort
 *
 * NOTE: This manager does NOT handle session persistence.
 * The SDK handles message persistence natively to ~/.claude/projects/
 * UI metadata (names, timestamps, costs) is managed by SessionMetadataStore.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import {
  SessionId,
  AISessionConfig,
  ISdkPermissionHandler,
  InlineImageAttachment,
  type AuthEnv,
  type McpHttpServerOverride,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import {
  SDKUserMessage,
  SDKMessage,
  ContentBlock,
} from '../types/sdk-types/claude-sdk.types';
import type { SdkModuleLoader } from './sdk-module-loader';
import type { SdkQueryOptionsBuilder } from './sdk-query-options-builder';
import type { SdkMessageFactory } from './sdk-message-factory';
import type { CompactionStartCallback } from './compaction-hook-handler';
import type {
  WorktreeCreatedCallback,
  WorktreeRemovedCallback,
} from './worktree-hook-handler';
import type { ModelResolver } from '../auth/model-resolver';
import {
  SessionRegistry,
  type SessionRecord,
} from './session-lifecycle/session-registry.service';
import { SessionStreamPump } from './session-lifecycle/session-stream-pump.service';
import { SessionQueryExecutor } from './session-lifecycle/session-query-executor.service';
import { SessionControl } from './session-lifecycle/session-control.service';
import type { SessionEndCallbackRegistry } from './session-end-callback-registry';

// Re-export for backward compatibility with other files
export type { SDKUserMessage, ContentBlock };

// Re-export SessionRecord and its type alias for all consumers.
export type { SessionRecord } from './session-lifecycle/session-registry.service';

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
  /**
   * Stop a specific running subagent by its SDK task_id.
   * The subagent's output is written to its output_file and a
   * task_notification with status='stopped' is emitted.
   */
  stopTask(taskId: string): Promise<void>;
  /**
   * Rewind tracked files to their state at a specific user message.
   * Requires the session to have been started with `enableFileCheckpointing: true`.
   * Throws if checkpointing is disabled.
   */
  rewindFiles(
    userMessageId: string,
    options?: { dryRun?: boolean },
  ): Promise<{
    canRewind: boolean;
    error?: string;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
  }>;
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
   * Callback for compaction start events.
   * Called when SDK begins compacting conversation history.
   */
  onCompactionStart?: CompactionStartCallback;
  /** Callback when SDK creates a worktree */
  onWorktreeCreated?: WorktreeCreatedCallback;
  /** Callback when SDK removes a worktree */
  onWorktreeRemoved?: WorktreeRemovedCallback;
  /**
   * Premium user flag - enables MCP server and Ptah system prompt.
   * Passed through to SdkQueryOptionsBuilder for conditional feature enabling.
   */
  isPremium?: boolean;
  /**
   * Whether the MCP server is currently running.
   * When false, MCP config will not be included even for premium users.
   * This prevents configuring Claude with a dead MCP endpoint.
   * Defaults to true for backward compatibility.
   */
  mcpServerRunning?: boolean;
  /**
   * Enhanced prompt content to use as system prompt.
   * When provided, this AI-generated guidance is appended to the system prompt
   * instead of the default PTAH_CORE_SYSTEM_PROMPT.
   * Resolved by the caller (ChatRpcHandlers) from EnhancedPromptsService.
   */
  enhancedPromptsContent?: string;
  /**
   * Plugin paths to load for this session.
   * Absolute paths to plugin directories resolved by PluginLoaderService.
   * Passed through to SdkQueryOptionsBuilder.
   */
  pluginPaths?: string[];
  /**
   * Explicit path to Claude Code CLI executable (cli.js).
   * Passed through to SdkQueryOptionsBuilder to override the default
   * import.meta.url-based resolution baked at bundle time.
   */
  pathToClaudeCodeExecutable?: string;
  /**
   * When true, resume + forkSession together create a NEW session ID instead
   * of mutating the resumed transcript. Has no effect unless `resumeSessionId`
   * is also set. Forwarded to `SdkQueryOptionsBuilder.build()`.
   */
  forkSession?: boolean;
  /**
   * When resuming, only replay messages up to (and including) the message
   * with this UUID. Maps directly to SDK Options.resumeSessionAt. Forwarded
   * to `SdkQueryOptionsBuilder.build()`.
   */
  resumeSessionAt?: string;
  /**
   * Toggle SDK file checkpointing for this session. Defaults to ON when
   * unspecified — file checkpointing is required by `Query.rewindFiles()`,
   * which is the underlying mechanism for the rewind feature. Pass `false`
   * explicitly to opt out (e.g., performance-sensitive contexts).
   */
  enableFileCheckpointing?: boolean;
  /**
   * When true, the SDK emits `SDKPartialAssistantMessage` events
   * (`subtype: 'stream_event'`) for finer-grained streaming deltas.
   * Forwarded to `SdkQueryOptionsBuilder.build()`. Defaults to ON when
   * unspecified to preserve historical Ptah streaming behavior.
   */
  includePartialMessages?: boolean;
  /**
   * Caller-supplied MCP HTTP server overrides — merged OVER the registry-
   * built map by the options builder (caller wins on key collision).
   * Reserved for the Anthropic-compatible HTTP proxy. When `undefined` or
   * empty, the SDK's `mcpServers` is identity-preserved.
   */
  mcpServersOverride?: Record<string, McpHttpServerOverride>;
  /**
   * The user's initial message text for this turn.
   * Used by SdkQueryOptionsBuilder to drive a memory recall search so the
   * top-K hits are prepended to the system prompt. Only used for premium users
   * with a non-empty query.
   */
  initialUserQuery?: string;
  /**
   * Pre-warmed `WarmQuery` handle from `SdkAgentAdapter.prewarm()`. When
   * provided, the executor uses `warm.query(prompt)` for the very first
   * query of this session instead of the standard `queryFn(...)` call —
   * skipping the spawn + initialize handshake.
   *
   * **Caller contract**: the caller MUST have already validated (via
   * `consumeWarmQuery(requirements)`) that this warm handle's option
   * fingerprint matches the options about to be built for this session.
   * The executor does NOT re-validate — `WarmQuery.query` accepts only a
   * prompt and silently inherits every other Option from the original
   * `startup()` call, so any mismatch produces a session running with the
   * wrong options. Callers that aren't sure must pass `undefined` here.
   *
   * Only meaningful for NEW (non-resume, non-fork) sessions with a string
   * or iterable prompt. The executor falls back to the normal `queryFn`
   * path if this is `undefined`, if the session is a resume/fork, or if
   * `warm.query` is missing on the handle.
   */
  warmQuery?: { close: () => void; query?: unknown };
}

/**
 * Configuration for slash command execution.
 * Shared between SessionLifecycleManager and SdkAgentAdapter.
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
  /** Explicit path to cli.js */
  pathToClaudeCodeExecutable?: string;
  /**
   * Mirrors `ExecuteQueryConfig.forkSession`. Only meaningful in combination
   * with `resumeSessionId` (always set internally for slash commands since
   * they resume the existing session). Forwarded to the options builder.
   */
  forkSession?: boolean;
  /**
   * Mirrors `ExecuteQueryConfig.resumeSessionAt`. When set, the resumed
   * transcript replay stops at this message UUID.
   */
  resumeSessionAt?: string;
  /**
   * Mirrors `ExecuteQueryConfig.enableFileCheckpointing`. Defaults to ON in
   * the builder when unspecified.
   */
  enableFileCheckpointing?: boolean;
  /**
   * Mirrors `ExecuteQueryConfig.includePartialMessages`. Defaults to ON in
   * the builder when unspecified.
   */
  includePartialMessages?: boolean;
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
  // Wave C7i: state ownership consolidated in `SessionRegistry`. The facade
  // owns NO mutable session state; all reads/writes go through `_registry`.
  private readonly _registry: SessionRegistry;
  private readonly _streamPump: SessionStreamPump;
  private readonly _queryExecutor: SessionQueryExecutor;
  private readonly _control: SessionControl;

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    private permissionHandler: ISdkPermissionHandler,
    // Dependencies for executeQuery orchestration
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    private moduleLoader: SdkModuleLoader,
    @inject(SDK_TOKENS.SDK_QUERY_OPTIONS_BUILDER)
    private queryOptionsBuilder: SdkQueryOptionsBuilder,
    @inject(SDK_TOKENS.SDK_MESSAGE_FACTORY)
    private messageFactory: SdkMessageFactory,
    // SubagentRegistryService for marking subagents as interrupted
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private subagentRegistry: SubagentRegistryService,
    @inject(SDK_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
    @inject(SDK_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: ModelResolver,
    @inject(SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY)
    private readonly sessionEndRegistry: SessionEndCallbackRegistry,
  ) {
    // Sub-services are constructed eagerly inside the facade because the spec
    // bypasses tsyringe and uses `new SessionLifecycleManager(...)` directly
    // with 9 positional args. Eager construction keeps the facade self-
    // contained: no container lookup, no late-binding hazard, identical
    // behavior whether instantiated by tsyringe or by hand in the spec.
    this._registry = new SessionRegistry(this.logger);
    this._streamPump = new SessionStreamPump(
      this.logger,
      this._registry,
      this.messageFactory,
    );
    this._queryExecutor = new SessionQueryExecutor(
      this.logger,
      this._registry,
      this._streamPump,
      this.permissionHandler,
      this.moduleLoader,
      this.queryOptionsBuilder,
      this.messageFactory,
      this.authEnv,
    );
    this._control = new SessionControl(
      this.logger,
      this._registry,
      this.permissionHandler,
      this.subagentRegistry,
      this.modelResolver,
      this.sessionEndRegistry,
    );
  }

  /**
   * Register a new session into the registry.
   * Delegates to SessionRegistry.register().
   * Returns the SessionRecord so callers can hold the object reference.
   */
  register(
    tabId: string,
    config: AISessionConfig,
    abortController: AbortController,
  ): SessionRecord {
    return this._registry.register(tabId, config, abortController);
  }

  /**
   * Bind the real SDK session UUID to a registered session record.
   * Delegates to SessionRegistry.bindRealSessionId().
   */
  bindRealSessionId(tabId: string, realSessionId: string): void {
    this._registry.bindRealSessionId(tabId, realSessionId);
  }

  /**
   * Find a session record by either tabId or realSessionId.
   * Delegates to SessionRegistry.find().
   */
  find(idOrTabId: string): SessionRecord | undefined {
    return this._registry.find(idOrTabId);
  }

  /**
   * Get all active session IDs, most recently active first.
   * Returns real SDK UUIDs when resolved, tab IDs otherwise.
   * The ordering ensures that getActiveSessionIds()[0] returns the session
   * the user most recently interacted with, which is critical for MCP tools
   * like ptah_agent_spawn that pick ids[0] as the parentSessionId.
   *
   * Delegates directly to the registry — single storage means the registry
   * owns all ordering and resolution logic.
   */
  getActiveSessionIds(): SessionId[] {
    return this._registry.getActiveSessionIds();
  }

  /**
   * Get the workspace root (projectPath) for the most recently active session.
   * Used by MCP tools to resolve workspace per-session instead of globally.
   * In multi-workspace scenarios (e.g., Electron with multiple folders open),
   * this ensures CLI agents and subagents inherit the correct workspace
   * from the session that spawned them, not whichever workspace is globally active.
   */
  getActiveSessionWorkspace(): string | undefined {
    return this._registry.getActiveSessionWorkspace();
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
    return this._control.interruptCurrentTurn(sessionId);
  }

  /**
   * End session and cleanup.
   * Calls cleanupPendingPermissions to prevent unhandled promise rejections,
   * and marks all running subagents as interrupted before session removal.
   *
   * CRITICAL RISK MITIGATION: SubagentStop hook doesn't fire when a session is aborted.
   * This method is the ONLY reliable way to detect interrupted subagents. All running
   * subagents for this session are marked as 'interrupted' to enable resumption.
   */
  async endSession(sessionId: SessionId): Promise<void> {
    return this._control.endSession(sessionId);
  }

  /**
   * Cleanup all active sessions.
   * Calls cleanupPendingPermissions to prevent unhandled promise rejections,
   * and marks all running subagents as interrupted for each session.
   */
  async disposeAllSessions(): Promise<void> {
    return this._control.disposeAllSessions();
  }

  /**
   * Get session count
   */
  getActiveSessionCount(): number {
    return this._registry.getActiveSessionCount();
  }

  // ============================================================================
  // Query Execution Orchestration
  // ============================================================================

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
    return this._queryExecutor.executeQuery(config);
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
    return this._streamPump.sendMessage(sessionId, content, files, images);
  }

  /**
   * Execute a slash command as a new query within an existing session.
   * Used when follow-up messages contain slash commands (e.g., /compact, /ptah-core:orchestrate).
   * The SDK only parses slash commands from raw string prompts, not from SDKUserMessage objects,
   * so we must start a new query with resume to maintain conversation context.
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

    // Resolve real SDK UUID before endSession removes the registry entry.
    // find() checks both byTabId and bySessionId (dual-index).
    const rec = this._registry.find(sessionId as string);
    const realSessionId = rec?.realSessionId ?? (sessionId as string);

    // Step 1: End the current session (abort existing query)
    await this._control.endSession(sessionId);

    // Step 2: Start a new query with resume using the REAL session ID
    // executeQuery will detect isSlashCommand and pass it as a raw string to query()
    return this._queryExecutor.executeQuery({
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
      // Mirror ExecuteQueryConfig pass-through so slash commands honor the
      // same fork/rewind/checkpoint/partial-message toggles as regular
      // resume flows. Without this, callers that set these on
      // SlashCommandConfig would have them silently dropped.
      forkSession: config.forkSession,
      resumeSessionAt: config.resumeSessionAt,
      enableFileCheckpointing: config.enableFileCheckpointing,
      includePartialMessages: config.includePartialMessages,
    });
  }

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
    return this._control.setSessionPermissionLevel(sessionId, level);
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
    return this._control.setSessionModel(sessionId, model);
  }
}
