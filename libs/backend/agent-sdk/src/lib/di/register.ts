/**
 * Agent SDK DI Registration
 * TASK_2025_044 Batch 3: Register all SDK services in DI container
 */

import { DependencyContainer } from 'tsyringe';
import type { Logger, ConfigManager } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SdkAgentAdapter } from '../sdk-agent-adapter';
import { SdkSessionStorage } from '../sdk-session-storage';
import { SdkPermissionHandler } from '../sdk-permission-handler';
import { SDK_TOKENS } from './tokens';
import * as vscode from 'vscode';

/**
 * Register all agent-sdk services in DI container
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

  // Register session storage (uses VS Code workspaceState Memento)
  container.register(SDK_TOKENS.SDK_SESSION_STORAGE, {
    useFactory: () => {
      logger.debug('[AgentSDK] Creating SdkSessionStorage');
      return new SdkSessionStorage(context.workspaceState, logger);
    },
  });

  // Register permission handler
  container.register(SDK_TOKENS.SDK_PERMISSION_HANDLER, {
    useFactory: () => {
      logger.debug('[AgentSDK] Creating SdkPermissionHandler');
      return new SdkPermissionHandler(logger);
    },
  });

  // Register adapter (depends on ConfigManager, storage, and permission handler)
  container.register(SDK_TOKENS.SDK_AGENT_ADAPTER, {
    useFactory: () => {
      logger.debug('[AgentSDK] Creating SdkAgentAdapter');
      const config = container.resolve<ConfigManager>(TOKENS.CONFIG_MANAGER);
      const storage = container.resolve<SdkSessionStorage>(
        SDK_TOKENS.SDK_SESSION_STORAGE
      );
      const permissionHandler = container.resolve<SdkPermissionHandler>(
        SDK_TOKENS.SDK_PERMISSION_HANDLER
      );
      return new SdkAgentAdapter(logger, config, storage, permissionHandler);
    },
  });

  logger.info('[AgentSDK] SDK services registered successfully', {
    services: Object.keys(SDK_TOKENS),
  });
}
