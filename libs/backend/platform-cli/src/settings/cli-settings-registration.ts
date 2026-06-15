/**
 * CLI Settings Registration
 *
 * Wires SETTINGS_TOKENS into the tsyringe container for the CLI platform.
 * Must be called AFTER registerPlatformCliServices() (which registers
 * PLATFORM_TOKENS.WORKSPACE_PROVIDER) and BEFORE any library that resolves
 * settings repositories.
 *
 * Called from app-level bootstrap. NOT called here.
 */

import * as os from 'os';
import * as path from 'path';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IPlatformInfo } from '@ptah-extension/platform-core';
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
  WorkspaceScopeResolver,
  appScopePrefixFor,
  runV1Migration,
  runV2Migration,
  runV3Migration,
  runV4Migration,
} from '@ptah-extension/settings-core';
import type { IActiveWorkspaceSource } from '@ptah-extension/settings-core';

import { FileSettingsStore } from './file-settings-store';
import { CliMasterKeyProvider } from './cli-master-key-provider';
import { CliWorkspaceProvider } from '../implementations/cli-workspace-provider';
import type { IUserInteraction } from '@ptah-extension/platform-core';

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
 * @param ptahDirOverride - optional override for the ~/.ptah directory
 */
export function registerCliSettings(
  container: DependencyContainer,
  ptahDirOverride?: string,
): void {
  const ptahDir = ptahDirOverride ?? path.join(os.homedir(), '.ptah');
  const workspaceProvider = container.resolve<CliWorkspaceProvider>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );
  const userInteraction = container.resolve<IUserInteraction>(
    PLATFORM_TOKENS.USER_INTERACTION,
  );
  const masterKeyProvider = new CliMasterKeyProvider(userInteraction);
  container.register(SETTINGS_TOKENS.MASTER_KEY_PROVIDER, {
    useValue: masterKeyProvider,
  });
  const secretsStore = new SecretsFileStore(ptahDir);
  const rawStore = new FileSettingsStore(
    workspaceProvider.fileSettings,
    masterKeyProvider,
    secretsStore,
  );
  workspaceProvider.fileSettings.enableCrossProcessWatch();
  const reactiveStore = new ReactiveSettingsStore(rawStore);
  container.register(SETTINGS_TOKENS.SETTINGS_STORE, {
    useValue: reactiveStore,
  });
  const appPrefix = resolveAppPrefix(container);
  const scopeResolver = container.isRegistered(
    SETTINGS_TOKENS.ACTIVE_WORKSPACE_SOURCE,
  )
    ? new WorkspaceScopeResolver(
        reactiveStore,
        container.resolve<IActiveWorkspaceSource>(
          SETTINGS_TOKENS.ACTIVE_WORKSPACE_SOURCE,
        ),
        appPrefix,
      )
    : undefined;
  if (scopeResolver) {
    container.register(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER, {
      useValue: scopeResolver,
    });
  }
  container.register(SETTINGS_TOKENS.AUTH_SETTINGS, {
    useValue: new AuthSettings(reactiveStore),
  });
  container.register(SETTINGS_TOKENS.REASONING_SETTINGS, {
    useValue: new ReasoningSettings(reactiveStore, scopeResolver),
  });
  container.register(SETTINGS_TOKENS.MODEL_SETTINGS, {
    useValue: new ModelSettings(reactiveStore, scopeResolver),
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
  const boundV3 = (dir: string) => runV3Migration(dir, masterKeyProvider);
  const boundV4 = (dir: string) => runV4Migration(dir, appPrefix);
  container.register(SETTINGS_TOKENS.MIGRATION_RUNNER, {
    useValue: new MigrationRunner(ptahDir, [
      runV1Migration,
      runV2Migration,
      boundV3,
      boundV4,
    ]),
  });
}

function resolveAppPrefix(container: DependencyContainer): string | undefined {
  if (!container.isRegistered(PLATFORM_TOKENS.PLATFORM_INFO)) {
    return undefined;
  }
  const info = container.resolve<IPlatformInfo>(PLATFORM_TOKENS.PLATFORM_INFO);
  const type = info.type;
  if (typeof type !== 'string' || type.trim() === '' || type === 'web') {
    return undefined;
  }
  return appScopePrefixFor(type);
}
