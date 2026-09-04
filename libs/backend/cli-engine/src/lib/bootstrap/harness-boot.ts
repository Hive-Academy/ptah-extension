/**
 * Harness bring-up for the headless hosts (`ptah-cli`, `ptah tui`).
 *
 * Before TASK_2026_278 Batch 3 this file did not exist, and the consequence was
 * the sharpest asymmetry in the whole harness story: VS Code and Electron each
 * ran mirror → reconcileAll → reconcile at activation, while the CLI ran NONE
 * of the three. `UserLayerMirrorService` was registered in the CLI container
 * and had zero callers, so `~/.ptah/user` — the reconciler's entire desired
 * state — was populated only by whichever GUI host had last been opened. On a
 * machine that had only ever run `ptah tui`, the user layer was empty, every
 * reconcile was a correct no-op over nothing, and the harness never existed.
 *
 * Two exports, deliberately separate:
 *
 * - `createCliUserLayerRefresher` is the `IUserLayerRefresher` the CLI hands
 *   `harness-sync` at registration. It runs on demand, before any propagation.
 * - `bootHarness` is the one-shot boot pass.
 *
 * Both resolve everything lazily. `registerHarnessSyncServices` runs in DI
 * phase 2 and `registerAgentGenerationServices` a few lines later, so a
 * refresher that captured the mirror service at construction would capture
 * nothing.
 */

import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type ContentDownloadService,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  type PluginLoaderService,
} from '@ptah-extension/agent-sdk';
import {
  AGENT_GENERATION_TOKENS,
  type MirrorSources,
  type UserLayerMirrorService,
} from '@ptah-extension/agent-generation';
import {
  HARNESS_SYNC_TOKENS,
  resolveAgentMirrorSource,
  type AgentSyncGate,
  type HarnessPropagationService,
  type IUserLayerRefresher,
} from '@ptah-extension/harness-sync';
import { resolveSkillsRoot } from '@ptah-extension/skill-synthesis';

/**
 * The sources block both halves of the refresh feed to `UserLayerMirrorService`.
 *
 * Built in ONE place for the same reason the GUI hosts build theirs in one
 * place: `reconcileAll`'s reap pass reads "not among the supplied roots" as
 * "upstream deleted", so a reconcile walking fewer roots than the mirror
 * would reap live clones.
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
    // The agent facet is scoped and gated in `harness-sync`, not here: all three
    // hosts share that decision and the two rules behind it fail silently when
    // one of them drifts (TASK_2026_365).
    ...resolveAgentMirrorSource(workspaceRoot, resolveAgentSyncGate(container)),
  };
}

/** The consent gate, or `null` in a host that has not wired `harness-sync`. */
function resolveAgentSyncGate(
  container: DependencyContainer,
): AgentSyncGate | null {
  return container.isRegistered(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE)
    ? container.resolve<AgentSyncGate>(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE)
    : null;
}

export function createCliUserLayerRefresher(
  container: DependencyContainer,
): IUserLayerRefresher {
  return {
    async refresh(workspaceRoot: string | undefined): Promise<void> {
      if (
        !container.isRegistered(
          AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE,
        )
      ) {
        return;
      }
      const mirror = container.resolve<UserLayerMirrorService>(
        AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE,
      );
      const sources = buildMirrorSources(container, workspaceRoot);
      // Create-if-absent first (new slugs), then fast-forward + reap. The CLI
      // needs both halves as much as the GUI does: a `ptah tui` user who
      // uninstalls a plugin has no other host to reap its clones for them.
      await mirror.mirrorAll(sources);
      await mirror.reconcileAll(sources);
    },
  };
}

/**
 * The CLI/TUI boot pass: refresh the user layer, then populate every target.
 *
 * Called from the content-download callback, so it runs with the plugin loader
 * initialized and the plugin tree on disk. It is deliberately NOT awaited by
 * the bootstrap — a `ptah` invocation must answer its first RPC without waiting
 * on the network. The window that leaves open is closed from the other side by
 * the session-start preflight, which awaits the same download bounded before
 * any session starts.
 *
 * Never throws. A CLI command must not fail because a workspace directory was
 * read-only.
 */
export async function bootHarness(
  container: DependencyContainer,
  logger: Logger,
): Promise<void> {
  try {
    if (!container.isRegistered(HARNESS_SYNC_TOKENS.PROPAGATION)) return;
    const workspaceRoot = resolveWorkspaceRoot(container);
    if (workspaceRoot === undefined) {
      logger.debug('[CLI harness] Boot reconcile skipped — no workspace root');
      return;
    }
    const propagation = container.resolve<HarnessPropagationService>(
      HARNESS_SYNC_TOKENS.PROPAGATION,
    );
    const health = await propagation.propagate(workspaceRoot, 'boot');
    if (health === null) return;
    logger.info('[CLI harness] Boot reconcile complete', {
      sources: health.sources,
      targets: health.targets
        .filter((target) => target.detected)
        .map((target) => `${target.target}:${target.found}/${target.expected}`),
    });
  } catch (error: unknown) {
    logger.warn('[CLI harness] Boot reconcile failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function resolveWorkspaceRoot(
  container: DependencyContainer,
): string | undefined {
  try {
    const workspaceProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const root = workspaceProvider.getWorkspaceRoot();
    return typeof root === 'string' && root.trim() !== '' ? root : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `harness.preflightTimeoutMs`, or `undefined` to take the lib default.
 * Same reader as the two GUI hosts; the default itself lives once, in
 * `harness-sync`.
 *
 * Section `'ptah'` with a DOTTED key: `FILE_BASED_SETTINGS_KEYS` routes only
 * that section to `~/.ptah/settings.json` (TASK_2026_278 Batch 4).
 */
export function readCliPreflightTimeoutMs(
  container: DependencyContainer,
): number | undefined {
  try {
    const workspace = container.resolve<IWorkspaceProvider>(
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
 * Same reader as the two GUI hosts.
 */
export function readCliManageGitignore(
  container: DependencyContainer,
): boolean | undefined {
  try {
    const workspace = container.resolve<IWorkspaceProvider>(
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
