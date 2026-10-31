/**
 * The default `IHarnessSourceResolver`: user layer at `~/.ptah/user` plus the
 * enabled/disabled state a plugin loader already tracks.
 *
 * The plugin loader is consumed STRUCTURALLY (`HarnessPluginConfigReader`), not
 * by importing `PluginLoaderService`. `PluginLoaderService` satisfies this shape
 * as-is, so a host wires it with a one-line lambda and `harness-sync` keeps zero
 * dependency on `agent-sdk`.
 */

import { readFileSync } from 'fs';
import * as os from 'os';
import { basename, join } from 'path';
import {
  type AgentModelLayers,
  isCapabilityPolicyUnknownError,
  parseSkillsShRetiredRegistry,
  SKILLS_SH_RETIRED_FILE,
  USER_LAYER_AGENTS_DIR_NAME,
  userLayerAgentDirName,
} from '@ptah-extension/shared';
import type { HarnessRetiredSources } from '../targets/harness-target.port';
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
  /**
   * The LAYERED policy — the workspace config with the global layer beneath
   * it — its fingerprint, and the overlay it implies, from one snapshot
   * (TASK_2026_560). A structural mirror of agent-sdk's
   * `EffectivePluginConfig`; this lib may not import agent-sdk.
   *
   * The three synchronous methods above read the WORKSPACE layer only, so a
   * global OFF on an opt-out plugin or a default-ON skill never reaches them.
   * When this method exists it is the ONLY one `resolve` calls.
   *
   * Rejects with an error `isCapabilityPolicyUnknownError` recognises when
   * either layer is unreadable. Optional so a hand-built reader (every spec,
   * and a host wrapper that predates the global layer) stays assignable.
   */
  getEffectivePluginConfig?(
    workspaceRoot?: string,
  ): Promise<HarnessEffectivePluginConfig>;
}

/** The slice of agent-sdk's `EffectivePluginConfig` this lib reads. */
export interface HarnessEffectivePluginConfig {
  config: {
    disabledSkillIds: string[];
    disabledPluginIds?: string[];
    disabledAgentIds?: string[];
  };
  fingerprint: string;
  overlayPluginPaths: string[];
}

/** Structural settings reader: hosts own settings-core and its lazy lifecycle. */
export type AgentModelsFactory = () => {
  layersForPath(workspacePath: string): AgentModelLayers;
} | null;

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
 * `~/.ptah/plugins` — where skills.sh roots are installed, and where the
 * retired-root registry (`SKILLS_SH_RETIRED_FILE`) sits beside them.
 */
