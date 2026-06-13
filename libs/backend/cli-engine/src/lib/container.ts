/**
 * TUI DI Container Orchestrator
 *
 * Mirrors the Electron ElectronDIContainer.setup() pattern but registers
 * CLI-specific adaptations instead of Electron-specific ones.
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
  registerCliSettings,
  CliStateStorage,
  CliWorkspaceProvider,
  type CliPlatformOptions,
} from '@ptah-extension/platform-cli';
import {
  PLATFORM_TOKENS,
  isFileBasedSettingKey,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import type {
  IOutputChannel,
  IStateStorage,
  ISecretStorage,
} from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { registerVsCodeCorePlatformAgnostic } from '@ptah-extension/vscode-core';
import { LicenseService } from '@ptah-extension/vscode-core';
import { GitInfoService } from '@ptah-extension/vscode-core';
import {
  WorkspaceAwareStateStorage,
  WorkspaceContextManager,
} from '@ptah-extension/vscode-core';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import {
  registerSdkServices,
  SDK_TOKENS,
  wireAgentAdapterAliases,
} from '@ptah-extension/agent-sdk';
import { registerAuthProvidersServices } from '@ptah-extension/auth-providers';
import { registerCliAgentRuntimeServices } from '@ptah-extension/cli-agent-runtime';
import type { PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  registerAgentGenerationServices,
  AGENT_GENERATION_TOKENS,
} from '@ptah-extension/agent-generation';
import type {
  EnhancedPromptsService,
  IMultiPhaseAnalysisReader,
} from '@ptah-extension/agent-generation';
import {
  registerVsCodeLmToolsServices,
  BROWSER_CAPABILITIES_TOKEN,
} from '@ptah-extension/vscode-lm-tools';
import {
  SessionRpcHandlers,
  ChatRpcHandlers,
  ConfigRpcHandlers,
  AuthRpcHandlers,
  ContextRpcHandlers,
  LicenseRpcHandlers,
  AutocompleteRpcHandlers,
  SubagentRpcHandlers,
  PluginRpcHandlers,
  PtahCliRpcHandlers,
  QualityRpcHandlers,
  ProviderRpcHandlers,
  WebSearchRpcHandlers,
  WorkspaceRpcHandlers,
  activateSessionLifecycleNotifier,
  registerSharedRpcHandlers,
} from '@ptah-extension/rpc-handlers';
import {
  CliOutputManagerAdapter,
  CliLoggerAdapter,
} from './adapters/cli-adapters';
import {
  CliPlatformCommands,
  CliPlatformAuth,
  CliSaveDialog,
  CliModelDiscovery,
} from './platform';
import { CliMessageTransport } from './transport/cli-message-transport';
import { CliWebviewManagerAdapter } from './transport/cli-webview-manager-adapter';
import { CliFireAndForgetHandler } from './transport/cli-fire-and-forget-handler';
import { CliRpcMethodRegistrationService } from './rpc/cli-rpc-method-registration.service';
import { registerThothLibraries } from './thoth/register-thoth-libraries';

/**
 * Options for bootstrapping the CLI DI container.
 */
export interface CliBootstrapOptions {
  /** Application entry point path. Defaults to __dirname. */
  appPath?: string;
  /** User data directory. Defaults to ~/.ptah/ */
  userDataPath?: string;
  /** Workspace directory. Defaults to process.cwd() */
  workspacePath?: string;
  /** Log file directory. Defaults to ~/.ptah/logs/ */
  logsPath?: string;
  /**
   * Bootstrap depth — `'minimal'` skips Phase 4.x RPC handler registration
   * (used by read-only commands that only need platform + storage adapters).
   * `'full'` mirrors Electron's phase-4-handlers.ts and registers every
   * shared RPC handler. Defaults to `'full'`.
   */
  bootstrapMode?: 'minimal' | 'full';
  /**
   * When true, emit `debug.di.phase` notifications via `pushAdapter` at the
   * start AND end of every numbered DI phase. Consumed by the JSON-RPC
   * event-pipe under the global `--verbose` flag.
   */
  verbose?: boolean;
  pushAdapter?: CliWebviewManagerAdapter;
}

