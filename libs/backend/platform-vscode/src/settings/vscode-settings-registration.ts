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
 * The `context` parameter is required so that `context.secrets` (VS Code's
 * SecretStorage) can be wired into VscodeMasterKeyProvider.
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

import {
  VscodeSettingsAdapter,
  type VscodeApiSlice,
} from './vscode-settings-adapter';
import { VscodeWorkspaceProvider } from '../implementations/vscode-workspace-provider';
import {
  VscodeMasterKeyProvider,
  type VscodeSecretStorageSlice,
} from './vscode-master-key-provider';

/**
 * Minimal slice of vscode.ExtensionContext required by this registration.
 * Typed structurally to avoid a hard `vscode` import.
 */
export interface VscodeContextSlice {
  secrets: VscodeSecretStorageSlice;
}

/**
 * Register all settings-core tokens for the VS Code platform.
 *
 * Registration order:
 * 1. VscodeMasterKeyProvider (backed by vscode.SecretStorage)
 * 2. SecretsFileStore (reads/writes ~/.ptah/secrets.enc.json)
 * 3. VscodeSettingsAdapter (raw backend adapter — global + secret routing)
 * 4. ReactiveSettingsStore (wraps backend with in-process event emission)
 * 5. Per-namespace repositories (AuthSettings, ReasoningSettings, …)
 * 6. MigrationRunner (v1 + v2 + v3, pointed at ~/.ptah/)
 *
 * @param container   - tsyringe DI container (must already have WORKSPACE_PROVIDER registered)
 * @param vscodeModule - the vscode API module (passed in, not imported, for compile safety)
 * @param context      - vscode.ExtensionContext (used to access context.secrets)
 */
export function registerVscodeSettings(
  container: DependencyContainer,
  vscodeModule: VscodeApiSlice,
  context: VscodeContextSlice,
): void {
  const ptahDir = path.join(os.homedir(), '.ptah');

  // 1. Resolve the workspace provider that owns the shared PtahFileSettingsManager.
  const workspaceProvider = container.resolve<VscodeWorkspaceProvider>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );

  // 2. Master key provider — backed by vscode.SecretStorage.
  const masterKeyProvider = new VscodeMasterKeyProvider(context.secrets);
  container.register(SETTINGS_TOKENS.MASTER_KEY_PROVIDER, {
    useValue: masterKeyProvider,
  });

  // 3. Secrets file store — reads/writes ~/.ptah/secrets.enc.json.
  const secretsStore = new SecretsFileStore(ptahDir);

  // 4. Wrap in the ISettingsStore port with file/VS Code routing + encryption.
  const rawStore = new VscodeSettingsAdapter(
    workspaceProvider,
    vscodeModule,
    masterKeyProvider,
    secretsStore,
  );

  // WP-5A: Enable cross-process reactivity so that if Electron or CLI writes
  // to ~/.ptah/settings.json while this VS Code extension process is running,
  // file-based setting listeners receive the updated values.
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
  //    v3 is bound to this registration's masterKeyProvider so it can
  //    encrypt the migrated values without needing a separate DI lookup.
  const boundV3 = (dir: string) => runV3Migration(dir, masterKeyProvider);
  container.register(SETTINGS_TOKENS.MIGRATION_RUNNER, {
    useValue: new MigrationRunner(ptahDir, [
      runV1Migration,
      runV2Migration,
      boundV3,
    ]),
  });
}
