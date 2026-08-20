import * as path from 'path';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  ContentDownloadService,
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  type PluginLoaderService,
} from '@ptah-extension/agent-sdk';
import {
  HARNESS_SYNC_TOKENS,
  type HarnessPropagationService,
  type HarnessReconcilerService,
} from '@ptah-extension/harness-sync';
import {
  AGENT_GENERATION_TOKENS,
  type MirrorSources,
  type UserLayerMirrorService,
  type UserLayerRoots,
} from '@ptah-extension/agent-generation';
import { initializePluginMarketplace } from '@ptah-extension/plugin-marketplace';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import {
  SKILL_SYNTHESIS_TOKENS,
  resolveSkillsRoot,
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
    // Same base path, same moment: PluginLoaderService asks this store whether
    // an external plugin id was consented to, and an unbound store reports an
    // empty allowlist — so the two must never be initialized apart.
    initializePluginMarketplace(container, pluginsPath);

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
 * The ONE `MirrorSources` block both user-layer passes feed to
 * `UserLayerMirrorService`. Built in a single place because mirror and reconcile
 * must never disagree about what the sources ARE: the reap half of
 * `reconcileAll()` reads "not among the supplied roots" as "upstream deleted",
 * so a reconcile walking fewer roots than the mirror would reap live clones.
 *
 * Four fields, three of them absent before TASK_2026_278 Batch 1b:
 * - `harnessPluginRoots` — the `ptah-harness-*` dirs the harness builder writes.
 *   They come from a different producer than `pluginPaths` and were present in
 *   every junction call while missing from every mirror call (defect 6).
 * - `pluginsBasePath` — lets the reap pass tell a DISABLED plugin (dir present,
 *   clones kept) from an UNINSTALLED one (dir gone, clones reaped).
 * - `synthesizedSkillsRoot` — through `resolveSkillsRoot`, not
 *   `~/.ptah/skills`, so promotion and the mirror cannot be pointed at two
 *   different roots by `skillSynthesis.skillsRoot`.
 */
function buildMirrorSources(
  container: DependencyContainer,
  workspaceRoot: string | undefined,
): MirrorSources {
  const pluginLoader = container.resolve<PluginLoaderService>(
    SDK_TOKENS.SDK_PLUGIN_LOADER,
  );
  const contentDownload = container.resolve<ContentDownloadService>(
    PLATFORM_TOKENS.CONTENT_DOWNLOAD,
  );
  const workspaceProvider = container.resolve<IWorkspaceProvider>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );
  const config = pluginLoader.getWorkspacePluginConfig();

  return {
    pluginPaths: pluginLoader.resolvePluginPaths(config.enabledPluginIds),
    harnessPluginRoots: pluginLoader.discoverHarnessPluginPaths(),
    pluginsBasePath: contentDownload.getPluginsPath(),
    synthesizedSkillsRoot: resolveSkillsRoot(workspaceProvider),
    ...(workspaceRoot
      ? { agentSourceDir: path.join(workspaceRoot, '.claude', 'agents') }
      : {}),
  };
}

/**
 * Mirror installed/downloaded skills, synthesized skills, and Claude agents
 * into the user layer (~/.ptah/user/). create-if-absent, so it is safe to call
 * on every activation. The IStateStorage watermark skips no work — it gates the
 * backfill log line only; the directory walk runs every activation and must, so
 * newly-added slugs get clones. Refreshing an EXISTING clone is not this
 * function's job and never was: that is reconcileUserLayer below.
 * Non-fatal on failure.
 *
 * Must run BEFORE reconcileHarness: the reconciler's desired state IS the user
 * layer, so reconciling an unmirrored layer copies nothing.
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

    const result = await mirror.mirrorAll(
      buildMirrorSources(container, workspaceRoot),
    );

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
 * Reconcile cloned skills/commands/agents against their upstream sources, and
 * sweep clones whose upstream is gone. Must run AFTER mirrorUserLayer
 * (create-if-absent), and now runs UNCONDITIONALLY — the old `!fromCache` gate
 * meant a clone edited between two cached activations was never noticed and an
 * upstream deletion was never reaped at all (defect 8). Both halves are a
 * directory walk plus a content hash, so a no-change pass is cheap.
 *
 * Fast-forwards untouched clones, flags diverged ones in their sidecars (the
 * SQLite-free record VS Code also uses), reaps clones with no local work whose
 * upstream vanished, keeps + flags the diverged ones as `orphaned`, and —
 * Electron-only — persists all of that into the skill_registry catalog.
 * Non-fatal on failure.
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

    const result = await mirror.reconcileAll(
      buildMirrorSources(container, workspaceRoot),
    );

    console.log(
      `[Ptah Electron] User-layer reconcile complete (noop: ${result.noop}, fastForwarded: ${result.fastForwarded}, diverged: ${result.diverged}, reaped: ${result.reaped}, orphaned: ${result.orphaned}, missingSidecar: ${result.missingSidecar}, errors: ${result.errors})`,
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

    // A reap DELETES a user-layer clone and an orphan re-flags one, so both
    // change what the catalog should hold just as much as a fast-forward does.
    // Leaving them out left reaped skills listed in the Library forever.
    if (
      sqliteOpen &&
      (result.fastForwarded > 0 ||
        result.diverged > 0 ||
        result.reaped > 0 ||
        result.orphaned > 0)
    ) {
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
 * The `IUserLayerRefresher` this host hands `harness-sync` at registration.
 *
 * `HarnessPropagationService` runs this before every reconcile it performs, so
 * a trigger that changed an UPSTREAM source — a promoted synth skill, a
 * harness-builder plugin dir, an agent the wizard wrote into
 * `{ws}/.claude/agents` — is visible in `~/.ptah/user` by the time the
 * reconciler reads it. Without this port a repropagation event reconciled the
 * PREVIOUS state and logged a clean pass (TASK_2026_278 Batch 3).
 *
 * Both halves, in the activation order: `mirrorUserLayer` is create-if-absent
 * and picks up new slugs; `reconcileUserLayer` fast-forwards existing clones
 * and reaps the ones whose upstream is gone. An uninstall needs the second
 * half specifically — see `deactivateExternalPlugin` in `plugin-rpc.handlers`.
 *
 * `sqliteOpen` is derived from the container rather than passed in, because
 * this runs long after `wire-runtime` computed its copy and the connection can
 * have opened (or closed) since.
 */
