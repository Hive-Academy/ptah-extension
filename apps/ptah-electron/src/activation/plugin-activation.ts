import * as os from 'os';
import * as path from 'path';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  type PluginLoaderService,
  type SkillJunctionService,
} from '@ptah-extension/agent-sdk';
import {
  AGENT_GENERATION_TOKENS,
  type UserLayerMirrorService,
  type UserLayerRoots,
} from '@ptah-extension/agent-generation';

const USER_LAYER_MIRRORED_AT = 'user_layer_mirrored_at';

/** Phase 4.55: initialize plugin loader. Non-fatal on failure. */
export function initPluginLoader(
  container: DependencyContainer,
  pluginsPath: string,
): void {
  try {
    const pluginLoader = container.resolve<PluginLoaderService>(
      SDK_TOKENS.SDK_PLUGIN_LOADER,
    );
    const workspaceStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    pluginLoader.initialize(pluginsPath, workspaceStateStorage);

    const pluginConfig = pluginLoader.getWorkspacePluginConfig();
    const pluginPaths = pluginLoader.resolvePluginPaths(
      pluginConfig.enabledPluginIds,
    );
    console.log(
      `[Ptah Electron] Plugin loader initialized (${pluginPaths.length} plugin paths)`,
    );
  } catch (error) {
    console.warn(
      '[Ptah Electron] Plugin loader initialization failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Mirror installed/downloaded skills, synthesized skills, and Claude agents
 * into the user layer (~/.ptah/user/). create-if-absent, so it is safe to call
 * on every activation; the IStateStorage watermark only skips the directory
 * walk after the first successful backfill. Non-fatal on failure.
 *
 * Must run BEFORE activateSkillJunctions so the user layer is populated before
 * junctions are pointed at it.
 */
export async function mirrorUserLayer(
  container: DependencyContainer,
  workspaceRoot: string | undefined,
): Promise<UserLayerRoots | null> {
  try {
    const mirror = container.resolve<UserLayerMirrorService>(
      AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE,
    );
    const stateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    const pluginLoader = container.resolve<PluginLoaderService>(
      SDK_TOKENS.SDK_PLUGIN_LOADER,
    );
    const config = pluginLoader.getWorkspacePluginConfig();
    const pluginPaths = pluginLoader.resolvePluginPaths(
      config.enabledPluginIds,
    );
    const synthesizedSkillsRoot = path.join(os.homedir(), '.ptah', 'skills');

    const result = await mirror.mirrorAll({
      pluginPaths,
      synthesizedSkillsRoot,
      ...(workspaceRoot
        ? { agentSourceDir: path.join(workspaceRoot, '.claude', 'agents') }
        : {}),
    });

    const firstBackfill =
      stateStorage.get<number>(USER_LAYER_MIRRORED_AT) === undefined;
    if (firstBackfill) {
      await stateStorage.update(USER_LAYER_MIRRORED_AT, Date.now());
      console.log(
        `[Ptah Electron] User-layer backfill complete (skills: ${result.skillsMirrored}, agents: ${result.agentsMirrored}, commands: ${result.commandsMirrored})`,
      );
    }

    return mirror.getUserLayerRoots();
  } catch (error) {
    console.warn(
      '[Ptah Electron] User-layer mirror failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Phase 4.56: activate skill junctions and return the service handle so the
 * caller can deactivate it during will-quit. Non-fatal on failure.
 *
 * When `userRoots` is provided, junctions and command copies source from the
 * user layer (~/.ptah/user/) instead of the plugin directories.
 */
export function activateSkillJunctions(
  container: DependencyContainer,
  pluginsPath: string,
  userRoots?: { skills: string; commands: string },
): { deactivateSync: () => void } | null {
  try {
    const skillJunction = container.resolve<SkillJunctionService>(
      SDK_TOKENS.SDK_SKILL_JUNCTION,
    );
    const synthesizedSkillsRoot = path.join(os.homedir(), '.ptah', 'skills');
    skillJunction.initialize(pluginsPath, synthesizedSkillsRoot);
    if (userRoots) {
      skillJunction.setSourceRoots(userRoots.skills, userRoots.commands);
    }

    const pluginLoader = container.resolve<PluginLoaderService>(
      SDK_TOKENS.SDK_PLUGIN_LOADER,
    );
    const config = pluginLoader.getWorkspacePluginConfig();
    const paths = pluginLoader.resolvePluginPaths(config.enabledPluginIds);

    const junctionResult = skillJunction.activate({
      pluginPaths: paths,
      disabledSkillIds: config.disabledSkillIds,
      getPluginPaths: () => pluginLoader.resolveCurrentPluginPaths(),
      getDisabledSkillIds: () => pluginLoader.getDisabledSkillIds(),
    });

    if (junctionResult.created > 0 || junctionResult.errors.length > 0) {
      console.log(
        `[Ptah Electron] Skill junctions: ${junctionResult.created} created, ${junctionResult.skipped} skipped, ${junctionResult.removed} removed, ${junctionResult.errors.length} errors`,
      );
    } else {
      console.log('[Ptah Electron] Skill junctions activated');
    }

    return skillJunction;
  } catch (error) {
    console.warn(
      '[Ptah Electron] Skill junction activation failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
