/**
 * VS Code Core DI Registration
 * TASK_2025_071: Centralized registration for vscode-core infrastructure services
 *
 * IMPORTANT: Logger AND OutputManager must be registered BEFORE calling this function.
 * - OutputManager is required by Logger (dependency injection)
 * - Logger is passed as parameter for logging registration events
 *
 * Registration order in container.ts:
 * 1. EXTENSION_CONTEXT (required by OutputManager)
 * 2. OUTPUT_MANAGER (required by Logger)
 * 3. LOGGER (can now be resolved safely)
 * 4. This function (registers remaining services)
 *
 * TASK_2025_291 Wave C1: Platform-agnostic services are registered via
 * `registerVsCodeCorePlatformAgnostic` (separate file with zero vscode imports).
 * This file retains the VS Code-specific registrations.
 */

import { DependencyContainer } from 'tsyringe';
import * as vscode from 'vscode';
import type { Logger } from '../logging/logger';
import { TOKENS } from './tokens';

// Import services (use relative paths to avoid circular dependencies)
import { ErrorHandler } from '../error-handling/error-handler';
import { ConfigManager } from '../config/config-manager';
import { CommandManager } from '../api-wrappers/command-manager';
import { WebviewManager } from '../api-wrappers/webview-manager';
// OutputManager is imported in container.ts - registered BEFORE Logger due to dependency
import { StatusBarManager } from '../api-wrappers/status-bar-manager';
import { FileSystemManager } from '../api-wrappers/file-system-manager';
import { WebviewMessageHandlerService } from '../services/webview-message-handler.service';

import { registerVsCodeCorePlatformAgnostic } from './register-platform-agnostic';

/**
 * Register vscode-core infrastructure services in DI container
 *
 * @param container - TSyringe DI container
 * @param context - VS Code extension context (needed for some services)
 * @param logger - Logger instance (already registered in container)
 */
export function registerVsCodeCoreServices(
  container: DependencyContainer,
  context: vscode.ExtensionContext,
  logger: Logger,
): void {
  // TASK_2025_071 Batch 7: Dependency validation - fail fast if prerequisites missing
  if (!container.isRegistered(TOKENS.EXTENSION_CONTEXT)) {
    throw new Error(
      '[VS Code Core] DEPENDENCY ERROR: TOKENS.EXTENSION_CONTEXT must be registered before calling registerVsCodeCoreServices. ' +
        'Ensure context is registered in PHASE 0 of container.ts.',
    );
  }

  if (!container.isRegistered(TOKENS.OUTPUT_MANAGER)) {
    throw new Error(
      '[VS Code Core] DEPENDENCY ERROR: TOKENS.OUTPUT_MANAGER must be registered before calling registerVsCodeCoreServices. ' +
        'OutputManager is required by Logger. Ensure container.registerSingleton(TOKENS.OUTPUT_MANAGER, OutputManager) ' +
        'is called BEFORE Logger registration in container.ts.',
    );
  }

  if (!container.isRegistered(TOKENS.LOGGER)) {
    throw new Error(
      '[VS Code Core] DEPENDENCY ERROR: TOKENS.LOGGER must be registered before calling registerVsCodeCoreServices. ' +
        'Ensure container.registerSingleton(TOKENS.LOGGER, Logger) is called after OutputManager in container.ts.',
    );
  }

  logger.info('[VS Code Core] Registering infrastructure services...');

  // ============================================================
  // Platform-agnostic block — delegated to the helper
  // (TASK_2025_291 Wave C1). Registers:
  //   RPC_HANDLER, MESSAGE_VALIDATOR, AGENT_SESSION_WATCHER_SERVICE,
  //   SUBAGENT_REGISTRY_SERVICE, FEATURE_GATE_SERVICE, SENTRY_SERVICE,
  //   LICENSE_SERVICE, AUTH_SECRETS_SERVICE.
  // ============================================================
  registerVsCodeCorePlatformAgnostic(container, logger);

  // ============================================================
  // Core infrastructure (Logger already registered externally)
  // ============================================================
  container.registerSingleton(TOKENS.ERROR_HANDLER, ErrorHandler);
  container.registerSingleton(TOKENS.CONFIG_MANAGER, ConfigManager);

  // ============================================================
  // API Wrappers
  // NOTE: OUTPUT_MANAGER is registered in container.ts BEFORE Logger
  // because Logger depends on OutputManager. Do not register it here.
  // ============================================================
  container.registerSingleton(TOKENS.COMMAND_MANAGER, CommandManager);
  container.registerSingleton(TOKENS.WEBVIEW_MANAGER, WebviewManager);
  // OUTPUT_MANAGER - Already registered in container.ts (required by Logger)
  container.registerSingleton(TOKENS.STATUS_BAR_MANAGER, StatusBarManager);
  container.registerSingleton(TOKENS.FILE_SYSTEM_MANAGER, FileSystemManager);

  // ============================================================
  // Webview Message Handler (shared message handling for all webviews)
  // ============================================================
  container.registerSingleton(
    TOKENS.WEBVIEW_MESSAGE_HANDLER,
    WebviewMessageHandlerService,
  );

  logger.info('[VS Code Core] Infrastructure services registered', {
    services: [
      'ERROR_HANDLER',
      'CONFIG_MANAGER',
      'COMMAND_MANAGER',
      'WEBVIEW_MANAGER',
      // OUTPUT_MANAGER registered in container.ts (Logger dependency)
      'STATUS_BAR_MANAGER',
      'FILE_SYSTEM_MANAGER',
      'WEBVIEW_MESSAGE_HANDLER',
      // Platform-agnostic services registered via registerVsCodeCorePlatformAgnostic:
      //   RPC_HANDLER, MESSAGE_VALIDATOR, AGENT_SESSION_WATCHER_SERVICE,
      //   SUBAGENT_REGISTRY_SERVICE, FEATURE_GATE_SERVICE,
      //   SENTRY_SERVICE, LICENSE_SERVICE, AUTH_SECRETS_SERVICE
    ],
  });
}
