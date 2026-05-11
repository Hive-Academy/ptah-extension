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

// vscode-core: TOKENS + service classes (LicenseService & AuthSecretsService
// use `import type` for vscode -- no runtime vscode dependency)
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';

// Platform-agnostic vscode-core services (verified: no runtime vscode imports)
import { RpcHandler } from '@ptah-extension/vscode-core';
import { MessageValidatorService } from '@ptah-extension/vscode-core';
import { SubagentRegistryService } from '@ptah-extension/vscode-core';
import { FeatureGateService } from '@ptah-extension/vscode-core';
import { LicenseService } from '@ptah-extension/vscode-core';
import { AuthSecretsService } from '@ptah-extension/vscode-core';
import { SentryService } from '@ptah-extension/vscode-core';
import { GitInfoService } from '@ptah-extension/vscode-core';
import {
  WorkspaceAwareStateStorage,
  WorkspaceContextManager,
} from '@ptah-extension/vscode-core';

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
  WorkspaceRpcHandlers,
} from '@ptah-extension/rpc-handlers';

// CLI adapters
import { CliOutputManagerAdapter, CliLoggerAdapter } from './cli-adapters';

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

// RPC method registration — wires the handler classes' `METHODS` tuples into
// the RpcHandler so the in-process dispatch can find them.
import { CliRpcMethodRegistrationService } from '../services/cli-rpc-method-registration.service';

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
   *
   * TASK_2026_104 Batch 4 — Discovery D12.
   */
  bootstrapMode?: 'minimal' | 'full';
  /**
   * When true, emit `debug.di.phase` notifications via `pushAdapter` at the
   * start AND end of every numbered DI phase. Consumed by the JSON-RPC
   * event-pipe under the global `--verbose` flag.
   *
   * TASK_2026_104 Batch 4 — task-description.md § 4.1.9.
   */
  verbose?: boolean;
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

    // Resolve mode flags. Defaults preserve backward-compatible behavior
    // (full bootstrap, no verbose diagnostics).
    const bootstrapMode: 'minimal' | 'full' = options.bootstrapMode ?? 'full';
    const verbose: boolean = options.verbose === true;

    // ========================================
    // PHASE 0a: pushAdapter (early — needed for `debug.di.phase` events)
    // ========================================
    // The adapter is registered into the container as TOKENS.WEBVIEW_MANAGER
    // later in Phase 4.0; we instantiate it now so verbose phase boundaries
    // can stream out from the very first phase. Subscribers attach via the
    // `CliBootstrapResult.pushAdapter` reference returned at the end.
    const pushAdapter = new CliWebviewManagerAdapter();

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

    // ========================================
    // PHASE 0: Platform Abstraction Layer
    // ========================================
    // Register all 13 platform tokens (IPlatformInfo + providers + WORKSPACE_STATE_STORAGE)
    // MUST be before any library services (they inject PLATFORM_TOKENS)
    const phase0Start = phaseStart('0');
    registerPlatformCliServices(container, platformOptions);
    phaseEnd('0', phase0Start);

    // ========================================
    // PHASE 1: Logger + Sentry + License + shims
    // ========================================
    const phase1Start = phaseStart('1');

    // ========================================
    // PHASE 1.0: OutputManager adapter + Logger adapter
    // ========================================
    const outputChannel = container.resolve<IOutputChannel>(
      PLATFORM_TOKENS.OUTPUT_CHANNEL,
    );
    const outputManager = new CliOutputManagerAdapter(outputChannel);
    container.register(TOKENS.OUTPUT_MANAGER, { useValue: outputManager });

    // Logger adapter: uses CliOutputManagerAdapter instead of VS Code OutputManager.
    // Cast to Logger type so library registration functions accept it.
    const loggerAdapter = new CliLoggerAdapter(outputManager);
    const logger = loggerAdapter as unknown as Logger;
    container.register(TOKENS.LOGGER, { useValue: logger });

    logger.info('[CLI DI] Starting service registration...');

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
      TOKENS.SUBAGENT_REGISTRY_SERVICE,
      SubagentRegistryService,
    );
    container.registerSingleton(
      TOKENS.FEATURE_GATE_SERVICE,
      FeatureGateService,
    );

    // TASK_2026_104 Sub-batch B5b: GitInfoService is shared (cross-spawn around
    // git CLI — no platform coupling). Required by the lifted GitRpcHandlers.
    container.register(TOKENS.GIT_INFO_SERVICE, {
      useFactory: (c) => new GitInfoService(c.resolve(TOKENS.LOGGER)),
    });

    // TASK_2026_104 Sub-batch B5a: WorkspaceContextManager + WorkspaceAwareStateStorage.
    // Required by the lifted shared WorkspaceRpcHandlers so the CLI can serve
    // workspace:* (getInfo / addFolder / registerFolder / removeFolder / switch).
    //
    // We override Phase 0's WORKSPACE_STATE_STORAGE with the workspace-aware
    // proxy so any handler that injects WORKSPACE_STATE_STORAGE later gets
    // routing-by-active-workspace at call time. The factory passed in produces
    // CliStateStorage instances (file-backed JSON, identical layout to the
    // per-workspace storage on Electron).
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

    // Eagerly create + activate the startup workspace (mirrors Electron Phase 1).
    // Synchronous container setup can't await; fire-and-forget with logging is
    // safe because the JSON-RPC stdio loop / commander handler doesn't dispatch
    // workspace:* calls until well after this resolves.
    workspaceContextManager.createWorkspace(workspacePath).then(
      (result) => {
        if ('error' in result) {
          // CreateWorkspaceFailure variant. Use `in`-based narrowing rather
          // than `if (result.success)` because ts-jest's spec tsconfig runs
          // without `strictNullChecks`, where boolean-discriminant narrowing
          // can collapse and require a structural cast. `in` narrowing
          // works under both strict and non-strict modes.
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
        '[CLI DI] FILE_SYSTEM_MANAGER shim registered (delegates to IFileSystemProvider)',
      );
    } catch (error) {
      logger.error(
        '[CLI DI] Failed to register FILE_SYSTEM_MANAGER shim',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // ========================================
    // PHASE 1.4: CONFIG_MANAGER shim (required by llm-abstraction, workspace-intelligence)
    // ========================================
    // ConfigManager (vscode-core) imports 'vscode' directly and cannot be used
    // in the CLI. We keep the shim but source fileSettings from the
    // CliWorkspaceProvider registered in Phase 0 so both the workspace provider
    // and the config shim share the same PtahFileSettingsManager instance.
    // The shared instance is stored on CliDIContainer._fileSettings so that
    // process.on('exit', ...) in main.ts can call flushSync() synchronously.
    try {
      const configStorage = container.resolve<IStateStorage>(
        PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
      );
      const workspaceProvider = container.resolve<CliWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      );
      const fileSettings = workspaceProvider.fileSettings;
      // Expose to the static flushSync() entry-point used by main.ts exit handler.
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
        '[CLI DI] EXTENSION_CONTEXT shim registered (delegates to platform storage)',
      );
    } catch (error) {
      logger.error(
        '[CLI DI] Failed to register EXTENSION_CONTEXT shim',
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
        '[CLI DI] Failed to seed community license (non-fatal)',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    phaseEnd('1', phase1Start);

    // ========================================
    // PHASE 2: Library Services
    // ========================================
    const phase2Start = phaseStart('2');

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
        '[CLI DI] WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR stubs registered',
      );
    } catch (error) {
      logger.error(
        '[CLI DI] Failed to register webview stubs for WizardWebviewLifecycleService',
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
      '[CLI DI] SETUP_WIZARD_SERVICE stub registered (no setup wizard in CLI)',
    );

    // TASK_2025_291 Wave C5: CLI agent services now registered by
    // registerSdkServices (earlier in Phase 2). The llm-abstraction
    // library has been deleted.

    phaseEnd('2', phase2Start);

    // ========================================
    // PHASE 3: Storage Adapters
    // ========================================
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

    // Global state adapter (for pricing cache - uses global state storage)
    const globalStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    container.register(TOKENS.GLOBAL_STATE, { useValue: globalStateStorage });

    phaseEnd('3', phase3Start);

    // ========================================
    // PHASE 3.5: Platform Abstraction Implementations
    // ========================================
    // Must be registered BEFORE shared handler classes that depend on these tokens.
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

    // ========================================
    // PHASE 4: WebviewManager + LM tools + Shared RPC handlers + wiring
    // ========================================
    // Skipped entirely under `bootstrapMode === 'minimal'`. Read-only commands
    // (config, status, etc.) need only Phases 0-3.5 and can avoid the cost of
    // resolving every RPC handler class. Discovery D12.
    if (bootstrapMode === 'full') {
      const phase4Start = phaseStart('4');

      // ========================================
      // PHASE 4.0: WebviewManager registration
      // ========================================
      // Adapter is instantiated in Phase 0a (so verbose phase events can flow);
      // Phase 4.0 only registers the token binding so RPC handlers find it.
      container.register(TOKENS.WEBVIEW_MANAGER, { useValue: pushAdapter });

      logger.info(
        '[CLI DI] CliWebviewManagerAdapter registered as WEBVIEW_MANAGER',
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
            c.resolve(TOKENS.PLATFORM_COMMANDS),
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

      // TASK_2026_104 Sub-batch B5a: WorkspaceRpcHandlers (lifted from Electron).
      container.registerSingleton(WorkspaceRpcHandlers);

      logger.info('[CLI DI] Shared RPC handler classes registered (18)');

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
        logger.info('[CLI DI] EnhancedPrompts analysis reader wired');
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
              logger.warn('[CLI DI] Content download incomplete', {
                error: result.error,
              } as unknown as Error);
            } else {
              logger.info('[CLI DI] Content download complete');
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

      // ========================================
      // PHASE 4.7: Register RPC method handlers with the RpcHandler
      // ========================================
      // Registering handler classes in DI is not enough — each handler exposes
      // a `static readonly METHODS` tuple that must be wired into the
      // RpcHandler so dispatch can find them. Without this, every CLI command
      // that calls into the in-process RPC layer would `task.error` with
      // `Method not found`.
      try {
        const registration = new CliRpcMethodRegistrationService();
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
