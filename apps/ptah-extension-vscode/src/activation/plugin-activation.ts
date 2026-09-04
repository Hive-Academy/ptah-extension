import * as vscode from 'vscode';
import type { Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  HARNESS_SYNC_TOKENS,
  resolveAgentMirrorSource,
  type AgentSyncGate,
  type HarnessPropagationService,
  type HarnessReconcilerService,
} from '@ptah-extension/harness-sync';
import {
  AGENT_GENERATION_TOKENS,
  type MirrorSources,
  type UserLayerMirrorService,
  type UserLayerRoots,
} from '@ptah-extension/agent-generation';
import { resolveSkillsRoot } from '@ptah-extension/skill-synthesis';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  ContentDownloadService,
  IDisposable,
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { initializePluginMarketplace } from '@ptah-extension/plugin-marketplace';
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
    // Same base path, same moment: PluginLoaderService asks this store whether
    // an external plugin id was consented to, and an unbound store reports an
    // empty allowlist.
    initializePluginMarketplace(DIContainer.getContainer(), pluginsPath);
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
 * The ONE `MirrorSources` block both user-layer passes feed to
 * `UserLayerMirrorService` — the VS Code twin of the Electron builder, and it
 * must stay identical in content. Mirror and reconcile cannot be allowed to
 * disagree about what the sources ARE: the reap half of `reconcileAll()` reads
 * "not among the supplied roots" as "upstream deleted", so a reconcile walking
 * fewer roots than the mirror would reap live clones.
 *
 * Four fields, three of them absent before TASK_2026_278 Batch 1b:
 * - `harnessPluginRoots` — the `ptah-harness-*` dirs the harness builder
 *   writes, which came from a different producer than `pluginPaths` and were
 *   therefore missing from every mirror call (defect 6).
 * - `pluginsBasePath` — lets the reap pass tell a DISABLED plugin (dir present,
 *   clones kept) from an UNINSTALLED one (dir gone, clones reaped).
 * - `synthesizedSkillsRoot` — through `resolveSkillsRoot`, not a hard-coded
 *   `~/.ptah/skills`, so promotion and the mirror cannot be pointed at two
 *   different roots by `skillSynthesis.skillsRoot`.
 */
function buildMirrorSources(workspaceRoot: string | undefined): MirrorSources {
  const pluginLoader = DIContainer.resolve<PluginLoaderService>(
    SDK_TOKENS.SDK_PLUGIN_LOADER,
  );
  const contentDownload = DIContainer.resolve<ContentDownloadService>(
    PLATFORM_TOKENS.CONTENT_DOWNLOAD,
  );
  const workspaceProvider = DIContainer.resolve<IWorkspaceProvider>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );
  const config = pluginLoader.getWorkspacePluginConfig();

  return {
    pluginPaths: pluginLoader.resolvePluginPaths(config.enabledPluginIds),
    harnessPluginRoots: pluginLoader.discoverHarnessPluginPaths(),
    pluginsBasePath: contentDownload.getPluginsPath(),
    synthesizedSkillsRoot: resolveSkillsRoot(workspaceProvider),
    // The agent facet is scoped and gated in `harness-sync`, not here: all three
    // hosts share that decision and the two rules behind it fail silently when
    // one of them drifts (TASK_2026_365).
    ...resolveAgentMirrorSource(workspaceRoot, resolveAgentSyncGate()),
  };
}

/** The consent gate, or `null` in a host that has not wired `harness-sync`. */
function resolveAgentSyncGate(): AgentSyncGate | null {
  return DIContainer.getContainer().isRegistered(
    HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE,
  )
    ? DIContainer.resolve<AgentSyncGate>(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE)
    : null;
}

