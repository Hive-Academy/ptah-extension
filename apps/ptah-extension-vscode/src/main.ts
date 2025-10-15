import 'reflect-metadata';
import * as vscode from 'vscode';
import { PtahExtension } from './core/ptah-extension';
import { DIContainer, TOKENS, EventBus } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  registerWorkspaceIntelligenceServices,
  type WorkspaceIntelligenceTokens,
} from '@ptah-extension/workspace-intelligence';
import {
  registerClaudeDomainServices,
  type ClaudeDomainTokens,
  type DI_IEventBus,
  // Import all 19 claude-domain tokens for main app token mapping
  EVENT_BUS as CLAUDE_EVENT_BUS,
  STORAGE_SERVICE as CLAUDE_STORAGE_SERVICE,
  CONTEXT_ORCHESTRATION_SERVICE as CLAUDE_CONTEXT_ORCHESTRATION_SERVICE,
  SESSION_MANAGER as CLAUDE_SESSION_MANAGER,
  CLAUDE_CLI_DETECTOR,
  CLAUDE_CLI_SERVICE,
  // Note: CLAUDE_CLI_LAUNCHER not imported - not registered (requires runtime params)
  PERMISSION_SERVICE as CLAUDE_PERMISSION_SERVICE,
  PROCESS_MANAGER as CLAUDE_PROCESS_MANAGER,
  EVENT_PUBLISHER as CLAUDE_EVENT_PUBLISHER,
  CHAT_ORCHESTRATION_SERVICE,
  PROVIDER_ORCHESTRATION_SERVICE,
  ANALYTICS_ORCHESTRATION_SERVICE,
  CONFIG_ORCHESTRATION_SERVICE,
  MESSAGE_HANDLER_SERVICE,
  CONTEXT_SERVICE as CLAUDE_CONTEXT_SERVICE,
  // Note: PROVIDER_MANAGER not imported - mapped to TOKENS.AI_PROVIDER_MANAGER instead
  CONFIGURATION_PROVIDER as CLAUDE_CONFIGURATION_PROVIDER,
  ANALYTICS_DATA_COLLECTOR as CLAUDE_ANALYTICS_DATA_COLLECTOR,
} from '@ptah-extension/claude-domain';
import {
  ProviderManager,
  ClaudeCliAdapter,
  VsCodeLmAdapter,
  IntelligentProviderStrategy,
  ContextManager,
} from '@ptah-extension/ai-providers-core';
import { MessagePayloadMap } from '@ptah-extension/shared';

