/**
 * Plugin Loader Service - Manages plugin metadata and per-workspace plugin configuration
 *
 * Responsibilities:
 * - Provide hardcoded metadata for bundled Ptah plugins
 * - Discover harness-authored plugin directories (`ptah-harness-*`) and describe
 *   them as first-class `PluginInfo` entries so the marketplace can show them
 * - Read/write per-workspace plugin configuration from VS Code workspaceState
 * - Resolve plugin IDs to absolute directory paths for SDK consumption
 *
 * Two activation models live side by side (see `PluginSource` in shared):
 * - Bundled plugins are OPT-IN: active only while listed in `enabledPluginIds`.
 * - Harness plugins are OPT-OUT: the user authored them by clicking Apply, so
 *   they are active the moment they appear on disk and stay active until their
 *   id lands in `disabledPluginIds`.
 *
 * Design:
 * - Initialized from main.ts with pluginsBasePath and workspaceState (late initialization)
 * - All methods gracefully handle uninitialized state (null pluginsBasePath/workspaceState)
 * - Plugin IDs are validated against the known set — bundled metadata plus the
 *   harness directories actually present on disk — to prevent arbitrary path
 *   construction
 *
 */

import * as path from 'path';
import * as fs from 'fs';
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  PluginInfo,
  PluginConfigState,
  PluginSkillEntry,
} from '@ptah-extension/shared';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { SdkError } from '../errors';

/** VS Code workspaceState key for plugin configuration */
const PLUGIN_CONFIG_KEY = 'ptah.plugins.config';

/**
 * Hardcoded metadata for all bundled Ptah plugins.
 *
 * Each entry corresponds to a directory under assets/plugins/ in the extension.
 * The metadata is used by the frontend Plugin Browser UI for display and filtering.
 *
 * `source` is omitted here and stamped as `'bundled'` by `getAvailablePlugins()`
 * — these entries are bundled by definition, so repeating it five times would
 * only invite drift.
 */
const AVAILABLE_PLUGINS: ReadonlyArray<Omit<PluginInfo, 'source'>> = [
  {
    id: 'ptah-core',
    name: 'Ptah Core',
    description:
      'Core development tools including orchestration, code review, testing, and documentation agents',
    category: 'core-tools',
    skillCount: 6,
    commandCount: 5,
    isDefault: true,
    keywords: ['orchestrate', 'review', 'test', 'document', 'core'],
  },
  {
    id: 'ptah-nx-saas',
    name: 'Ptah Nx SaaS',
    description:
      'Backend tools for Nx monorepo, NestJS patterns, webhook architecture, resilient service patterns, SaaS platform monetization, and production deployment',
    category: 'backend-tools',
    skillCount: 7,
    commandCount: 2,
    isDefault: false,
    keywords: [
      'nx',
      'nestjs',
      'prisma',
      'backend',
      'saas',
      'init-saas',
      'webhook',
      'deployment',
      'docker',
      'licensing',
      'subscription',
      'resilience',
    ],
  },
  {
    id: 'ptah-angular',
    name: 'Ptah Angular',
    description:
      'Frontend tools for Angular development with GSAP animations and 3D scene creation',
    category: 'frontend-tools',
    skillCount: 3,
    commandCount: 0,
    isDefault: false,
    keywords: ['angular', 'gsap', 'animation', '3d', 'frontend'],
  },
  {
    id: 'ptah-react',
    name: 'Ptah React',
    description: 'Frontend tools for React development with modern patterns',
    category: 'frontend-tools',
    skillCount: 3,
    commandCount: 0,
    isDefault: false,
    keywords: ['react', 'frontend', 'hooks', 'components'],
  },
  {
    id: 'ptah-video',
    name: 'Ptah Video',
    description:
      'Marketing-video toolkit — narrated, captioned, camera-animated product demos from automated UI walkthroughs (Playwright capture, Remotion render)',
    category: 'creative-tools',
    skillCount: 1,
    commandCount: 0,
    isDefault: false,
    keywords: [
      'video',
      'showcase',
      'demo',
      'tour',
      'marketing',
      'remotion',
      'playwright',
      'capture',
      'render',
    ],
  },
];

/** Set of valid plugin IDs for path validation */
const KNOWN_PLUGIN_IDS = new Set(AVAILABLE_PLUGINS.map((p) => p.id));

