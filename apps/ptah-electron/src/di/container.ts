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
 * - Uses real LicenseService & AuthSecretsService (no runtime vscode dependency via `import type`)
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
 * INCLUDED (no runtime vscode import):
 *   - RpcHandler           - RPC method routing (depends on LicenseService)
 *   - MessageValidatorService - Zod-based message validation
 *   - AgentSessionWatcherService - Real-time summary streaming (uses fs/events)
 *   - SubagentRegistryService    - In-memory subagent lifecycle tracking
 *   - FeatureGateService         - License tier feature gating
 *   - LicenseService      - Uses `import type` for vscode (no runtime dep)
 *   - AuthSecretsService  - Uses `import type` for vscode (no runtime dep)
 *
 * EXCLUDED (imports vscode at runtime):
 *   - OutputManager       - Uses vscode.window.createOutputChannel
 *   - Logger              - Depends on OutputManager (vscode.ExtensionContext)
 *   - ErrorHandler        - Uses vscode.window.showErrorMessage
 *   - ConfigManager       - Uses vscode.workspace.getConfiguration
 *   - CommandManager      - Uses vscode.commands.registerCommand
 *   - WebviewManager      - Uses webview panel APIs
 *   - StatusBarManager    - Uses status bar APIs
 *   - FileSystemManager   - Uses vscode.workspace.fs
 *   - WebviewMessageHandlerService - Uses vscode webview messaging
 *   - PreferencesStorageService    - Uses vscode.ExtensionContext.workspaceState
 *
 * REPLACED (Electron-compatible alternatives):
 *   - OutputManager -> ElectronOutputManagerAdapter (wraps IOutputChannel)
 *   - Logger -> Standard Logger class (works with adapter)
 */

import 'reflect-metadata';
import * as path from 'path';
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

// vscode-core: TOKENS + service classes (LicenseService & AuthSecretsService
// use `import type` for vscode — no runtime vscode dependency)
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';

// Platform-agnostic vscode-core services (verified: no runtime vscode imports)
import { RpcHandler } from '@ptah-extension/vscode-core';
import { MessageValidatorService } from '@ptah-extension/vscode-core';
import { AgentSessionWatcherService } from '@ptah-extension/vscode-core';
import { SubagentRegistryService } from '@ptah-extension/vscode-core';
import { FeatureGateService } from '@ptah-extension/vscode-core';
import { LicenseService } from '@ptah-extension/vscode-core';
import { AuthSecretsService } from '@ptah-extension/vscode-core';

// Library registration functions (all accept container + logger, no vscode)
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import { registerSdkServices, SDK_TOKENS } from '@ptah-extension/agent-sdk';
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
} from './electron-adapters';

// Electron setup wizard service (TASK_2025_214)
import { ElectronSetupWizardService } from '../services/electron-setup-wizard.service';

// Workspace context management (TASK_2025_208)
import { WorkspaceContextManager } from '../services/workspace-context-manager';
import { WorkspaceAwareStateStorage } from '../services/workspace-aware-state-storage';

// Electron platform abstraction implementations (TASK_2025_203)
import {
  ElectronPlatformCommands,
  ElectronPlatformAuth,
  ElectronSaveDialog,
  ElectronModelDiscovery,
} from '../services/platform';

// Shared RPC handler classes (TASK_2025_203 Batch 5: all 16 shared handlers)
// These are platform-agnostic handlers that can be used in both VS Code and Electron.
// TASK_2025_209: LlmRpcHandlers now included (rewritten to be platform-agnostic).
import {
  SessionRpcHandlers,
  ChatRpcHandlers,
  ConfigRpcHandlers,
  AuthRpcHandlers,
  ContextRpcHandlers,
  SetupRpcHandlers,
  LicenseRpcHandlers,
  WizardGenerationRpcHandlers,
  AutocompleteRpcHandlers,
  SubagentRpcHandlers,
  PluginRpcHandlers,
  PtahCliRpcHandlers,
  EnhancedPromptsRpcHandlers,
  QualityRpcHandlers,
  ProviderRpcHandlers,
  LlmRpcHandlers,
} from '@ptah-extension/rpc-handlers';

