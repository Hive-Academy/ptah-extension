/**
 * Centralized Dependency Injection Container (Orchestrator)
 *
 * RESPONSIBILITY: Orchestrate service registration across all libraries
 * Each library now has its own registration function (registerXXXServices)
 *
 * TASK_2025_071: Refactored from direct registrations to orchestration pattern
 * - Libraries: vscode-core, workspace-intelligence, vscode-lm-tools, agent-sdk,
 *              agent-generation, llm-abstraction, template-generation
 * - App-level: Logger (must be first), RpcMethodRegistrationService (requires container),
 *              storage adapters, webview services
 *
 * Benefits of orchestration pattern:
 * - Libraries own their own registrations (better separation of concerns)
 * - Clear registration order at orchestration level
 * - Single place to see service initialization flow
 * - Libraries can be tested independently with their registration functions
 */

import 'reflect-metadata';
import { container, DependencyContainer } from 'tsyringe';
import * as vscode from 'vscode';

// Import TOKENS (single source of truth)
import { TOKENS } from '@ptah-extension/vscode-core';

// Import Logger and OutputManager (must be registered directly - cannot be in registration function)
// Logger depends on OutputManager, so OutputManager must be registered BEFORE Logger is resolved
import {
  Logger,
  OutputManager,
  LlmRpcHandlers,
} from '@ptah-extension/vscode-core';

// Import app-level RPC service and handlers (TASK_2025_074: Modular architecture)
import {
  RpcMethodRegistrationService,
  ChatRpcHandlers,
  SessionRpcHandlers,
  ContextRpcHandlers,
  AutocompleteRpcHandlers,
  FileRpcHandlers,
  ConfigRpcHandlers,
  AuthRpcHandlers,
  SetupRpcHandlers,
  LicenseRpcHandlers,
  LlmRpcHandlers as AppLlmRpcHandlers,
  OpenRouterRpcHandlers,
} from '../services/rpc';

// Import agent-sdk services (TASK_2025_044 Batch 3)
// eslint-disable-next-line @nx/enforce-module-boundaries
import { registerSdkServices } from '@ptah-extension/agent-sdk';

// Import agent-generation services (TASK_2025_069)
// eslint-disable-next-line @nx/enforce-module-boundaries
import { registerAgentGenerationServices } from '@ptah-extension/agent-generation';

// Import registration functions (TASK_2025_071 Batch 3)

import { registerVsCodeCoreServices } from '@ptah-extension/vscode-core';

import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';

import { registerVsCodeLmToolsServices } from '@ptah-extension/vscode-lm-tools';

import { registerLlmAbstractionServices } from '@ptah-extension/llm-abstraction';

import { registerTemplateGenerationServices } from '@ptah-extension/template-generation';

// Import webview support services
import { WebviewEventQueue } from '../services/webview-event-queue';
import { AngularWebviewProvider } from '../providers/angular-webview.provider';
import { WebviewHtmlGenerator } from '../services/webview-html-generator';

// Import command handlers
import { LicenseCommands } from '../commands/license-commands';

/**
 * DI Container Orchestrator
 * Orchestrates service registration across all libraries
 *
 * TASK_2025_071: Now uses library registration functions instead of direct registrations
 */