export function defaultSkillsShPluginsRoot(
  homeDir: string = os.homedir(),
): string {
  return join(homeDir, '.ptah', 'plugins');
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
    private readonly agentModelsFactory?: AgentModelsFactory,
    /** The root the retired skills.sh registry and its roots live under. */
    private readonly skillsShPluginsRoot: string = defaultSkillsShPluginsRoot(),
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
  resolve(
    workspaceRoot?: string,
  ): HarnessSourceState | Promise<HarnessSourceState> {
    const mcpIntents = this.readMcpIntents(workspaceRoot);
    // Read before the plugin reader is even asked: retirement is permanent and
    // owes nothing to the policy, so every state below — the read failures
    // and the frozen one included — carries the same answer.
    const retired = this.readRetiredSources();
    // Scoped once, here, so the read-failure path below and the success path
    // cannot describe two different agent directories. The scope is a pure
    // function of the root and reads nothing, so it cannot itself fail.
    const layout = scopeAgentsRoot(this.layout, workspaceRoot);
    const agentModels = this.readAgentModels(workspaceRoot);
    // Every `return empty` below is a READ FAILURE, not an observation that the
    // user has nothing enabled. It therefore deliberately omits
    // `overlayPluginPathsKnown`, which is what tells the manifest builder to
    // filter nothing: an empty overlay presented as authoritative would assert
    // "every plugin is disabled here" and reap every skill copy in the
    // workspace. Adding the flag to this literal is the whole failure mode.
    const empty: HarnessSourceState = {
      layout,
      mcpIntents,
      retired,
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      disabledAgentIds: [],
      ...(agentModels === undefined ? {} : { agentModels }),
    };

    let reader: HarnessPluginConfigReader | null;
    try {
      reader = this.readerFactory();
    } catch {
      return empty;
    }
    if (reader === null) return empty;

    if (typeof reader.getEffectivePluginConfig === 'function') {
      return this.resolveEffective(reader, workspaceRoot, empty);
    }

    try {
      // One read, two fields. Two calls would let a loader that recomputes
      // between them hand the builder a plugin denylist and an agent denylist
      // from different snapshots of the same config.
      const config = reader.getWorkspacePluginConfig(workspaceRoot);
      return {
        layout,
        mcpIntents,
        retired,
        overlayPluginPaths: reader.resolveCurrentPluginPaths(workspaceRoot),
        // The one path that actually asked the plugin loader and got an answer,
        // so the one path entitled to say the overlay is authoritative.
        overlayPluginPathsKnown: true,
        disabledSkillIds: reader.getDisabledSkillIds(workspaceRoot),
        disabledPluginIds: config.disabledPluginIds ?? [],
        disabledAgentIds: config.disabledAgentIds ?? [],
        ...(agentModels === undefined ? {} : { agentModels }),
      };
    } catch {
      return empty;
    }
  }

  /**
   * The layered-policy path: ONE awaited read supplies the overlay, every
   * denylist and the fingerprint. Mixing in a workspace-only synchronous call
   * would put a global OFF in one field and not the other, which is a policy
   * no workspace ever had.
   *
   * `async` so a reader that throws synchronously is caught here as well. It
   * never rejects: an unknown policy becomes a frozen state, and any other
   * failure becomes the same `empty` (unfiltered) state the synchronous path
   * returns on a read failure.
   */
  private async resolveEffective(
    reader: HarnessPluginConfigReader,
    workspaceRoot: string | undefined,
    empty: HarnessSourceState,
  ): Promise<HarnessSourceState> {
    try {
      const effective = await reader.getEffectivePluginConfig?.(workspaceRoot);
      if (effective === undefined) return empty;
      return {
        layout: empty.layout,
        mcpIntents: empty.mcpIntents,
        retired: empty.retired,
        overlayPluginPaths: effective.overlayPluginPaths,
        overlayPluginPathsKnown: true,
        disabledSkillIds: effective.config.disabledSkillIds,
        disabledPluginIds: effective.config.disabledPluginIds ?? [],
        disabledAgentIds: effective.config.disabledAgentIds ?? [],
        policyFingerprint: effective.fingerprint,
        ...(empty.agentModels === undefined
          ? {}
          : { agentModels: empty.agentModels }),
      };
    } catch (error: unknown) {
      // Recognised by name, not `instanceof`: the error class lives in
      // agent-sdk, which this lib may not import. `empty` still omits
      // `overlayPluginPathsKnown`, and the reconciler plans no skill, command
      // or agent change for a frozen state, so nothing is re-added or reaped.
      if (isCapabilityPolicyUnknownError(error)) {
        return { ...empty, policyUnknown: true };
      }
      return empty;
    }
  }

  private readAgentModels(
    workspaceRoot: string | undefined,
  ): AgentModelLayers | undefined {
    // The reconciler already normalizes this root. Never substitute the host's
    // active folder or read a machine default for an unscoped resolve.
    if (!workspaceRoot) return undefined;
    try {
      return this.agentModelsFactory?.()?.layersForPath(workspaceRoot);
    } catch {
      // degradation-audit: optional-capability - per-agent model overrides are
      // optional; without them the sync keeps each agent's own model.
      // Settings may not be ready yet; models are optional and must not prevent
      // the existing source/policy resolution. This resolver has no logger.
      return undefined;
    }
  }

  /**
   * The global records plus this workspace's own. The store canonicalizes the
   * root (`resolveHarnessWorkspaceRoot`), the key the reconciler locks and
   * keeps its manifest on, so a sub-directory and its root read the same
   * records. No root yields the global records only — never every
   * workspace's, which is the leak v2 exists to close.
   */
  private readMcpIntents(workspaceRoot?: string): HarnessMcpIntent[] {
    try {
      return this.mcpIntents.listFor(workspaceRoot ?? '');
    } catch {
      return [];
    }
  }

  /** Both registries, re-read on every pass and sorted so a pass is stable. */
  private readRetiredSources(): HarnessRetiredSources {
    return {
      skillSourceRoots: this.readRetiredSkillSourceRoots(),
      mcpServerKeys: this.readRetiredMcpServerKeys(),
    };
  }

  /**
   * Every key the intent store carried over from v1. A key that is ALSO
   * recorded again stays listed: the reconciler consults the list only for a
   * removal, and a copy that is no longer desired somewhere is exactly a v1
   * leftover that must be removed on proof.
   */
  private readRetiredMcpServerKeys(): string[] {
    try {
      return this.mcpIntents.listRetired().map((intent) => intent.serverKey);
    } catch {
      // degradation-audit: optional-capability - the store already reads a
      // corrupt file as empty; an unexpected throw here leaves nothing
      // retired, so removals fall back to the ordinary manifest-hash rule.
      return [];
    }
  }

  /**
   * Absolute roots, `<plugins root>/<rootId>`, so the reconciler can match a
   * manifest `source` by prefix and name the item `skills-sh:<basename>`.
   * A root id that is not a plain directory name is dropped: it could only
   * point outside the plugins root, and its item id would not round-trip.
   */
  private readRetiredSkillSourceRoots(): string[] {
    let registry: ReturnType<typeof parseSkillsShRetiredRegistry>;
    try {
      registry = parseSkillsShRetiredRegistry(
        JSON.parse(
          readFileSync(
            join(this.skillsShPluginsRoot, SKILLS_SH_RETIRED_FILE),
            'utf-8',
          ),
        ),
      );
    } catch {
      // degradation-audit: optional-capability - an absent registry is the
      // normal state (no root was ever retired), and unparseable JSON is
      // treated like a malformed registry below: nothing is retired.
      return [];
    }
    // A malformed registry retires nothing: a copy it would have named is
    // still manifest-owned and removed only under the ordinary hash rule.
    if (registry === null) return [];
    return Object.keys(registry.roots)
      .filter(
        (id) => id !== '' && id !== '.' && id !== '..' && basename(id) === id,
      )
      .sort()
      .map((id) => join(this.skillsShPluginsRoot, id));
  }
}

/** Sugar for host wiring: `createPluginConfigSourceResolver(() => loader)`. */
export function createPluginConfigSourceResolver(
  readerFactory: () => HarnessPluginConfigReader | null,
  layout?: HarnessSourceLayout,
  mcpIntents?: McpIntentStore,
  agentModelsFactory?: AgentModelsFactory,
): IHarnessSourceResolver {
  return new PluginConfigSourceResolver(
    readerFactory,
    layout,
    mcpIntents,
    agentModelsFactory,
  );
}

/** A resolver bound to fixed roots and no overlay. Used by tests and by hosts
 * that have no plugin loader at all. */
export function createStaticSourceResolver(
  state: HarnessSourceState,
): IHarnessSourceResolver {
  return { resolve: () => state };
}