export function createUserLayerRefresher(container: DependencyContainer): {
  refresh(workspaceRoot: string | undefined): Promise<void>;
} {
  return {
    async refresh(workspaceRoot: string | undefined): Promise<void> {
      await mirrorUserLayer(container, workspaceRoot);
      await reconcileUserLayer(
        container,
        workspaceRoot,
        isSqliteOpen(container),
      );
    },
  };
}

function isSqliteOpen(container: DependencyContainer): boolean {
  try {
    if (!container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)) {
      return false;
    }
    const connection = container.resolve<{ isOpen: boolean }>(
      PERSISTENCE_TOKENS.SQLITE_CONNECTION,
    );
    return connection.isOpen === true;
  } catch {
    return false;
  }
}

/**
 * Slugs of promoted skills currently marked dormant by the residency budget.
 * Folded into the reconciler's disabledSkillIds channel so dormant skills are
 * not copied into .claude/skills/ and therefore no longer occupy the model's
 * prompt budget. The candidate store is Electron-only (Thoth) and resolved
 * optionally so this no-ops cleanly when skill-synthesis is absent.
 */
export function readDormantSkillSlugs(
  container: DependencyContainer,
): string[] {
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
 * Reconcile the workspace harness: copy every enabled skill and command from
 * the user layer into `{ws}/.claude/{skills,commands}` (TASK_2026_278).
 *
 * Replaces `activateSkillJunctions`. Artifacts are copies rather than NTFS
 * junctions, so they survive this process exiting and are readable by
 * `ptah tui`, the headless CLI, the gateway and a plain `claude` invocation.
 * Nothing is torn down on `will-quit` — which is why this returns no handle.
 *
 * Non-fatal by contract: a workspace that cannot be written must never block
 * boot. Failures land in the health report instead.
 */
export async function reconcileHarness(
  container: DependencyContainer,
  workspaceRoot: string | undefined,
  reason: string,
  options: { downloadPending?: boolean } = {},
): Promise<void> {
  if (workspaceRoot === undefined) {
    return;
  }
  try {
    const reconciler = container.resolve<HarnessReconcilerService>(
      HARNESS_SYNC_TOKENS.RECONCILER,
    );
    const health = await reconciler.reconcile(workspaceRoot, {
      mode: 'full',
      reason,
      ...(options.downloadPending === true ? { downloadPending: true } : {}),
    });
    const claude = health.targets.find((target) => target.target === 'claude');
    console.log(
      `[Ptah Electron] Harness reconciled (${reason}): sources=${health.sources}, ` +
        `found=${claude?.found ?? 0}/${claude?.expected ?? 0}, ` +
        `foreign=${claude?.foreign.length ?? 0}, ` +
        `writeFailed=${claude?.writeFailed.length ?? 0}`,
    );
  } catch (error) {
    console.warn(
      '[Ptah Electron] Harness reconcile failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Refresh the user layer for `workspaceRoot`, THEN reconcile it — the full
 * pass, not the bare reconcile.
 *
 * This is what a workspace-folder change needs and what it did not get. The
 * reconciler's desired state IS `~/.ptah/user`, and one of that layer's sources
 * is `{ws}/.claude/agents` — a per-WORKSPACE directory. Switching folders
 * therefore changes the sources, and a bare `reconcile` propagated the previous
 * workspace's agents into the new one and logged a clean pass. `propagate` runs
 * `mirrorUserLayer` + `reconcileUserLayer` first, which is exactly the ordering
 * `bootHeavyServices` performs by hand at activation.
 *
 * Falls back to a bare reconcile when propagation is not registered — a host
 * phase that never wired `harness-sync`'s trigger surface should still get the
 * old behaviour rather than nothing. Non-fatal by contract.
 */
export async function propagateHarness(
  container: DependencyContainer,
  workspaceRoot: string | undefined,
  reason: string,
): Promise<void> {
  if (workspaceRoot === undefined) {
    return;
  }
  try {
    if (!container.isRegistered(HARNESS_SYNC_TOKENS.PROPAGATION)) {
      await reconcileHarness(container, workspaceRoot, reason);
      return;
    }
    const propagation = container.resolve<HarnessPropagationService>(
      HARNESS_SYNC_TOKENS.PROPAGATION,
    );
    const health = await propagation.propagate(workspaceRoot, reason);
    const claude = health?.targets.find((target) => target.target === 'claude');
    console.log(
      `[Ptah Electron] Harness propagated (${reason}): sources=${health?.sources ?? 'unknown'}, ` +
        `found=${claude?.found ?? 0}/${claude?.expected ?? 0}`,
    );
  } catch (error) {
    console.warn(
      '[Ptah Electron] Harness propagation failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}