// Electron-specific RPC handler classes (TASK_2025_203 Batch 5)
// TASK_2025_209: ElectronLlmRpcHandlers, ElectronChatExtendedRpcHandlers removed (unified into shared)
// Re-added: ElectronAgentRpcHandlers, ElectronSkillsShRpcHandlers, ElectronLayoutRpcHandlers
import {
  ElectronWorkspaceRpcHandlers,
  ElectronEditorRpcHandlers,
  ElectronFileRpcHandlers,
  ElectronConfigExtendedRpcHandlers,
  ElectronCommandRpcHandlers,
  ElectronAuthExtendedRpcHandlers,
  ElectronSettingsRpcHandlers,
  ElectronAgentRpcHandlers,
  ElectronSkillsShRpcHandlers,
  ElectronLayoutRpcHandlers,
} from '../services/rpc/handlers';

// Electron RPC Method Registration Service (TASK_2025_203 Batch 5)
import { ElectronRpcMethodRegistrationService } from '../services/rpc/rpc-method-registration.service';

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
    // PHASE 1.1: LicenseService (real implementation)
    // ========================================
    // RpcHandler depends on LicenseService for license validation middleware.
    // LicenseService uses `import type` for vscode — no runtime vscode dependency.
    // It resolves EXTENSION_CONTEXT (shimmed in Phase 1.5), LOGGER, and CONFIG_MANAGER.
    // Must be registered AFTER Phase 1.5 (EXTENSION_CONTEXT shim) — resolved lazily via singleton.
    container.registerSingleton(TOKENS.LICENSE_SERVICE, LicenseService);

    // ========================================
    // PHASE 1.1b: AuthSecretsService (real implementation)
    // ========================================
    // AuthSecretsService manages encrypted credential storage (OAuth tokens, API keys).
    // Uses `import type` for vscode — no runtime vscode dependency.
    // Resolves EXTENSION_CONTEXT (shimmed in Phase 1.5) which provides secrets storage.
    // Required by: AuthManager, SdkAgentAdapter, PtahCliRegistry, auth RPC handlers.
    container.registerSingleton(
      TOKENS.AUTH_SECRETS_SERVICE,
      AuthSecretsService
    );

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
    // PHASE 1.4: CONFIG_MANAGER shim (required by llm-abstraction, workspace-intelligence, agent-generation)
    // ========================================
    // ConfigManager wraps vscode.workspace.getConfiguration('ptah').
    // Services call config.get<T>(key) and config.update(key, value).
    // In Electron, we delegate to the workspace state storage.
    try {
      const configStorage = container.resolve<IStateStorage>(
        PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE
      );
      const configManagerShim = {
        get: <T>(key: string): T | undefined => {
          return configStorage.get<T>(`ptah.${key}`);
        },
        getWithDefault: <T>(key: string, defaultValue: T): T => {
          const value = configStorage.get<T>(`ptah.${key}`);
          return value !== undefined ? value : defaultValue;
        },
        getTyped: <T>(key: string): T | undefined => {
          return configStorage.get<T>(`ptah.${key}`);
        },
        getTypedWithDefault: <T>(
          key: string,
          _schema: unknown,
          defaultValue: T
        ): T => {
          const value = configStorage.get<T>(`ptah.${key}`);
          return value !== undefined ? value : defaultValue;
        },
        set: async <T>(key: string, value: T): Promise<void> => {
          await configStorage.update(`ptah.${key}`, value);
        },
        setTyped: async <T>(key: string, value: T): Promise<void> => {
          await configStorage.update(`ptah.${key}`, value);
        },
        update: async (key: string, value: unknown): Promise<void> => {
          await configStorage.update(`ptah.${key}`, value);
        },
        watch: (
          _key: string,
          _callback: (value: unknown) => void
        ): { dispose: () => void } => ({
          dispose: () => {
            /* no-op: Electron has no vscode config change events */
          },
        }),
        onDidChangeConfiguration: () => ({
          dispose: () => {
            /* no-op: Electron has no vscode config change events */
          },
        }),
      };
      container.register(TOKENS.CONFIG_MANAGER, {
        useValue: configManagerShim,
      });
      logger.info(
        '[Electron DI] CONFIG_MANAGER shim registered (delegates to workspace state storage)'
      );
    } catch (error) {
      logger.error('[Electron DI] Failed to register CONFIG_MANAGER shim', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // ========================================
    // PHASE 1.5: EXTENSION_CONTEXT shim (required by agent-sdk + llm-abstraction)
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
          onDidChange: (_listener: unknown) => ({
            dispose: () => {
              /* no-op: Electron has no secret change events */
            },
          }),
        },
        subscriptions: [] as { dispose: () => void }[],
        extensionUri: { fsPath: options.appPath, scheme: 'file' },
        globalStorageUri: {
          fsPath: options.userDataPath,
          scheme: 'file',
        },
        extensionPath: options.appPath,
        // vscode.ExtensionMode: 0 = Test, 1 = Production, 2 = Development
        // Use NODE_ENV to match the VS Code extension's behavior:
        // Development mode uses localhost:3000 for the license server.
        extensionMode: process.env['NODE_ENV'] === 'development' ? 2 : 1,
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
    // PHASE 1.6: WorkspaceAwareStateStorage + WorkspaceContextManager (TASK_2025_208)
    // ========================================
    // WorkspaceAwareStateStorage is a proxy implementing IStateStorage that
    // delegates to per-workspace ElectronStateStorage instances based on the
    // active workspace. This replaces the child container approach which didn't
    // work because RPC handler singletons inject WORKSPACE_STATE_STORAGE at
    // construction time.
    //
    // By registering this proxy as PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE
    // (overriding Phase 0's plain ElectronStateStorage), all services that
    // inject workspace-scoped storage automatically get workspace-aware routing.
    const defaultWorkspaceStoragePath = path.join(
      options.userDataPath,
      'workspace-storage',
      'default'
    );
    const workspaceAwareStorage = new WorkspaceAwareStateStorage(
      defaultWorkspaceStoragePath
    );

    // Override Phase 0's WORKSPACE_STATE_STORAGE with the workspace-aware proxy
    container.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
      useValue: workspaceAwareStorage,
    });

    const workspaceContextManager = new WorkspaceContextManager(
      options.userDataPath,
      workspaceAwareStorage
    );
    container.register(TOKENS.WORKSPACE_CONTEXT_MANAGER, {
      useValue: workspaceContextManager,
    });

    // Create initial workspace context for the startup workspace folder (if provided).
    // NOTE: createWorkspace/switchWorkspace are async (TASK_2025_208 Batch 5).
    // Container setup is synchronous, so we fire-and-forget with error logging.
    // The workspace will be available before any RPC calls arrive because
    // the IPC bridge + renderer are initialized later in main.ts.
    if (options.initialFolders && options.initialFolders.length > 0) {
      const initialPath = options.initialFolders[0];
      workspaceContextManager.createWorkspace(initialPath).then(
        (result) => {
          if (result.success) {
            workspaceContextManager.switchWorkspace(initialPath).then(
              () => {
                logger.info(
                  '[Electron DI] Initial workspace created and activated',
                  { path: initialPath }
                );
              },
              (err: unknown) => {
                logger.warn(
                  '[Electron DI] Failed to switch to initial workspace',
                  {
                    path: initialPath,
                    error: err instanceof Error ? err.message : String(err),
                  }
                );
              }
            );
          } else {
            logger.warn(
              '[Electron DI] Failed to create initial workspace — using default storage',
              { path: initialPath, error: result.error }
            );
          }
        },
        (err: unknown) => {
          logger.warn(
            '[Electron DI] Failed to create initial workspace — using default storage',
            {
              path: initialPath,
              error: err instanceof Error ? err.message : String(err),
            }
          );
        }
      );
    }

    logger.info(
      '[Electron DI] WorkspaceAwareStateStorage and WorkspaceContextManager registered (TASK_2025_208)'
    );

    // ========================================
    // PHASE 2: Library Services
    // ========================================

    // Phase 2.1: Workspace Intelligence
    registerWorkspaceIntelligenceServices(container, logger);

    // Phase 2.2: Agent SDK (Claude Agent SDK integration)
    // NOTE: registerVsCodeLmToolsServices is SKIPPED (VS Code-specific MCP server)
    registerSdkServices(container, logger);

    // Phase 2.2.5: WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR stubs (TASK_2025_214)
    // These tokens are required by WizardWebviewLifecycleService which is registered
    // unconditionally inside registerAgentGenerationServices(). In Electron, the wizard
    // uses ElectronSetupWizardService instead, so these are no-op stubs to prevent
    // DI resolution failures.
    try {
      container.register(TOKENS.WEBVIEW_MESSAGE_HANDLER, { useValue: {} });
      container.register(TOKENS.WEBVIEW_HTML_GENERATOR, { useValue: {} });
      logger.info(
        '[Electron DI] WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR stubs registered (TASK_2025_214)'
      );
    } catch (error) {
      logger.error(
        '[Electron DI] Failed to register webview stubs for WizardWebviewLifecycleService',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    // Phase 2.3: Agent Generation (template storage, setup wizard)
    registerAgentGenerationServices(container, logger);

    // Phase 2.3.5: Override SETUP_WIZARD_SERVICE with Electron-specific implementation (TASK_2025_214)
    // ElectronSetupWizardService uses IPC navigation (broadcastMessage) instead of
    // VS Code webview panels. Registered AFTER registerAgentGenerationServices() so
    // it overrides the default SetupWizardService at AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE.
    container.register(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, {
      useClass: ElectronSetupWizardService,
    });
    logger.info(
      '[Electron DI] ElectronSetupWizardService registered (overrides SetupWizardService) (TASK_2025_214)'
    );

    // Phase 2.4: Wire multi-phase analysis reader into EnhancedPromptsService
    // DEFERRED to main.ts Phase 4.6 (after WebviewManager registration)
    // Resolving EnhancedPromptsService here fails because the dependency chain
    // reaches SdkPermissionHandler which requires TOKENS.WEBVIEW_MANAGER,
    // and that is only registered in main.ts after IPC bridge initialization.

    // Phase 2.5: CLI Abstraction (TASK_2025_212: vestigial LLM services removed, CLI services only)
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

    // ========================================
    // PHASE 3.5: Platform Abstraction Implementations (TASK_2025_203)
    // ========================================
    // Must be registered BEFORE shared handler classes that depend on these tokens.
    // Each registration is individually wrapped to prevent a single failure from cascading.
    const platformAbstractions: Array<{
      token: symbol;
      impl: new (...args: unknown[]) => unknown;
      name: string;
    }> = [
      {
        token: TOKENS.PLATFORM_COMMANDS,
        impl: ElectronPlatformCommands as unknown as new (
          ...args: unknown[]
        ) => unknown,
        name: 'PLATFORM_COMMANDS',
      },
      {
        token: TOKENS.PLATFORM_AUTH_PROVIDER,
        impl: ElectronPlatformAuth as unknown as new (
          ...args: unknown[]
        ) => unknown,
        name: 'PLATFORM_AUTH_PROVIDER',
      },
      {
        token: TOKENS.SAVE_DIALOG_PROVIDER,
        impl: ElectronSaveDialog as unknown as new (
          ...args: unknown[]
        ) => unknown,
        name: 'SAVE_DIALOG_PROVIDER',
      },
      {
        token: TOKENS.MODEL_DISCOVERY,
        impl: ElectronModelDiscovery as unknown as new (
          ...args: unknown[]
        ) => unknown,
        name: 'MODEL_DISCOVERY',
      },
    ];

    const registeredAbstractions: string[] = [];
    for (const { token, impl, name } of platformAbstractions) {
      try {
        container.registerSingleton(token, impl);
        registeredAbstractions.push(name);
      } catch (error) {
        logger.error(
          `[Electron DI] Failed to register platform abstraction: ${name}`,
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    logger.info(
      '[Electron DI] Platform abstraction implementations registered (TASK_2025_203)',
      {
        services: registeredAbstractions,
      }
    );

    // ========================================
    // PHASE 4: CODE_EXECUTION_MCP stub (required by shared ChatRpcHandlers)
    // ========================================
    // ChatRpcHandlers injects TOKENS.CODE_EXECUTION_MCP for MCP server port detection.
    // In Electron, the Code Execution MCP server is not available, so we provide a stub.
    try {
      container.register(TOKENS.CODE_EXECUTION_MCP, {
        useValue: {
          getPort: () => null,
          ensureRegisteredForSubagents: () => {
            /* no-op in Electron */
          },
        },
      });
      logger.info(
        '[Electron DI] CODE_EXECUTION_MCP stub registered (Electron has no MCP server)'
      );
    } catch (error) {
      logger.error('[Electron DI] Failed to register CODE_EXECUTION_MCP stub', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // ========================================
    // PHASE 4.1: Shared RPC Handler Classes (TASK_2025_203 Batch 5, TASK_2025_209)
    // ========================================
    // Register all 16 shared handler classes from @ptah-extension/rpc-handlers.
    // TASK_2025_209: LlmRpcHandlers now included (rewritten to be platform-agnostic).
    container.registerSingleton(SessionRpcHandlers);
    container.registerSingleton(ChatRpcHandlers);
    container.registerSingleton(ConfigRpcHandlers);
    container.registerSingleton(AuthRpcHandlers);
    container.registerSingleton(ContextRpcHandlers);
    // SetupRpcHandlers requires container instance for lazy resolution of agent-generation services.
    // Must use factory pattern because DependencyContainer is an interface (no reflection metadata).
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
    container.registerSingleton(LicenseRpcHandlers);
    // WizardGenerationRpcHandlers requires container instance for lazy resolution.
    // Same factory pattern as SetupRpcHandlers.
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
    container.registerSingleton(AutocompleteRpcHandlers);
    container.registerSingleton(SubagentRpcHandlers);
    container.registerSingleton(PluginRpcHandlers);
    container.registerSingleton(PtahCliRpcHandlers);
    // EnhancedPromptsRpcHandlers requires container instance for lazy resolution.
    // Same factory pattern as SetupRpcHandlers.
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
    container.registerSingleton(QualityRpcHandlers);
    container.registerSingleton(ProviderRpcHandlers);
    // TASK_2025_209: LlmRpcHandlers now platform-agnostic, uses DependencyContainer for lazy resolution
    container.register(LlmRpcHandlers, {
      useFactory: (c) =>
        new LlmRpcHandlers(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c
        ),
    });

    logger.info(
      '[Electron DI] Shared RPC handler classes registered (TASK_2025_203 Batch 5, TASK_2025_209)',
      {
        handlers: [
          'SessionRpcHandlers',
          'ChatRpcHandlers',
          'ConfigRpcHandlers',
          'AuthRpcHandlers',
          'ContextRpcHandlers',
          'SetupRpcHandlers',
          'LicenseRpcHandlers',
          'WizardGenerationRpcHandlers',
          'AutocompleteRpcHandlers',
          'SubagentRpcHandlers',
          'PluginRpcHandlers',
          'PtahCliRpcHandlers',
          'EnhancedPromptsRpcHandlers',
          'QualityRpcHandlers',
          'ProviderRpcHandlers',
          'LlmRpcHandlers',
        ],
      }
    );

    // ========================================
    // PHASE 4.2: Electron-specific RPC Handler Classes (TASK_2025_203 Batch 5)
    // ========================================
    container.registerSingleton(ElectronWorkspaceRpcHandlers);
    // ElectronEditorRpcHandlers requires container for lazy resolution.
    // Must use factory pattern because DependencyContainer is an interface (no reflection metadata).
    container.register(ElectronEditorRpcHandlers, {
      useFactory: (c) =>
        new ElectronEditorRpcHandlers(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c.resolve(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER),
          c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
          c
        ),
    });
    container.registerSingleton(ElectronFileRpcHandlers);
    // TASK_2025_209: ElectronLlmRpcHandlers, ElectronChatExtendedRpcHandlers, ElectronAgentRpcHandlers
    // removed (unified into shared LlmRpcHandlers and ChatRpcHandlers)
    // ElectronConfigExtendedRpcHandlers requires container for lazy resolution.
    // Same factory pattern as above.
    container.register(ElectronConfigExtendedRpcHandlers, {
      useFactory: (c) =>
        new ElectronConfigExtendedRpcHandlers(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c
        ),
    });
    container.registerSingleton(ElectronCommandRpcHandlers);
    container.registerSingleton(ElectronAuthExtendedRpcHandlers);
    container.registerSingleton(ElectronSettingsRpcHandlers);
    container.registerSingleton(ElectronAgentRpcHandlers);
    container.registerSingleton(ElectronSkillsShRpcHandlers);
    container.registerSingleton(ElectronLayoutRpcHandlers);

    // Register the orchestrator itself
    container.registerSingleton(ElectronRpcMethodRegistrationService);

    logger.info(
      '[Electron DI] Electron-specific RPC handler classes registered (TASK_2025_203 Batch 5, TASK_2025_209)',
      {
        handlers: [
          'ElectronWorkspaceRpcHandlers',
          'ElectronEditorRpcHandlers',
          'ElectronFileRpcHandlers',
          'ElectronConfigExtendedRpcHandlers',
          'ElectronCommandRpcHandlers',
          'ElectronAuthExtendedRpcHandlers',
          'ElectronSettingsRpcHandlers',
          'ElectronAgentRpcHandlers',
          'ElectronSkillsShRpcHandlers',
          'ElectronLayoutRpcHandlers',
        ],
      }
    );

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
