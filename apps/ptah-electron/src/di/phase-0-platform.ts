/**
 * Electron DI — Phase 0: Platform abstraction layer + Logger adapter.
 *
 * Registers:
 *   - The PLATFORM_TOKENS registerPlatformElectronServices binds, including
 *     WORKSPACE_WATCHER (ElectronWorkspaceWatcher over the watch host)
 *   - TOKENS.OUTPUT_MANAGER (ElectronOutputManagerAdapter)
 *   - TOKENS.LOGGER (ElectronLoggerAdapter, cast to Logger)
 *
 * Returns the Logger instance so subsequent phases can use it without re-resolving.
 */

import type { DependencyContainer } from 'tsyringe';
import {
  registerPlatformElectronServices,
  type ElectronPlatformOptions,
} from '@ptah-extension/platform-electron';
import {
  PLATFORM_TOKENS,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  ElectronOutputManagerAdapter,
  ElectronLoggerAdapter,
} from './electron-adapters';
import { createElectronWorkspaceWatcherOptions } from '../services/platform/electron-workspace-watch-host-factory';

export interface Phase0Result {
  logger: Logger;
}

/**
 * Phase 0: Register the platform abstraction layer and logger adapter.
 *
 * MUST run before any other phase — every later phase injects PLATFORM_TOKENS
 * or relies on the logger being available.
 */
export function registerPhase0Platform(
  container: DependencyContainer,
  options: ElectronPlatformOptions,
): Phase0Result {
  // `PLATFORM_TOKENS.WORKSPACE_WATCHER` (TASK_2026_437 C8): the out-of-main
  // watch host. Registered here with every other port; nothing forks until a
  // consumer calls `watch`. A caller-supplied wiring (a spec) wins.
  registerPlatformElectronServices(container, {
    ...options,
    workspaceWatchHost:
      options.workspaceWatchHost ??
      createElectronWorkspaceWatcherOptions(container),
  });
  const outputChannel = container.resolve<IOutputChannel>(
    PLATFORM_TOKENS.OUTPUT_CHANNEL,
  );
  const outputManager = new ElectronOutputManagerAdapter(outputChannel);
  container.register(TOKENS.OUTPUT_MANAGER, { useValue: outputManager });
  const loggerAdapter = new ElectronLoggerAdapter(outputManager);
  const logger = loggerAdapter as unknown as Logger;
  container.register(TOKENS.LOGGER, { useValue: logger });

  return { logger };
}
