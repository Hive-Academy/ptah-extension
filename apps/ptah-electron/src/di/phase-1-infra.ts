/**
 * Electron DI — Phase 1: Infrastructure services.
 *
 * Registers (in order):
 *   - Platform-agnostic vscode-core services via registerVsCodeCorePlatformAgnostic
 *     (Phase 1.0b: SENTRY_SERVICE, Phase 1.1: LICENSE_SERVICE, Phase 1.1b:
 *     AUTH_SECRETS_SERVICE, Phase 1.2: RPC_HANDLER, MESSAGE_VALIDATOR,
 *     AGENT_SESSION_WATCHER_SERVICE, SUBAGENT_REGISTRY_SERVICE, FEATURE_GATE_SERVICE)
 *   - Phase 1.3: TOKENS.FILE_SYSTEM_MANAGER shim (delegates to IFileSystemProvider)
 *   - Phase 1.4: TOKENS.CONFIG_MANAGER shim (file-based settings routing)
 *   - Phase 1.5: TOKENS.EXTENSION_CONTEXT shim (globalState/secrets/subscriptions)
 *   - Phase 1.6: WORKSPACE_STATE_STORAGE override + WORKSPACE_CONTEXT_MANAGER
 */

import * as path from 'path';
import type { DependencyContainer } from 'tsyringe';

import {
  PLATFORM_TOKENS,
  FILE_BASED_SETTINGS_KEYS,
  isFileBasedSettingKey,
  type IStateStorage,
  type ISecretStorage,
} from '@ptah-extension/platform-core';
import type { ElectronPlatformOptions } from '@ptah-extension/platform-electron';
import {
  TOKENS,
  registerVsCodeCorePlatformAgnostic,
  ConfigManager,
  WorkspaceContextManager,
  WorkspaceAwareStateStorage,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  ElectronStateStorage,
  ElectronWorkspaceProvider,
} from '@ptah-extension/platform-electron';

/**
 * Phase 1: Register logger-adjacent infrastructure services and environment shims.
 *
 * Prerequisites: Phase 0 must have registered PLATFORM_TOKENS and TOKENS.LOGGER.
 */
export function registerPhase1Infra(
  container: DependencyContainer,
  options: ElectronPlatformOptions,
  logger: Logger,
): void {
  logger.info('[Electron DI] Starting service registration...');

  // ========================================
  // PHASE 1.0b + 1.1 + 1.1b + 1.2: Platform-agnostic vscode-core services
  // ========================================
  // Centralized helper registers SENTRY_SERVICE, LICENSE_SERVICE, AUTH_SECRETS_SERVICE,
  // RPC_HANDLER, MESSAGE_VALIDATOR, AGENT_SESSION_WATCHER_SERVICE,
  // SUBAGENT_REGISTRY_SERVICE, FEATURE_GATE_SERVICE.
  // Each registration is idempotent (isRegistered-guarded inside the helper).
  registerVsCodeCorePlatformAgnostic(container, logger);

  // ========================================
  // PHASE 1.3: FILE_SYSTEM_MANAGER shim (required by workspace-intelligence)
  // ========================================
  // registerWorkspaceIntelligenceServices() checks container.isRegistered(TOKENS.FILE_SYSTEM_MANAGER)
  // and throws if missing. The real FileSystemManager imports vscode, so we provide
  // a shim that delegates to the platform-agnostic IFileSystemProvider already
  // registered in Phase 0 via platform-electron.
  try {
    const fileSystemProvider = container.resolve(
      PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER,
    );
    container.register(TOKENS.FILE_SYSTEM_MANAGER, {
      useValue: fileSystemProvider,
    });
    logger.info(
      '[Electron DI] FILE_SYSTEM_MANAGER shim registered (delegates to IFileSystemProvider)',
    );
  } catch (error) {
    logger.error(
      '[Electron DI] Failed to register FILE_SYSTEM_MANAGER shim — workspace-intelligence services may fail',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }

  // ========================================
  // PHASE 1.4: CONFIG_MANAGER — real ConfigManager wired to ElectronWorkspaceProvider.fileSettings
  // ========================================
  // WORKSPACE_PROVIDER was registered in Phase 0 via registerPlatformElectronServices.
  // We resolve the already-registered ElectronWorkspaceProvider to reuse its
  // PtahFileSettingsManager instance (no second instance created).
  //
  // ConfigManager uses the vscode-shim's workspace.getConfiguration (no-op in
  // Electron) for non-file-based keys. All provider/AI keys in FILE_BASED_SETTINGS_KEYS
  // are routed to PtahFileSettingsManager (~/.ptah/settings.json) via setFileSettingsStore.
  try {
    container.registerSingleton(TOKENS.CONFIG_MANAGER, ConfigManager);
    const configManager = container.resolve<ConfigManager>(
      TOKENS.CONFIG_MANAGER,
    );
    const workspaceProvider = container.resolve<ElectronWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    configManager.setFileSettingsStore(
      FILE_BASED_SETTINGS_KEYS,
      workspaceProvider.fileSettings,
      isFileBasedSettingKey,
    );
    logger.info(
      '[Electron DI] CONFIG_MANAGER registered (real ConfigManager + file-based settings routed via ElectronWorkspaceProvider.fileSettings)',
    );
  } catch (error) {
    logger.error('[Electron DI] Failed to register CONFIG_MANAGER', {
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
          /* no-op in Electron */
        },
      },
      secrets: {
        get: async (key: string): Promise<string | undefined> =>
          secretStorage.get(key),
        store: async (key: string, value: string): Promise<void> =>
          secretStorage.store(key, value),
        delete: async (key: string): Promise<void> => secretStorage.delete(key),
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
      '[Electron DI] EXTENSION_CONTEXT shim registered (delegates to platform storage)',
    );
  } catch (error) {
    logger.error(
      '[Electron DI] Failed to register EXTENSION_CONTEXT shim — agent-sdk/llm services may fail',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }

  // ========================================
  // PHASE 1.6: WorkspaceAwareStateStorage + WorkspaceContextManager
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
    'default',
  );
  const workspaceAwareStorage = new WorkspaceAwareStateStorage(
    defaultWorkspaceStoragePath,
    (storageDirPath) =>
      new ElectronStateStorage(storageDirPath, 'workspace-state.json'),
  );

  // Override Phase 0's WORKSPACE_STATE_STORAGE with the workspace-aware proxy
  container.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: workspaceAwareStorage,
  });

  const workspaceContextManager = new WorkspaceContextManager(
    options.userDataPath,
    workspaceAwareStorage,
  );
  container.register(TOKENS.WORKSPACE_CONTEXT_MANAGER, {
    useValue: workspaceContextManager,
  });

  // Create initial workspace context for the startup workspace folder (if provided).
  // NOTE: createWorkspace/switchWorkspace are async.
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
                { path: initialPath },
              );
            },
            (err: unknown) => {
              logger.warn(
                '[Electron DI] Failed to switch to initial workspace',
                {
                  path: initialPath,
                  error: err instanceof Error ? err.message : String(err),
                },
              );
            },
          );
        } else {
          logger.warn(
            '[Electron DI] Failed to create initial workspace — using default storage',
            { path: initialPath, error: result.error },
          );
        }
      },
      (err: unknown) => {
        logger.warn(
          '[Electron DI] Failed to create initial workspace — using default storage',
          {
            path: initialPath,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      },
    );
  }

  logger.info(
    '[Electron DI] WorkspaceAwareStateStorage and WorkspaceContextManager registered (TASK_2025_208)',
  );
}
