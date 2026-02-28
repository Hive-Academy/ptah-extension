/**
 * Agent SDK DI Registration
 * TASK_2025_044 Batch 3: Register all SDK services in DI container
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
import { SdkAgentAdapter } from '../sdk-agent-adapter';
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
  SdkMessageFactory,
  SdkQueryOptionsBuilder,
  SdkModuleLoader,
  SdkModelService,
  UserMessageStreamFactory,
  // History reader child services (TASK_2025_106)
  HistoryEventFactory,
  JsonlReaderService,
  AgentCorrelationService,
  SessionReplayService,
  // Compaction configuration and hooks (TASK_2025_098)
  CompactionConfigProvider,
  CompactionHookHandler,
} from '../helpers';
import {
  PromptDesignerAgent,
  PromptCacheService,
  EnhancedPromptsService,
} from '../prompt-harness';
import { InternalQueryService } from '../internal-query';
import { PluginLoaderService } from '../helpers/plugin-loader.service';
import { CustomAgentRegistry } from '../custom-agent';
import { SDK_TOKENS } from './tokens';
import { ProviderModelsService } from '../provider-models.service';
import * as vscode from 'vscode';

/**
 * Register all agent-sdk services in DI container
 *
 * Services are registered as singletons using tsyringe's lifecycle management.
 * The @injectable() decorators on each class enable auto-wiring of dependencies.
 *
 * @param container - TSyringe DI container
 * @param context - VS Code extension context (for Memento storage)
 * @param logger - Logger instance
 */
