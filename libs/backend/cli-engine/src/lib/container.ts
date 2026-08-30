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
  IFileDialog,
  IOutputChannel,
  IStateStorage,
  ISecretStorage,
  IWorkspaceProvider,
  IWorkspaceLifecycleProvider,
} from '@ptah-extension/platform-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type {
  CustomProviderStore,
  IActiveWorkspaceSource,
} from '@ptah-extension/settings-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  armDiagnostics,
  registerVsCodeCorePlatformAgnostic,
} from '@ptah-extension/vscode-core';
import { LicenseService } from '@ptah-extension/vscode-core';
import { GitInfoService } from '@ptah-extension/vscode-core';
import {
  WorkspaceAwareStateStorage,
  WorkspaceContextManager,
} from '@ptah-extension/vscode-core';
import {
  registerWorkspaceIntelligenceServices,
  TypeScriptDiagnosticsProvider,
} from '@ptah-extension/workspace-intelligence';
import {
  registerPluginMarketplaceServices,
  initializePluginMarketplace,
} from '@ptah-extension/plugin-marketplace';
import {
  registerSdkServices,
  SDK_TOKENS,
  wireAgentAdapterAliases,
  HARNESS_PREFLIGHT_TOKEN,
} from '@ptah-extension/agent-sdk';
import {
  registerHarnessSyncServices,
  ALL_HARNESS_TARGET_FACTORIES,
  createPluginConfigSourceResolver,
  HARNESS_SYNC_TOKENS,
  type HarnessPluginConfigReader,
} from '@ptah-extension/harness-sync';

