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

// Import Logger and OutputManager (must be registered directly - cannot be in registration function)
// Logger depends on OutputManager, so OutputManager must be registered BEFORE Logger is resolved
// TASK_2025_103: Import SubagentRegistryService for subagent resumption
import {
  Logger,
  OutputManager,
  ConfigManager,
  SubagentRegistryService,
  TOKENS,
  registerVsCodeCoreServices,
  LicenseService,
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
  ProviderRpcHandlers,
  SubagentRpcHandlers,
  CommandRpcHandlers, // TASK_2025_126: Webview command execution
  EnhancedPromptsRpcHandlers, // TASK_2025_137: Enhanced Prompts
  QualityRpcHandlers, // TASK_2025_144: Quality Dashboard
  WizardGenerationRpcHandlers, // TASK_2025_148: Wizard Generation Pipeline
  PluginRpcHandlers, // TASK_2025_153: Plugin Configuration
  AgentRpcHandlers, // TASK_2025_157: Agent Orchestration
  PtahCliRpcHandlers, // TASK_2025_167: Ptah CLI Management
  SkillsShRpcHandlers, // TASK_2025_204: Skills.sh Marketplace
} from '../services/rpc';

// Import agent-sdk services (TASK_2025_044 Batch 3)
import {
  registerSdkServices,
  SDK_TOKENS,
  EnhancedPromptsService,
} from '@ptah-extension/agent-sdk';
import type { IMultiPhaseAnalysisReader } from '@ptah-extension/agent-sdk';

// Import agent-generation services (TASK_2025_069)

import {
  registerAgentGenerationServices,
  AGENT_GENERATION_TOKENS,
} from '@ptah-extension/agent-generation';

import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';

import { registerVsCodeLmToolsServices } from '@ptah-extension/vscode-lm-tools';

import { registerLlmAbstractionServices } from '@ptah-extension/llm-abstraction';

import { registerTemplateGenerationServices } from '@ptah-extension/template-generation';

import { registerPlatformVscodeServices } from '@ptah-extension/platform-vscode';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