/**
 * Directory-name prefix used by harness-authored plugins.
 *
 * The harness wizard writes custom skills to
 * `{pluginsBasePath}/ptah-harness-{slug}/skills/{slug}/SKILL.md`. These plugins
 * are not part of AVAILABLE_PLUGINS and are not required to appear in
 * `enabledPluginIds`, so they can only be found by scanning the plugins base
 * directory.
 */
const HARNESS_PLUGIN_PREFIX = 'ptah-harness-';

/**
 * Fallback description for a harness plugin whose skills carry no frontmatter
 * description (or whose SKILL.md files are unreadable).
 */
const HARNESS_FALLBACK_DESCRIPTION =
  'Custom skill you authored with the Ptah harness wizard.';

/**
 * Turn a harness directory slug into a display name.
 *
 * `ptah-harness-release-notes` → slug `release-notes` → `Release Notes`.
 */
function humanizeSlug(slug: string): string {
  const words = slug
    .split('-')
    .map((word) => word.trim())
    .filter((word) => word.length > 0);

  if (words.length === 0) return slug;

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Manages plugin discovery and per-workspace plugin configuration.
 *
 * Pattern: Late-initialized service (similar to CompactionConfigProvider)
 * Single Responsibility: Plugin metadata + workspace configuration management
 *
 * Late initialization via `initialize()` is required because:
 * - pluginsBasePath comes from ContentDownloadService (available at activation)
 * - workspaceState comes from vscode.ExtensionContext (available at activation)
 * - DI registration happens before these values are available
 *
 * @example
 * ```typescript
 * // In main.ts after DI setup
 * const pluginLoader = container.resolve<PluginLoaderService>(SDK_TOKENS.SDK_PLUGIN_LOADER);
 * pluginLoader.initialize(contentDownload.getPluginsPath(), workspaceStateStorage);
 *
 * // In RPC handlers
 * const plugins = pluginLoader.getAvailablePlugins();
 * const config = pluginLoader.getWorkspacePluginConfig();
 * const paths = pluginLoader.resolvePluginPaths(config.enabledPluginIds);
 * ```
 */
@injectable()
export class PluginLoaderService {
  /** Absolute path to the plugins base directory (~/.ptah/plugins/) */
  private pluginsBasePath: string | null = null;

  /** VS Code Memento for per-workspace persistent state */
  private workspaceState: IStateStorage | null = null;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Initialize the plugin loader with the plugins base path and workspace state.
   *
   * Must be called once during extension activation, after DI setup.
   * Without initialization, path resolution returns empty arrays and
   * configuration returns defaults.
   *
   * @param pluginsBasePath - Absolute path to the plugins directory (~/.ptah/plugins/ from ContentDownloadService)
   * @param workspaceState - VS Code Memento for per-workspace state (from context.workspaceState)
   */
  initialize(pluginsBasePath: string, workspaceState: IStateStorage): void {
    this.pluginsBasePath = pluginsBasePath;
    this.workspaceState = workspaceState;

    this.logger.debug('[PluginLoaderService] Initialized', {
      pluginsBasePath,
      hasWorkspaceState: true,
    });
  }

  /**
   * Get metadata for every plugin the user can see and toggle.
   *
   * Two sources are merged:
   * - the hardcoded bundled catalogue (always present, even uninitialized), and
   * - one dynamically-built entry per `ptah-harness-*` directory on disk.
   *
   * The harness entries are what make user-authored skills visible in the
   * marketplace at all. They are also the allowlist that lets a harness ID
   * survive `plugins:save-config` — an ID matching neither list is still
   * rejected.
   *
   * @returns Array of PluginInfo objects with plugin metadata
   */
  getAvailablePlugins(): PluginInfo[] {
    const bundled: PluginInfo[] = AVAILABLE_PLUGINS.map((plugin) => ({
      ...plugin,
      source: 'bundled' as const,
    }));

    return [...bundled, ...this.describeHarnessPlugins()];
  }

  /**
   * Build a `PluginInfo` for every harness-authored directory on disk.
   *
   * Everything is derived from the directory itself — the slug supplies the
   * display name, the `skills/` tree supplies the real skill count, and the
   * first skill's frontmatter supplies a description. Nothing here is
   * persisted, so a directory created after activation shows up on the next
   * call without any cache invalidation.
   */
  private describeHarnessPlugins(): PluginInfo[] {
    return this.discoverHarnessPluginPaths().map((pluginPath) => {
      const id = path.basename(pluginPath);
      const slug = id.slice(HARNESS_PLUGIN_PREFIX.length);
      const skills = this.discoverSkillsForPlugins([pluginPath]);
      // The wizard writes `ptah-harness-{slug}/skills/{slug}/SKILL.md`, so the
      // skill named after the slug is the plugin's reason for existing. Prefer
      // it over `skills[0]`, which is whatever readdir happened to return
      // first once a second skill exists.
      const primarySkill =
        skills.find((skill) => skill.skillId === slug) ?? skills[0];

      return {
        id,
        name: humanizeSlug(slug),
        description: primarySkill?.description ?? HARNESS_FALLBACK_DESCRIPTION,
        category: 'harness-tools' as const,
        skillCount: skills.length,
        commandCount: this.countPluginCommands(pluginPath),
        // Harness plugins are opt-out, not "recommended" — `isDefault` drives a
        // Recommended badge in the browser modal and would misread here.
        isDefault: false,
        keywords: [
          ...slug.split('-').filter((word) => word.length > 0),
          'harness',
          'custom',
        ],
        source: 'harness' as const,
      };
    });
  }

  /**
   * Count the markdown command files directly under `{pluginPath}/commands/`.
   *
   * Returns 0 when the directory is absent — which is the normal case for
   * harness plugins, since the wizard only writes skills.
   */
  private countPluginCommands(pluginPath: string): number {
    try {
      return fs
        .readdirSync(path.join(pluginPath, 'commands'))
        .filter((entry) => entry.toLowerCase().endsWith('.md')).length;
    } catch {
      return 0;
    }
  }

  /**
   * Get the current per-workspace plugin configuration.
   *
   * Reads from VS Code workspaceState. Returns default empty config
   * if no configuration has been saved or if workspaceState is unavailable.
   *
   * @returns Current PluginConfigState with enabled plugin IDs and timestamp
   */
  getWorkspacePluginConfig(): PluginConfigState {
    if (!this.workspaceState) {
      this.logger.debug(
        '[PluginLoaderService] workspaceState not initialized, returning default config',
      );
      return {
        enabledPluginIds: [],
        disabledSkillIds: [],
        disabledPluginIds: [],
        lastUpdated: undefined,
      };
    }

    const stored =
      this.workspaceState.get<PluginConfigState>(PLUGIN_CONFIG_KEY);

    if (!stored || !Array.isArray(stored.enabledPluginIds)) {
      return {
        enabledPluginIds: [],
        disabledSkillIds: [],
        disabledPluginIds: [],
        lastUpdated: undefined,
      };
    }

    return {
      enabledPluginIds: stored.enabledPluginIds,
      disabledSkillIds: Array.isArray(stored.disabledSkillIds)
        ? stored.disabledSkillIds
        : [],
      // Absent on every config persisted before harness plugins became
      // toggleable — read as "nothing explicitly disabled", which is exactly
      // the default-enabled behaviour those configs already had. No migration.
      disabledPluginIds: Array.isArray(stored.disabledPluginIds)
        ? stored.disabledPluginIds
        : [],
      lastUpdated: stored.lastUpdated,
    };
  }

  /**
   * Save per-workspace plugin configuration.
   *
   * Persists the configuration to VS Code workspaceState with a lastUpdated timestamp.
   * The configuration survives VS Code restarts but is scoped to the current workspace.
   *
   * `disabledPluginIds` is preserve-on-omit: callers that predate harness
   * plugin toggling (`harness:start-new-project`, the CLI) pass only
   * `enabledPluginIds`/`disabledSkillIds`, and must not silently re-enable a
   * plugin the user turned off. Pass an explicit `[]` to clear the denylist.
   *
   * @param config - Plugin configuration to save (enabledPluginIds will be persisted)
   * @throws Error if workspaceState is not initialized
   */
  async saveWorkspacePluginConfig(
    config: Pick<
      PluginConfigState,
      'enabledPluginIds' | 'disabledSkillIds' | 'disabledPluginIds'
    >,
  ): Promise<void> {
    if (!this.workspaceState) {
      throw new SdkError(
        'PluginLoaderService not initialized: workspaceState is null',
      );
    }

    const disabledPluginIds =
      config.disabledPluginIds ??
      this.getWorkspacePluginConfig().disabledPluginIds ??
      [];

    const configToSave: PluginConfigState = {
      enabledPluginIds: config.enabledPluginIds,
      disabledSkillIds: config.disabledSkillIds,
      disabledPluginIds,
      lastUpdated: new Date().toISOString(),
    };

    await this.workspaceState.update(PLUGIN_CONFIG_KEY, configToSave);

    this.logger.debug('[PluginLoaderService] Plugin config saved', {
      enabledCount: configToSave.enabledPluginIds.length,
      enabledPluginIds: configToSave.enabledPluginIds,
      disabledSkillCount: configToSave.disabledSkillIds.length,
      disabledPluginIds,
      lastUpdated: configToSave.lastUpdated,
    });
  }

  /**
   * Resolve plugin IDs to absolute directory paths.
   *
   * Maps each valid plugin ID to its absolute path under the plugins base
   * directory. An ID is valid when it names a bundled plugin OR a
   * `ptah-harness-*` directory that actually exists on disk; anything else is
   * filtered out with a warning to prevent arbitrary path construction
   * (security). Directory-backed validation is what keeps traversal IDs like
   * `ptah-harness-../../etc` out — `discoverHarnessPluginPaths()` only ever
   * yields direct children of the base path.
   *
   * @param enabledPluginIds - Array of plugin IDs to resolve
   * @returns Array of absolute paths to plugin directories (only for valid IDs)
   */
  resolvePluginPaths(enabledPluginIds: string[]): string[] {
    if (!this.pluginsBasePath) {
      this.logger.debug(
        '[PluginLoaderService] pluginsBasePath not initialized, returning empty paths',
      );
      return [];
    }

    const pluginsBasePath = this.pluginsBasePath;

    // Only pay for the directory scan when a harness ID is actually requested —
    // the hot path (session start with bundled IDs) stays a pure Set lookup.
    const harnessIds = enabledPluginIds.some((id) =>
      id.startsWith(HARNESS_PLUGIN_PREFIX),
    )
      ? new Set(this.discoverHarnessPluginPaths().map((p) => path.basename(p)))
      : new Set<string>();

    const validIds = enabledPluginIds.filter((id) => {
      const isValid = KNOWN_PLUGIN_IDS.has(id) || harnessIds.has(id);
      if (!isValid) {
        this.logger.warn(
          '[PluginLoaderService] Unknown plugin ID filtered out',
          { pluginId: id },
        );
      }
      return isValid;
    });

    const paths = validIds
      .map((id) => path.join(pluginsBasePath, id))
      .filter((pluginPath) => {
        if (!fs.existsSync(pluginPath)) {
          this.logger.warn(
            '[PluginLoaderService] Plugin directory not found, skipping',
            { path: pluginPath },
          );
          return false;
        }
        return true;
      });

    this.logger.debug('[PluginLoaderService] Resolved plugin paths', {
      requestedCount: enabledPluginIds.length,
      resolvedCount: paths.length,
      pluginIds: validIds,
    });

    return paths;
  }

  /**
   * Get the current disabled skill IDs from workspace config.
   * Convenience method for SkillJunctionService callbacks.
   */
  getDisabledSkillIds(): string[] {
    return this.getWorkspacePluginConfig().disabledSkillIds;
  }

  /**
   * Discover harness-authored plugin directories (`ptah-harness-*`) under the
   * plugins base path.
   *
   * These plugins are written by the harness wizard (`harness:create-skill` /
   * `ptah_harness_create_skill`) directly into `{pluginsBasePath}/`. They are
   * deliberately absent from AVAILABLE_PLUGINS — the user never enables or
   * disables them in the marketplace — so `resolvePluginPaths` can never surface
   * them and a directory scan is the only way to find them.
   *
   * Synchronous by design: it shares `pluginsBasePath` and the sync `fs` style
   * of the rest of this service, and its callers (junction creation, workspace
   * change callbacks) are synchronous.
   *
   * @returns Absolute paths to harness plugin directories (empty when
   *          uninitialized or when the plugins directory does not exist)
   */
  discoverHarnessPluginPaths(): string[] {
    if (!this.pluginsBasePath) return [];

    const pluginsBasePath = this.pluginsBasePath;
    let entries: string[];
    try {
      entries = fs.readdirSync(pluginsBasePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          '[PluginLoaderService] Failed to read plugins directory',
          {
            path: pluginsBasePath,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      return [];
    }

    const paths: string[] = [];
    for (const entry of entries) {
      if (!entry.startsWith(HARNESS_PLUGIN_PREFIX)) continue;
      const pluginPath = path.join(pluginsBasePath, entry);
      try {
        if (fs.statSync(pluginPath).isDirectory()) {
          paths.push(pluginPath);
        }
      } catch (error: unknown) {
        this.logger.debug(
          '[PluginLoaderService] Skipping unreadable harness plugin dir',
          {
            path: pluginPath,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    return paths;
  }

  /**
   * Resolve the plugin paths that currently back workspace skill/command
   * junctions: the enabled bundled plugins PLUS every harness-authored
   * `ptah-harness-*` directory the user has NOT explicitly disabled.
   *
   * This is the single source of truth for junction creation, and it encodes
   * both activation models:
   * - bundled → opt-in, so only `enabledPluginIds` are included;
   * - harness → opt-out, so every discovered directory is included unless its
   *   id appears in `disabledPluginIds`.
   *
   * Both halves are filtered by `disabledPluginIds` so an explicit disable
   * always wins. That exclusion is the whole point of the toggle:
   * SkillJunctionService prunes any junction whose skill is missing from the
   * supplied paths, so dropping a disabled plugin here is what actually removes
   * its skills from `.claude/skills/`. Conversely, keeping the untouched
   * harness directories here is what stops a marketplace toggle from wiping
   * every harness-authored junction as stale.
   *
   * Callers that need only the bundled, user-selected plugins (the user-layer
   * mirror, session plugin options) must keep using `resolvePluginPaths`.
   */
  resolveCurrentPluginPaths(): string[] {
    const config = this.getWorkspacePluginConfig();
    const disabledIds = new Set(config.disabledPluginIds ?? []);

    const enabledPaths = this.resolvePluginPaths(
      config.enabledPluginIds.filter((id) => !disabledIds.has(id)),
    );
    const harnessPaths = this.discoverHarnessPluginPaths().filter(
      (pluginPath) => !disabledIds.has(path.basename(pluginPath)),
    );

    return Array.from(new Set([...enabledPaths, ...harnessPaths]));
  }

  /**
   * Enumerate all skills within the given plugin paths, returning stable skill IDs.
   *
   * For each plugin path, reads the skills/ directory and looks for subdirectories
   * containing a SKILL.md file. Parses YAML frontmatter for display name and description.
   * The skillId is the directory name (matching SkillJunctionService.buildSkillsMap keys).
   *
   * @param pluginPaths - Absolute paths to plugin directories
   * @returns Flat list of PluginSkillEntry with directory-name-based skillId
   */
  discoverSkillsForPlugins(pluginPaths: string[]): PluginSkillEntry[] {
    const skills: PluginSkillEntry[] = [];

    for (const pluginPath of pluginPaths) {
      const pluginId = path.basename(pluginPath);
      const skillsDir = path.join(pluginPath, 'skills');

      let entries: string[];
      try {
        entries = fs.readdirSync(skillsDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const entryPath = path.join(skillsDir, entry);
        try {
          if (!fs.statSync(entryPath).isDirectory()) continue;
        } catch {
          continue;
        }

        const skillMdPath = path.join(entryPath, 'SKILL.md');

        // Must not throw: this now runs over harness directories authored at
        // runtime by the wizard/agent, where a half-written skill folder with
        // no SKILL.md is plausible. One bad folder must not take down
        // `plugins:list-available`.
        let content: string;
        try {
          content = fs.readFileSync(skillMdPath, 'utf-8');
        } catch (error: unknown) {
          this.logger.debug(
            '[PluginLoaderService] Skipping skill without a readable SKILL.md',
            {
              path: skillMdPath,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          continue;
        }

        const { name, description } = this.parseFrontmatter(content);

        skills.push({
          skillId: entry,
          displayName: name || entry,
          description: description || name || entry,
          pluginId,
        });
      }
    }

    return skills;
  }

  /**
   * Parse simple YAML-like frontmatter from a SKILL.md file.
   * Extracts `name` and `description` fields from `---` delimited frontmatter.
   *
   * NOTE: Only handles single-line values (e.g., `description: Some text`).
   * Multi-line YAML block scalars (`|`, `>`) are not supported and will
   * return truncated or empty values. All existing SKILL.md files use
   * single-line values.
   */
  private parseFrontmatter(content: string): {
    name: string;
    description: string;
  } {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return { name: '', description: '' };

    const frontmatter = match[1];
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    return {
      name: nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : '',
      description: descMatch
        ? descMatch[1].trim().replace(/^['"]|['"]$/g, '')
        : '',
    };
  }
}
