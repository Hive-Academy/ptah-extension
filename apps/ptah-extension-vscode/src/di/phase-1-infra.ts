/**
 * Phase 1 — Infrastructure (LicenseService, platform-abstraction impls, vscode-core)
 *
 * Extracted from `container.ts` as part of TASK_2025_291 Wave C1, Step 2a.
 *
 * Exports two entry points:
 *   - `registerPhase1InfraMinimal`: used by `DIContainer.setupMinimal` — registers
 *     only `TOKENS.LICENSE_SERVICE` (Phase 0 has already registered everything
 *     LicenseService needs: EXTENSION_CONTEXT, LOGGER, CONFIG_MANAGER, SENTRY).
 *   - `registerPhase1Infra`: used by `DIContainer.setup` — registers platform
 *     abstraction implementations (Phase 1.4.5), delegates the full vscode-core
 *     block to `registerVsCodeCoreServices` (Phase 1.5), and wires file-based
 *     settings into ConfigManager (Phase 1.5.0).
 *
 * NOTE: The original Phase 1.5.1 explicit `SUBAGENT_REGISTRY_SERVICE` registration
 * has been REMOVED. `registerVsCodeCoreServices` now delegates to the platform-
 * agnostic helper (`registerVsCodeCorePlatformAgnostic`), which guardedly
 * registers `SUBAGENT_REGISTRY_SERVICE` itself. Re-registering here would be a
 * redundant no-op.
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
 * Phase 0.
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
 *   - Phase 1.4.5: PLATFORM_COMMANDS, PLATFORM_AUTH_PROVIDER, SAVE_DIALOG_PROVIDER, MODEL_DISCOVERY
 *   - Phase 1.5:   delegates to `registerVsCodeCoreServices` which registers
 *                  13 tokens including the platform-agnostic block (RPC_HANDLER,
 *                  MESSAGE_VALIDATOR, AGENT_SESSION_WATCHER_SERVICE,
 *                  SUBAGENT_REGISTRY_SERVICE, FEATURE_GATE_SERVICE, SENTRY_SERVICE,
 *                  LICENSE_SERVICE, AUTH_SECRETS_SERVICE).
 *   - Phase 1.5.0: wires file-based settings into ConfigManager (TASK_2025_253).
 */
export function registerPhase1Infra(
  container: DependencyContainer,
  context: vscode.ExtensionContext,
  logger: Logger,
): void {
  // ========================================
  // PHASE 1.4.5: Platform Abstraction Implementations (TASK_2025_203)
  // ========================================
  // Must be registered BEFORE handler classes that depend on these tokens.
  container.registerSingleton(TOKENS.PLATFORM_COMMANDS, VsCodePlatformCommands);
  container.registerSingleton(
    TOKENS.PLATFORM_AUTH_PROVIDER,
    VsCodePlatformAuth,
  );
  container.registerSingleton(TOKENS.SAVE_DIALOG_PROVIDER, VsCodeSaveDialog);
  container.registerSingleton(TOKENS.MODEL_DISCOVERY, VsCodeModelDiscovery);

  // ========================================
  // PHASE 1.5: Register remaining vscode-core infrastructure services
  // ========================================
  // Also registers the platform-agnostic block via
  // `registerVsCodeCorePlatformAgnostic` (TASK_2025_291 Wave C1 Step 1).
  registerVsCodeCoreServices(container, context, logger);

  // ========================================
  // PHASE 1.5.0: Wire file-based settings into ConfigManager (TASK_2025_253)
  // ========================================
  // ConfigManager must route FILE_BASED_SETTINGS_KEYS to PtahFileSettingsManager
  // (~/.ptah/settings.json) instead of VS Code workspace config. These keys were
  // removed from package.json contributes.configuration (TASK_2025_247).
  const configManager = container.resolve<ConfigManager>(TOKENS.CONFIG_MANAGER);
  const workspaceProvider = container.resolve(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  ) as VscodeWorkspaceProvider;
  configManager.setFileSettingsStore(
    FILE_BASED_SETTINGS_KEYS,
    workspaceProvider.fileSettings,
  );

  // ========================================
  // PHASE 1.5.1: Subagent Registry Service — REMOVED
  // ========================================
  // Original Phase 1.5.1 registered TOKENS.SUBAGENT_REGISTRY_SERVICE here.
  // As of Wave C1 Step 1, `registerVsCodeCoreServices` delegates to
  // `registerVsCodeCorePlatformAgnostic`, which registers this token guardedly.
  // The explicit registration has been removed to eliminate the duplicate.
}
