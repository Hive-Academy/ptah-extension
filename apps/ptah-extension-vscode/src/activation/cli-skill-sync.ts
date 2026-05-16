// CLI Skill Sync helper: syncs Ptah plugin skills to installed CLI agent
// directories (Copilot, Gemini). Pro/trial_pro-only fire-and-forget.
// Caller is responsible for the tier gate.
// Mirrors the Electron sibling (apps/ptah-electron/src/activation/cli-skill-sync.ts).

import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, PluginLoaderService } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { DIContainer } from '../di/container';

export function syncCliSkillsOnActivation(
  pluginsPath: string,
  logger: Logger,
): void {
  try {
    const cliPluginSync = DIContainer.getContainer().resolve(
      TOKENS.CLI_PLUGIN_SYNC_SERVICE,
    ) as {
      initialize: (
        globalState: IStateStorage,
        extensionPath: string,
        pluginPathResolver?: (ids: string[]) => string[],
      ) => void;
      syncOnActivation: (enabledPluginIds: string[]) => Promise<unknown[]>;
    };

    // Resolve enabled plugin IDs (pluginLoader must be resolved before initialize
    // so we can pass its resolvePluginPaths as the validated path resolver)
    const pluginLoader = DIContainer.resolve<PluginLoaderService>(
      SDK_TOKENS.SDK_PLUGIN_LOADER,
    );

    // Late-initialize with global state storage, extension path, and validated path resolver
    const globalStateStorage = DIContainer.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    cliPluginSync.initialize(globalStateStorage, pluginsPath, (ids: string[]) =>
      pluginLoader.resolvePluginPaths(ids),
    );
    const pluginConfig = pluginLoader.getWorkspacePluginConfig();
    const enabledPluginIds = pluginConfig.enabledPluginIds || [];

    if (enabledPluginIds.length > 0) {
      // Fire-and-forget: sync skills in background
      cliPluginSync
        .syncOnActivation(enabledPluginIds)
        .then((results) => {
          logger.info('CLI skill sync complete', {
            results: results.length,
          });
        })
        .catch((syncError) => {
          logger.debug('CLI skill sync failed (non-blocking)', {
            error:
              syncError instanceof Error
                ? syncError.message
                : String(syncError),
          });
        });
    } else {
      logger.debug('CLI skill sync skipped (no enabled plugins)');
    }
  } catch (cliSyncError) {
    logger.debug('CLI skill sync setup failed (non-blocking)', {
      error:
        cliSyncError instanceof Error
          ? cliSyncError.message
          : String(cliSyncError),
    });
  }
}
