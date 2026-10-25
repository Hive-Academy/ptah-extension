/**
 * Agent SDK DI Registration
 *
 * IMPORTANT: All SDK services are registered as singletons to ensure
 * the same instance is used across all consumers. This is critical for
 * SdkAgentAdapter - the initialized state must be shared between main.ts
 * (which calls initialize()) and `registerRpcSurface` (which uses it).
 *
 * Pattern: Services use @injectable() and @inject() decorators for auto-wiring.
 * Registration uses singleton pattern to ensure consistent state across consumers.
 */

import {
  DependencyContainer,
  instanceCachingFactory,
  Lifecycle,
} from 'tsyringe';
import { LANE_ROUTING_TOKENS } from '@ptah-extension/lane-routing';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  BackgroundWorkGovernor,
  Logger,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import { MEMORY_CONTRACT_TOKENS } from '@ptah-extension/memory-contracts';
import type { CodeOutliner } from '@ptah-extension/tool-output-reducers';
import { SdkAgentAdapter } from '../sdk-agent-adapter';
import {
  type RuntimeHostCapabilities,
  type IAgentAdapter,
} from '@ptah-extension/shared';
import {
  RoutingAgentAdapter,
  type RuntimeAdmissionPort,
  type NativeChatAdapter,
} from '../codex-app-server/routing-agent-adapter';
import { createCodexChatMetadataPort } from '../wiring/codex-chat-metadata-port';
import type { InitializedSessionRuntimeIdentityLookup } from '../wiring/session-runtime-identity-cache';
import {
  createLegacySessionControls,
  type LegacySessionControlPorts,
} from '../wiring/legacy-session-controls-composition';
import {
  guardRuntimeComposition,
  registerDefaultRuntimeHostCapabilities,
} from '../wiring/codex-runtime-composition';
import { LegacySessionControls } from '../codex-app-server/legacy-session-controls';
import {
  SessionRuntimeRouter,
  type NativeSessionControls,
} from '../codex-app-server/session-runtime-router';
import {
  CodexChatAdapter,
  type CodexChatAdapterPorts,
} from '../codex-app-server/codex-chat-adapter';
import { SessionApprovalRouter } from '../codex-app-server/session-approval-router';
import { SdkTranscriptReaderAdapter } from '../sdk-transcript-reader.adapter';
import { SessionMetadataStore } from '../session-metadata-store';
import {
  SDK_SESSION_IMPORT_BINDING_LOOKUP,
  SessionImporterService,
} from '../session-importer.service';
import { SDK_NAMED_ACCOUNT_PERSISTENCE } from '../helpers/sdk-query-runner.service';
import { SessionHistoryReaderService } from '../session-history-reader.service';
import { SessionStatsReaderService } from '../session-stats';
import { SessionStatsOwnerService } from '../session-stats/session-stats-owner.service';
import { SdkPermissionHandler } from '../sdk-permission-handler';
import { UnattendedSessionPolicyRegistry } from '../permission/unattended-session-policy.registry';
import { HostAttentionCoordinator } from '../permission/host-attention-coordinator';
import { SdkMessageTransformer } from '../sdk-message-transformer';
import { ClaudeCliDetector } from '../detector/claude-cli-detector';
import {
  SessionLifecycleManager,
  ConfigWatcher,
  StreamTransformer,
  AttachmentProcessorService,
  SubagentHookHandler,
  SubagentMessageDispatcher,
  SdkMessageFactory,
  SdkQueryOptionsBuilder,
  SdkQueryRunner,
  OffThreadProcessSpawner,
  SdkModuleLoader,
  SdkModelService,
  MemoryPromptInjector,
  CodeSymbolPromptInjector,
  SdkInternalQueryCuratorLlm,
  HistoryEventFactory,
  JsonlReaderService,
  AgentCorrelationService,
  SessionReplayService,
  CompactionConfigProvider,
  CompactionHookHandler,
  CompactionCallbackRegistry,
  CompactionBoundaryGenerationRegistry,
  SessionIdResolvedCallbackRegistry,
  SessionMcpStatusCallbackRegistry,
  McpServerBackoffService,
  SessionTurnStateRegistry,
  SessionEndCallbackRegistry,
  SessionActivityRegistry,
  SubagentStopCallbackRegistry,
  PostToolUseCallbackRegistry,
  PostToolUseHookHandler,
  SessionStartCallbackRegistry,
  SessionStartHookHandler,
  UserPromptSubmitCallbackRegistry,
  UserPromptSubmitHookHandler,
  UserPromptExpansionCallbackRegistry,
  UserPromptExpansionHookHandler,
  StopCallbackRegistry,
  StopHookHandler,
  StopFailureHookHandler,
  SubagentStopHookHandler,
  TeammateLifecycleHookHandler,
  SessionEndHookCallbackRegistry,
  SessionEndHookHandler,
  ToolFailureCallbackRegistry,
  ToolFailureHookHandler,
  CuratorRateLimitService,
  LiveUsageTracker,
  WorktreeHookHandler,
  SlashCommandInterceptor,
  SessionForkService,
  SessionTitleService,
  SdkRuntimeStateService,
  SdkAdapterEvents,
} from '../helpers';
import { InternalQueryService } from '../internal-query';
import { StructuredDecisionAdapter } from '../lane-routing/structured-decision.adapter';
import { CommitMessageGenerator } from '../commit-message/commit-message-generator.service';
import { PeerSessionDirectory, PeerSessionMessenger } from '../peer-sessions';
import { PluginLoaderService } from '../helpers/plugin-loader.service';
import { HarnessPolicySync } from '../harness/harness-policy-sync';
import { TurnStateForegroundSource } from '../helpers/turn-state-foreground-source';
import { SessionPlanLimitCallbackRegistry } from '../helpers/plan-limits/session-plan-limit-callback-registry';
import { SessionQuotaProbeService } from '../helpers/plan-limits/session-quota-probe.service';
import { SettingsExportService } from '../settings-export.service';
import { SettingsImportService } from '../settings-import.service';
import { SessionBudgetConfigProvider } from '../helpers/session-budget/session-budget-config.provider';
import {
  SessionBudgetService,
  type SessionBudgetSessionControl,
} from '../helpers/session-budget/session-budget.service';
import { SessionRotationAdvisor } from '../helpers/compaction/session-rotation-advisor';
import { MainThreadNoticeQueue } from '../helpers/main-thread-notice-queue';
import { SubagentNoticeQueue } from '../helpers/subagent-notice-queue';
import { ToolOutputCapper } from '../helpers/compaction/tool-output-capper';
import { CompactionCoordinator } from '../helpers/compaction/compaction-coordinator';
import { IdleCompactionService } from '../helpers/compaction/idle/idle-compaction.service';
import { createUnrefScheduler } from '../helpers/compaction/idle/unref-scheduler';
import { ContextUsagePort } from '../helpers/compaction/context-usage.port';
import { SubagentBudgetMonitor } from '../helpers/compaction/subagent-budget-monitor';
import { SubagentStopNotices } from '../helpers/compaction/subagent-stop-notices';
import { SubagentBudgetStopCallbackRegistry } from '../helpers/subagent-budget-stop-callback-registry';
import { SubagentHandoffFiles } from '../helpers/compaction/subagent-handoff-files';
import { SubagentHandoffRecords } from '../helpers/compaction/subagent-handoff-record';
import { SubagentHandoffIndex } from '../helpers/compaction/subagent-handoff-index';
import {
  MODEL_DISPATCH_PROVENANCE_TAP,
  type ModelDispatchProvenanceTap,
} from '../curator-llm-adapter/model-dispatch-provenance';
import { SDK_TOKENS } from './tokens';