import {
  bootHarness,
  createCliUserLayerRefresher,
  readCliManageGitignore,
  readCliPreflightTimeoutMs,
} from './bootstrap/harness-boot';
import { shutdownHostRuntime } from './bootstrap/shutdown-host-runtime.js';
import { registerAuthProvidersServices } from '@ptah-extension/auth-providers';
import {
  registerCliAgentRuntimeServices,
  createHarnessCliDetector,
  type HarnessCliDetectionReader,
} from '@ptah-extension/cli-agent-runtime';
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
  AgentRpcHandlers,
  FilePickerRpcHandlers,
  activateSessionLifecycleNotifier,
  registerChatServices,
  registerHarnessServices,
  registerRpcSurface,
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
import { createCliRpcHostProfile } from './rpc/cli-host-profile';
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
   * Which headless host is booting. Both share this container, but they are
   * separate RPC hosts — `createCliRpcHostProfile` keys off this so a
   * capability can differ between the stdio CLI and the interactive TUI.
   * Defaults to `'cli'`.
   */
  host?: 'cli' | 'tui';
  /**
   * Selection UI for `file:pick`. Only the TUI supplies one — its profile is
   * the only headless profile with the `filePicker` capability on.
   */
  filePicker?: IFileDialog;
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
  /**
   * Resolves once the initial workspace context has been created and marked
   * active on the workspace-aware state storage. `setup()` is synchronous, so
   * this step is inherently deferred; callers that touch settings MUST await
   * this first (`withEngine` does) or their reads/writes race the activation
   * and hit the global default bucket.
   *
   * Never rejects — failures are logged and swallowed inside `setup()`.
   * Optional so test doubles for `bootstrap` need not provide it.
   */
  workspaceReady?: Promise<void>;
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
   * The armed diagnostics handle, held statically for the same reason
   * {@link _fileSettings} is: `apps/ptah-cli/src/main.ts` installs the
   * SIGINT/SIGTERM handlers but never sees a container — `withEngine` owns
   * every container it creates. A static is the only reference the signal
   * handlers can reach. Undefined unless `setup({ verbose: true })` ran.
   */
  private static _diagnostics: { dispose(): void } | undefined;

  /**
   * The child container the most recent {@link setup} built, held statically
   * for exactly the reason {@link _diagnostics} is — and here the reason is
   * load-bearing rather than convenient. `setup()` registers
   * `AgentProcessManager` and `SdkPtahCliRegistry` on the CHILD container it
   * creates, never on tsyringe's global one, so a signal handler that reaches
   * for the global container gets `isRegistered === false` for both tokens and
   * any teardown routed through it is a permanent, silent no-op. This static
   * is the only reference `apps/ptah-cli/src/main.ts` can reach.
   *
   * Undefined before `setup()` runs and after {@link disposeHostRuntime}.
   */
  private static _container: DependencyContainer | undefined;

  /**
   * Synchronously flush any pending file-based settings writes to disk.
   * Safe to call from process.on('exit', ...) — never throws.
   * No-op if setup() has not been called yet.
   */
  static flushSync(): void {
    CliDIContainer._fileSettings?.flushSync();
  }

  /**
   * Stop the event-loop lag sampler. Safe from a signal handler — never
   * throws, and a no-op when diagnostics were never armed.
   */
  static disposeDiagnostics(): void {
    try {
      CliDIContainer._diagnostics?.dispose();
    } catch (error: unknown) {
      // Reported on stderr rather than through the logger: this runs from a
      // signal handler, and the logger lives in the container that this static
      // exists precisely to avoid touching mid-teardown. A teardown failure
      // must not change the exit code the signal already chose.
      process.stderr.write(
        `[ptah] diagnostics dispose failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
    CliDIContainer._diagnostics = undefined;
  }

  /**
   * The container most recently built by {@link setup}, or undefined if
   * `setup()` has not run (or its runtime has already been disposed).
   * Read-only for callers; the CLI's signal handlers are the reason it exists.
   */
  static get activeContainer(): DependencyContainer | undefined {
    return CliDIContainer._container;
  }

  /**
   * End the OS-level resources the active container owns — spawned CLI agent
   * subprocesses first, then the ptah-cli proxy leases they were speaking
   * through. Safe from a signal handler: never throws, and a no-op when
   * `setup()` never ran.
   *
   * Clears the static before doing the work, for the same reason
   * {@link disposeDiagnostics} clears its own: a second signal (or the `exit`
   * hook firing after a signalled teardown) must not re-enter a disposal that
   * has already been started.
   */
  static async disposeHostRuntime(): Promise<void> {
    const container = CliDIContainer._container;
    CliDIContainer._container = undefined;
    await shutdownHostRuntime(container);
  }

  /**
   * Setup and orchestrate all service registrations for the TUI.
   *
   * @param options - Bootstrap options (paths)
   * @returns Configured container, transport, push adapter, and fire-and-forget handler
   */
  static setup(options: CliBootstrapOptions = {}): CliBootstrapResult {
    const container = globalContainer.createChildContainer();
    // Recorded before any registration runs, not after: a bootstrap that
    // throws part-way through may already have spawned something, and the
    // signal handlers need a reference to it either way.
    CliDIContainer._container = container;

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
    const host: 'cli' | 'tui' = options.host ?? 'cli';
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
    // NOTE: diagnostics are armed at the END of Phase 1, once
    // `registerVsCodeCorePlatformAgnostic` has registered the monitor. See
    // below — this comment marks the phase, the arming has to follow the
    // registration it depends on.
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

    // Verbose-only, unlike the desktop hosts. A one-shot `ptah` invocation that
    // blocks the loop for 300 ms has not hung anything a user can perceive —
    // there is no window to freeze — so sampling by default would only add a
    // wakeup and a line of noise to every command. Under `--verbose` the caller
    // has explicitly asked to watch the machinery, and `debug.perf.lag` sits
    // alongside `debug.di.phase` in the same stream.
    if (verbose) {
      CliDIContainer._diagnostics = armDiagnostics({
        container,
        logsPath,
        onLag: (sample) => {
          pushAdapter.emit('debug.perf.lag', {
            maxMs: sample.maxMs,
            p99Ms: sample.p99Ms,
          });
        },
      });
    }
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
    /**
     * `setup()` is synchronous, so this cannot be awaited here. The promise is
     * surfaced on the bootstrap result instead and awaited by `withEngine`
     * BEFORE any user work runs — otherwise early settings reads/writes race
     * the activation and land in the global default bucket rather than the
     * workspace bucket. Never rejects: both outcomes are logged and swallowed.
     */
    const workspaceReady = workspaceContextManager
      .createWorkspace(workspacePath)
      .then(
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
    // Override the Phase 0 diagnostics stub with the real TypeScript compiler
    // provider. Must come AFTER workspace-intelligence so IFileSystemProvider is
    // registered. registerVsCodeLmToolsServices (Phase 4) runs later.
    const tsDiagsProvider = new TypeScriptDiagnosticsProvider(
      container.resolve(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER),
    );
    container.register(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER, {
      useValue: tsDiagsProvider,
    });
    logger.info(
      '[CLI DI] Overrode DIAGNOSTICS_PROVIDER with TypeScriptDiagnosticsProvider',
    );
    registerAuthProvidersServices(container, logger);
    // MUST precede registerSdkServices: PluginLoaderService injects the
    // external consent store as its allowlist source.
    registerPluginMarketplaceServices(container, logger);
    registerSdkServices(container, logger);
    // The CLI/TUI reconciler, its boot pass (`bootHarness`, fired from the
    // content-download callback below) and its session-start preflight.
    //
    // Every target, in every host: a workspace is populated for the tools the
    // USER has, not for the one running Ptah. Undetected CLIs are skipped at
    // reconcile time, which is why the detector is the only host-specific part.
    registerHarnessSyncServices(container, logger, {
      targets: ALL_HARNESS_TARGET_FACTORIES,
      cliDetector: createHarnessCliDetector(() =>
        container.isRegistered(TOKENS.CLI_DETECTION_SERVICE)
          ? container.resolve<HarnessCliDetectionReader>(
              TOKENS.CLI_DETECTION_SERVICE,
            )
          : null,
      ),
      sourceResolver: createPluginConfigSourceResolver(() =>
        container.isRegistered(SDK_TOKENS.SDK_PLUGIN_LOADER)
          ? container.resolve<HarnessPluginConfigReader>(
              SDK_TOKENS.SDK_PLUGIN_LOADER,
            )
          : null,
      ),
      // Batch 3. Without this the CLI reconciled an EMPTY user layer forever:
      // `UserLayerMirrorService` was registered here and had no caller, so a
      // machine that only ever ran `ptah tui` had no desired state to copy.
      userLayerRefresher: createCliUserLayerRefresher(container),
      gitignore: {
        readManageGitignore: () => readCliManageGitignore(container),
      },
      preflight: {
        readTimeoutMs: () => readCliPreflightTimeoutMs(container),
        // The CLI starts its content download fire-and-forget, so this gate is
        // what stops a session that began seconds after boot from reporting an
        // empty harness (E2).
        contentGate: {
          awaitContentReady: (timeoutMs) =>
            container
              .resolve<ContentDownloadService>(PLATFORM_TOKENS.CONTENT_DOWNLOAD)
              .awaitContentReady(timeoutMs),
        },
      },
    });
    // Lets `SessionQueryExecutor` reach the reconciler without `agent-sdk`
    // importing `harness-sync`.
    container.register(HARNESS_PREFLIGHT_TOKEN, {
      useToken: HARNESS_SYNC_TOKENS.PREFLIGHT,
    });
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
      useValue: new CliPlatformCommands({ verbose, pushSink: pushAdapter }),
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
    const cliWsProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const cliLifecycle = container.resolve<IWorkspaceLifecycleProvider>(
      PLATFORM_TOKENS.WORKSPACE_LIFECYCLE_PROVIDER,
    );
    const cliActiveWorkspaceSource: IActiveWorkspaceSource = {
      getActivePath: () =>
        cliLifecycle.getActiveFolder() ?? cliWsProvider.getWorkspaceRoot(),
      onDidChange: (cb) => cliWsProvider.onDidChangeWorkspaceFolders(cb),
    };
    container.register(SETTINGS_TOKENS.ACTIVE_WORKSPACE_SOURCE, {
      useValue: cliActiveWorkspaceSource,
    });
    try {
      registerCliSettings(container, userDataPath);
      logger.info(
        '[CLI DI] Settings repositories registered (SETTINGS_TOKENS)',
      );
      // Publish user-defined providers to the shared registry cache BEFORE
      // anything resolves a provider by id — until this runs,
      // getAnthropicProvider() knows only the built-ins.
      const customProviders = container.resolve<CustomProviderStore>(
        SETTINGS_TOKENS.CUSTOM_PROVIDER_STORE,
      );
      const { entries, dropped } = customProviders.load();
      if (dropped.length > 0) {
        logger.warn(
          `[CLI DI] Dropped ${dropped.length} malformed custom provider entries`,
        );
      }
      logger.info(`[CLI DI] Custom providers loaded (${entries.length})`);
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
              // Same base path, same moment: the allowlist store must be bound
              // before anything asks PluginLoaderService to resolve an
              // external plugin id.
              initializePluginMarketplace(
                container,
                contentDownload.getPluginsPath(),
              );
              logger.info('[CLI DI] PluginLoaderService initialized');
              // AFTER the loader is initialized and the plugin tree is on
              // disk: the refresher reads both. Not awaited by the bootstrap —
              // a `ptah` invocation answers its first RPC without waiting on
              // this, and the session-start preflight closes the window from
              // the other side.
              void bootHarness(container, logger);
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
        registerChatServices(container);
        registerHarnessServices(container);
        container.registerSingleton(AgentRpcHandlers);
        if (options.filePicker) {
          container.register(PLATFORM_TOKENS.FILE_DIALOG, {
            useValue: options.filePicker,
          });
          container.registerSingleton(FilePickerRpcHandlers);
        }
        registerRpcSurface(container, createCliRpcHostProfile(host));
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
      workspaceReady,
    };
  }
}