/**
 * Mirror installed/downloaded skills, synthesized skills, and Claude agents
 * into the user layer (~/.ptah/user/). SQLite-free, so it runs in VS Code.
 * create-if-absent, safe to call every activation; the IStateStorage watermark
 * only skips the backfill log after the first run. Non-fatal on failure.
 *
 * Must run BEFORE reconcileHarness: the reconciler's desired state IS the user
 * layer, so reconciling an unmirrored layer copies nothing.
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

    const sources = buildMirrorSources(workspaceRoot);
    const result = await mirror.mirrorAll(sources);

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

    // The SAME root the mirror just wrote under, taken from the sources rather
    // than re-derived: the agent root is keyed by it, so a second derivation
    // that disagreed would hand the caller a directory nothing was written to.
    return mirror.getUserLayerRoots(sources.workspaceRoot);
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
 * Reconcile cloned skills/commands/agents against their upstream sources, and
 * sweep clones whose upstream is gone. SQLite-free, so it runs in VS Code:
 * divergence is recorded ONLY in the sidecar (no catalog, no UI here per the
 * runtime split). Must run AFTER mirrorUserLayer, and now runs
 * UNCONDITIONALLY — the old `!fromCache` gate meant a clone edited between two
 * cached activations was never noticed and an upstream deletion was never
 * reaped at all (defect 8). Both halves are a directory walk plus a content
 * hash, so a no-change pass is cheap. Non-fatal on failure.
 */
export async function reconcileUserLayer(
  workspaceRoot: string | undefined,
  logger: Logger,
): Promise<void> {
  try {
    const mirror = DIContainer.resolve<UserLayerMirrorService>(
      AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE,
    );

    const result = await mirror.reconcileAll(buildMirrorSources(workspaceRoot));

    logger.info('User-layer reconcile complete', {
      noop: result.noop,
      fastForwarded: result.fastForwarded,
      diverged: result.diverged,
      reaped: result.reaped,
      orphaned: result.orphaned,
      missingSidecar: result.missingSidecar,
      errors: result.errors,
    });
  } catch (reconcileError) {
    logger.warn('User-layer reconcile failed (non-fatal)', {
      error:
        reconcileError instanceof Error
          ? reconcileError.message
          : String(reconcileError),
    });
  }
}

/**
 * The `IUserLayerRefresher` this host hands `harness-sync` at registration.
 *
 * `HarnessPropagationService` runs it before each reconcile it performs, so a
 * trigger that changed an UPSTREAM source — a harness-builder plugin dir, an
 * agent the wizard wrote into `{ws}/.claude/agents`, an uninstalled
 * marketplace plugin — is visible in `~/.ptah/user` by the time the
 * reconciler reads it. Without it, an RPC-driven reconcile propagated the
 * PREVIOUS state and logged a clean pass (TASK_2026_278 Batch 3).
 *
 * Both halves, in the activation order: `mirrorUserLayer` is create-if-absent
 * and picks up new slugs; `reconcileUserLayer` fast-forwards existing clones
 * and reaps the ones whose upstream is gone. An uninstall needs the second
 * half specifically — see `deactivateExternalPlugin` in `plugin-rpc.handlers`.
 */
export function createUserLayerRefresher(logger: Logger): {
  refresh(workspaceRoot: string | undefined): Promise<void>;
} {
  return {
    async refresh(workspaceRoot: string | undefined): Promise<void> {
      await mirrorUserLayer(workspaceRoot, logger);
      await reconcileUserLayer(workspaceRoot, logger);
    },
  };
}

/**
 * `harness.preflightTimeoutMs`, or `undefined` to take the lib default. The
 * default itself lives once, in `harness-sync`, so two hosts cannot drift.
 *
 * Section `'ptah'` with a DOTTED key, not section `'harness'`. The key is
 * registered in `FILE_BASED_SETTINGS_KEYS`, and only the `'ptah'` section is
 * routed to `~/.ptah/settings.json`; section `'harness'` fell through to
 * `vscode.workspace.getConfiguration('harness')`, which no
 * `contributes.configuration` declares — reads returned undefined and writes
 * were dropped without an error (TASK_2026_278 Batch 4).
 */
