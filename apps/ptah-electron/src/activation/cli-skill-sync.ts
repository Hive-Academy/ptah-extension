// CLI Skill Sync helper.
// Syncs Ptah plugin skills to installed CLI agent directories (Copilot, Gemini).
// Pro/trial_pro-only fire-and-forget. Caller is responsible for the tier gate.

import * as os from 'os';
import * as path from 'path';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  type PluginLoaderService,
} from '@ptah-extension/agent-sdk';

export function syncCliSkillsOnActivation(
  container: DependencyContainer,
  pluginsPath: string,
): void {
  try {
    const cliPluginSync = container.resolve(TOKENS.CLI_PLUGIN_SYNC_SERVICE) as {
      initialize: (
        globalState: IStateStorage,
        extensionPath: string,
        pluginPathResolver?: (ids: string[]) => string[],
      ) => void;
      syncOnActivation: (enabledPluginIds: string[]) => Promise<unknown[]>;
      syncSynthesizedSkillsOnActivation: (
        synthesizedSkillsRoot: string,
      ) => Promise<unknown[]>;
    };

    const pluginLoaderForSync = container.resolve<PluginLoaderService>(
      SDK_TOKENS.SDK_PLUGIN_LOADER,
    );

    const globalStateForSync = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    cliPluginSync.initialize(globalStateForSync, pluginsPath, (ids: string[]) =>
      pluginLoaderForSync.resolvePluginPaths(ids),
    );

    const syncPluginConfig = pluginLoaderForSync.getWorkspacePluginConfig();
    const enabledPluginIds = syncPluginConfig.enabledPluginIds || [];

    if (enabledPluginIds.length > 0) {
      cliPluginSync
        .syncOnActivation(enabledPluginIds)
        .then((results) => {
          console.log(
            `[Ptah Electron] CLI skill sync complete (${results.length} results)`,
          );
        })
        .catch((syncError) => {
          console.warn(
            '[Ptah Electron] CLI skill sync failed (non-blocking):',
            syncError instanceof Error ? syncError.message : String(syncError),
          );
        });
    } else {
      console.log(
        '[Ptah Electron] CLI skill sync skipped (no enabled plugins)',
      );
    }

    // Fire-and-forget: sync synthesized skills from ~/.ptah/skills/ to CLI agent dirs.
    // Non-blocking — never delays activation.
    const synthesizedRoot = path.join(os.homedir(), '.ptah', 'skills');
    cliPluginSync
      .syncSynthesizedSkillsOnActivation(synthesizedRoot)
      .then((results) => {
        console.log(
          `[Ptah Electron] Synthesized skill CLI sync complete (${results.length} results)`,
        );
      })
      .catch((err: unknown) => {
        console.warn(
          '[Ptah Electron] Synthesized skill CLI sync failed (non-blocking):',
          err instanceof Error ? err.message : String(err),
        );
      });
  } catch (cliSyncError) {
    console.warn(
      '[Ptah Electron] CLI skill sync setup failed (non-fatal):',
      cliSyncError instanceof Error
        ? cliSyncError.message
        : String(cliSyncError),
    );
  }
}