let ptahExtension: PtahExtension | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    // Initialize DI Container with infrastructure services
    DIContainer.setup(context);

    // Get logger from DI container
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.info('Activating Ptah extension...');

    // ========================================
    // Register Domain Services (TASK_CORE_001)
    // ========================================
    // Per LIBRARY_INTEGRATION_ARCHITECTURE.md:
    // Main app orchestrates domain service registration by calling bootstrap functions

    // 1. Register workspace-intelligence services
    const workspaceTokens: WorkspaceIntelligenceTokens = {
      TOKEN_COUNTER_SERVICE: TOKENS.TOKEN_COUNTER_SERVICE,
      FILE_SYSTEM_SERVICE: TOKENS.FILE_SYSTEM_SERVICE,
      CONTEXT_SERVICE: TOKENS.CONTEXT_SERVICE,
      PROJECT_DETECTOR_SERVICE: TOKENS.PROJECT_DETECTOR_SERVICE,
      FRAMEWORK_DETECTOR_SERVICE: TOKENS.FRAMEWORK_DETECTOR_SERVICE,
      DEPENDENCY_ANALYZER_SERVICE: TOKENS.DEPENDENCY_ANALYZER_SERVICE,
      MONOREPO_DETECTOR_SERVICE: TOKENS.MONOREPO_DETECTOR_SERVICE,
      PATTERN_MATCHER_SERVICE: TOKENS.PATTERN_MATCHER_SERVICE,
      IGNORE_PATTERN_RESOLVER_SERVICE: TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE,
      FILE_TYPE_CLASSIFIER_SERVICE: TOKENS.FILE_TYPE_CLASSIFIER_SERVICE,
      WORKSPACE_INDEXER_SERVICE: TOKENS.WORKSPACE_INDEXER_SERVICE,
      WORKSPACE_SERVICE: TOKENS.WORKSPACE_SERVICE,
      CONTEXT_ORCHESTRATION_SERVICE: TOKENS.CONTEXT_ORCHESTRATION_SERVICE,
      WORKSPACE_ANALYZER_SERVICE: TOKENS.WORKSPACE_ANALYZER_SERVICE, // Phase 4: Composite facade
    };
    registerWorkspaceIntelligenceServices(
      DIContainer.getContainer(),
      workspaceTokens
    );
    logger.info(
      'Workspace intelligence services registered (including WorkspaceAnalyzerService)'
    );

    // 2. Register claude-domain services
    const eventBus = DIContainer.resolve<EventBus>(TOKENS.EVENT_BUS);
    const eventBusAdapter: DI_IEventBus = {
      publish: <T>(topic: keyof MessagePayloadMap, payload: T) => {
        eventBus.publish(topic, payload);
      },
    };

    // Get context orchestration service to pass to claude-domain
    const contextOrchestration = DIContainer.resolve(
      TOKENS.CONTEXT_ORCHESTRATION_SERVICE
    );

    // Create storage adapter from VS Code ExtensionContext
    const storageAdapter = {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        return context.workspaceState.get<T>(key, defaultValue);
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        await context.workspaceState.update(key, value);
      },
    };

    const claudeTokens: ClaudeDomainTokens = {
      // Infrastructure tokens (provided by vscode-core)
      EVENT_BUS: CLAUDE_EVENT_BUS,
      STORAGE_SERVICE: CLAUDE_STORAGE_SERVICE,
      CONTEXT_ORCHESTRATION_SERVICE: CLAUDE_CONTEXT_ORCHESTRATION_SERVICE,

      // Core domain services
      SESSION_MANAGER: CLAUDE_SESSION_MANAGER,
      CLAUDE_CLI_DETECTOR: CLAUDE_CLI_DETECTOR,
      CLAUDE_CLI_SERVICE: CLAUDE_CLI_SERVICE,
      // Note: CLAUDE_CLI_LAUNCHER removed - requires runtime parameters, created on-demand by ClaudeCliService
      PERMISSION_SERVICE: CLAUDE_PERMISSION_SERVICE,
      PROCESS_MANAGER: CLAUDE_PROCESS_MANAGER,
      EVENT_PUBLISHER: CLAUDE_EVENT_PUBLISHER,

      // Orchestration services
      CHAT_ORCHESTRATION_SERVICE: CHAT_ORCHESTRATION_SERVICE,
      PROVIDER_ORCHESTRATION_SERVICE: PROVIDER_ORCHESTRATION_SERVICE,
      ANALYTICS_ORCHESTRATION_SERVICE: ANALYTICS_ORCHESTRATION_SERVICE,
      CONFIG_ORCHESTRATION_SERVICE: CONFIG_ORCHESTRATION_SERVICE,
      MESSAGE_HANDLER_SERVICE: MESSAGE_HANDLER_SERVICE,

      // Service-specific dependencies
      CONTEXT_SERVICE: CLAUDE_CONTEXT_SERVICE,
      PROVIDER_MANAGER: TOKENS.AI_PROVIDER_MANAGER, // Map to vscode-core token where ProviderManager is registered
      CONFIGURATION_PROVIDER: CLAUDE_CONFIGURATION_PROVIDER,
      ANALYTICS_DATA_COLLECTOR: CLAUDE_ANALYTICS_DATA_COLLECTOR,
    };
    registerClaudeDomainServices(
      DIContainer.getContainer(),
      claudeTokens,
      eventBusAdapter,
      storageAdapter,
      contextOrchestration
    );
    logger.info('Claude domain services registered');

    // 3. Register ai-providers-core services (TASK_CORE_001 - Phase 3)
    const container = DIContainer.getContainer();
    container.registerSingleton(TOKENS.AI_PROVIDER_MANAGER, ProviderManager);
    container.registerSingleton('ClaudeCliAdapter', ClaudeCliAdapter);
    container.registerSingleton('VsCodeLmAdapter', VsCodeLmAdapter);
    container.registerSingleton(
      'IntelligentProviderStrategy',
      IntelligentProviderStrategy
    );
    container.registerSingleton(TOKENS.CONTEXT_MANAGER, ContextManager);
    logger.info('AI providers core services registered');

    // ========================================
    // Phase 3: Initialize MessageHandlerService
    // ========================================
    // Start EventBus message routing
    const messageHandler = DIContainer.resolve(MESSAGE_HANDLER_SERVICE);
    (messageHandler as { initialize: () => void }).initialize();
    logger.info('MessageHandlerService initialized and subscribed to EventBus');

    // Initialize main extension controller
    ptahExtension = new PtahExtension(context);
    await ptahExtension.initialize();

    // Register all providers, commands, and services
    await ptahExtension.registerAll();

    logger.info('Ptah extension activated successfully');

    // Show welcome message for first-time users
    const isFirstTime = context.globalState.get('ptah.firstActivation', true);
    if (isFirstTime) {
      await ptahExtension.showWelcome();
      await context.globalState.update('ptah.firstActivation', false);
    }
  } catch (error) {
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.error('Failed to activate Ptah extension', error);
    vscode.window.showErrorMessage(
      `Ptah activation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

export function deactivate(): void {
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Deactivating Ptah extension');
  ptahExtension?.dispose();
  ptahExtension = undefined;
  DIContainer.clear();
}
