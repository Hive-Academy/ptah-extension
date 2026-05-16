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
import { createEmptyAuthEnv } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  MEMORY_CONTRACT_TOKENS,
  type IMemoryReader,
} from '@ptah-extension/memory-contracts';
import { SdkAgentAdapter } from '../sdk-agent-adapter';
import { CliDetectionService } from '../cli-agents/cli-detection.service';
import { AgentProcessManager } from '../cli-agents/agent-process-manager.service';
import { CliPluginSyncService } from '../cli-agents/cli-skill-sync/cli-plugin-sync.service';
import { SessionMetadataStore } from '../session-metadata-store';
import { SessionImporterService } from '../session-importer.service';
import { SessionHistoryReaderService } from '../session-history-reader.service';
import { SdkPermissionHandler } from '../sdk-permission-handler';
import { SdkMessageTransformer } from '../sdk-message-transformer';
import { ClaudeCliDetector } from '../detector/claude-cli-detector';
import {
  AuthManager,
  SessionLifecycleManager,
  ConfigWatcher,
  StreamTransformer,
  AttachmentProcessorService,
  SubagentHookHandler,
  SubagentMessageDispatcher,
  SdkMessageFactory,
  SdkQueryOptionsBuilder,
  SdkModuleLoader,
  SdkModelService,
  MemoryPromptInjector,
  SdkInternalQueryCuratorLlm,
  // History reader child services
  HistoryEventFactory,
  JsonlReaderService,
  AgentCorrelationService,
  SessionReplayService,
  // Compaction configuration and hooks
  CompactionConfigProvider,
  CompactionHookHandler,
  // Compaction callback registry
  CompactionCallbackRegistry,
  // Session end callback registry
  SessionEndCallbackRegistry,
  // Live usage tracker
  LiveUsageTracker,
  // Worktree hook handler
  WorktreeHookHandler,
  // Slash command interceptor
  SlashCommandInterceptor,
} from '../helpers';
import {
  PromptDesignerAgent,
  PromptCacheService,
  EnhancedPromptsService,
} from '../prompt-harness';
import { InternalQueryService } from '../internal-query';
import { PluginLoaderService } from '../helpers/plugin-loader.service';
import { SkillJunctionService } from '../helpers/skill-junction.service';
import { SettingsExportService } from '../settings-export.service';
import { SettingsImportService } from '../settings-import.service';
import {
  PtahCliRegistry,
  PtahCliConfigPersistence,
  PtahCliSpawnOptions,
} from '../ptah-cli';
import { registerProviders } from '../providers';
import { SDK_TOKENS } from './tokens';
import { ProviderModelsService } from '../provider-models.service';
import { ModelResolver } from '../auth/model-resolver';
import {
  ApiKeyStrategy,
  OAuthProxyStrategy,
  LocalNativeStrategy,
  LocalProxyStrategy,
  CliStrategy,
} from '../auth/strategies';

/**
 * Register all agent-sdk services in DI container
 *
 * Services are registered as singletons using tsyringe's lifecycle management.
 * The @injectable() decorators on each class enable auto-wiring of dependencies.
 *
 * SessionMetadataStore resolves IStateStorage via
 * PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE decorator injection.
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance
 */
