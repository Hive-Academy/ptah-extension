/**
 * The default `IHarnessSourceResolver`: user layer at `~/.ptah/user` plus the
 * enabled/disabled state a plugin loader already tracks.
 *
 * The plugin loader is consumed STRUCTURALLY (`HarnessPluginConfigReader`), not
 * by importing `PluginLoaderService`. `PluginLoaderService` satisfies this shape
 * as-is, so a host wires it with a one-line lambda and `harness-sync` keeps zero
 * dependency on `agent-sdk`.
 */

import * as os from 'os';
import { join } from 'path';
import {
  USER_LAYER_AGENTS_DIR_NAME,
  userLayerAgentDirName,
} from '@ptah-extension/shared';
import type {
  HarnessSourceLayout,
  HarnessSourceState,
  IHarnessSourceResolver,
} from './harness-source.port';
import { McpIntentStore, type HarnessMcpIntent } from './mcp-intent-store';

/**
 * The slice of `PluginLoaderService` the reconciler reads.
 *
 * `resolveCurrentPluginPaths()` is the harness-INCLUSIVE list (bundled plugins
 * plus `ptah-harness-*`). Using `resolvePluginPaths(enabledPluginIds)` here was
 * the original defect: harness skills were absent from the desired state and
 * every one of their copies looked stale.
 */
/**
 * Every method takes the same optional `workspaceRoot`: the root the reconciler
 * is building a desired state FOR, which is not always the folder the host has
 * active (TASK_2026_346). A reader wired to a single-workspace host has one
 * answer and may ignore the argument; a reader over a multi-root host must
 * answer for the root it was given, or the two folders overwrite each other's
 * harness on every switch.
 *
 * Optional, not required, so a reader assembled by hand — every spec, and the
 * `plugin-gate` suite's `readerFactory` — stays assignable with zero-argument
 * methods.
 */
export interface HarnessPluginConfigReader {
  resolveCurrentPluginPaths(workspaceRoot?: string): string[];
  getDisabledSkillIds(workspaceRoot?: string): string[];
  getWorkspacePluginConfig(workspaceRoot?: string): {
    disabledPluginIds?: string[];
    disabledAgentIds?: string[];
  };
}

/**
 * `~/.ptah/user/{skills,commands,agents}`, plus the two other roots a legacy
 * junction could have pointed into.
 *
 * `~/.ptah/plugins` covers plugins that are disabled today (and so are missing
 * from `overlayPluginPaths`), and `~/.ptah/skills` covers the synthesized-skill
 * root the earliest `SkillJunctionService` linked directly. Both are needed for
 * `ClaudeTarget` to recognise its own leftovers; see `HarnessSourceLayout`.
 *
 * `agentsRoot` here is the BASE — the directory that holds one subdirectory per
 * workspace. {@link scopeAgentsRoot} turns it into the root a pass reads, and
 * `PluginConfigSourceResolver.resolve` is the one caller that does so.
 */
export function defaultHarnessSourceLayout(
  homeDir: string = os.homedir(),
): HarnessSourceLayout {
  const ptahRoot = join(homeDir, '.ptah');
  const userRoot = join(ptahRoot, 'user');
  return {
    skillsRoot: join(userRoot, 'skills'),
    commandsRoot: join(userRoot, 'commands'),
    agentsRoot: join(userRoot, USER_LAYER_AGENTS_DIR_NAME),
    legacyLinkRoots: [join(ptahRoot, 'plugins'), join(ptahRoot, 'skills')],
  };
}

/**
 * Point a layout's `agentsRoot` at ONE workspace's clones.
 *
 * With no root the base is returned unchanged. No path that builds a desired
 * state reaches that case — `HarnessReconcilerService` resolves the root at its
 * entry point and passes it from `reconcile` (both modes) and from `verify` —
 * and the base holds only subdirectories, so a pass that somehow read it would
 * see no agents rather than another workspace's.
 */
export function scopeAgentsRoot(
  layout: HarnessSourceLayout,
  workspaceRoot: string | undefined,
): HarnessSourceLayout {
  if (workspaceRoot === undefined) return layout;
  return {
    ...layout,
    agentsRoot: join(layout.agentsRoot, userLayerAgentDirName(workspaceRoot)),
  };
}

/**
 * Reads the source state on every call — never caches. A reconcile triggered by
 * `plugins:save-config` must see the config that was just saved.
 */
