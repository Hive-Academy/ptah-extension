/**
 * Phase 1 — Infrastructure (LicenseService, platform-abstraction impls, vscode-core)
 *
 * Exports two entry points:
 *   - `registerPhase1InfraMinimal`: used by `DIContainer.setupMinimal` — registers
 *     only `TOKENS.LICENSE_SERVICE` (Phase 0 has already registered everything
 *     LicenseService needs: EXTENSION_CONTEXT, LOGGER, CONFIG_MANAGER, SENTRY).
 *   - `registerPhase1Infra`: used by `DIContainer.setup` — registers platform
 *     abstraction implementations, delegates the full vscode-core block to
 *     `registerVsCodeCoreServices`, and wires file-based settings into
 *     ConfigManager.
 *
 * `registerVsCodeCoreServices` delegates to the platform-agnostic helper
 * (`registerVsCodeCorePlatformAgnostic`), which guardedly registers
 * `SUBAGENT_REGISTRY_SERVICE` itself — no explicit registration needed here.
 */

import type { DependencyContainer } from 'tsyringe';
import * as vscode from 'vscode';

import {
  ConfigManager,
  LicenseService,
  TOKENS,
  registerVsCodeCoreServices,
} from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  FILE_BASED_SETTINGS_KEYS,
  isFileBasedSettingKey,
} from '@ptah-extension/platform-core';
import { VscodeWorkspaceProvider } from '@ptah-extension/platform-vscode';

import {
  VsCodePlatformCommands,
  VsCodePlatformAuth,
  VsCodeSaveDialog,
  VsCodeModelDiscovery,
} from '../services/platform';

/**
 * Minimal infrastructure: registers `TOKENS.LICENSE_SERVICE` only.
 *
 * Prerequisite: `registerPhase0Platform` must have run first — LicenseService
 * depends on EXTENSION_CONTEXT, LOGGER, and CONFIG_MANAGER, all registered by
 * the platform phase.
 */
export function registerPhase1InfraMinimal(
  container: DependencyContainer,
): void {
  if (!container.isRegistered(TOKENS.LICENSE_SERVICE)) {
    container.registerSingleton(TOKENS.LICENSE_SERVICE, LicenseService);
  }
}

/**
 * Full infrastructure for the licensed-user activation path.
 *
 * Registers (in order):
 *   - Platform abstraction implementations: PLATFORM_COMMANDS,
 *     PLATFORM_AUTH_PROVIDER, SAVE_DIALOG_PROVIDER, MODEL_DISCOVERY
 *   - Delegates to `registerVsCodeCoreServices` which registers 13 tokens
 *     including the platform-agnostic block (RPC_HANDLER, MESSAGE_VALIDATOR,
 *     AGENT_SESSION_WATCHER_SERVICE, SUBAGENT_REGISTRY_SERVICE,
 *     SENTRY_SERVICE, LICENSE_SERVICE, AUTH_SECRETS_SERVICE).
 *   - Wires file-based settings into ConfigManager.
 */
export function registerPhase1Infra(
  container: DependencyContainer,
  context: vscode.ExtensionContext,
  logger: Logger,
): void {
  container.registerSingleton(TOKENS.PLATFORM_COMMANDS, VsCodePlatformCommands);
  container.registerSingleton(
    TOKENS.PLATFORM_AUTH_PROVIDER,
    VsCodePlatformAuth,
  );
  container.registerSingleton(TOKENS.SAVE_DIALOG_PROVIDER, VsCodeSaveDialog);
  container.registerSingleton(TOKENS.MODEL_DISCOVERY, VsCodeModelDiscovery);
  registerVsCodeCoreServices(container, context, logger);
  const configManager = container.resolve<ConfigManager>(TOKENS.CONFIG_MANAGER);
  const workspaceProvider = container.resolve(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  ) as VscodeWorkspaceProvider;
  configManager.setFileSettingsStore(
    FILE_BASED_SETTINGS_KEYS,
    workspaceProvider.fileSettings,
    isFileBasedSettingKey,
  );
}
