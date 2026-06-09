import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  AGENT_GENERATION_TOKENS,
  type UserLayerMirrorService,
} from '@ptah-extension/agent-generation';

/**
 * Propagate user-layer skills/commands to installed rival CLIs at the
 * WORKSPACE level. Source = ~/.ptah/user/; skipped entirely when no workspace
 * is open. Fire-and-forget, non-fatal.
 */
export function syncCliSkillsOnActivation(
  container: DependencyContainer,
  workspaceRoot: string | undefined,
): void {
  try {
    const cliPluginSync = container.resolve(TOKENS.CLI_PLUGIN_SYNC_SERVICE) as {
      initialize: (globalState: IStateStorage) => void;
      syncOnActivation: (
        sources: { skillsRoot: string; commandsRoot: string },
        workspaceRoot: string | undefined,
      ) => Promise<unknown[]>;
    };

    const globalStateForSync = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    cliPluginSync.initialize(globalStateForSync);

    const mirror = container.resolve<UserLayerMirrorService>(
      AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE,
    );
    const roots = mirror.getUserLayerRoots();

    cliPluginSync
      .syncOnActivation(
        { skillsRoot: roots.skills, commandsRoot: roots.commands },
        workspaceRoot,
      )
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
  } catch (cliSyncError) {
    console.warn(
      '[Ptah Electron] CLI skill sync setup failed (non-fatal):',
      cliSyncError instanceof Error
        ? cliSyncError.message
        : String(cliSyncError),
    );
  }
}
