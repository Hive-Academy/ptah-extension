/**
 * CLI Settings Registration
 *
 * Wires SETTINGS_TOKENS into the tsyringe container for the CLI platform.
 * Must be called AFTER registerPlatformCliServices() (which registers
 * PLATFORM_TOKENS.WORKSPACE_PROVIDER) and BEFORE any library that resolves
 * settings repositories.
 *
 * Called from WP-3C (app-level bootstrap). NOT called here.
 *
 * WP-2B: Platform adapter creation.
 * WP-4A: Master key provider + SecretsFileStore wiring.
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
  SecretsFileStore,
  runV1Migration,
  runV2Migration,
  runV3Migration,
} from '@ptah-extension/settings-core';

import { FileSettingsStore } from './file-settings-store';
import { CliMasterKeyProvider } from './cli-master-key-provider';
import { CliWorkspaceProvider } from '../implementations/cli-workspace-provider';

/**
 * Register all settings-core tokens for the CLI platform.
 *
 * Registration order:
 * 1. CliMasterKeyProvider (keytar with HKDF fallback)
 * 2. SecretsFileStore (reads/writes ~/.ptah/secrets.enc.json)
 * 3. FileSettingsStore (raw backend adapter — global settings + encryption)
 * 4. ReactiveSettingsStore (wraps backend with in-process event emission)
 * 5. Per-namespace repositories (AuthSettings, ReasoningSettings, …)
 * 6. MigrationRunner (v1 + v2 + v3, pointed at ~/.ptah/)
 *
 * @param container - tsyringe DI container (must already have WORKSPACE_PROVIDER registered)
 */
export function registerCliSettings(container: DependencyContainer): void {
  const ptahDir = path.join(os.homedir(), '.ptah');

  // 1. Resolve the workspace provider that owns the shared PtahFileSettingsManager.
  const workspaceProvider = container.resolve<CliWorkspaceProvider>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );

  // 2. Master key provider — keytar with HKDF-SHA256 fallback.
  const masterKeyProvider = new CliMasterKeyProvider();
  container.register(SETTINGS_TOKENS.MASTER_KEY_PROVIDER, {
    useValue: masterKeyProvider,
  });

  // 3. Secrets file store — reads/writes ~/.ptah/secrets.enc.json.
  const secretsStore = new SecretsFileStore(ptahDir);

  // 4. Wrap PtahFileSettingsManager + encryption in the ISettingsStore port.
  const rawStore = new FileSettingsStore(
    workspaceProvider.fileSettings,
    masterKeyProvider,
    secretsStore,
  );

  // WP-5A: Enable cross-process reactivity so that when another process
  // (e.g. Electron main) writes to ~/.ptah/settings.json, this CLI process
  // fires listeners for the changed keys.
  // persistent: false (set inside enableCrossProcessWatch) ensures the watcher
  // does not block the headless CLI process from exiting normally.
  workspaceProvider.fileSettings.enableCrossProcessWatch();

  // 5. Add in-process reactivity layer.
  const reactiveStore = new ReactiveSettingsStore(rawStore);
  container.register(SETTINGS_TOKENS.SETTINGS_STORE, {
    useValue: reactiveStore,
  });

  // 6. Per-namespace repositories — each takes the reactive store.
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

  // 7. MigrationRunner — v1, v2, and v3 (gateway cipher migration).
  //    v3 is bound to this registration's masterKeyProvider.
  const boundV3 = (dir: string) => runV3Migration(dir, masterKeyProvider);
  container.register(SETTINGS_TOKENS.MIGRATION_RUNNER, {
    useValue: new MigrationRunner(ptahDir, [
      runV1Migration,
      runV2Migration,
      boundV3,
    ]),
  });
}