/**
 * Result of CliDIContainer.setup() -- all services needed by main.tsx and
 * React components to interact with the backend.
 */
export interface CliBootstrapResult {
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
export class CliDIContainer {
  /**
   * The PtahFileSettingsManager instance shared with CliWorkspaceProvider.
   * Stored statically so process.on('exit', ...) in main.ts can call
   * flushSync() without needing an async reference into the container.
   * Undefined before setup() is called.
   */
  private static _fileSettings: { flushSync(): void } | undefined;

  /**
   * Synchronously flush any pending file-based settings writes to disk.
   * Safe to call from process.on('exit', ...) — never throws.
   * No-op if setup() has not been called yet.
   */
  static flushSync(): void {
    CliDIContainer._fileSettings?.flushSync();
  }

  /**
   * Setup and orchestrate all service registrations for the TUI.
   *
   * @param options - Bootstrap options (paths)
   * @returns Configured container, transport, push adapter, and fire-and-forget handler
   */
  static setup(options: CliBootstrapOptions = {}): CliBootstrapResult {
    const container = globalContainer.createChildContainer();

    container.register(PLATFORM_TOKENS.DI_CONTAINER, { useValue: container });
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
    const bootstrapMode: 'minimal' | 'full' = options.bootstrapMode ?? 'full';
    const verbose: boolean = options.verbose === true;
    const pushAdapter = options.pushAdapter ?? new CliWebviewManagerAdapter();
    container.register(TOKENS.WEBVIEW_MANAGER, { useValue: pushAdapter });

    /**
     * Phase boundary helpers — emit `debug.di.phase` notifications when
     * `verbose === true`. Each `phaseStart` returns the start timestamp so
     * `phaseEnd` can compute `durationMs`.
     */
    const phaseStart = (n: string): number => {
      if (verbose) {
        pushAdapter.emit('debug.di.phase', { phase: n, state: 'start' });
      }
      return Date.now();
    };
    const phaseEnd = (n: string, startMs: number): void => {
      if (verbose) {
        pushAdapter.emit('debug.di.phase', {
          phase: n,
          state: 'end',
          durationMs: Date.now() - startMs,
        });
      }
    };
    const phase0Start = phaseStart('0');
    registerPlatformCliServices(container, platformOptions);
    phaseEnd('0', phase0Start);
    const phase1Start = phaseStart('1');
    const outputChannel = container.resolve<IOutputChannel>(
      PLATFORM_TOKENS.OUTPUT_CHANNEL,
    );
    const outputManager = new CliOutputManagerAdapter(outputChannel);
    container.register(TOKENS.OUTPUT_MANAGER, { useValue: outputManager });
    const loggerAdapter = new CliLoggerAdapter(outputManager);
    const logger = loggerAdapter as unknown as Logger;
    container.register(TOKENS.LOGGER, { useValue: logger });

    logger.info('[CLI DI] Starting service registration...');
    registerVsCodeCorePlatformAgnostic(container, logger, {
      includeLicensingAndAuth: true,
    });
    container.register(TOKENS.GIT_INFO_SERVICE, {
      useFactory: (c) => new GitInfoService(c.resolve(TOKENS.LOGGER)),
    });
    const defaultWorkspaceStoragePath = path.join(
      userDataPath,
      'workspace-storage',
      'default',
    );
    const workspaceAwareStorage = new WorkspaceAwareStateStorage(
      defaultWorkspaceStoragePath,
      (storageDirPath) =>
        new CliStateStorage(storageDirPath, 'workspace-state.json'),
    );
    container.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
      useValue: workspaceAwareStorage,
    });

