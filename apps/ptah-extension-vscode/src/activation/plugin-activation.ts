import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  PluginLoaderService,
  SkillJunctionService,
} from '@ptah-extension/agent-sdk';
import {
  AGENT_GENERATION_TOKENS,
  type UserLayerMirrorService,
  type UserLayerRoots,
} from '@ptah-extension/agent-generation';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { DIContainer } from '../di/container';

const USER_LAYER_MIRRORED_AT = 'user_layer_mirrored_at';

/** Initialize plugin loader with extension path. Non-fatal. */
export function initPluginLoader(pluginsPath: string, logger: Logger): void {
  try {
    const pluginLoader = DIContainer.resolve<PluginLoaderService>(
      SDK_TOKENS.SDK_PLUGIN_LOADER,
    );
    const workspaceStateStorage = DIContainer.resolve<IStateStorage>(
      PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
    );
    pluginLoader.initialize(pluginsPath, workspaceStateStorage);
    logger.info('Plugin loader initialized');
  } catch (pluginLoaderError) {
    logger.warn('Plugin loader initialization failed', {
      error:
        pluginLoaderError instanceof Error
          ? pluginLoaderError.message
          : String(pluginLoaderError),
    });
  }
}

/**
 * Mirror installed/downloaded skills, synthesized skills, and Claude agents
 * into the user layer (~/.ptah/user/). SQLite-free, so it runs in VS Code.
 * create-if-absent, safe to call every activation; the IStateStorage watermark
 * only skips the backfill log after the first run. Non-fatal on failure.
 *
 * Must run BEFORE activateSkillJunctions so the user layer is populated before
 * junctions are pointed at it.
 */
export async function mirrorUserLayer(
  workspaceRoot: string | undefined,
  logger: Logger,
): Promise<UserLayerRoots | null> {
  try {
    const mirror = DIContainer.resolve<UserLayerMirrorService>(
      AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE,
    );
    const stateStorage = DIContainer.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    const pluginLoader = DIContainer.resolve<PluginLoaderService>(
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
      logger.info('User-layer backfill complete', {
        skills: result.skillsMirrored,
        agents: result.agentsMirrored,
        commands: result.commandsMirrored,
      });
    }

    return mirror.getUserLayerRoots();
  } catch (mirrorError) {
    logger.warn('User-layer mirror failed (non-fatal)', {
      error:
        mirrorError instanceof Error
          ? mirrorError.message
          : String(mirrorError),
    });
    return null;
  }
}

/**
 * Create workspace skill junctions: project skill files from extension assets
 * into workspace .ptah/skills/ via junctions so third-party providers (Copilot,
 * Codex) can find skills via MCP workspace search. Non-fatal on failure.
 *
 * When `userRoots` is provided, junctions and command copies source from the
 * user layer (~/.ptah/user/) instead of the plugin directories.
 */
export function activateSkillJunctions(
  pluginsPath: string,
  logger: Logger,
  userRoots?: { skills: string; commands: string },
): void {
  try {
    const skillJunction = DIContainer.resolve<SkillJunctionService>(
      SDK_TOKENS.SDK_SKILL_JUNCTION,
    );
    skillJunction.initialize(pluginsPath);
    if (userRoots) {
      skillJunction.setSourceRoots(userRoots.skills, userRoots.commands);
    }
    const junctionPluginLoader = DIContainer.resolve<PluginLoaderService>(
      SDK_TOKENS.SDK_PLUGIN_LOADER,
    );
    const junctionPluginConfig =
      junctionPluginLoader.getWorkspacePluginConfig();
    const junctionPluginPaths = junctionPluginLoader.resolvePluginPaths(
      junctionPluginConfig.enabledPluginIds,
    );
    const junctionResult = skillJunction.activate({
      pluginPaths: junctionPluginPaths,
      disabledSkillIds: junctionPluginConfig.disabledSkillIds,
      getPluginPaths: () => junctionPluginLoader.resolveCurrentPluginPaths(),
      getDisabledSkillIds: () => junctionPluginLoader.getDisabledSkillIds(),
    });
    if (junctionResult.created > 0 || junctionResult.errors.length > 0) {
      logger.info('Skill junctions created', {
        created: junctionResult.created,
        skipped: junctionResult.skipped,
        removed: junctionResult.removed,
        errors:
          junctionResult.errors.length > 0 ? junctionResult.errors : undefined,
      });
    }
  } catch (skillJunctionError) {
    logger.warn('Skill junction creation failed (non-blocking)', {
      error:
        skillJunctionError instanceof Error
          ? skillJunctionError.message
          : String(skillJunctionError),
    });
  }
}