export class PluginConfigSourceResolver implements IHarnessSourceResolver {
  constructor(
    /**
     * Lazy on purpose: DI registration happens in an early host phase, while
     * the plugin loader is only usable after `initialize()` runs in a later one.
     * Returning `null` (or throwing) is a supported state and yields an empty
     * overlay rather than a failed reconcile.
     */
    private readonly readerFactory: () => HarnessPluginConfigReader | null,
    private readonly layout: HarnessSourceLayout = defaultHarnessSourceLayout(),
    /**
     * MCP intents are read on every resolve, exactly like the plugin config:
     * an `mcp:install` triggers a reconcile immediately afterwards and must see
     * the entry it just recorded.
     */
    private readonly mcpIntents: McpIntentStore = new McpIntentStore(),
  ) {}

  /**
   * @param workspaceRoot Forwarded VERBATIM to all three reader calls, so the
   *   answer describes the root being reconciled rather than the folder the
   *   host has active. The three go together on purpose: a config read for
   *   root A beside an overlay resolved for root B is a state no workspace ever
   *   had, and the builder cannot tell the halves apart.
   *
   *   Nothing is inferred here when it is absent. Answering an unscoped reader
   *   with an EMPTY state was considered and rejected — an empty overlay drops
   *   every overlay-only skill (skills.sh roots, workspace-scoped
   *   `ptah-harness-*`) out of the desired state, and skills are
   *   manifest-owned, so the "safe" fallback would REAP them. Forwarding a root
   *   a reader ignores leaves that reader exactly as it was, which is the only
   *   fallback here that removes nothing.
   */
  resolve(workspaceRoot?: string): HarnessSourceState {
    const mcpIntents = this.readMcpIntents();
    // Scoped once, here, so the read-failure path below and the success path
    // cannot describe two different agent directories. The scope is a pure
    // function of the root and reads nothing, so it cannot itself fail.
    const layout = scopeAgentsRoot(this.layout, workspaceRoot);
    // Every `return empty` below is a READ FAILURE, not an observation that the
    // user has nothing enabled. It therefore deliberately omits
    // `overlayPluginPathsKnown`, which is what tells the manifest builder to
    // filter nothing: an empty overlay presented as authoritative would assert
    // "every plugin is disabled here" and reap every skill copy in the
    // workspace. Adding the flag to this literal is the whole failure mode.
    const empty: HarnessSourceState = {
      layout,
      mcpIntents,
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      disabledAgentIds: [],
    };

    let reader: HarnessPluginConfigReader | null;
    try {
      reader = this.readerFactory();
    } catch {
      return empty;
    }
    if (reader === null) return empty;

    try {
      // One read, two fields. Two calls would let a loader that recomputes
      // between them hand the builder a plugin denylist and an agent denylist
      // from different snapshots of the same config.
      const config = reader.getWorkspacePluginConfig(workspaceRoot);
      return {
        layout,
        mcpIntents,
        overlayPluginPaths: reader.resolveCurrentPluginPaths(workspaceRoot),
        // The one path that actually asked the plugin loader and got an answer,
        // so the one path entitled to say the overlay is authoritative.
        overlayPluginPathsKnown: true,
        disabledSkillIds: reader.getDisabledSkillIds(workspaceRoot),
        disabledPluginIds: config.disabledPluginIds ?? [],
        disabledAgentIds: config.disabledAgentIds ?? [],
      };
    } catch {
      return empty;
    }
  }

  private readMcpIntents(): HarnessMcpIntent[] {
    try {
      return this.mcpIntents.list();
    } catch {
      return [];
    }
  }
}

/** Sugar for host wiring: `createPluginConfigSourceResolver(() => loader)`. */
export function createPluginConfigSourceResolver(
  readerFactory: () => HarnessPluginConfigReader | null,
  layout?: HarnessSourceLayout,
  mcpIntents?: McpIntentStore,
): IHarnessSourceResolver {
  return new PluginConfigSourceResolver(readerFactory, layout, mcpIntents);
}

/** A resolver bound to fixed roots and no overlay. Used by tests and by hosts
 * that have no plugin loader at all. */
export function createStaticSourceResolver(
  state: HarnessSourceState,
): IHarnessSourceResolver {
  return { resolve: () => state };
}