export function registerSdkServices(
  container: DependencyContainer,
  context: vscode.ExtensionContext,
  logger: Logger
): void {
  logger.info('[AgentSDK] Registering SDK services...');

  // ============================================================
  // Core Services (require special initialization)
  // ============================================================

  // Session metadata store needs VS Code Memento for UI metadata persistence
  // SDK handles message persistence natively to ~/.claude/projects/
  container.registerInstance(
    SDK_TOKENS.SDK_SESSION_METADATA_STORE,
    (() => {
      return new SessionMetadataStore(context.workspaceState, logger);
    })()
  );

  // Shared mutable AuthEnv singleton (TASK_2025_164)
  // Must be registered before AuthManager and ProviderModelsService which inject it
  container.registerInstance(SDK_TOKENS.SDK_AUTH_ENV, createEmptyAuthEnv());

  // Session importer - scans existing Claude sessions
  container.register(
    SDK_TOKENS.SDK_SESSION_IMPORTER,
    { useClass: SessionImporterService },
    { lifecycle: Lifecycle.Singleton }
  );

  // ============================================================
  // History reader child services (TASK_2025_106)
  // ============================================================

  // History event factory - creates FlatStreamEventUnion events
  container.register(
    SDK_TOKENS.SDK_HISTORY_EVENT_FACTORY,
    { useClass: HistoryEventFactory },
    { lifecycle: Lifecycle.Singleton }
  );

  // JSONL reader - file I/O operations for session files
  container.register(
    SDK_TOKENS.SDK_JSONL_READER,
    { useClass: JsonlReaderService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Agent correlation - correlates agents to Task tool_uses
  container.register(
    SDK_TOKENS.SDK_AGENT_CORRELATION,
    { useClass: AgentCorrelationService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Session replay - orchestrates JSONL to event conversion
  container.register(
    SDK_TOKENS.SDK_SESSION_REPLAY,
    { useClass: SessionReplayService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Session history reader (facade) - reads JSONL files and converts to stream events
  container.register(
    SDK_TOKENS.SDK_SESSION_HISTORY_READER,
    { useClass: SessionHistoryReaderService },
    { lifecycle: Lifecycle.Singleton }
  );

  // ============================================================
  // Services with @injectable() decorators (auto-wired)
  // ============================================================

  // Permission handler - no special deps
  container.register(
    SDK_TOKENS.SDK_PERMISSION_HANDLER,
    { useClass: SdkPermissionHandler },
    { lifecycle: Lifecycle.Singleton }
  );

  // Message transformer - no special deps
  container.register(
    SDK_TOKENS.SDK_MESSAGE_TRANSFORMER,
    { useClass: SdkMessageTransformer },
    { lifecycle: Lifecycle.Singleton }
  );

  // CLI detector - no DI deps (plain class)
  container.register(
    SDK_TOKENS.SDK_CLI_DETECTOR,
    { useClass: ClaudeCliDetector },
    { lifecycle: Lifecycle.Singleton }
  );

  // Auth manager - depends on Logger, ConfigManager
  container.register(
    SDK_TOKENS.SDK_AUTH_MANAGER,
    { useClass: AuthManager },
    { lifecycle: Lifecycle.Singleton }
  );

  // Config watcher - depends on Logger, ConfigManager
  container.register(
    SDK_TOKENS.SDK_CONFIG_WATCHER,
    { useClass: ConfigWatcher },
    { lifecycle: Lifecycle.Singleton }
  );

  // Session lifecycle manager - depends on Logger only (runtime session tracking)
  container.register(
    SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER,
    { useClass: SessionLifecycleManager },
    { lifecycle: Lifecycle.Singleton }
  );

  // Stream transformer - depends on Logger, SdkMessageTransformer (no storage - SDK persists natively)
  container.register(
    SDK_TOKENS.SDK_STREAM_TRANSFORMER,
    { useClass: StreamTransformer },
    { lifecycle: Lifecycle.Singleton }
  );

  // Attachment processor (images + text) - depends on Logger
  container.register(
    SDK_TOKENS.SDK_ATTACHMENT_PROCESSOR,
    { useClass: AttachmentProcessorService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Provider models service - depends on Logger, ConfigManager (TASK_2025_091 Phase 2, generalized TASK_2025_132)
  container.register(
    SDK_TOKENS.SDK_PROVIDER_MODELS,
    { useClass: ProviderModelsService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Subagent hook handler - depends on Logger, AgentSessionWatcherService (TASK_2025_099)
  // Connects SDK subagent lifecycle hooks to real-time summary streaming
  container.register(
    SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER,
    { useClass: SubagentHookHandler },
    { lifecycle: Lifecycle.Singleton }
  );

  // Compaction config provider - depends on Logger, ConfigManager (TASK_2025_098)
  // Provides SDK compaction settings from VS Code configuration
  container.register(
    SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER,
    { useClass: CompactionConfigProvider },
    { lifecycle: Lifecycle.Singleton }
  );

  // Compaction hook handler - depends on Logger (TASK_2025_098)
  // Handles SDK PreCompact hooks and notifies via callback
  container.register(
    SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER,
    { useClass: CompactionHookHandler },
    { lifecycle: Lifecycle.Singleton }
  );

  // SDK module loader - caches SDK query function (TASK_2025_102)
  container.register(
    SDK_TOKENS.SDK_MODULE_LOADER,
    { useClass: SdkModuleLoader },
    { lifecycle: Lifecycle.Singleton }
  );

  // SDK model service - fetches and caches supported models (TASK_2025_102)
  container.register(
    SDK_TOKENS.SDK_MODEL_SERVICE,
    { useClass: SdkModelService },
    { lifecycle: Lifecycle.Singleton }
  );

  // User message stream factory - creates async iterables for SDK (TASK_2025_102)
  container.register(
    SDK_TOKENS.SDK_USER_MESSAGE_STREAM_FACTORY,
    { useClass: UserMessageStreamFactory },
    { lifecycle: Lifecycle.Singleton }
  );

  // Message factory - creates SDK user messages with attachments (TASK_2025_102)
  container.register(
    SDK_TOKENS.SDK_MESSAGE_FACTORY,
    { useClass: SdkMessageFactory },
    { lifecycle: Lifecycle.Singleton }
  );

  // Query options builder - constructs SDK query config (TASK_2025_102)
  container.register(
    SDK_TOKENS.SDK_QUERY_OPTIONS_BUILDER,
    { useClass: SdkQueryOptionsBuilder },
    { lifecycle: Lifecycle.Singleton }
  );

  // ============================================================
  // Enhanced Prompts Services (TASK_2025_137)
  // ============================================================

  // Prompt Designer Agent - generates project-specific guidance (Batch 2)
  // Note: Requires LlmService to be registered by consuming application
  container.register(
    SDK_TOKENS.SDK_PROMPT_DESIGNER_AGENT,
    { useClass: PromptDesignerAgent },
    { lifecycle: Lifecycle.Singleton }
  );

  // Prompt Cache Service - smart caching with file-based invalidation (Batch 3)
  // Note: Requires ExtensionContext and FileSystemManager to be registered
  container.register(
    SDK_TOKENS.SDK_PROMPT_CACHE_SERVICE,
    { useClass: PromptCacheService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Enhanced Prompts Service - orchestrates the Enhanced Prompts feature (Batch 4)
  // Note: Requires PromptDesignerAgent, PromptCacheService, WorkspaceIntelligence
  container.register(
    SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE,
    { useClass: EnhancedPromptsService },
    { lifecycle: Lifecycle.Singleton }
  );

  // ============================================================
  // Internal Query Service (TASK_2025_145)
  // One-shot SDK queries, separate from interactive chat path
  // ============================================================

  // Depends on: SdkModuleLoader, SdkAgentAdapter (health check), EnhancedPromptsService,
  // SubagentHookHandler, CompactionConfigProvider, CompactionHookHandler
  container.register(
    SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE,
    { useClass: InternalQueryService },
    { lifecycle: Lifecycle.Singleton }
  );

  // ============================================================
  // Plugin Loader Service (TASK_2025_153)
  // Manages plugin discovery and per-workspace configuration
  // ============================================================
  container.register(
    SDK_TOKENS.SDK_PLUGIN_LOADER,
    { useClass: PluginLoaderService },
    { lifecycle: Lifecycle.Singleton }
  );

  // ============================================================
  // Custom Agent Registry (TASK_2025_167)
  // Manages lifecycle of user-configured custom agent adapters
  // ============================================================
  container.register(
    SDK_TOKENS.SDK_CUSTOM_AGENT_REGISTRY,
    { useClass: CustomAgentRegistry },
    { lifecycle: Lifecycle.Singleton }
  );

  // ============================================================
  // Main Adapter (depends on all helper services)
  // ============================================================

  // SDK Agent Adapter - the main entry point
  // CRITICAL: Must be singleton so initialize() state is shared
  container.register(
    SDK_TOKENS.SDK_AGENT_ADAPTER,
    { useClass: SdkAgentAdapter },
    { lifecycle: Lifecycle.Singleton }
  );

  logger.info('[AgentSDK] SDK services registered successfully', {
    services: Object.keys(SDK_TOKENS),
  });
}
