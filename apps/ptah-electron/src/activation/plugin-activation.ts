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
import {
  SKILL_SYNTHESIS_TOKENS,
  type SkillCandidateStore,
  type SkillRegistryCatalogService,
  type SkillRegistryStore,
} from '@ptah-extension/skill-synthesis';

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
 * Electron-only enrichment: walk the user layer (the sidecars the mirror
 * already wrote) and upsert each clone into the SQLite skill_registry catalog,
 * linking synth rows to skill_candidates by name. Pure read-of-sidecars +
 * upsert; never mirrors the filesystem itself. Non-fatal on failure. Must run
 * AFTER mirrorUserLayer so the sidecars exist.
 */
export async function syncSkillRegistryCatalog(
  container: DependencyContainer,
): Promise<void> {
  try {
    if (
      !container.isRegistered(
        SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_CATALOG_SERVICE,
      )
    ) {
      return;
    }
    const catalog = container.resolve<SkillRegistryCatalogService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_CATALOG_SERVICE,
    );
    const result = await catalog.sync();
    console.log(
      `[Ptah Electron] Skill registry catalog synced (upserted: ${result.upserted}, linked: ${result.linked})`,
    );
  } catch (error) {
    console.warn(
      '[Ptah Electron] Skill registry catalog sync failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Reconcile cloned skills/commands/agents against the freshly re-downloaded
 * plugin sources. Must run AFTER mirrorUserLayer (create-if-absent) and only
 * when a download actually happened (caller gates on !fromCache). Fast-forwards
 * untouched clones, flags diverged ones in their sidecars (the SQLite-free
 * record VS Code also uses), and — Electron-only — persists the divergence into
 * the skill_registry catalog. Non-fatal on failure.
 */
export async function reconcileUserLayer(
  container: DependencyContainer,
  workspaceRoot: string | undefined,
  sqliteOpen: boolean,
): Promise<void> {
  try {
    const mirror = container.resolve<UserLayerMirrorService>(
      AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE,
    );
    const pluginLoader = container.resolve<PluginLoaderService>(
      SDK_TOKENS.SDK_PLUGIN_LOADER,
    );
    const config = pluginLoader.getWorkspacePluginConfig();
    const pluginPaths = pluginLoader.resolvePluginPaths(
      config.enabledPluginIds,
    );
    const synthesizedSkillsRoot = path.join(os.homedir(), '.ptah', 'skills');

    const result = await mirror.reconcile({
      pluginPaths,
      synthesizedSkillsRoot,
      ...(workspaceRoot
        ? { agentSourceDir: path.join(workspaceRoot, '.claude', 'agents') }
        : {}),
    });

    console.log(
      `[Ptah Electron] User-layer reconcile complete (noop: ${result.noop}, fastForwarded: ${result.fastForwarded}, diverged: ${result.diverged}, missingSidecar: ${result.missingSidecar}, errors: ${result.errors})`,
    );

    if (sqliteOpen && result.divergedSlugs.length > 0) {
      if (container.isRegistered(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE)) {
        const registry = container.resolve<SkillRegistryStore>(
          SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE,
        );
        for (const diverged of result.divergedSlugs) {
          registry.setDiverged(diverged.kind, diverged.slug, true);
          registry.setPending(
            diverged.kind,
            diverged.slug,
            diverged.pendingSourceHash,
          );
        }
      }
    }

    if (sqliteOpen && (result.fastForwarded > 0 || result.diverged > 0)) {
      await syncSkillRegistryCatalog(container);
    }
  } catch (error) {
    console.warn(
      '[Ptah Electron] User-layer reconcile failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Slugs of promoted skills currently marked dormant by the residency budget.
 * Folded into the junction layer's disabledSkillIds channel so dormant skills
 * are not junctioned into .claude/skills/ and therefore no longer occupy the
 * model's prompt budget. The candidate store is Electron-only (Thoth) and
 * resolved optionally so this no-ops cleanly when skill-synthesis is absent.
 */
function readDormantSkillSlugs(container: DependencyContainer): string[] {
  try {
    if (!container.isRegistered(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)) {
      return [];
    }
    const store = container.resolve<SkillCandidateStore>(
      SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE,
    );
    return store.listDormantPromotedSlugs();
  } catch (error) {
    console.warn(
      '[Ptah Electron] Failed to read dormant skill slugs (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
    return [];
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
      disabledSkillIds: [
        ...config.disabledSkillIds,
        ...readDormantSkillSlugs(container),
      ],
      getPluginPaths: () => pluginLoader.resolveCurrentPluginPaths(),
      getDisabledSkillIds: () => [
        ...pluginLoader.getDisabledSkillIds(),
        ...readDormantSkillSlugs(container),
      ],
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
