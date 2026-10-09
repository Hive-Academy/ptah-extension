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
import type { ConfigManager } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import {
  SessionId,
  AISessionConfig,
  ISdkPermissionHandler,
  InlineImageAttachment,
  type AIMessageOptions,
  type AuthEnv,
  type ContextCapacityRoute,
  type EffortLevel,
  type FlagEffortLevel,
  type ICapabilityResolver,
  type McpHttpServerOverride,
  type PermissionLevel,
  type SessionBudgetWindow,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import {
  SDKUserMessage,
  SDKMessage,
  ContentBlock,
  type SDKMessageOrigin,
} from '../types/sdk-types/claude-sdk.types';
import type { SdkModuleLoader } from './sdk-module-loader';
import type { SdkQueryOptionsBuilder } from './sdk-query-options-builder';
import type { SdkMessageFactory } from './sdk-message-factory';
import type { CompactionStartCallback } from './compaction-hook-handler';
import type {
  WorktreeCreatedCallback,
  WorktreeRemovedCallback,
} from './worktree-hook-handler';
import type { IModelResolver } from '../auth-env.port';
import {
  SessionRegistry,
  type SessionRecord,
  type BindRealSessionIdOutcome,
  type SessionEvictionListener,
} from './session-lifecycle/session-registry.service';
import { SessionStreamPump } from './session-lifecycle/session-stream-pump.service';
import {
  SessionQueryExecutor,
  type CompactionCoordinatorSink,
  type SubagentBudgetSink,
} from './session-lifecycle/session-query-executor.service';
import type { IContextUsagePort } from './compaction/context-usage.port';
import { SessionControl } from './session-lifecycle/session-control.service';
import {
  isInProgress,
  SessionHandoverCoordinator,
  type QueuedSessionInput,
} from './session-handoff/session-handover-coordinator.service';
import { SessionBudgetService } from './session-budget/session-budget.service';
import type { SessionEndCallbackRegistry } from './session-end-callback-registry';
import type { SdkQueryRunner } from './sdk-query-runner.service';
import type { NoActivityWatchdog } from './no-activity-watchdog';
import type { UsageCostSource } from '../session-stats/session-stats-owner.service';
import type { HarnessPolicySync } from '../harness/harness-policy-sync';
import type { CompactionConfigProvider } from './compaction-config-provider';
export type { SDKUserMessage, ContentBlock };
export type {
  SessionRecord,
  BindRealSessionIdOutcome,
} from './session-lifecycle/session-registry.service';

/**
 * The part of the SDK's `SDKControlGetContextUsageResponse` Ptah reads.
 * `autoCompactThreshold` is optional in the SDK type as well. `totalTokens`
 * and `maxTokens` feed the per-turn `ContextUsagePort`.
 */
export interface ContextUsageReadBack {
  readonly totalTokens: number;
  readonly maxTokens: number;
  readonly autoCompactThreshold?: number;
  readonly isAutoCompactEnabled: boolean;
}

/**
 * Query interface - matches SDK's Query runtime structure
 * Properly typed with SDKMessage instead of any
 */
export interface Query {
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage, void>;
  next(): Promise<IteratorResult<SDKMessage, void>>;
  return?(value?: void): Promise<IteratorResult<SDKMessage, void>>;
  throw?(e?: unknown): Promise<IteratorResult<SDKMessage, void>>;
  // SDK 0.3.278 changed this from `Promise<void>` to
  // `Promise<SDKControlInterruptResponse | undefined>`. This interface is a
  // structural mirror kept deliberately free of SDK imports, so it widens to
  // `unknown` rather than naming the SDK type. Callers here ignore the value.
  interrupt(): Promise<unknown>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
  /**
   * Session-scoped flag-layer change. `null` clears a key. `autoCompactWindow`
   * carries a live `compaction.threshold` change (see
   * `SessionControl.applyAutoCompactConfig`).
   */
  applyFlagSettings(settings: {
    effortLevel?: FlagEffortLevel;
    autoCompactWindow?: number | null;
  }): Promise<void>;
  /**
   * Current context usage, as the runtime computes it. Mirrors the SDK's
   * `Query.getContextUsage` (`sdk.d.ts:2852`) narrowed to the fields Ptah
   * reads from `SDKControlGetContextUsageResponse` (`sdk.d.ts:3739-3808`).
   * `autoCompactThreshold` is the read-back that proves a per-session window
   * change took effect (see `SessionControl.applySessionAutoCompactWindow`).
   *
   * OPTIONAL so query fakes without it keep compiling; a caller treats a
   * query without it as unable to verify.
   */
  getContextUsage?(opts?: {
    detail?: 'summary' | 'full';
  }): Promise<ContextUsageReadBack>;
  /** Stream input messages to the query */
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  /**
   * Stop a specific running subagent by its SDK task_id.
   * The subagent's output is written to its output_file and a
   * task_notification with status='stopped' is emitted.
   */
  stopTask(taskId: string): Promise<void>;
  /**
   * Move in-flight foreground task(s) to the background (Ctrl+B parity).
   * With no argument, all foreground tasks are backgrounded. With a
   * `toolUseId`, only that task is targeted — resolving to `false` when the
   * id matched no foreground task.
   */
  backgroundTasks(toolUseId?: string): Promise<boolean>;
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
   * Whether the MCP server is currently running.
   * When false, MCP config will not be included.
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
   * Initial per-session permission level. When provided, seeds this session's
   * `rec.permissionLevel` instead of the global `permissionHandler` default so
   * the first tool call already runs at the caller-supplied level. A FRONTEND
   * level (e.g. `'yolo'`) — mapped to the SDK mode via `PERMISSION_MODE_MAP`,
   * never passed to the SDK as `'bypassPermissions'`.
   */
  permissionLevel?: PermissionLevel;
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
   * top-K hits are prepended to the system prompt. Only used when non-empty.
   */
  initialUserQuery?: string;
  /**
   * Per-call AuthEnv override (from a ProviderProfile). Forwarded verbatim to
   * the options builder so third-party-provider sessions use the profile's
   * auth env instead of the DI-singleton AuthEnv.
   */
  authEnvOverride?: AuthEnv;
}

/**
 * Configuration for slash command execution.
 * Shared between SessionLifecycleManager and SdkAgentAdapter.
 */
export interface SlashCommandConfig {
  sessionConfig?: AISessionConfig;
  mcpServerRunning?: boolean;
  enhancedPromptsContent?: string;
  onCompactionStart?: CompactionStartCallback;
  onWorktreeCreated?: WorktreeCreatedCallback;
  onWorktreeRemoved?: WorktreeRemovedCallback;
  /** Explicit path to cli.js */
  pathToClaudeCodeExecutable?: string;
  /**
   * Runs after the previous query has ended and BEFORE the re-query starts —
   * the one moment the transcript holds what the previous process saved and
   * the new process has not yet restored it. Session accounting reads the
   * restore candidate here (TASK_2026_533). A rejection aborts the re-query.
   */
  beforeRelaunch?: () => Promise<void>;
  /**
   * Mirrors `ExecuteQueryConfig.forkSession`. Only meaningful in combination
   * with `resumeSessionId` (always set internally for slash commands since
   * they resume the existing session). Forwarded to the options builder.
   */
  forkSession?: boolean;
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
  /**
   * No-stream-activity watchdog for this turn. The StreamTransformer must
   * `start()` it before consuming the stream, `kick()` it on every SDK message
   * (any event resets the inactivity window), and `stop()` it in a `finally`
   * so it can neither leak nor fire after the turn ends. On timeout it resolves
   * pending permissions and aborts `abortController` with a descriptive error.
   */
  activityWatchdog: NoActivityWatchdog;
  /**
   * The run's compaction tap, message half. Pass it to
   * `StreamTransformer.transform` as `onMessage`: every stream message must
   * reach it (the coordinator, context-usage port and subagent budget monitor
   * are fed from it). Never throws.
   */
  onMessage: (message: SDKMessage) => void;
  /**
   * The run's compaction tap, teardown half. Pass it to
   * `StreamTransformer.transform` as `onStreamEnd`: it releases what the run
   * tracked on any teardown (TASK_2026_614 D.11). Never throws.
   */
  onStreamEnd: () => void;
  /**
   * `token` of the registry record this query owns.
   *
   * Hand it back to `bindRealSessionId` so the registry can tell the record's
   * OWN process ("this session forked, follow the new id") from a displaced
   * process still emitting against the same tab ("refuse it"). Without the
   * token those two cases are the same observation.
   *
   * It is also the identity of this query RUN for session accounting: the
   * stats owner keeps the latest cumulative result per token (TASK_2026_533).
   * A backend-only capability — never sent to the renderer or a log.
   */
  sessionToken: string;
  /** Cost authority frozen on the record at query creation (TASK_2026_533). */
  usageCostSource: UsageCostSource;
  /** Effective auth env frozen with it; pricing alias resolution uses it. */
  accountingAuthEnv: Readonly<AuthEnv>;
  capacityRoute?: ContextCapacityRoute;
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
  private readonly _registry: SessionRegistry;
  private readonly _streamPump: SessionStreamPump;
  private readonly _queryExecutor: SessionQueryExecutor;
  private readonly _control: SessionControl;
  /** The `compaction.threshold` subscription; released in `dispose()`. */
  private compactionThresholdWatch: { dispose(): void } | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    private permissionHandler: ISdkPermissionHandler,
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    private moduleLoader: SdkModuleLoader,
    @inject(SDK_TOKENS.SDK_QUERY_OPTIONS_BUILDER)
    private queryOptionsBuilder: SdkQueryOptionsBuilder,
    @inject(SDK_TOKENS.SDK_MESSAGE_FACTORY)
    private messageFactory: SdkMessageFactory,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private subagentRegistry: SubagentRegistryService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: IModelResolver,
    @inject(SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY)
    private readonly sessionEndRegistry: SessionEndCallbackRegistry,
    @inject(SDK_TOKENS.SDK_QUERY_RUNNER)
    private readonly queryRunner: SdkQueryRunner,
    /**
     * The capability policy every session is built under (TASK_2026_560, C5),
     * registered by `cli-agent-runtime`. Optional so a container without it —
     * every unit test, and any embedder that only wants the SDK adapter — still
     * constructs; its sessions then run fail-closed.
     */
    @inject(SDK_TOKENS.SDK_CAPABILITY_RESOLVER, { isOptional: true })
    private readonly capabilityResolver: ICapabilityResolver | null = null,
    /**
     * Runs the harness preflight (`HARNESS_PREFLIGHT_TOKEN`, bound by each host
     * to `HARNESS_SYNC_TOKENS.PREFLIGHT`) until a pass acknowledges the
     * session's policy fingerprint. Registered by `registerSdkServices`.
     */
    @inject(SDK_TOKENS.SDK_HARNESS_POLICY_SYNC, { isOptional: true })
    private readonly harnessPolicySync: HarnessPolicySync | null = null,
    /**
     * Source of the live `compaction.threshold` change. Both are optional so a
     * container without them (unit tests, SDK-only embedders) still
     * constructs; a threshold change then applies from the next session start.
     */
    @inject(TOKENS.CONFIG_MANAGER, { isOptional: true })
    private readonly configManager: ConfigManager | null = null,
    @inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER, { isOptional: true })
    private readonly compactionConfigProvider: CompactionConfigProvider | null = null,
    /** A8 coordinator and per-turn context reader, handed to the executor. */
    @inject(SDK_TOKENS.SDK_COMPACTION_COORDINATOR, { isOptional: true })
    private readonly compactionCoordinator: CompactionCoordinatorSink | null = null,
    @inject(SDK_TOKENS.SDK_CONTEXT_USAGE_PORT, { isOptional: true })
    private readonly contextUsagePort: IContextUsagePort | null = null,
    @inject(SDK_TOKENS.SDK_SUBAGENT_BUDGET_MONITOR, { isOptional: true })
    private readonly subagentBudgetMonitor: SubagentBudgetSink | null = null,
    @inject(SessionHandoverCoordinator, { isOptional: true })
    private readonly handoverCoordinator: SessionHandoverCoordinator | null = null,
    @inject(SDK_TOKENS.SDK_SESSION_BUDGET, { isOptional: true })
    private readonly sessionBudget: SessionBudgetService | null = null,
  ) {
    this._registry = new SessionRegistry(this.logger);
    this._streamPump = new SessionStreamPump(
      this.logger,
      this._registry,
      this.messageFactory,
      this.handoverCoordinator,
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
      this.queryRunner,
      this.capabilityResolver,
      this.harnessPolicySync,
      this.compactionCoordinator,
      this.contextUsagePort,
      this.subagentBudgetMonitor,
    );
    const compactionProvider = this.compactionConfigProvider;
    this._control = new SessionControl(
      this.logger,
      this._registry,
      this.permissionHandler,
      this.subagentRegistry,
      this.modelResolver,
      this.sessionEndRegistry,
      compactionProvider ? () => compactionProvider.getConfig() : null,
      (sessionId) => this.onTurnTerminal(sessionId),
      (sessionId) =>
        !this.handoverCoordinator?.admitInterrupt(
          this.handoverKey(sessionId),
        ).held,
    );
    this.handoverCoordinator?.attachRuntime({
      sourceSnapshot: (sourceSessionId) => {
        const rec = this._registry.find(sourceSessionId);
        const workspacePath = rec?.config.projectPath;
        if (!rec || !workspacePath) return undefined;
        return {
          sessionId: rec.realSessionId ?? sourceSessionId,
          tabId: rec.tabId,
          token: rec.token,
          workspacePath,
          successorConfig: {
            model: rec.currentModel,
            effort: rec.config.effort,
            permissionLevel: rec.permissionLevel,
            workspacePath: rec.config.workspaceId ?? workspacePath,
          },
          resourceLease: {
            worktreePath: workspacePath,
            inheritedParentIds: [],
          },
        };
      },
      queueOwnedHandoff: (sourceSessionId, prompt) =>
        this._streamPump.enqueueOwnedHandoff(sourceSessionId as SessionId, prompt),
      restoreInputs: (sourceSessionId, inputs) => {
        return this._registry.restoreQueuedInputs(sourceSessionId, inputs);
      },
      closeIfTokenMatches: (sourceSessionId, token) =>
        this.endSessionIfTokenMatches(sourceSessionId as SessionId, token),
      isOwnedHandoffPendingOrRunning: (sourceSessionId, token) => {
        const rec = this._registry.find(sourceSessionId);
        return !!rec && rec.token === token && (
          rec.turnInFlight ||
          rec.messageQueue.some(
            (input) => input.admission === 'owned-handoff',
          )
        );
      },
    });
    this._registry.startEvictionSweep();
    this.watchCompactionThreshold();
  }

  /** Arm a handover before waking a held source queue. */
  onTurnTerminal(
    sessionId: SessionId,
    atBlockingLimit: boolean = this.isAtBlockingLimit(sessionId),
  ): void {
    const rec = this._registry.find(sessionId as string);
    if (rec && this.handoverCoordinator) {
      const canonicalId = this.handoverKey(sessionId);
      this.handoverCoordinator.armAtTerminal(
        canonicalId,
        atBlockingLimit,
        rec.messageQueue,
        this.sessionBudget?.stageFor(canonicalId) === 'handoff',
      );
    }
    this._registry.markTurnEnded(sessionId as string);
  }

  /** Read the current refusal before an interrupt releases the source turn. */
  private isAtBlockingLimit(sessionId: SessionId): boolean {
    const check = this.sessionBudget?.canSend(sessionId as string);
    return check?.ok === false;
  }

  /**
   * Use the SDK session id once it is known. An operation started before the
   * SDK init message remains under its tab id, so continue addressing that
   * existing operation instead of creating a second handover.
   */
  private handoverKey(sessionId: SessionId): string {
    const rec = this._registry.find(sessionId as string);
    if (!rec) return sessionId as string;

    const canonicalId = rec.realSessionId ?? rec.tabId;
    if (
      canonicalId !== rec.tabId &&
      isInProgress(this.handoverCoordinator?.snapshotFor(rec.tabId)) &&
      !this.handoverCoordinator?.snapshotFor(canonicalId)
    ) {
      return rec.tabId;
    }
    return canonicalId;
  }

  /**
   * Subscribe to the idle sweep's evictions: each evicted record's keys (tab
   * id, real SDK id once bound). Returns the disposer.
   */
  onSessionEvicted(listener: SessionEvictionListener): () => void {
    return this._registry.onEvicted(listener);
  }

  dispose(): void {
    this._registry.stopEvictionSweep();
    this.compactionThresholdWatch?.dispose();
    this.compactionThresholdWatch = null;
  }

  /**
   * Re-apply the auto-compact window to live sessions when
   * `compaction.threshold` changes. `ConfigManager.watch` also calls back once
   * with the current value on registration; with no live session that call
   * does nothing.
   */
  private watchCompactionThreshold(): void {
    const config = this.configManager;
    const provider = this.compactionConfigProvider;
    if (!config || !provider) return;
    this.compactionThresholdWatch = config.watch('compaction.threshold', () => {
      if (this._registry.getActiveSessionCount() === 0) return;
      // Off the caller's stack: a failure here must not reject the settings
      // write that triggered the watch.
      void Promise.resolve()
        .then(() => this._control.applyAutoCompactConfig(provider.getConfig()))
        .catch((error: unknown) => {
          this.logger.warn(
            '[SessionLifecycle] Live auto-compact window change failed',
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    });
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
   *
   * The outcome is RETURNED, not swallowed: a caller that announces the
   * resolution downstream must not announce an id the registry refused.
   */
  bindRealSessionId(
    tabId: string,
    realSessionId: string,
    ownerToken?: string,
  ): BindRealSessionIdOutcome {
    return this._registry.bindRealSessionId(tabId, realSessionId, ownerToken);
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
   * Get the workspace root (projectPath) for a specific session, by tabId or
   * realSessionId. Returns undefined when the session is unknown or carries no
   * projectPath. Lets MCP tools resolve a call against the exact session that
   * issued it (concurrency-safe), not the most-recently-active one.
   */
  getSessionWorkspace(idOrTabId: string): string | undefined {
    return this._registry.getSessionWorkspace(idOrTabId);
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
   * Release the turn claimed by the streaming pump, and wake it so a message
   * held while the turn was generating is sent now (TASK_2026_294).
   *
   * Called by `SdkAgentAdapter` on every `result` message.
   */
  markTurnEnded(sessionId: SessionId): boolean {
    return this._registry.markTurnEnded(sessionId as string);
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
    const token = this.getSessionToken(sessionId);
    if (token) {
      this.handoverCoordinator?.sourceEnded(
        this.handoverKey(sessionId),
        token,
        'session ended',
      );
    }
    await this._control.endSession(sessionId);
  }

  /**
   * Token of the record currently registered under this id, or null.
   * Delegates to SessionRegistry.getToken().
   */
  getSessionToken(sessionId: SessionId): string | null {
    return this._registry.getToken(sessionId as string);
  }

  /**
   * End the session only if `token` still identifies the registered record.
   * Delegates to SessionControl.endSessionIfTokenMatches().
   */
  async endSessionIfTokenMatches(
    sessionId: SessionId,
    token: string,
  ): Promise<boolean> {
    if (this.getSessionToken(sessionId) === token) {
      this.handoverCoordinator?.sourceEnded(
        this.handoverKey(sessionId),
        token,
        'session ended',
      );
    }
    return this._control.endSessionIfTokenMatches(sessionId, token);
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
   * @param options - Provenance of the turn (absent means an interactive human
   *   turn) and its admission rule (absent means a mid-turn message is held).
   *   Forwarded verbatim; see `SessionStreamPump.sendMessage`.
   */
  async sendMessage(
    sessionId: SessionId,
    content: string,
    files?: string[],
    images?: InlineImageAttachment[],
    options?: {
      origin?: SDKMessageOrigin;
      admission?: AIMessageOptions['admission'];
    },
  ): Promise<void> {
    return this._streamPump.sendMessage(
      sessionId,
      content,
      files,
      images,
      options,
    );
  }

  /** Transfer a coordinator-held FIFO to a successor in one queue operation. */
  async enqueueTransferInputs(
    sessionId: SessionId,
    inputs: readonly QueuedSessionInput[],
  ): Promise<void> {
    return this._streamPump.enqueueTransferInputs(sessionId, inputs);
  }

  /**
   * Execute a slash command as a new query within an existing session.
   * Used when follow-up messages contain slash commands (e.g., /compact, /orchestrate).
   * The command is delivered through the resumed session's persistent input
   * stream as an ordinary SDKUserMessage, so the input stays open after the
   * command's `result` and a background subagent keeps its tools
   * (TASK_2026_472). A new query with resume is still started so the command
   * reaches a fresh SDK query with the conversation context restored.
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
    const rec = this._registry.find(sessionId as string);
    const realSessionId = rec?.realSessionId ?? (sessionId as string);
    await this._control.endSession(sessionId);
    await config.beforeRelaunch?.();
    return this._queryExecutor.executeQuery({
      sessionId,
      sessionConfig: config.sessionConfig,
      resumeSessionId: realSessionId,
      initialPrompt: { content: command, files: [], images: [] },
      onCompactionStart: config.onCompactionStart,
      onWorktreeCreated: config.onWorktreeCreated,
      onWorktreeRemoved: config.onWorktreeRemoved,
      mcpServerRunning: config.mcpServerRunning,
      enhancedPromptsContent: config.enhancedPromptsContent,
      pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
      forkSession: config.forkSession,
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

  async setSessionEffort(
    sessionId: SessionId,
    effort: EffortLevel | undefined,
  ): Promise<void> {
    return this._control.setSessionEffort(sessionId, effort);
  }

  /**
   * Lower one session's auto-compact window (`window`), or restore it
   * (`null`), and report whether the runtime honoured it. See
   * `SessionControl.applySessionAutoCompactWindow`.
   */
  async applySessionAutoCompactWindow(
    sessionId: SessionId,
    window: number | null,
  ): Promise<SessionBudgetWindow | undefined> {
    return this._control.applySessionAutoCompactWindow(sessionId, window);
  }
}
