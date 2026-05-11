/**
 * VS Code Settings Registration
 *
 * Wires SETTINGS_TOKENS into the tsyringe container for the VS Code platform.
 * Must be called AFTER registerPlatformVscodeServices() (which registers
 * PLATFORM_TOKENS.WORKSPACE_PROVIDER) and BEFORE any library that resolves
 * settings repositories.
 *
 * The vscode module is accepted as a parameter rather than imported at the
 * top level. This preserves the ability to compile platform-vscode without
 * the VS Code runtime loaded (e.g., in unit tests or static analysis).
 *
 * Called from WP-3C (app-level bootstrap). NOT called here.
 *
 * WP-2B: Platform adapter creation.
 */

import * as os from 'os';
import * as path from 'path';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  SETTINGS_TOKENS,
  ReactiveSettingsStore,
  AuthSettings,
  ReasoningSettings,
  ModelSettings,
  CliSubagentSettings,
  ProviderSettings,
  GatewaySettings,
  MemorySettings,
  SkillSynthesisSettings,
  CronSettings,
  MigrationRunner,
  runV1Migration,
  runV2Migration,
} from '@ptah-extension/settings-core';

import {
  VscodeSettingsAdapter,
  type VscodeApiSlice,
} from './vscode-settings-adapter';
import { VscodeWorkspaceProvider } from '../implementations/vscode-workspace-provider';

/**
 * Register all settings-core tokens for the VS Code platform.
 *
 * Registration order:
 * 1. VscodeSettingsAdapter (raw backend adapter with file/VS Code routing)
 * 2. ReactiveSettingsStore (wraps backend with in-process event emission)
 * 3. Per-namespace repositories (AuthSettings, ReasoningSettings, …)
 * 4. MigrationRunner (pointed at ~/.ptah/)
 *
 * @param container - tsyringe DI container (must already have WORKSPACE_PROVIDER registered)
 * @param vscodeModule - the vscode API module (passed in, not imported, for compile safety)
 */
export function registerVscodeSettings(
  container: DependencyContainer,
  vscodeModule: VscodeApiSlice,
): void {
  // 1. Resolve the workspace provider that owns the shared PtahFileSettingsManager.
  const workspaceProvider = container.resolve<VscodeWorkspaceProvider>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );

  // 2. Wrap in the ISettingsStore port with file/VS Code routing.
  const rawStore = new VscodeSettingsAdapter(workspaceProvider, vscodeModule);

  // 3. Add in-process reactivity layer.
  const reactiveStore = new ReactiveSettingsStore(rawStore);
  container.register(SETTINGS_TOKENS.SETTINGS_STORE, {
    useValue: reactiveStore,
  });

  // 4. Per-namespace repositories — each takes the reactive store.
  container.register(SETTINGS_TOKENS.AUTH_SETTINGS, {
    useValue: new AuthSettings(reactiveStore),
  });
  container.register(SETTINGS_TOKENS.REASONING_SETTINGS, {
    useValue: new ReasoningSettings(reactiveStore),
  });
  container.register(SETTINGS_TOKENS.MODEL_SETTINGS, {
    useValue: new ModelSettings(reactiveStore),
  });
  container.register(SETTINGS_TOKENS.CLI_SUBAGENT_SETTINGS, {
    useValue: new CliSubagentSettings(reactiveStore),
  });
  container.register(SETTINGS_TOKENS.PROVIDER_SETTINGS, {
    useValue: new ProviderSettings(reactiveStore),
  });
  container.register(SETTINGS_TOKENS.GATEWAY_SETTINGS, {
    useValue: new GatewaySettings(reactiveStore),
  });
  container.register(SETTINGS_TOKENS.MEMORY_SETTINGS, {
    useValue: new MemorySettings(reactiveStore),
  });
  container.register(SETTINGS_TOKENS.SKILL_SYNTHESIS_SETTINGS, {
    useValue: new SkillSynthesisSettings(reactiveStore),
  });
  container.register(SETTINGS_TOKENS.CRON_SETTINGS, {
    useValue: new CronSettings(reactiveStore),
  });

  // 5. MigrationRunner — pointed at ~/.ptah/ directory.
  const ptahDir = path.join(os.homedir(), '.ptah');
  container.register(SETTINGS_TOKENS.MIGRATION_RUNNER, {
    useValue: new MigrationRunner(ptahDir, [runV1Migration, runV2Migration]),
  });
}
