/**
 * Electron DI — Phase 3: Storage adapters + platform abstractions + vscode-lm-tools.
 *
 * Registers (in order):
 *   - Phase 3: TOKENS.STORAGE_SERVICE, TOKENS.GLOBAL_STATE adapters
 *   - Phase 3.5: TOKENS.PLATFORM_COMMANDS, PLATFORM_AUTH_PROVIDER, SAVE_DIALOG_PROVIDER,
 *                MODEL_DISCOVERY (per-item try/catch loop)
 *   - Phase 4 prelude: registerVsCodeLmToolsServices + BROWSER_CAPABILITIES_TOKEN
 */

import type { DependencyContainer } from 'tsyringe';

import {
  PLATFORM_TOKENS,
  type IStateStorage,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  registerVsCodeLmToolsServices,
  BROWSER_CAPABILITIES_TOKEN,
  ChromeLauncherBrowserCapabilities,
} from '@ptah-extension/vscode-lm-tools';

import {
  ElectronPlatformCommands,
  ElectronPlatformAuth,
  ElectronSaveDialog,
  ElectronModelDiscovery,
  ElectronPowerMonitor,
} from '../services/platform';
import { CRON_TOKENS } from '@ptah-extension/cron-scheduler';

/**
 * Phase 3: Register storage adapters, platform abstractions, and vscode-lm-tools.
 *
 * Prerequisites: Phase 1.6 must have registered the workspace-aware
 * WORKSPACE_STATE_STORAGE override; Phase 0 must have registered STATE_STORAGE.
 */
export function registerPhase3Storage(
  container: DependencyContainer,
  logger: Logger,
): void {
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
        },
      );
    }
  }

  logger.info(
    '[Electron DI] Platform abstraction implementations registered (TASK_2025_203)',
    {
      services: registeredAbstractions,
    },
  );
  try {
    container.registerSingleton(
      CRON_TOKENS.CRON_POWER_MONITOR,
      ElectronPowerMonitor,
    );
    logger.info('[Electron DI] ElectronPowerMonitor registered (Track 3)');
  } catch (error) {
    logger.warn(
      '[Electron DI] ElectronPowerMonitor registration failed (non-fatal)',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  registerVsCodeLmToolsServices(container, logger);
  const workspaceProvider = container.resolve<IWorkspaceProvider>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );
  container.register(BROWSER_CAPABILITIES_TOKEN, {
    useValue: new ChromeLauncherBrowserCapabilities(
      () => {
        const configured =
          workspaceProvider.getConfiguration<string>(
            'ptah',
            'browser.recordingDir',
            '',
          ) ?? '';
        if (configured) return configured;
        const wsRoot = workspaceProvider.getWorkspaceRoot();
        if (wsRoot) return `${wsRoot}/.ptah/recordings`;
        return '';
      },
    ),
  });
}
