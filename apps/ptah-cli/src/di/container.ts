/**
 * TUI DI Container Orchestrator
 *
 * TASK_2025_263 Batch 3: Mirrors the Electron ElectronDIContainer.setup() pattern
 * but registers CLI-specific adaptations instead of Electron-specific ones.
 *
 * CRITICAL DESIGN DECISIONS:
 * - DOES NOT call registerVsCodeCoreServices() (it imports the vscode module)
 * - Manually registers platform-agnostic vscode-core services
 * - Uses platform-cli providers instead of Electron or VS Code API wrappers
 * - Uses real LicenseService & AuthSecretsService (no runtime vscode dependency via `import type`)
 * - Provides a TUI-compatible OutputManager that delegates to IOutputChannel
 *
 * Phase-based registration order mirrors Electron container:
 *   Phase 0:   Platform abstraction layer (platform-cli)
 *   Phase 1:   Logger + platform-agnostic vscode-core services
 *   Phase 2:   Library services (workspace-intelligence, agent-sdk, etc.)
 *   Phase 3:   Storage adapters
 *   Phase 3.5: Platform abstraction implementations
 *   Phase 4:   WebviewManager + RPC handler classes
 */

import 'reflect-metadata';
import * as path from 'path';
import * as os from 'os';
import {
  container as globalContainer,
  type DependencyContainer,
} from 'tsyringe';

