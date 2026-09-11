/**
 * Electron DI — Phase 1: Infrastructure services.
 *
 * Registers (in order):
 *   - Platform-agnostic vscode-core services via registerVsCodeCorePlatformAgnostic
 *     (Phase 1.0b: SENTRY_SERVICE, Phase 1.1: LICENSE_SERVICE, Phase 1.1b:
 *     AUTH_SECRETS_SERVICE, Phase 1.2: RPC_HANDLER, MESSAGE_VALIDATOR,
 *     AGENT_SESSION_WATCHER_SERVICE, SUBAGENT_REGISTRY_SERVICE)
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
} from '@ptah-extension/platform-core';
import type { ElectronPlatformOptions } from '@ptah-extension/platform-electron';
import {
  TOKENS,
  registerVsCodeCorePlatformAgnostic,
  registerExtensionContextShim,
  ConfigManager,
  WorkspaceContextManager,
  WorkspaceAwareStateStorage,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  ElectronStateStorage,
  ElectronWorkspaceProvider,
} from '@ptah-extension/platform-electron';
import {
  SESSION_METADATA_MIGRATION,
  SESSION_METADATA_WORKER_CACHE_EXCLUSIONS,
} from '@ptah-extension/agent-sdk';

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
  registerVsCodeCorePlatformAgnostic(container, logger);
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
  // The shim itself — and its own try/catch — belongs to `vscode-core`, which
  // owns the token and the shape `LicenseService` reads off it. Only the two
  // paths are this host's.
  registerExtensionContextShim(container, logger, {
    appPath: options.appPath,
    userDataPath: options.userDataPath,
  });
  const defaultWorkspaceStoragePath = path.join(
    options.userDataPath,
    'workspace-storage',
    'default',
  );
  const workspaceAwareStorage = new WorkspaceAwareStateStorage(
    defaultWorkspaceStoragePath,
    (storageDirPath) =>
      new ElectronStateStorage(
        storageDirPath,
        'workspace-state.json',
        options.stateStorageWorkerPath
          ? {
              workerPath: options.stateStorageWorkerPath,
              migrations: [SESSION_METADATA_MIGRATION],
              cacheExcludeKeyPrefixes:
                SESSION_METADATA_WORKER_CACHE_EXCLUSIONS,
            }
          : undefined,
      ),
  );
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
  logger.info(
    '[Electron DI] WorkspaceAwareStateStorage and WorkspaceContextManager registered (TASK_2025_208)',
  );
}