export class DIContainer {
  /**
   * Setup and orchestrate all service registrations
   *
   * Order matters:
   * 1. Logger (MUST be first)
   * 2. vscode-core infrastructure
   * 3. workspace-intelligence
   * 4. vscode-lm-tools
   * 5. agent-sdk
   * 6. agent-generation
   * 7. llm-abstraction (NEW - fixes LlmService error)
   * 8. template-generation (NEW)
   * 9. App-level services (RPC, storage, webview)
   *
   * @param context - VS Code extension context
   * @returns Configured DependencyContainer
   */
  static setup(context: vscode.ExtensionContext): DependencyContainer {
    // ========================================
    // PHASE 0: Extension Context (MUST BE FIRST)
    // ========================================
    // Extension Context must be registered BEFORE any services that depend on it
    container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context });

    // ========================================
    // PHASE 1: Infrastructure Services (vscode-core)
    // ========================================
    // CRITICAL: OutputManager must be registered BEFORE Logger
    // because Logger depends on OutputManager (@inject(OUTPUT_MANAGER))
    // Dependency chain: Logger → OutputManager → EXTENSION_CONTEXT
    container.registerSingleton(TOKENS.OUTPUT_MANAGER, OutputManager);

    // Now Logger can be registered and resolved safely
    container.registerSingleton(TOKENS.LOGGER, Logger);
    const logger = container.resolve<Logger>(TOKENS.LOGGER);

    // PHASE 1.5: Register remaining vscode-core infrastructure services
    registerVsCodeCoreServices(container, context, logger);

    // ========================================
    // PHASE 1.6: RPC Domain Handlers (TASK_2025_074)
    // ========================================
    // Register all domain-specific RPC handler classes
    // These are used by RpcMethodRegistrationService to delegate RPC registration
    container.registerSingleton(ChatRpcHandlers);
    container.registerSingleton(SessionRpcHandlers);
    container.registerSingleton(ContextRpcHandlers);
    container.registerSingleton(AutocompleteRpcHandlers);
    container.registerSingleton(FileRpcHandlers);
    container.registerSingleton(ConfigRpcHandlers);
    container.registerSingleton(AuthRpcHandlers);
    container.registerSingleton(LicenseRpcHandlers);
    // SetupRpcHandlers and LlmRpcHandlers require container instance for lazy resolution
    // Must use factory pattern because DependencyContainer is an interface (no reflection metadata)
    container.register(SetupRpcHandlers, {
      useFactory: (c) =>
        new SetupRpcHandlers(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c
        ),
    });

    container.register(AppLlmRpcHandlers, {
      useFactory: (c) =>
        new AppLlmRpcHandlers(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c
        ),
    });

    // OpenRouterRpcHandlers requires SDK_OPENROUTER_MODELS which is registered in Phase 2.7
    // Must be registered after agent-sdk services but resolved lazily
    // Temporarily register as placeholder - will be re-registered after agent-sdk
    container.registerSingleton(OpenRouterRpcHandlers);

    // RPC Method Registration Service (orchestrator - requires container instance)
    // TASK_2025_074: Refactored to use domain-specific handler classes
    // TASK_2025_079: Added LicenseRpcHandlers for premium feature gating
    container.register(TOKENS.RPC_METHOD_REGISTRATION_SERVICE, {
      useFactory: (c) => {
        return new RpcMethodRegistrationService(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c.resolve(TOKENS.WEBVIEW_MANAGER),
          c.resolve(TOKENS.AGENT_SESSION_WATCHER_SERVICE),
          c.resolve(TOKENS.COMMAND_MANAGER),
          c.resolve('SdkAgentAdapter'),
          // Domain-specific handlers
          c.resolve(ChatRpcHandlers),
          c.resolve(SessionRpcHandlers),
          c.resolve(ContextRpcHandlers),
          c.resolve(AutocompleteRpcHandlers),
          c.resolve(FileRpcHandlers),
          c.resolve(ConfigRpcHandlers),
          c.resolve(AuthRpcHandlers),
          c.resolve(SetupRpcHandlers),
          c.resolve(LicenseRpcHandlers),
          c.resolve(AppLlmRpcHandlers),
          c.resolve(OpenRouterRpcHandlers),
          c // Pass container instance
        );
      },
    });

    // ========================================
    // PHASE 2: Workspace Intelligence Services
    // ========================================
    registerWorkspaceIntelligenceServices(container, logger);

    // ========================================
    // PHASE 2.5: Code Execution MCP (TASK_2025_025)
    // ========================================
    registerVsCodeLmToolsServices(container, logger);

    // ========================================
    // PHASE 2.7: Agent SDK Integration (TASK_2025_044 Batch 3)
    // ========================================
    // Register Agent SDK services (adapter, storage, permission handler)
    // TASK_2025_092: SdkPermissionHandler now handles permission emitter directly
    // (SdkRpcHandlers deleted - was dead code, only initializePermissionEmitter() was used)
    registerSdkServices(container, context, logger);

    // Register adapter with main TOKENS symbol (TASK_2025_057 Batch 1)
    // This allows main.ts to resolve adapter using TOKENS.SDK_AGENT_ADAPTER
    container.register(TOKENS.SDK_AGENT_ADAPTER, {
      useFactory: () => {
        // Resolve from SDK_TOKENS registration
        const { SDK_TOKENS } = require('@ptah-extension/agent-sdk');
        return container.resolve(SDK_TOKENS.SDK_AGENT_ADAPTER);
      },
    });

    // ========================================
    // PHASE 2.8: Agent Generation Services (TASK_2025_069)
    // ========================================
    // SetupStatusService, SetupWizardService, and supporting services
    // Required for setup wizard functionality
    registerAgentGenerationServices(container, logger);

    // ========================================
    // PHASE 2.9: LLM Abstraction Services (TASK_2025_071 - CRITICAL FIX)
    // ========================================
    // FIXES: LlmService was never registered before this task
    // This registration function was created but NEVER called in container.ts
    registerLlmAbstractionServices(container, logger);

    // Register LlmRpcHandlers (TASK_2025_073 Batch 5)
    // Must come AFTER llm-abstraction (depends on LLM_SECRETS_SERVICE, LLM_CONFIGURATION_SERVICE)
    container.registerSingleton(TOKENS.LLM_RPC_HANDLERS, LlmRpcHandlers);

    // ========================================
    // PHASE 2.10: Template Generation Services (TASK_2025_071)
    // ========================================
    // Template processing and generation services
    // This registration function was created but NEVER called in container.ts
    registerTemplateGenerationServices(container, logger);

    // ========================================
    // PHASE 3: Storage Adapters (app-level)
    // ========================================

    // Storage adapter (from VS Code workspace state)
    const storageAdapter = {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        const value = context.workspaceState.get<T>(key);
        // Fix: Handle undefined properly before passing to get()
        return value !== undefined ? value : defaultValue;
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        await context.workspaceState.update(key, value);
      },
    };
    container.register(TOKENS.STORAGE_SERVICE, { useValue: storageAdapter });

    // Global state adapter (for pricing cache - uses globalState for cross-workspace persistence)
    container.register(TOKENS.GLOBAL_STATE, { useValue: context.globalState });

    // ========================================
    // PHASE 4: Webview Support Services (app-level)
    // ========================================
    container.registerSingleton(TOKENS.WEBVIEW_EVENT_QUEUE, WebviewEventQueue);

    // WebviewHtmlGenerator - used by AngularWebviewProvider and SetupWizardService
    // Registered as factory because it requires ExtensionContext (not injectable)
    container.register(TOKENS.WEBVIEW_HTML_GENERATOR, {
      useFactory: () => new WebviewHtmlGenerator(context),
    });

    container.registerSingleton(
      TOKENS.ANGULAR_WEBVIEW_PROVIDER,
      AngularWebviewProvider
    );

    // ========================================
    // PHASE 5: Command Handlers (TASK_2025_075)
    // ========================================
    container.registerSingleton(TOKENS.LICENSE_COMMANDS, LicenseCommands);

    return container;
  }

  /**
   * Get the global container instance
   */
  static getContainer(): DependencyContainer {
    return container;
  }

  /**
   * Resolve a service by its token
   */
  static resolve<T>(token: symbol): T {
    return container.resolve<T>(token);
  }

  /**
   * Check if a service is registered
   */
  static isRegistered(token: symbol): boolean {
    return container.isRegistered(token);
  }

  /**
   * Clear all instances (for testing)
   */
  static clear(): void {
    container.clearInstances();
  }
}

// Re-export container for backward compatibility
export { container };
