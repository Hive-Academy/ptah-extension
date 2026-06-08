/**
 * Agent SDK DI Registration
 *
 * IMPORTANT: All SDK services are registered as singletons to ensure
 * the same instance is used across all consumers. This is critical for
 * SdkAgentAdapter - the initialized state must be shared between main.ts
 * (which calls initialize()) and RpcMethodRegistrationService (which uses it).
 *
 * Pattern: Services use @injectable() and @inject() decorators for auto-wiring.
 * Registration uses singleton pattern to ensure consistent state across consumers.
 */

import { DependencyContainer, Lifecycle } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { MEMORY_CONTRACT_TOKENS } from '@ptah-extension/memory-contracts';
import { SdkAgentAdapter } from '../sdk-agent-adapter';
import { SdkTranscriptReaderAdapter } from '../sdk-transcript-reader.adapter';
import { SessionMetadataStore } from '../session-metadata-store';
import { SessionImporterService } from '../session-importer.service';
import { SessionHistoryReaderService } from '../session-history-reader.service';
import { SdkPermissionHandler } from '../sdk-permission-handler';
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
  SessionEndCallbackRegistry,
  SessionActivityRegistry,
  SubagentStopCallbackRegistry,
  PostToolUseCallbackRegistry,
  PostToolUseHookHandler,
  PreToolUseCallbackRegistry,
  PreToolUseHookHandler,
  SessionStartCallbackRegistry,
  SessionStartHookHandler,
  UserPromptSubmitCallbackRegistry,
  UserPromptSubmitHookHandler,
  StopCallbackRegistry,
  StopHookHandler,
  StopFailureHookHandler,
  SubagentStopHookHandler,
  SessionEndHookCallbackRegistry,
  SessionEndHookHandler,
  ToolFailureCallbackRegistry,
  ToolFailureHookHandler,
  CuratorRateLimitService,
  LiveUsageTracker,
  WorktreeHookHandler,
  SlashCommandInterceptor,
  SdkWarmQueryManager,
  SessionForkService,
  SdkRuntimeStateService,
  SdkAdapterEvents,
} from '../helpers';
import { InternalQueryService } from '../internal-query';
import { PluginLoaderService } from '../helpers/plugin-loader.service';
import { SkillJunctionService } from '../helpers/skill-junction.service';
import { SettingsExportService } from '../settings-export.service';
import { SettingsImportService } from '../settings-import.service';
import { SDK_TOKENS } from './tokens';

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
  container.register(
    SDK_TOKENS.SDK_SESSION_METADATA_STORE,
    { useClass: SessionMetadataStore },
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

  container.register(
    SDK_TOKENS.SDK_SESSION_HISTORY_READER,
    { useClass: SessionHistoryReaderService },
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
    SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY,
    { useClass: PostToolUseCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_POST_TOOL_USE_HOOK_HANDLER,
    { useClass: PostToolUseHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_PRE_TOOL_USE_CALLBACK_REGISTRY,
    { useClass: PreToolUseCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_PRE_TOOL_USE_HOOK_HANDLER,
    { useClass: PreToolUseHookHandler },
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

  container.register(
    SDK_TOKENS.SDK_COMPACTION_CALLBACK_REGISTRY,
    { useClass: CompactionCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

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

  container.register(
    SDK_TOKENS.SDK_PLUGIN_LOADER,
    { useClass: PluginLoaderService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SKILL_JUNCTION,
    { useClass: SkillJunctionService },
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
    SDK_TOKENS.SDK_WARM_QUERY_MANAGER,
    { useClass: SdkWarmQueryManager },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_SESSION_FORK_SERVICE,
    { useClass: SessionForkService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_AGENT_ADAPTER,
    { useClass: SdkAgentAdapter },
    { lifecycle: Lifecycle.Singleton },
  );

  container.resolve(SDK_TOKENS.SDK_CONFIG_WATCHER);

  logger.info('[AgentSDK] SDK services registered successfully', {
    services: Object.keys(SDK_TOKENS),
  });
}

export function wireAgentAdapterAliases(container: DependencyContainer): void {
  container.register(TOKENS.AGENT_ADAPTER, {
    useFactory: (c) => c.resolve<SdkAgentAdapter>(SDK_TOKENS.SDK_AGENT_ADAPTER),
  });
}