const noOpModelDispatchProvenanceTap: ModelDispatchProvenanceTap = {
  onModelDispatched: () => undefined,
};

function createIdleCompactionService(
  c: DependencyContainer,
  logger: Logger,
): IdleCompactionService {
  const workspace = c.isRegistered(PLATFORM_TOKENS.WORKSPACE_PROVIDER, true)
    ? c.resolve<IWorkspaceProvider>(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    : undefined;
  const events = c.isRegistered(SDK_TOKENS.SDK_ADAPTER_EVENTS, true)
    ? c.resolve<SdkAdapterEvents>(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    : undefined;
  if (!workspace || !events) {
    logger.debug('[IdleCompaction] Optional host signals unavailable', {
      workspace: Boolean(workspace),
      events: Boolean(events),
    });
  }
  return new IdleCompactionService(
    logger,
    c.resolve<CompactionCoordinator>(SDK_TOKENS.SDK_COMPACTION_COORDINATOR),
    c.resolve<CompactionConfigProvider>(
      SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER,
    ),
    c.resolve<SessionTurnStateRegistry>(
      SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY,
    ),
    {
      sendIdleCompact: (sessionId, beforeEnqueue) =>
        c
          .resolve<SessionLifecycleManager>(
            SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER,
          )
          .sendIdleCompact(sessionId, beforeEnqueue),
    },
    c.resolve<CompactionCallbackRegistry>(
      SDK_TOKENS.SDK_COMPACTION_CALLBACK_REGISTRY,
    ),
    events,
    workspace,
    { scheduler: createUnrefScheduler(), now: () => Date.now() },
    c.resolve<SessionStatsOwnerService>(SDK_TOKENS.SDK_SESSION_STATS_OWNER),
  );
}

/**
 * Register all agent-sdk services in DI container
 *
 * Services are registered as singletons using tsyringe's lifecycle management.
 * The @injectable() decorators on each class enable auto-wiring of dependencies.
 *
 * SessionMetadataStore resolves IStateStorage via
 * PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE decorator injection.
 *
 * Prerequisite: `registerAuthProvidersServices(container, logger)` from
 * `@ptah-extension/auth-providers` MUST run BEFORE this function. agent-sdk
 * consumers inject AUTH_PROVIDERS_TOKENS.* (auth manager, env, strategies,
 * provider services, model resolver) at construction time.
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance
 */
export function registerSdkServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[AgentSDK] Registering SDK services...');
  registerCodexChatServices(container);
  // Product hosts do not consume model-dispatch provenance. Benchmark record
  // mode replaces this default with its collector after the container boots.
  container.registerInstance(
    MODEL_DISPATCH_PROVENANCE_TAP,
    noOpModelDispatchProvenanceTap,
  );
  // Named Claude accounts stay release-held (TASK_2026_712 D7/D21): no host
  // has a certified persistence or import-lookup adapter yet, so both resolve
  // to null and every named admission or import refuses. A host replaces these
  // defaults when it registers the certified adapters. A factory is required:
  // tsyringe rejects `{ useValue: null }` (its check is `useValue != undefined`).
  container.register(SDK_NAMED_ACCOUNT_PERSISTENCE, { useFactory: () => null });
  container.register(SDK_SESSION_IMPORT_BINDING_LOOKUP, {
    useFactory: () => null,
  });
  container.register(
    SDK_TOKENS.SDK_SESSION_METADATA_STORE,
    { useClass: SessionMetadataStore },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    SDK_TOKENS.HOST_ATTENTION_COORDINATOR,
    { useClass: HostAttentionCoordinator },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    SDK_TOKENS.SDK_SESSION_IMPORTER,
    { useClass: SessionImporterService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    SDK_TOKENS.SDK_HISTORY_EVENT_FACTORY,
    { useClass: HistoryEventFactory },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_JSONL_READER,
    { useClass: JsonlReaderService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_AGENT_CORRELATION,
    { useClass: AgentCorrelationService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_REPLAY,
    { useClass: SessionReplayService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Before the history reader, the stream transformer, the subagent hook
  // handler and the adapter — all four inject it.
  container.register(
    SDK_TOKENS.SDK_SESSION_STATS_OWNER,
    { useClass: SessionStatsOwnerService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_HISTORY_READER,
    { useClass: SessionHistoryReaderService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_STATS_READER,
    { useClass: SessionStatsReaderService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Before the permission handler: it injects the registry as an OPTIONAL
  // dependency, and tsyringe resolves that once, when the singleton handler is
  // built — a later registration would leave the handler without it.
  container.register(
    SDK_TOKENS.SDK_UNATTENDED_SESSION_POLICY_REGISTRY,
    { useClass: UnattendedSessionPolicyRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_PERMISSION_HANDLER,
    { useClass: SdkPermissionHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_LIVE_USAGE_TRACKER,
    { useClass: LiveUsageTracker },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_MESSAGE_TRANSFORMER,
    { useClass: SdkMessageTransformer },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SUBAGENT_STOP_NOTICES,
    { useClass: SubagentStopNotices },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_CLI_DETECTOR,
    { useClass: ClaudeCliDetector },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_CONFIG_WATCHER,
    { useClass: ConfigWatcher },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY,
    { useClass: SessionEndCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_ACTIVITY_REGISTRY,
    { useClass: SessionActivityRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY,
    { useClass: SubagentStopCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    SDK_TOKENS.SDK_SUBAGENT_BUDGET_STOP_CALLBACK_REGISTRY,
    { useClass: SubagentBudgetStopCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY,
    { useClass: PostToolUseCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  // One shared queue each: producers post host notices and the PostToolUse
  // hook handler drains them. Registered first so the handler never gets an
  // auto-constructed private instance.
  container.registerSingleton(MainThreadNoticeQueue);
  container.registerSingleton(SubagentNoticeQueue);

  container.register(
    SDK_TOKENS.SDK_POST_TOOL_USE_HOOK_HANDLER,
    { useClass: PostToolUseHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_START_CALLBACK_REGISTRY,
    { useClass: SessionStartCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_START_HOOK_HANDLER,
    { useClass: SessionStartHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY,
    { useClass: UserPromptSubmitCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_HOOK_HANDLER,
    { useClass: UserPromptSubmitHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_USER_PROMPT_EXPANSION_REGISTRY,
    { useClass: UserPromptExpansionCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_USER_PROMPT_EXPANSION_HOOK_HANDLER,
    { useClass: UserPromptExpansionHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_STOP_CALLBACK_REGISTRY,
    { useClass: StopCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_STOP_HOOK_HANDLER,
    { useClass: StopHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_STOP_FAILURE_HOOK_HANDLER,
    { useClass: StopFailureHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SUBAGENT_STOP_HOOK_HANDLER,
    { useClass: SubagentStopHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_TEAMMATE_LIFECYCLE_HOOK_HANDLER,
    { useClass: TeammateLifecycleHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_END_HOOK_CALLBACK_REGISTRY,
    { useClass: SessionEndHookCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_END_HOOK_HANDLER,
    { useClass: SessionEndHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_TOOL_FAILURE_CALLBACK_REGISTRY,
    { useClass: ToolFailureCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_TOOL_FAILURE_HOOK_HANDLER,
    { useClass: ToolFailureHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_CURATOR_RATE_LIMIT,
    { useClass: CuratorRateLimitService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_RUNTIME_STATE,
    { useClass: SdkRuntimeStateService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_ADAPTER_EVENTS,
    { useClass: SdkAdapterEvents },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_PROCESS_SPAWNER,
    { useClass: OffThreadProcessSpawner },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_QUERY_RUNNER,
    { useClass: SdkQueryRunner },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER,
    { useClass: SessionLifecycleManager },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_STREAM_TRANSFORMER,
    { useClass: StreamTransformer },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_ATTACHMENT_PROCESSOR,
    { useClass: AttachmentProcessorService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER,
    { useClass: SubagentHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SUBAGENT_MESSAGE_DISPATCHER,
    { useClass: SubagentMessageDispatcher },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER,
    { useClass: CompactionConfigProvider },
    { lifecycle: Lifecycle.Singleton },
  );

  // A factory rather than `useClass`: `SDK_CODE_OUTLINER` is optional and is
  // bound by the hosts, not here. It is looked up when the capper is first
  // resolved; when no host bound it, the capper gets none and Read reduction
  // takes the log reducer plus the file path pointer.
  container.register(SDK_TOKENS.SDK_TOOL_OUTPUT_CAPPER, {
    useFactory: instanceCachingFactory(
      (c) =>
        new ToolOutputCapper(
          c.resolve<Logger>(TOKENS.LOGGER),
          c.resolve<CompactionConfigProvider>(
            SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER,
          ),
          c.isRegistered(SDK_TOKENS.SDK_CODE_OUTLINER, true)
            ? c.resolve<CodeOutliner>(SDK_TOKENS.SDK_CODE_OUTLINER)
            : undefined,
        ),
    ),
  });

  // A factory rather than `useClass`: the coordinator is a plain class (no
  // tsyringe decorator) whose optional `timers` seam is for specs only; the
  // container builds it with the default unref'd Node timers and routes a
  // throwing state subscriber to the SDK logger.
  container.register(SDK_TOKENS.SDK_COMPACTION_COORDINATOR, {
    useFactory: instanceCachingFactory((c) => {
      const logger = c.resolve<Logger>(TOKENS.LOGGER);
      return new CompactionCoordinator(undefined, (error, change) =>
        logger.warn('[CompactionCoordinator] State subscriber failed', {
          sessionId: change.sessionId,
          from: change.from,
          to: change.to,
          trigger: change.trigger,
          errorType: error instanceof Error ? error.name : typeof error,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }),
  });

  let idleCompactionFailed = false;
  container.register(SDK_TOKENS.SDK_IDLE_COMPACTION, {
    useFactory: instanceCachingFactory((c) => {
      if (idleCompactionFailed) return undefined;
      try {
        return createIdleCompactionService(c, logger);
      } catch (cause) {
        idleCompactionFailed = true;
        logger.error(
          '[IdleCompaction] Optional service unavailable',
          cause instanceof Error ? cause : new Error(String(cause)),
        );
        return undefined;
      }
    }),
  });

  container.register(
    SDK_TOKENS.SDK_CONTEXT_USAGE_PORT,
    { useClass: ContextUsagePort },
    { lifecycle: Lifecycle.Singleton },
  );

  // A factory rather than `useClass`: `SessionLifecycleManager` injects the
  // monitor, and the monitor needs the dispatcher, which injects the manager.
  // The dispatcher is resolved on first use, after the manager exists, so
  // constructing the manager does not recurse.
  // The monitor picks the handoff's route. A foreground subagent's `Agent`
  // tool result is still due, so the handoff goes to the main-thread notice
  // queue and its PostToolUse drains it. A background subagent's tool result
  // came back at spawn ("Async agent launched"), and the session budget
  // clears pending notices at turn end, so the handoff is streamed to the
  // parent as a user turn through the dispatcher.
  container.register(SDK_TOKENS.SDK_SUBAGENT_BUDGET_MONITOR, {
    useFactory: instanceCachingFactory((c) => {
      const dispatcher = () =>
        c.resolve<SubagentMessageDispatcher>(
          SDK_TOKENS.SDK_SUBAGENT_MESSAGE_DISPATCHER,
        );
      const notices = c.resolve(MainThreadNoticeQueue);
      const subagentNotices = c.resolve(SubagentNoticeQueue);
      const logger = c.resolve<Logger>(TOKENS.LOGGER);
      // Resolved on first use, like the dispatcher: the lifecycle manager
      // injects this monitor.
      const workspaceOf = (sessionId: string) =>
        c
          .resolve<SessionLifecycleManager>(
            SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER,
          )
          .getSessionWorkspace(sessionId);
      const handoffFiles = new SubagentHandoffFiles(logger, workspaceOf);
      return new SubagentBudgetMonitor(
        logger,
        c.resolve<CompactionConfigProvider>(
          SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER,
        ),
        {
          stopSubagent: (sessionId, taskId) =>
            dispatcher().stopSubagent(sessionId, taskId),
          pushParentMessage: (sessionId, content) =>
            dispatcher().pushParentMessage(sessionId, content),
          postMainThreadNotice: (sessionId, text, onDropped) =>
            notices.post(sessionId, text, onDropped),
          withdrawMainThreadNotice: (sessionId, text) =>
            notices.withdraw(sessionId, text),
          postSubagentNotice: (agentId, text) =>
            subagentNotices.post(agentId, text),
          withdrawSubagentNotice: (agentId) =>
            subagentNotices.withdraw(agentId),
        },
        c.resolve<SubagentRegistryService>(TOKENS.SUBAGENT_REGISTRY_SERVICE),
        handoffFiles,
        // The durable handoff records and the index that names pending ones
        // on main-thread prompts (UserPromptSubmit hook).
        new SubagentHandoffRecords(logger, workspaceOf),
        new SubagentHandoffIndex(logger),
        c.resolve<SubagentBudgetStopCallbackRegistry>(
          SDK_TOKENS.SDK_SUBAGENT_BUDGET_STOP_CALLBACK_REGISTRY,
        ),
        c.resolve<SubagentStopNotices>(SDK_TOKENS.SDK_SUBAGENT_STOP_NOTICES),
      );
    }),
  });

  container.register(
    SDK_TOKENS.SDK_COMPACTION_CALLBACK_REGISTRY,
    { useClass: CompactionCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  // `instanceCachingFactory` rather than `useClass`: the registry's only
  // constructor parameter is a defaulted primitive (`maxEntries = 256`) with
  // no explicit type annotation, so TypeScript emits `Object` for its
  // `design:paramtypes` entry and tsyringe's constructor auto-wiring tries
  // (and fails) to resolve a dependency named "Object" — surfaced as
  // "TypeInfo not known for \"Object\"" through every consumer's DI chain
  // (`SdkMessageTransformer`, `SessionHistoryReaderService`, `PtahCliRegistry`
  // in cli-agent-runtime). A factory sidesteps tsyringe's parameter
  // resolution entirely and just calls the constructor directly, keeping the
  // default-parameter API every existing spec constructs with `new
  // CompactionBoundaryGenerationRegistry()` / `(n)`.
  container.register(SDK_TOKENS.SDK_COMPACTION_BOUNDARY_GENERATION_REGISTRY, {
    useFactory: instanceCachingFactory(
      () => new CompactionBoundaryGenerationRegistry(),
    ),
  });

  container.register(
    SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY,
    { useClass: SessionIdResolvedCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  // Registered BEFORE StreamTransformer / SdkQueryOptionsBuilder resolve, both
  // of which now inject it as a required dependency.
  container.register(
    SDK_TOKENS.SDK_SESSION_MCP_STATUS_CALLBACK_REGISTRY,
    { useClass: SessionMcpStatusCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  // Required by StreamTransformer; the plan-limit ledger subscribes.
  container.register(
    SDK_TOKENS.SDK_SESSION_PLAN_LIMIT_REGISTRY,
    { useClass: SessionPlanLimitCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  // Resolved lazily by its consumers; it subscribes to the plan-limit registry
  // and `turnFailed` when first constructed, before which it holds no cache.
  container.register(
    SDK_TOKENS.SDK_SESSION_QUOTA_PROBE,
    { useClass: SessionQuotaProbeService },
    { lifecycle: Lifecycle.Singleton },
  );

  // `instanceCachingFactory` rather than `useClass`, for the same reason as
  // the compaction registry above: the untokened `options?:
  // McpServerBackoffOptions` parameter (an interface) emits `Object` in
  // `design:paramtypes`, so tsyringe's auto-wiring throws "TypeInfo not known
  // for \"Object\"" through every consumer (`SdkQueryOptionsBuilder`,
  // `CapabilityResolverService` in cli-agent-runtime). The optional callback
  // registries keep their `isOptional` semantics: passed only when registered.
  container.register(SDK_TOKENS.SDK_MCP_SERVER_BACKOFF_SERVICE, {
    useFactory: instanceCachingFactory(
      (c) =>
        new McpServerBackoffService(
          c.resolve<Logger>(TOKENS.LOGGER),
          c.isRegistered(
            SDK_TOKENS.SDK_SESSION_MCP_STATUS_CALLBACK_REGISTRY,
            true,
          )
            ? c.resolve<SessionMcpStatusCallbackRegistry>(
                SDK_TOKENS.SDK_SESSION_MCP_STATUS_CALLBACK_REGISTRY,
              )
            : undefined,
          undefined,
          c.isRegistered(
            SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY,
            true,
          )
            ? c.resolve<SessionIdResolvedCallbackRegistry>(
                SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY,
              )
            : undefined,
        ),
    ),
  });

  container.registerSingleton(
    SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY,
    SessionTurnStateRegistry,
  );
  // Alias: a fresh session streams under its tabId until the SDK reports the
  // real UUID. Same subscriber contract as MemoryTriggerService /
  // SkillTriggerService — synchronous, never overwrites the real-id entry.
  const turnStateRegistry = container.resolve<SessionTurnStateRegistry>(
    SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY,
  );
  // Foreground source for the background-work governor (TASK_2026_437 C14):
  // background lanes yield while any session is generating (a record stuck in
  // `generating` past the stale ceiling stops counting). The governor lives in
  // vscode-core, which this lib already depends on; vscode-core cannot see the
  // registry, so the source implements the structural `ForegroundActivitySource`.
  // Every host registers the governor in `registerVsCodeCorePlatformAgnostic`
  // before this runs; a container without it (a test host) simply has no
  // foreground signal, and `InternalQueryService` reports that degradation.
  if (container.isRegistered(TOKENS.BACKGROUND_WORK_GOVERNOR, true)) {
    container
      .resolve<BackgroundWorkGovernor>(TOKENS.BACKGROUND_WORK_GOVERNOR)
      .addForegroundSource(
        new TurnStateForegroundSource(turnStateRegistry, logger),
      );
  }
  container
    .resolve<SessionIdResolvedCallbackRegistry>(
      SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY,
    )
    .register(({ tabId, realSessionId }) => {
      if (tabId) {
        turnStateRegistry.rekey(tabId, realSessionId);
        // A PreCompact whose payload lacked `session_id` recorded its
        // expectation under the tab id; move it onto the real id so
        // chat:resume verifies it. Resolved LAZILY, at the first binding: an
        // eager resolve here would make registration itself fail on any host
        // where the registry cannot be constructed, instead of only the
        // consumers that need it.
        container
          .resolve<CompactionBoundaryGenerationRegistry>(
            SDK_TOKENS.SDK_COMPACTION_BOUNDARY_GENERATION_REGISTRY,
          )
          .rekey(tabId, realSessionId);
      }
    });

  container.register(
    SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER,
    { useClass: CompactionHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_WORKTREE_HOOK_HANDLER,
    { useClass: WorktreeHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_MODULE_LOADER,
    { useClass: SdkModuleLoader },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_MODEL_SERVICE,
    { useClass: SdkModelService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_MESSAGE_FACTORY,
    { useClass: SdkMessageFactory },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    MEMORY_CONTRACT_TOKENS.TRANSCRIPT_READER,
    { useClass: SdkTranscriptReaderAdapter },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    SDK_TOKENS.SDK_CURATOR_LLM_ADAPTER,
    { useClass: SdkInternalQueryCuratorLlm },
    { lifecycle: Lifecycle.Singleton },
  );

  container.registerSingleton(
    SDK_TOKENS.SDK_MEMORY_PROMPT_INJECTOR,
    MemoryPromptInjector,
  );

  container.registerSingleton(
    SDK_TOKENS.SDK_CODE_SYMBOL_PROMPT_INJECTOR,
    CodeSymbolPromptInjector,
  );

  container.register(
    SDK_TOKENS.SDK_QUERY_OPTIONS_BUILDER,
    { useClass: SdkQueryOptionsBuilder },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE,
    { useClass: InternalQueryService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Structured decision model (lane-routing port). One registration; every
  // host that calls registerSdkServices binds the optional port.
  container.register(
    LANE_ROUTING_TOKENS.STRUCTURED_DECISION,
    { useClass: StructuredDecisionAdapter },
    { lifecycle: Lifecycle.Singleton },
  );

  // Stateless; resolved lazily by the `git:generateCommitMessage` handler, so
  // its `TOKENS.GIT_INFO_SERVICE` dependency is the host's registration.
  container.register(
    SDK_TOKENS.SDK_COMMIT_MESSAGE_GENERATOR,
    { useClass: CommitMessageGenerator },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_PLUGIN_LOADER,
    { useClass: PluginLoaderService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Singleton: it remembers, per workspace root, the last policy fingerprint a
  // harness pass acknowledged (TASK_2026_560, N4).
  container.register(
    SDK_TOKENS.SDK_HARNESS_POLICY_SYNC,
    { useClass: HarnessPolicySync },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SETTINGS_EXPORT,
    { useClass: SettingsExportService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SETTINGS_IMPORT,
    { useClass: SettingsImportService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SLASH_COMMAND_INTERCEPTOR,
    { useClass: SlashCommandInterceptor },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_FORK_SERVICE,
    { useClass: SessionForkService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_TITLE_SERVICE,
    { useClass: SessionTitleService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Session budget (TASK_2026_597 N7), advisory only. The service injects its
  // provider by class token. Before the adapter, which injects the service.
  container.registerSingleton(SessionBudgetConfigProvider);
  container.registerSingleton(SessionRotationAdvisor);
  // The lifecycle manager reads the budget at turn-end and the budget applies
  // compact windows through lifecycle. Resolve the latter only when budget work
  // needs it, matching the lazy factory used for other reciprocal SDK services.
  container.register(SDK_TOKENS.SDK_SESSION_BUDGET, {
    useFactory: instanceCachingFactory((c) => {
      const lifecycle: SessionBudgetSessionControl = {
        applySessionAutoCompactWindow: (...args) =>
          c
            .resolve<SessionLifecycleManager>(
              SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER,
            )
            .applySessionAutoCompactWindow(...args),
      };
      return new SessionBudgetService(
        c.resolve<Logger>(TOKENS.LOGGER),
        c.resolve(SessionBudgetConfigProvider),
        c.resolve(SDK_TOKENS.SDK_SESSION_STATS_OWNER),
        lifecycle,
        c.resolve(SessionRotationAdvisor),
        c.resolve(MainThreadNoticeQueue),
      );
    }),
  });

  container.register(
    SDK_TOKENS.SDK_AGENT_ADAPTER,
    { useClass: SdkAgentAdapter },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_PEER_SESSION_DIRECTORY,
    { useClass: PeerSessionDirectory },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_PEER_SESSION_MESSENGER,
    { useClass: PeerSessionMessenger },
    { lifecycle: Lifecycle.Singleton },
  );

  container.resolve(SDK_TOKENS.SDK_CONFIG_WATCHER);

  logger.info('[AgentSDK] SDK services registered successfully', {
    services: Object.keys(SDK_TOKENS),
  });
}

/** SDK-owned services below are registered once by registerSdkServices.
 * Hosts override only the guarded nullable port tokens before first resolution. */
export function registerCodexChatServices(
  container: DependencyContainer,
): void {
  if (!container.isRegistered(SDK_TOKENS.RUNTIME_HOST_CAPABILITIES, true)) {
    registerDefaultRuntimeHostCapabilities(container);
  }
  if (!container.isRegistered(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS, true)) {
    container.register(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS, {
      useFactory: () => null,
    });
  }
  for (const token of [
    SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
    SDK_TOKENS.LEGACY_SESSION_CONTROL_PORTS,
    SDK_TOKENS.NATIVE_SESSION_CONTROLS,
    SDK_TOKENS.RUNTIME_ADMISSION_PORT,
  ]) {
    if (!container.isRegistered(token, true))
      container.register(token, { useFactory: () => null });
  }
  container.register(SDK_TOKENS.LEGACY_SESSION_CONTROLS, {
    useFactory: instanceCachingFactory((c) => {
      const ports = c.resolve<LegacySessionControlPorts | null>(
        SDK_TOKENS.LEGACY_SESSION_CONTROL_PORTS,
      );
      return ports ? createLegacySessionControls(ports) : null;
    }),
  });
  container.register(SDK_TOKENS.SESSION_RUNTIME_ROUTER, {
    useFactory: instanceCachingFactory((c) => {
      const identities =
        c.resolve<InitializedSessionRuntimeIdentityLookup | null>(
          SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
        );
      const legacy = c.resolve<LegacySessionControls | null>(
        SDK_TOKENS.LEGACY_SESSION_CONTROLS,
      );
      const native = c.resolve<NativeSessionControls | null>(
        SDK_TOKENS.NATIVE_SESSION_CONTROLS,
      );
      return identities && legacy && native
        ? new SessionRuntimeRouter(identities, legacy, native)
        : null;
    }),
  });
  const assertComposition = guardRuntimeComposition(container);
  container.register(SDK_TOKENS.ROUTING_AGENT_ADAPTER, {
    useFactory: instanceCachingFactory((c) => {
      const identities =
        c.resolve<InitializedSessionRuntimeIdentityLookup | null>(
          SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
        );
      const native = c.resolve<NativeChatAdapter | null>(
        SDK_TOKENS.CODEX_CHAT_ADAPTER,
      );
      const admission = c.resolve<RuntimeAdmissionPort | null>(
        SDK_TOKENS.RUNTIME_ADMISSION_PORT,
      );
      return identities && native && admission
        ? new RoutingAgentAdapter(
            identities,
            c.resolve<IAgentAdapter>(SDK_TOKENS.SDK_AGENT_ADAPTER),
            native,
            admission,
            c.resolve<RuntimeHostCapabilities>(
              SDK_TOKENS.RUNTIME_HOST_CAPABILITIES,
            ),
          )
        : null;
    }),
  });
  container.beforeResolution(
    SDK_TOKENS.ROUTING_AGENT_ADAPTER,
    assertComposition,
  );
  container.register(SDK_TOKENS.SESSION_APPROVAL_ROUTER, {
    useFactory: instanceCachingFactory(
      (c) =>
        new SessionApprovalRouter(
          c.resolve<SdkPermissionHandler>(SDK_TOKENS.SDK_PERMISSION_HANDLER),
          (payload) =>
            c
              .resolve<CodexChatAdapterPorts | null>(
                SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
              )
              ?.presentation.cancelPrompt(payload),
        ),
    ),
  });
  container.register(SDK_TOKENS.CODEX_CHAT_ADAPTER, {
    useFactory: instanceCachingFactory((c) => {
      const ports = c.resolve<CodexChatAdapterPorts | null>(
        SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
      );
      if (!ports) return null;
      const identities =
        c.resolve<InitializedSessionRuntimeIdentityLookup | null>(
          SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
        );
      if (!identities) return null;
      return new CodexChatAdapter({
        ...ports,
        logger: c.resolve<Logger>(TOKENS.LOGGER),
        approvals: c.resolve<SessionApprovalRouter>(
          SDK_TOKENS.SESSION_APPROVAL_ROUTER,
        ),
        metadata: createCodexChatMetadataPort(identities),
      });
    }),
  });
}

export function wireAgentAdapterAliases(container: DependencyContainer): void {
  container.register(TOKENS.AGENT_ADAPTER, {
    useFactory: (c) => {
      const routing = c.isRegistered(SDK_TOKENS.ROUTING_AGENT_ADAPTER, true)
        ? c.resolve<RoutingAgentAdapter | null>(
            SDK_TOKENS.ROUTING_AGENT_ADAPTER,
          )
        : null;
      return (
        routing ?? c.resolve<SdkAgentAdapter>(SDK_TOKENS.SDK_AGENT_ADAPTER)
      );
    },
  });
}