// Platform abstraction implementations (TASK_2025_203)
import {
  VsCodePlatformCommands,
  VsCodePlatformAuth,
  VsCodeSaveDialog,
  VsCodeModelDiscovery,
} from '../services/platform';

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
   * Minimal DI setup for license verification (TASK_2025_121 Batch 3)
   *
   * Called BEFORE license check. Only registers services required for license verification:
   * 1. EXTENSION_CONTEXT (required by all services)
   * 2. OUTPUT_MANAGER (required by Logger)
   * 3. LOGGER (required for logging)
   * 4. LICENSE_SERVICE (for license verification)
   *
   * This minimal setup ensures license can be verified without initializing
   * unnecessary services that depend on license status.
   *
   * @param context - VS Code extension context
   * @returns Configured DependencyContainer with minimal services
   */
  static setupMinimal(context: vscode.ExtensionContext): DependencyContainer {
    // ========================================
    // PHASE 0: Extension Context (MUST BE FIRST)
    // ========================================
    container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context });

    // ========================================
    // PHASE 0.5: Platform Abstraction Layer (TASK_2025_199)
    // ========================================
    // MUST be before any library services (they inject PLATFORM_TOKENS)
    registerPlatformVscodeServices(container, context);

    // ========================================
    // PHASE 1: Logger Dependencies
    // ========================================
    // CRITICAL: OutputManager must be registered BEFORE Logger
    // because Logger depends on OutputManager (@inject(OUTPUT_MANAGER))
    container.registerSingleton(TOKENS.OUTPUT_MANAGER, OutputManager);

    // Now Logger can be registered and resolved safely
    container.registerSingleton(TOKENS.LOGGER, Logger);

    // ========================================
    // PHASE 1.5: ConfigManager (required by LicenseService)
    // ========================================
    // ConfigManager wraps vscode.workspace.getConfiguration('ptah').
    // LicenseService depends on it for reading license config.
    container.registerSingleton(TOKENS.CONFIG_MANAGER, ConfigManager);

    // ========================================
    // PHASE 2: License Service for verification
    // ========================================
    // LicenseService depends on EXTENSION_CONTEXT, LOGGER, and CONFIG_MANAGER

    container.registerSingleton(TOKENS.LICENSE_SERVICE, LicenseService);

    return container;
  }

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
   * IMPORTANT (TASK_2025_121): This method should only be called AFTER license
   * verification passes. Use setupMinimal() first to check license status.
   *
   * @param context - VS Code extension context
   * @returns Configured DependencyContainer
   */
  static setup(context: vscode.ExtensionContext): DependencyContainer {
    // ========================================
    // PHASE 0: Extension Context (MUST BE FIRST)
    // ========================================
    // TASK_2025_121: Check if already registered by setupMinimal()
    // If not, register now (supports both flows: with/without setupMinimal)
    if (!container.isRegistered(TOKENS.EXTENSION_CONTEXT)) {
      container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context });
    }

    // ========================================
    // PHASE 0.5: Platform Abstraction Layer (TASK_2025_199)
    // ========================================
    // MUST be before any library services (they inject PLATFORM_TOKENS)
    // Check if already registered by setupMinimal()
    if (!container.isRegistered(PLATFORM_TOKENS.PLATFORM_INFO)) {
      registerPlatformVscodeServices(container, context);
    }

    // ========================================
    // PHASE 1: Infrastructure Services (vscode-core)
    // ========================================
    // TASK_2025_121: Check if already registered by setupMinimal()
    // CRITICAL: OutputManager must be registered BEFORE Logger
    // because Logger depends on OutputManager (@inject(OUTPUT_MANAGER))
    // Dependency chain: Logger → OutputManager → EXTENSION_CONTEXT
    if (!container.isRegistered(TOKENS.OUTPUT_MANAGER)) {
      container.registerSingleton(TOKENS.OUTPUT_MANAGER, OutputManager);
    }

    // Now Logger can be registered and resolved safely
    if (!container.isRegistered(TOKENS.LOGGER)) {
      container.registerSingleton(TOKENS.LOGGER, Logger);
    }
    const logger = container.resolve<Logger>(TOKENS.LOGGER);

    // PHASE 1.4.5: Platform Abstraction Implementations (TASK_2025_203)
    // Must be registered BEFORE handler classes that depend on these tokens
    container.registerSingleton(
      TOKENS.PLATFORM_COMMANDS,
      VsCodePlatformCommands
    );
    container.registerSingleton(
      TOKENS.PLATFORM_AUTH_PROVIDER,
      VsCodePlatformAuth
    );
    container.registerSingleton(TOKENS.SAVE_DIALOG_PROVIDER, VsCodeSaveDialog);
    container.registerSingleton(TOKENS.MODEL_DISCOVERY, VsCodeModelDiscovery);

    // PHASE 1.5: Register remaining vscode-core infrastructure services
    registerVsCodeCoreServices(container, context, logger);

    // PHASE 1.5.1: Subagent Registry Service (TASK_2025_103)
    // Must be registered AFTER vscode-core (Logger dependency) but BEFORE RPC handlers
    container.registerSingleton(
      TOKENS.SUBAGENT_REGISTRY_SERVICE,
      SubagentRegistryService
    );

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
    // TASK_2025_203: Added WORKSPACE_PROVIDER injection
    container.register(SetupRpcHandlers, {
      useFactory: (c) =>
        new SetupRpcHandlers(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c.resolve(TOKENS.CONFIG_MANAGER),
          c.resolve(SDK_TOKENS.SDK_PLUGIN_LOADER),
          c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
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

    // ProviderRpcHandlers requires SDK_PROVIDER_MODELS which is registered in Phase 2.7
    // Must be registered after agent-sdk services but resolved lazily
    // Temporarily register as placeholder - will be re-registered after agent-sdk
    container.registerSingleton(ProviderRpcHandlers);

    // TASK_2025_103: Subagent RPC handlers for subagent resumption
    container.registerSingleton(SubagentRpcHandlers);

    // TASK_2025_126: Command RPC handlers for webview command execution
    container.registerSingleton(CommandRpcHandlers);

    // TASK_2025_137: Enhanced Prompts RPC handlers
    // Must use factory pattern because DependencyContainer is an interface (no reflection metadata)
    // Same pattern as SetupRpcHandlers and WizardGenerationRpcHandlers
    // TASK_2025_203: Added WORKSPACE_PROVIDER + SAVE_DIALOG_PROVIDER injections
    container.register(EnhancedPromptsRpcHandlers, {
      useFactory: (c) =>
        new EnhancedPromptsRpcHandlers(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c.resolve(SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE),
          c.resolve(TOKENS.LICENSE_SERVICE),
          c.resolve(SDK_TOKENS.SDK_PLUGIN_LOADER),
          c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
          c.resolve(TOKENS.SAVE_DIALOG_PROVIDER),
          c
        ),
    });

    // TASK_2025_144: Quality Dashboard RPC handlers
    container.registerSingleton(QualityRpcHandlers);

    // TASK_2025_153: Plugin Configuration RPC handlers
    container.registerSingleton(PluginRpcHandlers);

    // TASK_2025_157: Agent Orchestration RPC handlers
    container.registerSingleton(AgentRpcHandlers);

    // TASK_2025_167: Ptah CLI Management RPC handlers
    container.registerSingleton(PtahCliRpcHandlers);

    // TASK_2025_204: Skills.sh Marketplace RPC handlers
    container.registerSingleton(SkillsShRpcHandlers);

    // TASK_2025_148: Wizard Generation RPC handlers (requires container for lazy resolution)
    // TASK_2025_203: Added WORKSPACE_PROVIDER injection
    container.register(WizardGenerationRpcHandlers, {
      useFactory: (c) =>
        new WizardGenerationRpcHandlers(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c.resolve(SDK_TOKENS.SDK_PLUGIN_LOADER),
          c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
          c
        ),
    });

    // RPC Method Registration Service (orchestrator - requires container instance)
    // TASK_2025_074: Refactored to use domain-specific handler classes
    // TASK_2025_079: Added LicenseRpcHandlers for premium feature gating
    // TASK_2025_103: Added SubagentRpcHandlers for subagent resumption
    // TASK_2025_137: Added EnhancedPromptsRpcHandlers
    container.register(TOKENS.RPC_METHOD_REGISTRATION_SERVICE, {
      useFactory: (c) => {
        return new RpcMethodRegistrationService(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c.resolve(TOKENS.WEBVIEW_MANAGER),
          c.resolve(TOKENS.AGENT_SESSION_WATCHER_SERVICE),
          c.resolve(TOKENS.COMMAND_MANAGER),
          c.resolve(SDK_TOKENS.SDK_AGENT_ADAPTER),
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
          c.resolve(ProviderRpcHandlers),
          c.resolve(SubagentRpcHandlers),
          c.resolve(CommandRpcHandlers), // TASK_2025_126
          c.resolve(EnhancedPromptsRpcHandlers), // TASK_2025_137
          c.resolve(QualityRpcHandlers), // TASK_2025_144
          c.resolve(WizardGenerationRpcHandlers), // TASK_2025_148
          c.resolve(PluginRpcHandlers), // TASK_2025_153
          c.resolve(AgentRpcHandlers), // TASK_2025_157
          c.resolve(PtahCliRpcHandlers), // TASK_2025_167
          c.resolve(SkillsShRpcHandlers), // TASK_2025_204
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
    // TASK_2025_199: Removed context parameter — SDK services now inject
    // platform abstractions via PLATFORM_TOKENS decorators instead of receiving
    // vscode.ExtensionContext directly.
    registerSdkServices(container, logger);

    // TASK_2025_140: Bridge registration removed. TOKENS.SDK_AGENT_ADAPTER and
    // SDK_TOKENS.SDK_AGENT_ADAPTER both use Symbol.for('SdkAgentAdapter'), so
    // they are the same symbol. registerSdkServices() registers the adapter
    // directly against that symbol -- no bridge needed.

    // ========================================
    // PHASE 2.8: Agent Generation Services (TASK_2025_069)
    // ========================================
    // SetupStatusService, SetupWizardService, and supporting services
    // Required for setup wizard functionality
    // TASK_2025_199: Removed extensionPath parameter — services now inject
    // IPlatformInfo directly via PLATFORM_TOKENS.PLATFORM_INFO instead of
    // receiving extensionPath through the registration function.
    registerAgentGenerationServices(container, logger);

    // TASK_2025_154: Wire multi-phase analysis reader into EnhancedPromptsService
    // Both SDK and agent-generation services are now registered, so we can
    // safely resolve and connect them for optional multi-phase enrichment.
    try {
      const enhancedPrompts = container.resolve<EnhancedPromptsService>(
        SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE
      );
      const analysisStorage = container.resolve<IMultiPhaseAnalysisReader>(
        AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE
      );
      enhancedPrompts.setAnalysisReader(analysisStorage);
    } catch (error) {
      logger.warn(
        '[DI] Failed to wire multi-phase analysis reader into EnhancedPromptsService',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    // ========================================
    // PHASE 2.9: CLI Abstraction Services (TASK_2025_071, TASK_2025_212)
    // ========================================
    // TASK_2025_212: Vestigial LLM provider services (LlmSecretsService,
    // LlmConfigurationService, ProviderRegistry, LlmService) removed.
    // Only CLI detection/management services remain.
    registerLlmAbstractionServices(container, logger);

    // TASK_2025_209: TOKENS.LLM_RPC_HANDLERS deleted. Shared LlmRpcHandlers (from @ptah-extension/rpc-handlers)
    // is now platform-agnostic and registered in Phase 2.5 as AppLlmRpcHandlers.

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