export function readPreflightTimeoutMs(): number | undefined {
  try {
    const workspace = DIContainer.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const value = workspace.getConfiguration<number>(
      'ptah',
      'harness.preflightTimeoutMs',
    );
    return typeof value === 'number' && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `harness.manageGitignore`, or `undefined` to take the lib default (on).
 *
 * Same routing as the timeout above. Returns `undefined` rather than `true` for
 * an unset key so `harness-sync` owns the default; a host that answered `true`
 * here would be the second place the default lives.
 */
export function readManageGitignore(): boolean | undefined {
  try {
    const workspace = DIContainer.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const value = workspace.getConfiguration<boolean>(
      'ptah',
      'harness.manageGitignore',
    );
    return typeof value === 'boolean' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reconcile the workspace harness: copy every enabled skill and command from
 * the user layer into `{ws}/.claude/{skills,commands}` (TASK_2026_278).
 *
 * Replaces `activateSkillJunctions`. Two behavioural differences worth naming:
 * artifacts are copies rather than NTFS junctions, so they survive this host
 * exiting and are readable by `ptah tui`, the headless CLI and a plain `claude`
 * invocation; and nothing is torn down on deactivate.
 *
 * Non-fatal by contract — a workspace that cannot be written must never block
 * activation. Failures land in the returned health report instead.
 */
export async function reconcileHarness(
  logger: Logger,
  reason: string,
  options: { downloadPending?: boolean } = {},
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot === undefined) {
    logger.debug('Harness reconcile skipped — no workspace open', { reason });
    return;
  }
  try {
    const reconciler = DIContainer.resolve<HarnessReconcilerService>(
      HARNESS_SYNC_TOKENS.RECONCILER,
    );
    const health = await reconciler.reconcile(workspaceRoot, {
      mode: 'full',
      reason,
      ...(options.downloadPending === true ? { downloadPending: true } : {}),
    });
    const claude = health.targets.find((target) => target.target === 'claude');
    logger.info('Harness reconciled', {
      reason,
      sources: health.sources,
      expected: claude?.expected ?? 0,
      found: claude?.found ?? 0,
      foreign: claude?.foreign.length ?? 0,
      writeFailed: claude?.writeFailed.length ?? 0,
    });
  } catch (reconcileError) {
    logger.warn('Harness reconcile failed (non-blocking)', {
      reason,
      error:
        reconcileError instanceof Error
          ? reconcileError.message
          : String(reconcileError),
    });
  }
}

/**
 * Refresh the user layer for the ACTIVE workspace, then reconcile it.
 *
 * The refresh is the half a workspace-folder change cannot do without: one of
 * the user layer's sources is `{ws}/.claude/agents`, which belongs to the
 * workspace, so switching folders changes the sources. A bare `reconcileHarness`
 * propagated the PREVIOUS workspace's agents into the new one and logged a clean
 * pass. Falls back to a bare reconcile when propagation is not registered.
 *
 * Non-fatal by contract, like everything else on this path.
 */
export async function propagateHarness(
  logger: Logger,
  reason: string,
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot === undefined) {
    logger.debug('Harness propagation skipped — no workspace open', { reason });
    return;
  }
  try {
    if (
      !DIContainer.getContainer().isRegistered(HARNESS_SYNC_TOKENS.PROPAGATION)
    ) {
      await reconcileHarness(logger, reason);
      return;
    }
    const propagation = DIContainer.resolve<HarnessPropagationService>(
      HARNESS_SYNC_TOKENS.PROPAGATION,
    );
    const health = await propagation.propagate(workspaceRoot, reason);
    logger.info('Harness propagated', {
      reason,
      sources: health?.sources ?? 'unknown',
    });
  } catch (propagateError) {
    logger.warn('Harness propagation failed (non-blocking)', {
      reason,
      error:
        propagateError instanceof Error
          ? propagateError.message
          : String(propagateError),
    });
  }
}

/**
 * Re-propagate when the user opens or closes a workspace folder.
 *
 * The OUTGOING workspace is deliberately left alone. `SkillJunctionService`
 * reaped it, which broke every other host still working in that directory —
 * the same defect as tearing down on deactivate (E12). The new workspace gets a
 * full pass — mirror the user layer, then reconcile — because its
 * `.claude/agents` directory is a SOURCE the reconciler cannot see until the
 * mirror has run.
 */
export function subscribeHarnessToWorkspaceChanges(
  logger: Logger,
): IDisposable {
  const workspaceProvider = DIContainer.resolve<IWorkspaceProvider>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );
  return workspaceProvider.onDidChangeWorkspaceFolders(() => {
    void propagateHarness(logger, 'workspace-folders-changed');
  });
}
