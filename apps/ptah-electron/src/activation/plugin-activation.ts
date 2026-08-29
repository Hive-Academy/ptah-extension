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
  summarizeHarnessHealth,
  type HarnessHealth,
} from '@ptah-extension/shared';
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

import { createCoalescedJob, type CoalescedJob } from './coalesced-job';
import { normalizeWorkspaceRoot } from './workspace-root-key';

const USER_LAYER_MIRRORED_AT = 'user_layer_mirrored_at';

/**
 * How long the user-layer pass collects triggers before it runs
 * (TASK_2026_345).
 *
 * A workspace switch fires up to four independent triggers — `activation`
 * (the one-shot heavy boot), `workspace-folders-changed` (the propagation the
 * folder listener issues), `content-download-complete`, and an `addFolder`
 * immediately followed by a `switch`. They arrive within a few hundred
 * milliseconds of each other and each asked for the same walk of
 * `~/.ptah/user`, so one switch to `property-hub` ran the mirror twice and the
 * catalog sync four times (`tmp/logs/log.log:1206-1223`).
 *
 * 300 ms is chosen to be comfortably wider than the gap between two triggers
 * that share a cause (the folder listener and the boot's own pass are separated
 * by a handful of `await`s on already-warm DI resolutions, measured in single
 * milliseconds) and far narrower than the gap between two triggers with
 * DIFFERENT causes — `content-download-complete` follows the network, and a
 * user toggling a plugin is seconds away. It is not a rate limit: a trigger
 * that arrives after a pass has drained always gets its own pass.
 *
 * The delay is paid on the post-window boot path, which is behind the visible
 * window by construction (TASK_2026_331), and never on anything the renderer
 * waits for.
 */
export const USER_LAYER_COALESCE_WINDOW_MS = 300;

/**
 * The raw workspace root a request carries, alongside the normalized key the
 * batch is filed under.
 *
 * The key folds case and separators so two spellings of one directory join one
 * pass; the payload keeps the ORIGINAL string, because that is what
 * `path.join(root, '.claude', 'agents')` has to be given on a case-sensitive
 * filesystem.
 */
interface UserLayerPassPayload {
  workspaceRoot: string | undefined;
}

/**
 * One coalescer per container.
 *
 * The container is the process-scope handle these free functions already share
 * — `boot-heavy-services.ts`, the DI-registered `IUserLayerRefresher` and every
 * RPC handler that propagates all hold the same one — so keying off it gives a
 * single coalescer per app without a module-level singleton that would leak
 * between test files.
 */
const coalescersByContainer = new WeakMap<
  DependencyContainer,
  CoalescedJob<UserLayerPassPayload>
>();

