/**
 * Phase 0 — Platform, Logger, Sentry, ConfigManager
 *
 * Registers:
 *   - TOKENS.EXTENSION_CONTEXT
 *   - registerPlatformVscodeServices (platform-vscode)
 *   - TOKENS.OUTPUT_MANAGER, TOKENS.LOGGER
 *   - TOKENS.SENTRY_SERVICE
 *   - TOKENS.CONFIG_MANAGER (minimal prefix)
 *
 * Idempotent — every registration is guarded by `isRegistered` so the function
 * is safe to call twice (setupMinimal then setup on the licensed path).
 *
 * Returns the resolved Logger instance so callers can pass it to downstream
 * phases without re-resolving.
 */

import type { DependencyContainer } from 'tsyringe';
import * as vscode from 'vscode';

import {
  Logger,
  OutputManager,
  ConfigManager,
  SentryService,
  TOKENS,
} from '@ptah-extension/vscode-core';
import { registerPlatformVscodeServices } from '@ptah-extension/platform-vscode';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

export interface Phase0Result {
  logger: Logger;
}

export function registerPhase0Platform(
  container: DependencyContainer,
  context: vscode.ExtensionContext,
): Phase0Result {
  // Extension Context (MUST BE FIRST)
  if (!container.isRegistered(TOKENS.EXTENSION_CONTEXT)) {
    container.register(TOKENS.EXTENSION_CONTEXT, { useValue: context });
  }

  // Platform Abstraction Layer — MUST be before any library services
  // (they inject PLATFORM_TOKENS).
  if (!container.isRegistered(PLATFORM_TOKENS.PLATFORM_INFO)) {
    registerPlatformVscodeServices(container, context);
  }

  // Logger Dependencies — OutputManager must be registered BEFORE Logger
  // because Logger depends on OutputManager (@inject(OUTPUT_MANAGER)).
  if (!container.isRegistered(TOKENS.OUTPUT_MANAGER)) {
    container.registerSingleton(TOKENS.OUTPUT_MANAGER, OutputManager);
  }
  if (!container.isRegistered(TOKENS.LOGGER)) {
    container.registerSingleton(TOKENS.LOGGER, Logger);
  }
  const logger = container.resolve<Logger>(TOKENS.LOGGER);

  // Sentry Error Monitoring — registered early for activation failure
  // capture. SentryService depends on LOGGER — must come after Logger.
  if (!container.isRegistered(TOKENS.SENTRY_SERVICE)) {
    container.registerSingleton(TOKENS.SENTRY_SERVICE, SentryService);
  }

  // ConfigManager wraps vscode.workspace.getConfiguration('ptah'). LicenseService
  // depends on it for reading license config, so it must be registered before
  // the minimal path registers LicenseService.
  //
  // On the full path, `registerVsCodeCoreServices` will re-register this token;
  // tsyringe's `registerSingleton` is idempotent for the same class, so this is
  // fine. We keep the registration here so setupMinimal does not need to call
  // the full vscode-core helper.
  if (!container.isRegistered(TOKENS.CONFIG_MANAGER)) {
    container.registerSingleton(TOKENS.CONFIG_MANAGER, ConfigManager);
  }

  return { logger };
}
