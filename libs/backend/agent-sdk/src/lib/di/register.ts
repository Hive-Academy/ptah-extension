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
} from '../helpers';
import { SDK_TOKENS } from './tokens';
import { OpenRouterModelsService } from '../openrouter-models.service';
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

  // Session importer - scans existing Claude Code sessions
  container.register(
    SDK_TOKENS.SDK_SESSION_IMPORTER,
    { useClass: SessionImporterService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Session history reader - reads JSONL files and converts to stream events
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

  // OpenRouter models service - depends on Logger, ConfigManager (TASK_2025_091 Phase 2)
  container.register(
    SDK_TOKENS.SDK_OPENROUTER_MODELS,
    { useClass: OpenRouterModelsService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Subagent hook handler - depends on Logger, AgentSessionWatcherService (TASK_2025_099)
  // Connects SDK subagent lifecycle hooks to real-time summary streaming
  container.register(
    SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER,
    { useClass: SubagentHookHandler },
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