import {
  registerPlatformCliServices,
  type CliPlatformOptions,
} from '@ptah-extension/platform-cli';
import {
  PLATFORM_TOKENS,
  PtahFileSettingsManager,
  FILE_BASED_SETTINGS_KEYS,
  FILE_BASED_SETTINGS_DEFAULTS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import type {
  IOutputChannel,
  IStateStorage,
  ISecretStorage,
} from '@ptah-extension/platform-core';

// vscode-core: TOKENS + service classes (LicenseService & AuthSecretsService
// use `import type` for vscode -- no runtime vscode dependency)
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
import { SentryService } from '@ptah-extension/vscode-core';

// Library registration functions (all accept container + logger, no vscode)
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import { registerSdkServices, SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type {
  EnhancedPromptsService,
  IMultiPhaseAnalysisReader,
  PluginLoaderService,
  SdkAgentAdapter,
} from '@ptah-extension/agent-sdk';
import {
  registerAgentGenerationServices,
  AGENT_GENERATION_TOKENS,
} from '@ptah-extension/agent-generation';
import {
  registerVsCodeLmToolsServices,
  BROWSER_CAPABILITIES_TOKEN,
} from '@ptah-extension/vscode-lm-tools';

// Shared RPC handler classes (all 17 shared handlers)
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
  WebSearchRpcHandlers,
} from '@ptah-extension/rpc-handlers';

// TUI adapters
import { TuiOutputManagerAdapter, TuiLoggerAdapter } from './tui-adapters';

// CLI platform abstraction implementations
import {
  CliPlatformCommands,
  CliPlatformAuth,
  CliSaveDialog,
  CliModelDiscovery,
} from '../services/platform';

// Transport
import { CliMessageTransport } from '../transport/cli-message-transport';
import { CliWebviewManagerAdapter } from '../transport/cli-webview-manager-adapter';
import { CliFireAndForgetHandler } from '../transport/cli-fire-and-forget-handler';

/**
 * Options for bootstrapping the TUI DI container.
 */
export interface TuiBootstrapOptions {
  /** Application entry point path. Defaults to __dirname. */
  appPath?: string;
  /** User data directory. Defaults to ~/.ptah/ */
  userDataPath?: string;
  /** Workspace directory. Defaults to process.cwd() */
  workspacePath?: string;
  /** Log file directory. Defaults to ~/.ptah/logs/ */
  logsPath?: string;
}

/**
 * Result of TuiDIContainer.setup() -- all services needed by main.tsx and
 * React components to interact with the backend.
 */
export interface TuiBootstrapResult {
  container: DependencyContainer;
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
  logger: Logger;
}

/**
 * TUI DI Container Orchestrator
 *
 * Mirrors the Electron ElectronDIContainer but registers only platform-agnostic
 * services and uses CLI-compatible replacements for VS Code/Electron-specific ones.
 */
export class TuiDIContainer {
  /**
   * Setup and orchestrate all service registrations for the TUI.
   *
   * @param options - Bootstrap options (paths)
   * @returns Configured container, transport, push adapter, and fire-and-forget handler
   */
  static setup(options: TuiBootstrapOptions = {}): TuiBootstrapResult {
    const container = globalContainer;

    // Resolve default paths
    const userDataPath =
      options.userDataPath ?? path.join(os.homedir(), '.ptah');
    const appPath = options.appPath ?? __dirname;
    const workspacePath = options.workspacePath ?? process.cwd();
    const logsPath = options.logsPath ?? path.join(userDataPath, 'logs');

    const platformOptions: CliPlatformOptions = {
      appPath,
      userDataPath,
      workspacePath,
      logsPath,
    };

    // ========================================
    // PHASE 0: Platform Abstraction Layer
    // ========================================
    // Register all 13 platform tokens (IPlatformInfo + providers + WORKSPACE_STATE_STORAGE)
    // MUST be before any library services (they inject PLATFORM_TOKENS)
    registerPlatformCliServices(container, platformOptions);

    // ========================================
    // PHASE 1.0: OutputManager adapter + Logger adapter
    // ========================================
    const outputChannel = container.resolve<IOutputChannel>(
      PLATFORM_TOKENS.OUTPUT_CHANNEL,
    );
    const outputManager = new TuiOutputManagerAdapter(outputChannel);
    container.register(TOKENS.OUTPUT_MANAGER, { useValue: outputManager });

    // Logger adapter: uses TuiOutputManagerAdapter instead of VS Code OutputManager.
    // Cast to Logger type so library registration functions accept it.
    const loggerAdapter = new TuiLoggerAdapter(outputManager);
    const logger = loggerAdapter as unknown as Logger;
    container.register(TOKENS.LOGGER, { useValue: logger });

    logger.info('[TUI DI] Starting service registration...');

    // ========================================
    // PHASE 1.0b: SentryService (opt-in; uninitialized until SENTRY_DSN is set)
    // ========================================
    // Wave C4b: shared RPC handler factories require TOKENS.SENTRY_SERVICE.
    // The service is a no-op until `initialize()` is called with a DSN, so
    // registering it unconditionally is safe for the CLI.
    container.registerSingleton(TOKENS.SENTRY_SERVICE, SentryService);

    // ========================================
    // PHASE 1.1: LicenseService + AuthSecretsService (real implementations)
    // ========================================
    container.registerSingleton(TOKENS.LICENSE_SERVICE, LicenseService);
    container.registerSingleton(
      TOKENS.AUTH_SECRETS_SERVICE,
      AuthSecretsService,
    );

    // ========================================
    // PHASE 1.2: Platform-agnostic vscode-core services
    // ========================================
    container.registerSingleton(TOKENS.RPC_HANDLER, RpcHandler);
    container.registerSingleton(
      TOKENS.MESSAGE_VALIDATOR,
      MessageValidatorService,
    );
    container.registerSingleton(
      TOKENS.AGENT_SESSION_WATCHER_SERVICE,
      AgentSessionWatcherService,
    );
    container.registerSingleton(
      TOKENS.SUBAGENT_REGISTRY_SERVICE,
      SubagentRegistryService,
    );
    container.registerSingleton(
      TOKENS.FEATURE_GATE_SERVICE,
      FeatureGateService,
    );

    logger.info('[TUI DI] Platform-agnostic vscode-core services registered');

    // ========================================
    // PHASE 1.3: FILE_SYSTEM_MANAGER shim (required by workspace-intelligence)
    // ========================================
    try {
      const fileSystemProvider = container.resolve(
        PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER,
      );
      container.register(TOKENS.FILE_SYSTEM_MANAGER, {
        useValue: fileSystemProvider,
      });
      logger.info(
        '[TUI DI] FILE_SYSTEM_MANAGER shim registered (delegates to IFileSystemProvider)',
      );
    } catch (error) {
      logger.error(
        '[TUI DI] Failed to register FILE_SYSTEM_MANAGER shim',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // ========================================
    // PHASE 1.4: CONFIG_MANAGER shim (required by llm-abstraction, workspace-intelligence)
    // ========================================
    try {
      const configStorage = container.resolve<IStateStorage>(
        PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
      );
      const fileSettings = new PtahFileSettingsManager(
        FILE_BASED_SETTINGS_DEFAULTS,
      );
      const configManagerShim = {
        get: <T>(key: string): T | undefined => {
          if (FILE_BASED_SETTINGS_KEYS.has(key)) {
            return fileSettings.get<T>(key);
          }
          return configStorage.get<T>(`ptah.${key}`);
        },
        getWithDefault: <T>(key: string, defaultValue: T): T => {
          if (FILE_BASED_SETTINGS_KEYS.has(key)) {
            return fileSettings.get<T>(key, defaultValue) ?? defaultValue;
          }
          const value = configStorage.get<T>(`ptah.${key}`);
          return value !== undefined ? value : defaultValue;
        },
        getTyped: <T>(key: string): T | undefined => {
          if (FILE_BASED_SETTINGS_KEYS.has(key)) {
            return fileSettings.get<T>(key);
          }
          return configStorage.get<T>(`ptah.${key}`);
        },
        getTypedWithDefault: <T>(
          key: string,
          _schema: unknown,
          defaultValue: T,
        ): T => {
          if (FILE_BASED_SETTINGS_KEYS.has(key)) {
            return fileSettings.get<T>(key, defaultValue) ?? defaultValue;
          }
          const value = configStorage.get<T>(`ptah.${key}`);
          return value !== undefined ? value : defaultValue;
        },
        set: async <T>(key: string, value: T): Promise<void> => {
          if (FILE_BASED_SETTINGS_KEYS.has(key)) {
            await fileSettings.set(key, value);
            return;
          }
          await configStorage.update(`ptah.${key}`, value);
        },
        setTyped: async <T>(key: string, value: T): Promise<void> => {
          if (FILE_BASED_SETTINGS_KEYS.has(key)) {
            await fileSettings.set(key, value);
            return;
          }
          await configStorage.update(`ptah.${key}`, value);
        },
        update: async (key: string, value: unknown): Promise<void> => {
          if (FILE_BASED_SETTINGS_KEYS.has(key)) {
            await fileSettings.set(key, value);
            return;
          }
          await configStorage.update(`ptah.${key}`, value);
        },
        watch: (
          _key: string,
          _callback: (value: unknown) => void,
        ): { dispose: () => void } => ({
          dispose: () => {
            /* no-op: CLI has no vscode config change events */
          },
        }),
        onDidChangeConfiguration: () => ({
          dispose: () => {
            /* no-op: CLI has no vscode config change events */
          },
        }),
      };
      container.register(TOKENS.CONFIG_MANAGER, {
        useValue: configManagerShim,
      });
      logger.info(
        '[TUI DI] CONFIG_MANAGER shim registered (delegates to workspace state storage + file-based settings)',
      );
    } catch (error) {
      logger.error(
        '[TUI DI] Failed to register CONFIG_MANAGER shim',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // ========================================
    // PHASE 1.5: EXTENSION_CONTEXT shim (required by agent-sdk + llm-abstraction)
    // ========================================
    try {
      const globalState = container.resolve<IStateStorage>(
        PLATFORM_TOKENS.STATE_STORAGE,
      );
      const secretStorage = container.resolve<ISecretStorage>(
        PLATFORM_TOKENS.SECRET_STORAGE,
      );
      const extensionContextShim = {
        globalState: {
          get: <T>(key: string): T | undefined => globalState.get<T>(key),
          update: async (key: string, value: unknown): Promise<void> => {
            await globalState.update(key, value);
          },
          keys: () => [] as readonly string[],
          setKeysForSync: () => {
            /* no-op in CLI */
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
              /* no-op: CLI has no secret change events */
            },
          }),
        },
        subscriptions: [] as { dispose: () => void }[],
        extensionUri: { fsPath: appPath, scheme: 'file' },
        globalStorageUri: { fsPath: userDataPath, scheme: 'file' },
        extensionPath: appPath,
        // vscode.ExtensionMode: 0 = Test, 1 = Production, 2 = Development
        extensionMode: process.env['NODE_ENV'] === 'development' ? 2 : 1,
      };
      container.register(TOKENS.EXTENSION_CONTEXT, {
        useValue: extensionContextShim,
      });
      logger.info(
        '[TUI DI] EXTENSION_CONTEXT shim registered (delegates to platform storage)',
      );
    } catch (error) {
      logger.error(
        '[TUI DI] Failed to register EXTENSION_CONTEXT shim',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // ========================================
    // PHASE 1.6: Seed community license (CLI has no registration gate)
    // ========================================
    // Must be after Phase 1.5 (EXTENSION_CONTEXT + CONFIG_MANAGER are required by LicenseService)
    try {
      const licenseService = container.resolve<LicenseService>(
        TOKENS.LICENSE_SERVICE,
      );
      licenseService.seedCommunityStatus();
    } catch (error) {
      logger.warn(
        '[TUI DI] Failed to seed community license (non-fatal)',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // ========================================
    // PHASE 2: Library Services
    // ========================================

    // Phase 2.1: Workspace Intelligence
    registerWorkspaceIntelligenceServices(container, logger);

    // Phase 2.2: Agent SDK (Claude Agent SDK integration)
    registerSdkServices(container, logger);

    // TOKENS.AGENT_ADAPTER -> SdkAgentAdapter (Wave C4b: shared wiring helpers
    // resolve via TOKENS.AGENT_ADAPTER; mirror VS Code / Electron pattern so
    // the helper sees the adapter when called from tui-rpc-method-registration).
    container.register(TOKENS.AGENT_ADAPTER, {
      useFactory: (c) =>
        c.resolve<SdkAgentAdapter>(SDK_TOKENS.SDK_AGENT_ADAPTER),
    });

    // Phase 2.2.5: WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR stubs
    // These tokens are required by WizardWebviewLifecycleService which is registered
    // unconditionally inside registerAgentGenerationServices(). In CLI, the wizard
    // is not used, so these are no-op stubs to prevent DI resolution failures.
    try {
      container.register(TOKENS.WEBVIEW_MESSAGE_HANDLER, { useValue: {} });
      container.register(TOKENS.WEBVIEW_HTML_GENERATOR, { useValue: {} });
      logger.info(
        '[TUI DI] WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR stubs registered',
      );
    } catch (error) {
      logger.error(
        '[TUI DI] Failed to register webview stubs for WizardWebviewLifecycleService',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // Phase 2.3: Agent Generation (template storage, setup wizard)
    registerAgentGenerationServices(container, logger);

    // Phase 2.3.5: Override SETUP_WIZARD_SERVICE with CLI-compatible stub
    // No setup wizard in CLI v1. Register a no-op stub.
    container.register(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, {
      useValue: {
        startWizard: async () => {
          /* no-op: CLI has no setup wizard */
        },
      },
    });
    logger.info(
      '[TUI DI] SETUP_WIZARD_SERVICE stub registered (no setup wizard in CLI)',
    );

    // TASK_2025_291 Wave C5: CLI agent services now registered by
    // registerSdkServices (earlier in Phase 2). The llm-abstraction
    // library has been deleted.

    // ========================================
    // PHASE 3: Storage Adapters
    // ========================================
    const workspaceStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
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
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    container.register(TOKENS.GLOBAL_STATE, { useValue: globalStateStorage });

    // ========================================
    // PHASE 3.5: Platform Abstraction Implementations
    // ========================================
    // Must be registered BEFORE shared handler classes that depend on these tokens.
    container.register(TOKENS.PLATFORM_COMMANDS, {
      useValue: new CliPlatformCommands(),
    });
    container.register(TOKENS.PLATFORM_AUTH_PROVIDER, {
      useValue: new CliPlatformAuth(),
    });
    container.register(TOKENS.SAVE_DIALOG_PROVIDER, {
      useValue: new CliSaveDialog(),
    });
    container.register(TOKENS.MODEL_DISCOVERY, {
      useValue: new CliModelDiscovery(),
    });

    logger.info('[TUI DI] Platform abstraction implementations registered');

    // ========================================
    // PHASE 4.0: WebviewManager (CliWebviewManagerAdapter)
    // ========================================
    // Must be registered BEFORE RPC handlers (they resolve TOKENS.WEBVIEW_MANAGER
    // during .register() for push event wiring).
    const pushAdapter = new CliWebviewManagerAdapter();
    container.register(TOKENS.WEBVIEW_MANAGER, { useValue: pushAdapter });

    logger.info(
      '[TUI DI] CliWebviewManagerAdapter registered as WEBVIEW_MANAGER',
    );

    // ========================================
    // PHASE 4.0.5: vscode-lm-tools services
    // ========================================
    registerVsCodeLmToolsServices(container, logger);

    // ========================================
    // PHASE 4.0.6: Browser capabilities stub (no CDP browser in CLI v1)
    // ========================================
    container.register(BROWSER_CAPABILITIES_TOKEN, {
      useValue: {
        launch: async () => {
          throw new Error('Browser automation not available in CLI');
        },
        close: async () => {
          /* no-op: no browser to close */
        },
        getStatus: () => ({ launched: false }),
      },
    });

    // ========================================
    // PHASE 4.1: Shared RPC Handler Classes (all 17)
    // ========================================
    container.registerSingleton(SessionRpcHandlers);
    container.registerSingleton(ChatRpcHandlers);
    container.registerSingleton(ConfigRpcHandlers);
    container.registerSingleton(AuthRpcHandlers);
    container.registerSingleton(ContextRpcHandlers);

    // SetupRpcHandlers requires container instance for lazy resolution.
    container.register(SetupRpcHandlers, {
      useFactory: (c) =>
        new SetupRpcHandlers(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c.resolve(TOKENS.CONFIG_MANAGER),
          c.resolve(SDK_TOKENS.SDK_PLUGIN_LOADER),
          c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
          c,
          c.resolve(TOKENS.SENTRY_SERVICE),
        ),
    });

    container.registerSingleton(LicenseRpcHandlers);

    // WizardGenerationRpcHandlers requires container instance for lazy resolution.
    container.register(WizardGenerationRpcHandlers, {
      useFactory: (c) =>
        new WizardGenerationRpcHandlers(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c.resolve(SDK_TOKENS.SDK_PLUGIN_LOADER),
          c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
          c,
          c.resolve(TOKENS.SENTRY_SERVICE),
        ),
    });

    container.registerSingleton(AutocompleteRpcHandlers);
    container.registerSingleton(SubagentRpcHandlers);
    container.registerSingleton(PluginRpcHandlers);
    container.registerSingleton(PtahCliRpcHandlers);

    // EnhancedPromptsRpcHandlers requires container instance for lazy resolution.
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
          c,
          c.resolve(TOKENS.SENTRY_SERVICE),
        ),
    });

    container.registerSingleton(QualityRpcHandlers);
    container.registerSingleton(ProviderRpcHandlers);

    // LlmRpcHandlers uses DependencyContainer for lazy resolution
    container.register(LlmRpcHandlers, {
      useFactory: (c) =>
        new LlmRpcHandlers(
          c.resolve(TOKENS.LOGGER),
          c.resolve(TOKENS.RPC_HANDLER),
          c,
          c.resolve(TOKENS.SENTRY_SERVICE),
        ),
    });

    container.registerSingleton(WebSearchRpcHandlers);

    logger.info('[TUI DI] Shared RPC handler classes registered (17)');

    // ========================================
    // PHASE 4.5: Wire EnhancedPrompts + analysis reader
    // ========================================
    try {
      const enhancedPrompts = container.resolve<EnhancedPromptsService>(
        SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE,
      );
      const analysisStorage = container.resolve<IMultiPhaseAnalysisReader>(
        AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
      );
      enhancedPrompts.setAnalysisReader(analysisStorage);
      logger.info('[TUI DI] EnhancedPrompts analysis reader wired');
    } catch {
      // Non-fatal: enhanced prompts may not be needed in all configurations
    }

    // ========================================
    // PHASE 4.6: Content download + plugin initialization
    // ========================================
    // Plugins and templates are downloaded from GitHub to ~/.ptah/ on first launch.
    // Fire-and-forget: activation continues immediately.
    try {
      const contentDownload = container.resolve<ContentDownloadService>(
        PLATFORM_TOKENS.CONTENT_DOWNLOAD,
      );
      contentDownload.ensureContent().then(
        (result) => {
          if (!result.success) {
            logger.warn('[TUI DI] Content download incomplete', {
              error: result.error,
            } as unknown as Error);
          } else {
            logger.info('[TUI DI] Content download complete');
          }

          // Initialize PluginLoaderService after content download
          try {
            const pluginLoader = container.resolve<PluginLoaderService>(
              SDK_TOKENS.SDK_PLUGIN_LOADER,
            );
            const wsStorage = container.resolve<IStateStorage>(
              PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
            );
            pluginLoader.initialize(
              contentDownload.getPluginsPath(),
              wsStorage,
            );
            logger.info('[TUI DI] PluginLoaderService initialized');
          } catch (pluginError) {
            logger.warn(
              '[TUI DI] Failed to initialize PluginLoaderService (non-fatal)',
              {
                error:
                  pluginError instanceof Error
                    ? pluginError.message
                    : String(pluginError),
              } as unknown as Error,
            );
          }
        },
        (error) => {
          logger.warn('[TUI DI] Content download failed (non-fatal)', {
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error);
        },
      );
    } catch (error) {
      logger.warn('[TUI DI] Failed to start content download (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
    }

    logger.info('[TUI DI] All services registered successfully');

    // ========================================
    // Build transport objects
    // ========================================
    const transport = new CliMessageTransport(container);
    const fireAndForget = new CliFireAndForgetHandler(container);

    return {
      container,
      transport,
      pushAdapter,
      fireAndForget,
      logger,
    };
  }
}
