/**
 * Electron DI Container Orchestrator
 *
 * TASK_2025_200 Batch 3: Mirrors the VS Code container.ts pattern but
 * selectively registers only platform-agnostic services from vscode-core.
 *
 * CRITICAL DESIGN DECISIONS:
 * - DOES NOT call registerVsCodeCoreServices() (it imports the vscode module)
 * - Manually registers platform-agnostic vscode-core services
 * - Uses platform-electron providers instead of VS Code API wrappers
 * - Provides an Electron-compatible LicenseService stub (API key auth, no Paddle)
 * - Provides an Electron-compatible OutputManager that delegates to IOutputChannel
 *
 * Phase-based registration order mirrors VS Code container:
 *   Phase 0:   Platform abstraction layer (platform-electron)
 *   Phase 1:   Logger + platform-agnostic vscode-core services
 *   Phase 1.6: RPC handler setup (deferred to setupRpcHandlers)
 *   Phase 2:   Library services (workspace-intelligence, agent-sdk, etc.)
 *   Phase 3:   Storage adapters
 *   Phase 4:   Analysis reader wiring
 *
 * vscode-core Audit Results:
 *
 * INCLUDED (no vscode import):
 *   - RpcHandler           - RPC method routing (depends on LicenseService)
 *   - MessageValidatorService - Zod-based message validation
 *   - AgentSessionWatcherService - Real-time summary streaming (uses fs/events)
 *   - SubagentRegistryService    - In-memory subagent lifecycle tracking
 *   - FeatureGateService         - License tier feature gating
 *
 * EXCLUDED (imports vscode directly):
 *   - OutputManager       - Uses vscode.window.createOutputChannel
 *   - Logger              - Depends on OutputManager (vscode.ExtensionContext)
 *   - ErrorHandler        - Uses vscode.window.showErrorMessage
 *   - ConfigManager       - Uses vscode.workspace.getConfiguration
 *   - CommandManager      - Uses vscode.commands.registerCommand
 *   - WebviewManager      - Uses webview panel APIs
 *   - StatusBarManager    - Uses status bar APIs
 *   - FileSystemManager   - Uses vscode.workspace.fs
 *   - AuthSecretsService  - Uses vscode.ExtensionContext.secrets
 *   - LicenseService      - Uses vscode.ExtensionContext
 *   - WebviewMessageHandlerService - Uses vscode webview messaging
 *   - PreferencesStorageService    - Uses vscode.ExtensionContext.workspaceState
 *
 * REPLACED (Electron-compatible alternatives):
 *   - OutputManager -> ElectronOutputManagerAdapter (wraps IOutputChannel)
 *   - Logger -> Standard Logger class (works with adapter)
 *   - LicenseService -> ElectronLicenseServiceStub (always valid, API key auth)
 */

import 'reflect-metadata';
import { container, DependencyContainer } from 'tsyringe';

import {
  registerPlatformElectronServices,
  type ElectronPlatformOptions,
} from '@ptah-extension/platform-electron';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IOutputChannel,
  IStateStorage,
  ISecretStorage,
} from '@ptah-extension/platform-core';

// vscode-core: TOKENS only (no service class imports that pull in vscode)
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';

// Platform-agnostic vscode-core services (verified: no vscode imports)
import { RpcHandler } from '@ptah-extension/vscode-core';
import { MessageValidatorService } from '@ptah-extension/vscode-core';
import { AgentSessionWatcherService } from '@ptah-extension/vscode-core';
import { SubagentRegistryService } from '@ptah-extension/vscode-core';
import { FeatureGateService } from '@ptah-extension/vscode-core';

// Library registration functions (all accept container + logger, no vscode)
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import {
  registerSdkServices,
  SDK_TOKENS,
  EnhancedPromptsService,
} from '@ptah-extension/agent-sdk';
import type { IMultiPhaseAnalysisReader } from '@ptah-extension/agent-sdk';
import {
  registerAgentGenerationServices,
  AGENT_GENERATION_TOKENS,
} from '@ptah-extension/agent-generation';
import { registerLlmAbstractionServices } from '@ptah-extension/llm-abstraction';
import { registerTemplateGenerationServices } from '@ptah-extension/template-generation';

