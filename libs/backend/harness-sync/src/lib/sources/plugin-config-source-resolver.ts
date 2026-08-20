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
export interface HarnessPluginConfigReader {
  resolveCurrentPluginPaths(): string[];
  getDisabledSkillIds(): string[];
  getWorkspacePluginConfig(): {
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
 */
export function defaultHarnessSourceLayout(
  homeDir: string = os.homedir(),
): HarnessSourceLayout {
  const ptahRoot = join(homeDir, '.ptah');
  const userRoot = join(ptahRoot, 'user');
  return {
    skillsRoot: join(userRoot, 'skills'),
    commandsRoot: join(userRoot, 'commands'),
    agentsRoot: join(userRoot, 'agents'),
    legacyLinkRoots: [join(ptahRoot, 'plugins'), join(ptahRoot, 'skills')],
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

  resolve(): HarnessSourceState {
    const mcpIntents = this.readMcpIntents();
    const empty: HarnessSourceState = {
      layout: this.layout,
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
      const config = reader.getWorkspacePluginConfig();
      return {
        layout: this.layout,
        mcpIntents,
        overlayPluginPaths: reader.resolveCurrentPluginPaths(),
        disabledSkillIds: reader.getDisabledSkillIds(),
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