    const workspaceContextManager = new WorkspaceContextManager(
      userDataPath,
      workspaceAwareStorage,
    );
    container.register(TOKENS.WORKSPACE_CONTEXT_MANAGER, {
      useValue: workspaceContextManager,
    });
    workspaceContextManager.createWorkspace(workspacePath).then(
      (result) => {
        if ('error' in result) {
          logger.warn(
            '[CLI DI] Failed to create initial workspace context (non-fatal)',
            { error: result.error } as unknown as Error,
          );
          return;
        }
        workspaceAwareStorage.setActiveWorkspace(path.resolve(workspacePath));
      },
      (error) => {
        logger.warn(
          '[CLI DI] Failed to create initial workspace context (non-fatal)',
          {
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error,
        );
      },
    );

    logger.info('[CLI DI] Platform-agnostic vscode-core services registered');
    try {
      const fileSystemProvider = container.resolve(
        PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER,
      );
      container.register(TOKENS.FILE_SYSTEM_MANAGER, {
        useValue: fileSystemProvider,
      });
      logger.info(
        '[CLI DI] FILE_SYSTEM_MANAGER shim registered (delegates to IFileSystemProvider)',
      );
    } catch (error) {
      logger.error(
        '[CLI DI] Failed to register FILE_SYSTEM_MANAGER shim',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    try {
      const configStorage = container.resolve<IStateStorage>(
        PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
      );
      const workspaceProvider = container.resolve<CliWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      );
      const fileSettings = workspaceProvider.fileSettings;
      CliDIContainer._fileSettings = fileSettings;
      const configManagerShim = {
        get: <T>(key: string): T | undefined => {
          if (isFileBasedSettingKey(key)) {
            return fileSettings.get<T>(key);
          }
          return configStorage.get<T>(`ptah.${key}`);
        },
        getWithDefault: <T>(key: string, defaultValue: T): T => {
          if (isFileBasedSettingKey(key)) {
            return fileSettings.get<T>(key, defaultValue) ?? defaultValue;
          }
          const value = configStorage.get<T>(`ptah.${key}`);
          return value !== undefined ? value : defaultValue;
        },
        getTyped: <T>(key: string): T | undefined => {
          if (isFileBasedSettingKey(key)) {
            return fileSettings.get<T>(key);
          }
          return configStorage.get<T>(`ptah.${key}`);
        },
        getTypedWithDefault: <T>(
          key: string,
          _schema: unknown,
          defaultValue: T,
        ): T => {
          if (isFileBasedSettingKey(key)) {
            return fileSettings.get<T>(key, defaultValue) ?? defaultValue;
          }
          const value = configStorage.get<T>(`ptah.${key}`);
          return value !== undefined ? value : defaultValue;
        },
        set: async <T>(key: string, value: T): Promise<void> => {
          if (isFileBasedSettingKey(key)) {
            await fileSettings.set(key, value);
            return;
          }
          await configStorage.update(`ptah.${key}`, value);
        },
        setTyped: async <T>(key: string, value: T): Promise<void> => {
          if (isFileBasedSettingKey(key)) {
            await fileSettings.set(key, value);
            return;
          }
          await configStorage.update(`ptah.${key}`, value);
        },
        update: async (key: string, value: unknown): Promise<void> => {
          if (isFileBasedSettingKey(key)) {
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
        '[CLI DI] CONFIG_MANAGER shim registered (delegates to workspace state storage + file-based settings)',
      );
    } catch (error) {
      logger.error(
        '[CLI DI] Failed to register CONFIG_MANAGER shim',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
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
        extensionMode: process.env['NODE_ENV'] === 'development' ? 2 : 1,
      };
      container.register(TOKENS.EXTENSION_CONTEXT, {
        useValue: extensionContextShim,
      });
      logger.info(
        '[CLI DI] EXTENSION_CONTEXT shim registered (delegates to platform storage)',
      );
    } catch (error) {
      logger.error(
        '[CLI DI] Failed to register EXTENSION_CONTEXT shim',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    try {
      const licenseService = container.resolve<LicenseService>(
        TOKENS.LICENSE_SERVICE,
      );
      licenseService.seedCommunityStatus();
    } catch (error) {
      logger.warn(
        '[CLI DI] Failed to seed community license (non-fatal)',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    phaseEnd('1', phase1Start);
    const phase2Start = phaseStart('2');
    registerWorkspaceIntelligenceServices(container, logger);
    registerAuthProvidersServices(container, logger);
    registerSdkServices(container, logger);
    registerCliAgentRuntimeServices(container, logger);

    wireAgentAdapterAliases(container);

    try {
      container.register(TOKENS.WEBVIEW_MESSAGE_HANDLER, { useValue: {} });
      container.register(TOKENS.WEBVIEW_HTML_GENERATOR, { useValue: {} });
      logger.info(
        '[CLI DI] WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR stubs registered',
      );
    } catch (error) {
      logger.error(
        '[CLI DI] Failed to register webview stubs for WizardWebviewLifecycleService',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    registerAgentGenerationServices(container, logger);
    container.register(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, {
      useValue: {
        startWizard: async () => {
          /* no-op: CLI has no setup wizard */
        },
      },
    });
    logger.info(
      '[CLI DI] SETUP_WIZARD_SERVICE stub registered (no setup wizard in CLI)',
    );

    registerThothLibraries(container, logger);

    phaseEnd('2', phase2Start);
    const phase3Start = phaseStart('3');
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
    const globalStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    container.register(TOKENS.GLOBAL_STATE, { useValue: globalStateStorage });

    phaseEnd('3', phase3Start);
    const phase3_5Start = phaseStart('3.5');
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

    logger.info('[CLI DI] Platform abstraction implementations registered');

    phaseEnd('3.5', phase3_5Start);
    try {
      registerCliSettings(container, userDataPath);
      logger.info(
        '[CLI DI] Settings repositories registered (SETTINGS_TOKENS)',
      );
    } catch (settingsRegError) {
      logger.error(
        '[CLI DI] Failed to register settings repositories',
        settingsRegError instanceof Error
          ? settingsRegError
          : new Error(String(settingsRegError)),
      );
      throw settingsRegError;
    }
    if (bootstrapMode === 'full') {
      const phase4Start = phaseStart('4');
      registerVsCodeLmToolsServices(container, logger);
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
      container.registerSingleton(SessionRpcHandlers);
      container.registerSingleton(ChatRpcHandlers);
      container.registerSingleton(ConfigRpcHandlers);
      container.registerSingleton(AuthRpcHandlers);
      container.registerSingleton(ContextRpcHandlers);
      container.registerSingleton(LicenseRpcHandlers);
      container.registerSingleton(AutocompleteRpcHandlers);
      container.registerSingleton(SubagentRpcHandlers);
      container.registerSingleton(PluginRpcHandlers);
      container.registerSingleton(PtahCliRpcHandlers);
      container.registerSingleton(QualityRpcHandlers);
      container.registerSingleton(ProviderRpcHandlers);
      container.registerSingleton(WebSearchRpcHandlers);
      container.registerSingleton(WorkspaceRpcHandlers);
      registerSharedRpcHandlers(container);
      activateSessionLifecycleNotifier(container);

      logger.info('[CLI DI] Shared RPC handler classes registered (18)');

      const enhancedPrompts = container.resolve<EnhancedPromptsService>(
        AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE,
      );
      const analysisStorage = container.resolve<IMultiPhaseAnalysisReader>(
        AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
      );
      enhancedPrompts.setAnalysisReader(analysisStorage);
      logger.info('[CLI DI] EnhancedPrompts analysis reader wired');
      try {
        const contentDownload = container.resolve<ContentDownloadService>(
          PLATFORM_TOKENS.CONTENT_DOWNLOAD,
        );
        contentDownload.ensureContent().then(
          (result) => {
            if (!result.success) {
              logger.warn('[CLI DI] Content download incomplete', {
                error: result.error,
              } as unknown as Error);
            } else {
              logger.info('[CLI DI] Content download complete');
            }
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
              logger.info('[CLI DI] PluginLoaderService initialized');
            } catch (pluginError) {
              logger.warn(
                '[CLI DI] Failed to initialize PluginLoaderService (non-fatal)',
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
            logger.warn('[CLI DI] Content download failed (non-fatal)', {
              error: error instanceof Error ? error.message : String(error),
            } as unknown as Error);
          },
        );
      } catch (error) {
        logger.warn('[CLI DI] Failed to start content download (non-fatal)', {
          error: error instanceof Error ? error.message : String(error),
        } as unknown as Error);
      }
      try {
        const registration = new CliRpcMethodRegistrationService(container);
        registration.registerAll();
      } catch (error) {
        logger.error(
          '[CLI DI] RPC method registration failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }

      phaseEnd('4', phase4Start);
    } else {
      logger.info(
        '[CLI DI] bootstrapMode=minimal — Phase 4 (RPC handlers) skipped',
      );
    }

    logger.info('[CLI DI] All services registered successfully');
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