// Electron-specific adapters (defined below)
import {
  ElectronOutputManagerAdapter,
  ElectronLoggerAdapter,
  ElectronLicenseServiceStub,
} from './electron-adapters';

/**
 * Electron DI Container Orchestrator
 *
 * Mirrors the VS Code DIContainer but registers only platform-agnostic
 * services and uses Electron-compatible replacements for VS Code-specific ones.
 */
export class ElectronDIContainer {
  /**
   * Setup and orchestrate all service registrations for Electron.
   *
   * @param options - Electron platform options (paths, APIs)
   * @returns Configured DependencyContainer
   */
  static setup(options: ElectronPlatformOptions): DependencyContainer {
    // ========================================
    // PHASE 0: Platform Abstraction Layer
    // ========================================
    // Register all 10 platform tokens (IPlatformInfo + 8 providers + WORKSPACE_STATE_STORAGE)
    // MUST be before any library services (they inject PLATFORM_TOKENS)
    registerPlatformElectronServices(container, options);

    // ========================================
    // PHASE 1: Logger + Infrastructure Services
    // ========================================

    // OutputManager adapter: wraps the platform-electron IOutputChannel
    // Logger depends on OutputManager, so this must be registered first
    const outputChannel = container.resolve<IOutputChannel>(
      PLATFORM_TOKENS.OUTPUT_CHANNEL
    );
    const outputManager = new ElectronOutputManagerAdapter(outputChannel);
    container.register(TOKENS.OUTPUT_MANAGER, { useValue: outputManager });

    // Logger adapter: uses ElectronOutputManagerAdapter instead of VS Code OutputManager.
    // Cast to Logger type so library registration functions accept it.
    // This is safe because they only call public methods (info, warn, error, debug).
    const loggerAdapter = new ElectronLoggerAdapter(outputManager);
    const logger = loggerAdapter as unknown as Logger;
    container.register(TOKENS.LOGGER, { useValue: logger });

    logger.info('[Electron DI] Starting service registration...');

    // ========================================
    // PHASE 1.1: Electron-compatible LicenseService stub
    // ========================================
    // RpcHandler depends on LicenseService for license validation middleware.
    // In Electron, we use API key auth instead of Paddle subscriptions.
    // The stub returns a perpetually valid Pro license.
    const licenseStub = new ElectronLicenseServiceStub();
    container.register(TOKENS.LICENSE_SERVICE, { useValue: licenseStub });

    // ========================================
    // PHASE 1.2: Platform-agnostic vscode-core services
    // ========================================
    // These classes do NOT import vscode and can be used directly.

    // RpcHandler: RPC method routing with license middleware
    container.registerSingleton(TOKENS.RPC_HANDLER, RpcHandler);

    // MessageValidatorService: Zod-based message validation
    container.registerSingleton(
      TOKENS.MESSAGE_VALIDATOR,
      MessageValidatorService
    );

    // AgentSessionWatcherService: Real-time summary streaming (fs/events only)
    container.registerSingleton(
      TOKENS.AGENT_SESSION_WATCHER_SERVICE,
      AgentSessionWatcherService
    );

    // SubagentRegistryService: In-memory subagent lifecycle tracking
    container.registerSingleton(
      TOKENS.SUBAGENT_REGISTRY_SERVICE,
      SubagentRegistryService
    );

    // FeatureGateService: License tier feature gating
    container.registerSingleton(
      TOKENS.FEATURE_GATE_SERVICE,
      FeatureGateService
    );

    logger.info(
      '[Electron DI] Platform-agnostic vscode-core services registered',
      {
        services: [
          'RPC_HANDLER',
          'MESSAGE_VALIDATOR',
          'AGENT_SESSION_WATCHER_SERVICE',
          'SUBAGENT_REGISTRY_SERVICE',
          'FEATURE_GATE_SERVICE',
        ],
      }
    );

    // ========================================
    // PHASE 1.3: FILE_SYSTEM_MANAGER shim (required by workspace-intelligence)
    // ========================================
    // registerWorkspaceIntelligenceServices() checks container.isRegistered(TOKENS.FILE_SYSTEM_MANAGER)
    // and throws if missing. The real FileSystemManager imports vscode, so we provide
    // a shim that delegates to the platform-agnostic IFileSystemProvider already
    // registered in Phase 0 via platform-electron.
    try {
      const fileSystemProvider = container.resolve(
        PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER
      );
      container.register(TOKENS.FILE_SYSTEM_MANAGER, {
        useValue: fileSystemProvider,
      });
      logger.info(
        '[Electron DI] FILE_SYSTEM_MANAGER shim registered (delegates to IFileSystemProvider)'
      );
    } catch (error) {
      logger.error(
        '[Electron DI] Failed to register FILE_SYSTEM_MANAGER shim — workspace-intelligence services may fail',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    // ========================================
    // PHASE 1.4: EXTENSION_CONTEXT shim (required by agent-sdk + llm-abstraction)
    // ========================================
    // Many services inject TOKENS.EXTENSION_CONTEXT for globalState.get/update
    // and secrets.get/store/delete. Provide a shim that delegates to platform abstractions.
    try {
      const globalState = container.resolve<IStateStorage>(
        PLATFORM_TOKENS.STATE_STORAGE
      );
      const secretStorage = container.resolve<ISecretStorage>(
        PLATFORM_TOKENS.SECRET_STORAGE
      );
      const extensionContextShim = {
        globalState: {
          get: <T>(key: string): T | undefined => globalState.get<T>(key),
          update: async (key: string, value: unknown): Promise<void> => {
            await globalState.update(key, value);
          },
          keys: () => [] as readonly string[],
          setKeysForSync: () => {
            /* no-op in Electron */
          },
        },
        secrets: {
          get: async (key: string): Promise<string | undefined> =>
            secretStorage.get(key),
          store: async (key: string, value: string): Promise<void> =>
            secretStorage.store(key, value),
          delete: async (key: string): Promise<void> =>
            secretStorage.delete(key),
          onDidChange: {
            event: () => ({
              dispose: () => {
                /* no-op: Electron has no secret change events */
              },
            }),
          },
        },
        subscriptions: [] as { dispose: () => void }[],
        extensionUri: { fsPath: options.appPath, scheme: 'file' },
        globalStorageUri: {
          fsPath: options.userDataPath,
          scheme: 'file',
        },
        extensionPath: options.appPath,
        extensionMode: 1, // Production
      };
      container.register(TOKENS.EXTENSION_CONTEXT, {
        useValue: extensionContextShim,
      });
      logger.info(
        '[Electron DI] EXTENSION_CONTEXT shim registered (delegates to platform storage)'
      );
    } catch (error) {
      logger.error(
        '[Electron DI] Failed to register EXTENSION_CONTEXT shim — agent-sdk/llm services may fail',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    // ========================================
    // PHASE 2: Library Services
    // ========================================

    // Phase 2.1: Workspace Intelligence
    registerWorkspaceIntelligenceServices(container, logger);

    // Phase 2.2: Agent SDK (Claude Agent SDK integration)
    // NOTE: registerVsCodeLmToolsServices is SKIPPED (VS Code-specific MCP server)
    registerSdkServices(container, logger);

    // Phase 2.3: Agent Generation (template storage, setup wizard)
    registerAgentGenerationServices(container, logger);

    // Phase 2.4: Wire multi-phase analysis reader into EnhancedPromptsService
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
        '[Electron DI] Failed to wire multi-phase analysis reader into EnhancedPromptsService',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    // Phase 2.5: LLM Abstraction (multi-provider LLM)
    registerLlmAbstractionServices(container, logger);

    // Phase 2.6: Template Generation
    registerTemplateGenerationServices(container, logger);

    // ========================================
    // PHASE 3: Storage Adapters
    // ========================================

    // Storage adapter (workspace-scoped state storage)
    // Maps TOKENS.STORAGE_SERVICE to the platform-electron workspace state storage
    const workspaceStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE
    );
    const storageAdapter = {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        const value = workspaceStateStorage.get<T>(key);
        return value !== undefined ? value : defaultValue;
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        await workspaceStateStorage.update(key, value);
      },
    };
    container.register(TOKENS.STORAGE_SERVICE, { useValue: storageAdapter });

    // Global state adapter (for pricing cache - uses global state storage)
    const globalStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE
    );
    container.register(TOKENS.GLOBAL_STATE, { useValue: globalStateStorage });

    logger.info('[Electron DI] All services registered successfully');

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
}
