/**
 * Electron DI — Phase 0: Platform abstraction layer + Logger adapter.
 *
 * TASK_2025_291 Wave C1 Step 2b: Split from the monolithic container.ts.
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
  // ========================================
  // PHASE 0: Platform Abstraction Layer
  // ========================================
  // Register all 10 platform tokens (IPlatformInfo + 8 providers + WORKSPACE_STATE_STORAGE).
  // MUST be before any library services (they inject PLATFORM_TOKENS).
  registerPlatformElectronServices(container, options);

  // ========================================
  // PHASE 1: Logger + OutputManager adapters
  // ========================================
  // OutputManager adapter wraps the platform-electron IOutputChannel.
  // Logger depends on OutputManager, so this must be registered first.
  const outputChannel = container.resolve<IOutputChannel>(
    PLATFORM_TOKENS.OUTPUT_CHANNEL,
  );
  const outputManager = new ElectronOutputManagerAdapter(outputChannel);
  container.register(TOKENS.OUTPUT_MANAGER, { useValue: outputManager });

  // Logger adapter: uses ElectronOutputManagerAdapter instead of VS Code OutputManager.
  // Cast to Logger type so library registration functions accept it — safe because
  // they only call public methods (info, warn, error, debug).
  const loggerAdapter = new ElectronLoggerAdapter(outputManager);
  const logger = loggerAdapter as unknown as Logger;
  container.register(TOKENS.LOGGER, { useValue: logger });

  return { logger };
}