function userLayerJobFor(
  container: DependencyContainer,
): CoalescedJob<UserLayerPassPayload> {
  const existing = coalescersByContainer.get(container);
  if (existing !== undefined) return existing;

  const created = createCoalescedJob<UserLayerPassPayload>({
    windowMs: USER_LAYER_COALESCE_WINDOW_MS,
    run: async ({ reasons, payload }) =>
      runUserLayerPass(container, payload.workspaceRoot, reasons),
  });
  coalescersByContainer.set(container, created);
  return created;
}

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

    // The catalog sync used to live HERE, gated on
    // `fastForwarded || diverged || reaped || orphaned`, while the heavy boot
    // ALSO fired an unconditional one immediately after calling this function.
    // Two call sites plus two passes per switch is where the four syncs of
    // `tmp/logs/log.log:1206-1223` came from. It now runs exactly once per
    // coalesced pass, in `runUserLayerPass` below, which is the only place that
    // knows a pass has finished. Do not add a third call site here.
  } catch (error) {
    console.warn(
      '[Ptah Electron] User-layer reconcile failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * The whole user-layer pass, in the one order it is ever correct in.
 *
 * `mirrorUserLayer` is create-if-absent and picks up new slugs;
 * `reconcileUserLayer` fast-forwards existing clones, flags divergence and
 * reaps the ones whose upstream is gone; the catalog sync then writes what the
 * two of them just settled into `skill_registry`.
 *
 * Private, and reached ONLY through {@link refreshUserLayer}'s coalescer —
 * running two of these concurrently against the same tree is the interleaving
 * defect this task closes, and a direct export would be a way to do it again.
 *
 * `sqliteOpen` is read HERE rather than passed in, because a pass can start a
 * coalescing window before `bootThothRuntime` has opened the database and run
 * after it has.
 */
async function runUserLayerPass(
  container: DependencyContainer,
  workspaceRoot: string | undefined,
  reasons: readonly string[],
): Promise<void> {
  console.log(`[Ptah Electron] User-layer pass (${reasons.join(' + ')})`);
  await mirrorUserLayer(container, workspaceRoot);
  const sqliteOpen = isSqliteOpen(container);
  await reconcileUserLayer(container, workspaceRoot, sqliteOpen);
  // The ONLY catalog sync. It is unconditional rather than gated on
  // "something changed" — the gate used to live inside `reconcileUserLayer`
  // and the heavy boot fired an ungated one right beside it anyway, so this is
  // strictly less work than before (one per pass instead of two), and a pass
  // that changed nothing costs one upsert sweep of already-current rows.
  if (sqliteOpen) {
    await syncSkillRegistryCatalog(container);
  }
}

/**
 * Run the user-layer pass for `workspaceRoot`, coalescing every trigger that
 * asks for it inside one window into a single run (TASK_2026_345).
 *
 * This is the ONE entry point. `boot-heavy-services.ts` calls it for
 * `activation` and again for `content-download-complete`; the DI-registered
 * `IUserLayerRefresher` below calls it for every harness propagation. Because
 * they share a coalescer keyed by the normalized root, a workspace switch that
 * fires three of those within 300 ms performs ONE mirror, ONE reconcile and ONE
 * catalog sync — and, just as importantly, can never perform two of them at the
 * same time on the same tree.
 *
 * Never throws: the pass is non-fatal by contract, and a failed run is reported
 * by the coalescer rather than propagated to the trigger that happened to be
 * first.
 */
export function refreshUserLayer(
  container: DependencyContainer,
  workspaceRoot: string | undefined,
  reason: string,
): Promise<void> {
  return userLayerJobFor(container).request(
    normalizeWorkspaceRoot(workspaceRoot),
    reason,
    { workspaceRoot },
  );
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
 * The port carries no reason, so every propagation shares one label here. That
 * is enough for the log to say a pass was propagation-driven; which propagation
 * is already on the reconciler's own line.
 */
export function createUserLayerRefresher(container: DependencyContainer): {
  refresh(workspaceRoot: string | undefined): Promise<void>;
} {
  return {
    refresh(workspaceRoot: string | undefined): Promise<void> {
      return refreshUserLayer(container, workspaceRoot, 'harness-propagation');
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
 * The claude target's slice, rendered so an ABSENT target cannot read as a
 * healthy empty pass.
 *
 * `claude?.found ?? 0` collapsed three different facts to `0/0`: a host that
 * never registered the claude target, a claude that is registered but not
 * detected, and a claude with genuinely nothing desired. Only the last is a
 * clean pass; the first two are wiring and environment problems that the `0/0`
 * spelling actively hid.
 */
function formatClaudeSlice(health: HarnessHealth): string {
  const claude = health.targets.find((target) => target.target === 'claude');
  if (claude === undefined) return 'claude=not-registered';
  if (!claude.detected) return 'claude=undetected';
  return `claude=${claude.found}/${claude.expected}`;
}

/**
 * The one health line both harness call sites print.
 *
 * Shared rather than duplicated because the two sites previously carried the
 * SAME defect and were fixed together: each narrowed to the claude target and
 * printed `found`/`expected` under bare field names, while the reconciler's own
 * warn (`harness-reconciler.service.ts`) sums all six targets under those same
 * names. `found=14/27` beside `found=106/119` from one pass is not a
 * disagreement anybody can debug — the two numbers were never measuring the
 * same thing.
 *
 * The AGGREGATE is now the headline, so this line and the reconciler's warn
 * report the same scope, and it comes from `summarizeHarnessHealth` — the one
 * definition of these totals that `harness doctor`, the Marketplace badge and
 * the health push already share — rather than from a fourth summation written
 * here. The claude slice is kept beside it and explicitly LABELLED, because it
 * is the target this host cares about most and dropping it would trade one
 * legibility problem for an information loss.
 */
function formatHarnessLine(
  verb: 'reconciled' | 'propagated',
  reason: string,
  health: HarnessHealth | null,
): string {
  if (health === null) {
    return `[Ptah Electron] Harness ${verb} (${reason}): no health report produced`;
  }
  const summary = summarizeHarnessHealth(health);
  return (
    `[Ptah Electron] Harness ${verb} (${reason}): sources=${summary.sources}, ` +
    `detectedTargets=${summary.detectedTargets}/${health.targets.length}, ` +
    `found=${summary.found}/${summary.expected} (all targets), ` +
    `${formatClaudeSlice(health)}, ` +
    `missing=${summary.missing}, foreign=${summary.foreign}, ` +
    `writeFailed=${summary.writeFailed}`
  );
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
 *
 * `options.signal` is forwarded to the reconciler, which honours it only while
 * HASHING — it is detached per target the moment that target is about to write
 * (`abort/pass-abort.ts`). So an abort abandons a pass that is still reading and
 * never one that is mid-copy; a target either finishes with its manifest or was
 * never touched. `options` is optional and unchanged for callers that pass
 * neither field.
 */
export async function reconcileHarness(
  container: DependencyContainer,
  workspaceRoot: string | undefined,
  reason: string,
  options: { downloadPending?: boolean; signal?: AbortSignal } = {},
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
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    console.log(formatHarnessLine('reconciled', reason, health));
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
    console.log(formatHarnessLine('propagated', reason, health));
  } catch (error) {
    console.warn(
      '[Ptah Electron] Harness propagation failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}