export function registerSdkServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[AgentSDK] Registering SDK services...');

  // ============================================================
  // Core Services (require special initialization)
  // ============================================================

  // Session metadata store - uses @inject decorators for IStateStorage and Logger
  // Resolved via decorator injection (PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE).
  container.register(
    SDK_TOKENS.SDK_SESSION_METADATA_STORE,
    { useClass: SessionMetadataStore },
    { lifecycle: Lifecycle.Singleton },
  );

  // Shared mutable AuthEnv singleton.
  // Must be registered before AuthManager and ProviderModelsService which inject it.
  container.registerInstance(SDK_TOKENS.SDK_AUTH_ENV, createEmptyAuthEnv());

  // Session importer - scans existing Claude sessions
  container.register(
    SDK_TOKENS.SDK_SESSION_IMPORTER,
    { useClass: SessionImporterService },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // History reader child services
  // ============================================================

  // History event factory - creates FlatStreamEventUnion events
  container.register(
    SDK_TOKENS.SDK_HISTORY_EVENT_FACTORY,
    { useClass: HistoryEventFactory },
    { lifecycle: Lifecycle.Singleton },
  );

  // JSONL reader - file I/O operations for session files
  container.register(
    SDK_TOKENS.SDK_JSONL_READER,
    { useClass: JsonlReaderService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Agent correlation - correlates agents to Task tool_uses
  container.register(
    SDK_TOKENS.SDK_AGENT_CORRELATION,
    { useClass: AgentCorrelationService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Session replay - orchestrates JSONL to event conversion
  container.register(
    SDK_TOKENS.SDK_SESSION_REPLAY,
    { useClass: SessionReplayService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Session history reader (facade) - reads JSONL files and converts to stream events
  container.register(
    SDK_TOKENS.SDK_SESSION_HISTORY_READER,
    { useClass: SessionHistoryReaderService },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // Services with @injectable() decorators (auto-wired)
  // ============================================================

  // Permission handler - no special deps
  container.register(
    SDK_TOKENS.SDK_PERMISSION_HANDLER,
    { useClass: SdkPermissionHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  // Live usage tracker - no deps; shared writer/reader for cumulative
  // pre-compaction tokens. Registered BEFORE SdkMessageTransformer and
  // CompactionHookHandler so both can resolve it.
  container.register(
    SDK_TOKENS.SDK_LIVE_USAGE_TRACKER,
    { useClass: LiveUsageTracker },
    { lifecycle: Lifecycle.Singleton },
  );

  // Message transformer - no special deps
  container.register(
    SDK_TOKENS.SDK_MESSAGE_TRANSFORMER,
    { useClass: SdkMessageTransformer },
    { lifecycle: Lifecycle.Singleton },
  );

  // CLI detector - no DI deps (plain class)
  container.register(
    SDK_TOKENS.SDK_CLI_DETECTOR,
    { useClass: ClaudeCliDetector },
    { lifecycle: Lifecycle.Singleton },
  );

  // Auth manager - depends on Logger, ConfigManager
  container.register(
    SDK_TOKENS.SDK_AUTH_MANAGER,
    { useClass: AuthManager },
    { lifecycle: Lifecycle.Singleton },
  );

  // Config watcher - depends on Logger, ConfigManager
  container.register(
    SDK_TOKENS.SDK_CONFIG_WATCHER,
    { useClass: ConfigWatcher },
    { lifecycle: Lifecycle.Singleton },
  );

  // Session end callback registry (TASK_2026_THOTH_SKILL_LIFECYCLE)
  // Must be registered BEFORE SessionControl (built inside SessionLifecycleManager facade)
  container.register(
    SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY,
    { useClass: SessionEndCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  // Session lifecycle manager - depends on Logger only (runtime session tracking)
  container.register(
    SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER,
    { useClass: SessionLifecycleManager },
    { lifecycle: Lifecycle.Singleton },
  );

  // Stream transformer - depends on Logger, SdkMessageTransformer (no storage - SDK persists natively)
  container.register(
    SDK_TOKENS.SDK_STREAM_TRANSFORMER,
    { useClass: StreamTransformer },
    { lifecycle: Lifecycle.Singleton },
  );

  // Attachment processor (images + text) - depends on Logger
  container.register(
    SDK_TOKENS.SDK_ATTACHMENT_PROCESSOR,
    { useClass: AttachmentProcessorService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Provider models service - depends on Logger, ConfigManager
  container.register(
    SDK_TOKENS.SDK_PROVIDER_MODELS,
    { useClass: ProviderModelsService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Subagent hook handler - depends on Logger, SubagentRegistryService.
  // Subagent visibility flows via `agentProgressSummaries: true` Option +
  // task_* system messages handled by SdkMessageTransformer.
  container.register(
    SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER,
    { useClass: SubagentHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  // SubagentMessageDispatcher — Phase 2 bidirectional messaging + stop/interrupt.
  // Depends on Logger, SessionLifecycleManager, SubagentRegistryService.
  container.register(
    SDK_TOKENS.SDK_SUBAGENT_MESSAGE_DISPATCHER,
    { useClass: SubagentMessageDispatcher },
    { lifecycle: Lifecycle.Singleton },
  );

  // Compaction config provider - depends on Logger, ConfigManager.
  // Provides SDK compaction settings from VS Code configuration.
  container.register(
    SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER,
    { useClass: CompactionConfigProvider },
    { lifecycle: Lifecycle.Singleton },
  );

  // Compaction callback registry (TASK_2026_HERMES Track 1)
  // Must be registered BEFORE CompactionHookHandler which injects it.
  container.register(
    SDK_TOKENS.SDK_COMPACTION_CALLBACK_REGISTRY,
    { useClass: CompactionCallbackRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  // Compaction hook handler - depends on Logger.
  // Handles SDK PreCompact hooks and notifies via callback.
  container.register(
    SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER,
    { useClass: CompactionHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  // Worktree hook handler - depends on Logger.
  // Handles SDK WorktreeCreate/WorktreeRemove hooks and notifies via callback.
  container.register(
    SDK_TOKENS.SDK_WORKTREE_HOOK_HANDLER,
    { useClass: WorktreeHookHandler },
    { lifecycle: Lifecycle.Singleton },
  );

  // SDK module loader - caches SDK query function
  container.register(
    SDK_TOKENS.SDK_MODULE_LOADER,
    { useClass: SdkModuleLoader },
    { lifecycle: Lifecycle.Singleton },
  );

  // SDK model service - fetches and caches supported models
  container.register(
    SDK_TOKENS.SDK_MODEL_SERVICE,
    { useClass: SdkModelService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Message factory - creates SDK user messages with attachments
  container.register(
    SDK_TOKENS.SDK_MESSAGE_FACTORY,
    { useClass: SdkMessageFactory },
    { lifecycle: Lifecycle.Singleton },
  );

  // Curator LLM adapter — SdkInternalQueryCuratorLlm implements ICuratorLLM.
  // Symbol.for('PtahCuratorLlm') matches MEMORY_CONTRACT_TOKENS.CURATOR_LLM so
  // memory-curator resolves this registration when it injects CURATOR_LLM.
  container.register(
    SDK_TOKENS.SDK_CURATOR_LLM_ADAPTER,
    { useClass: SdkInternalQueryCuratorLlm },
    { lifecycle: Lifecycle.Singleton },
  );

  // Memory prompt injector (TASK_2026_THOTH_MEMORY_READ)
  // Register a no-op fallback for hosts where memory-curator is not registered
  // (e.g. VS Code pre-HERMES_FINISH landing SQLite support). This prevents the
  // @inject(MEMORY_CONTRACT_TOKENS.MEMORY_READER) in MemoryPromptInjector from
  // throwing at construction time when the token is absent.
  if (!container.isRegistered(MEMORY_CONTRACT_TOKENS.MEMORY_READER)) {
    const noopReader: IMemoryReader = {
      search: async () => ({ hits: [], bm25Only: true }),
    };
    container.register(MEMORY_CONTRACT_TOKENS.MEMORY_READER, {
      useValue: noopReader,
    });
  }
  container.registerSingleton(
    SDK_TOKENS.SDK_MEMORY_PROMPT_INJECTOR,
    MemoryPromptInjector,
  );

  // Query options builder - constructs SDK query config
  container.register(
    SDK_TOKENS.SDK_QUERY_OPTIONS_BUILDER,
    { useClass: SdkQueryOptionsBuilder },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // Enhanced Prompts Services
  // ============================================================

  // Prompt Designer Agent - generates project-specific guidance (Batch 2)
  // Note: Requires LlmService to be registered by consuming application
  container.register(
    SDK_TOKENS.SDK_PROMPT_DESIGNER_AGENT,
    { useClass: PromptDesignerAgent },
    { lifecycle: Lifecycle.Singleton },
  );

  // Prompt Cache Service - smart caching with file-based invalidation (Batch 3)
  // Note: Requires ExtensionContext and FileSystemManager to be registered
  container.register(
    SDK_TOKENS.SDK_PROMPT_CACHE_SERVICE,
    { useClass: PromptCacheService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Enhanced Prompts Service - orchestrates the Enhanced Prompts feature (Batch 4)
  // Note: Requires PromptDesignerAgent, PromptCacheService, WorkspaceIntelligence
  container.register(
    SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE,
    { useClass: EnhancedPromptsService },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // Internal Query Service
  // One-shot SDK queries, separate from interactive chat path
  // ============================================================

  // Depends on: SdkModuleLoader, SdkAgentAdapter (health check), EnhancedPromptsService,
  // SubagentHookHandler, CompactionConfigProvider, CompactionHookHandler
  container.register(
    SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE,
    { useClass: InternalQueryService },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // Plugin Loader Service
  // Manages plugin discovery and per-workspace configuration
  // ============================================================
  container.register(
    SDK_TOKENS.SDK_PLUGIN_LOADER,
    { useClass: PluginLoaderService },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // Skill Junction Service
  // Manages workspace .ptah/skills/ junctions to plugin skill directories
  // So third-party providers (Codex, Copilot) can find skills via MCP search.
  // ============================================================
  container.register(
    SDK_TOKENS.SDK_SKILL_JUNCTION,
    { useClass: SkillJunctionService },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // Settings Export/Import Services
  // Platform-agnostic settings portability between VS Code and Electron
  // ============================================================
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

  // ============================================================
  // Ptah CLI Services
  // Config persistence, spawn options, and registry
  // ============================================================
  container.register(
    SDK_TOKENS.SDK_PTAH_CLI_CONFIG_PERSISTENCE,
    { useClass: PtahCliConfigPersistence },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_PTAH_CLI_SPAWN_OPTIONS,
    { useClass: PtahCliSpawnOptions },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_PTAH_CLI_REGISTRY,
    { useClass: PtahCliRegistry },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // Slash Command Interceptor
  // Detects and classifies slash commands in follow-up messages
  // ============================================================
  container.register(
    SDK_TOKENS.SDK_SLASH_COMMAND_INTERCEPTOR,
    { useClass: SlashCommandInterceptor },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // CLI Agent Services
  // CliDetectionService enumerates installed CLI agents (Gemini, Codex,
  // Copilot, Cursor). AgentProcessManager spawns and supervises their
  // processes. CliPluginSyncService mirrors MCP plugins into each CLI's
  // native extension format.
  // Tokens live in @ptah-extension/vscode-core (cross-layer platform
  // tokens) — resolve-call sites at apps are unchanged.
  // ============================================================
  container.registerSingleton(
    TOKENS.CLI_DETECTION_SERVICE,
    CliDetectionService,
  );
  container.registerSingleton(
    TOKENS.AGENT_PROCESS_MANAGER,
    AgentProcessManager,
  );
  container.registerSingleton(
    TOKENS.CLI_PLUGIN_SYNC_SERVICE,
    CliPluginSyncService,
  );

  // Provider services (Copilot, Codex, OpenRouter, Ollama, LM Studio).
  // Must register before AuthManager (auth strategies depend on these tokens).
  registerProviders(container);

  // ============================================================
  // Auth Strategies (TASK_AUTH_REFACTOR Phase 2)
  // 5 strategies extract auth logic from the AuthManager god class
  // Must be registered before AuthManager resolves (which depends on these)
  // ============================================================

  container.register(
    SDK_TOKENS.SDK_API_KEY_STRATEGY,
    { useClass: ApiKeyStrategy },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_OAUTH_PROXY_STRATEGY,
    { useClass: OAuthProxyStrategy },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_LOCAL_NATIVE_STRATEGY,
    { useClass: LocalNativeStrategy },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_LOCAL_PROXY_STRATEGY,
    { useClass: LocalProxyStrategy },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_CLI_STRATEGY,
    { useClass: CliStrategy },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // ModelResolver - Single source of truth for tier→model resolution (TASK_AUTH_REFACTOR)
  // ============================================================
  container.register(
    SDK_TOKENS.SDK_MODEL_RESOLVER,
    { useClass: ModelResolver },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // Main Adapter (depends on all helper services)
  // ============================================================

  // SDK Agent Adapter - the main entry point
  // CRITICAL: Must be singleton so initialize() state is shared
  container.register(
    SDK_TOKENS.SDK_AGENT_ADAPTER,
    { useClass: SdkAgentAdapter },
    { lifecycle: Lifecycle.Singleton },
  );

  logger.info('[AgentSDK] SDK services registered successfully', {
    services: Object.keys(SDK_TOKENS),
  });
}
