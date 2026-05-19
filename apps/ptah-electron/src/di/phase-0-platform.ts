/**
 * Electron DI — Phase 0: Platform abstraction layer + Logger adapter.
 *
 * Registers:
 *   - All 10 PLATFORM_TOKENS via registerPlatformElectronServices
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
  registerPlatformElectronServices(container, options);
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
