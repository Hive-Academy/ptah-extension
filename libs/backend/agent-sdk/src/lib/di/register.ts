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
import { TOKENS } from '@ptah-extension/vscode-core';
import { SdkAgentAdapter } from '../sdk-agent-adapter';
import { SdkSessionStorage } from '../sdk-session-storage';
import { SdkPermissionHandler } from '../sdk-permission-handler';
import { SdkMessageTransformer } from '../sdk-message-transformer';
import { ClaudeCliDetector } from '../detector/claude-cli-detector';
import {
  AuthManager,
  SessionLifecycleManager,
  ConfigWatcher,
  SdkQueryBuilder,
  UserMessageStreamFactory,
  StreamTransformer,
} from '../helpers';
import { SDK_TOKENS } from './tokens';
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

  // Session storage needs VS Code Memento - register with factory
  container.registerInstance(
    SDK_TOKENS.SDK_SESSION_STORAGE,
    (() => {
      // Create singleton instance immediately during registration
      return new SdkSessionStorage(context.workspaceState, logger);
    })()
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

  // Session lifecycle manager - depends on Logger, SdkSessionStorage
  container.register(
    SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER,
    { useClass: SessionLifecycleManager },
    { lifecycle: Lifecycle.Singleton }
  );

  // Query builder - depends on Logger, SdkPermissionHandler
  container.register(
    SDK_TOKENS.SDK_QUERY_BUILDER,
    { useClass: SdkQueryBuilder },
    { lifecycle: Lifecycle.Singleton }
  );

  // User message stream factory - depends on Logger, SessionLifecycleManager
  container.register(
    SDK_TOKENS.SDK_USER_MESSAGE_STREAM_FACTORY,
    { useClass: UserMessageStreamFactory },
    { lifecycle: Lifecycle.Singleton }
  );

  // Stream transformer - depends on Logger, SdkMessageTransformer, SdkSessionStorage, SessionLifecycleManager
  container.register(
    SDK_TOKENS.SDK_STREAM_TRANSFORMER,
    { useClass: StreamTransformer },
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
