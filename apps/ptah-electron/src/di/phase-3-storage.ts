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
  // ========================================
  // PHASE 3: Storage Adapters
  // ========================================
  // Storage adapter (workspace-scoped state storage)
  // Maps TOKENS.STORAGE_SERVICE to the platform-electron workspace state storage.
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

  // Global state adapter (for pricing cache — uses global state storage).
  const globalStateStorage = container.resolve<IStateStorage>(
    PLATFORM_TOKENS.STATE_STORAGE,
  );
  container.register(TOKENS.GLOBAL_STATE, { useValue: globalStateStorage });

  // ========================================
  // PHASE 3.5: Platform Abstraction Implementations
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

  // ========================================
  // PHASE 3.6: Cron Power Monitor
  // ========================================
  // CronScheduler's CatchupCoordinator depends on IPowerMonitor to re-arm
  // jobs after the system resumes from sleep. ElectronPowerMonitor wraps
  // electron.powerMonitor — registered here (Phase 3) so it is available
  // before wire-runtime Phase 4.54 calls scheduler.start().
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

  // ========================================
  // PHASE 4 prelude: Code Execution MCP + Browser Capabilities
  // ========================================
  // Register the real vscode-lm-tools services instead of a stub.
  // The library is now platform-agnostic:
  //   - WebviewManager is optional (auto-resolved via container.isRegistered)
  //   - IDE capabilities gracefully degrade (no VscodeIDECapabilities registered)
  //   - Diagnostics use ElectronDiagnosticsProvider (registered in Phase 0)
  //   - approval_prompt auto-allows when WebviewManager is absent
  registerVsCodeLmToolsServices(container, logger);

  // Phase 4.0.1: Browser capabilities
  // Uses ChromeLauncherBrowserCapabilities (same as VS Code) to launch a real Chrome
  // instance via chrome-launcher + chrome-remote-interface for CDP automation.
  // This avoids the Electron BrowserWindow approach which confusingly opens
  // another Ptah Desktop window instead of a separate browser.
  const workspaceProvider = container.resolve<IWorkspaceProvider>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );
  container.register(BROWSER_CAPABILITIES_TOKEN, {
    useValue: new ChromeLauncherBrowserCapabilities(
      // getRecordingDir — defaults to {workspace}/.ptah/recordings/
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
