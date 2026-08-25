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
 * Harness plugins live in one of TWO roots and the difference is their scope:
 * - `~/.ptah/plugins` — user-global, loads in every workspace on this machine;
 * - `{ws}/.ptah/plugins` — workspace-scoped, loads only here and can be
 *   committed with the project.
 * Only the user-global root feeds each host's `buildMirrorSources`; see
 * {@link PluginLoaderService.discoverWorkspaceHarnessPluginPaths} for why that
 * asymmetry is what makes the scope real.
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
import {
  buildSkillDescriptorId,
  HARNESS_PLUGIN_ID_PREFIX,
  SKILLS_SH_PLUGIN_ID_PREFIX,
  workspacePluginsDir,
  type PluginInfo,
  type PluginConfigState,
  type PluginSkillEntry,
  type PluginSource,
} from '@ptah-extension/shared';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  ExternalPluginStateStore,
  PLUGIN_MARKETPLACE_TOKENS,
  externalPluginDir,
  isExternalPluginId,
  parseExternalPluginId,
} from '@ptah-extension/plugin-marketplace';
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
      'Core development tools including orchestration, behavior-preserving refactoring, code review, testing, and documentation agents',
    category: 'core-tools',
    skillCount: 8,
    commandCount: 5,
    isDefault: true,
    keywords: [
      'orchestrate',
      'review',
      'test',
      'document',
      'core',
      'humanize',
      'refactor',
      'cleanup',
      'solid',
      'duplication',
    ],
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
    id: 'ptah-dotnet',
    name: 'Ptah .NET',
    description:
      'Discovery, domain modelling, solution layout and the Nx decision for .NET workspaces — execution mechanics (dotnet new, tests, EF Core, MSBuild, NuGet) come from the .NET team’s own marketplace plugins',
    category: 'backend-tools',
    skillCount: 3,
    commandCount: 0,
    isDefault: false,
    keywords: [
      'dotnet',
      'csharp',
      'aspnetcore',
      'blazor',
      'msbuild',
      'nuget',
      'solution',
      'backend',
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

/**
 * Bundled plugin IDs — the STATIC half of the path-validation allowlist.
 *
 * There are three kinds of valid id and they are validated three different
 * ways, on purpose (see `isKnownPluginId`):
 *
 * 1. bundled — this constant. Fixed at compile time.
 * 2. harness — a `ptah-harness-*` directory that exists on disk, because the
 *    user authored it here through the wizard.
 * 3. external — an id with a CONSENT RECORD in `ExternalPluginStateStore`.
 *
 * Note what case 3 is not: it is not "a directory under `external/` exists".
 * Externals are the only kind whose bytes came from a third party, so for them
 * the question is never "is this on disk" but "did the user approve this". See
 * `ExternalPluginStateStore.isInstalled`.
 */
const KNOWN_PLUGIN_IDS = new Set(AVAILABLE_PLUGINS.map((p) => p.id));

/**
 * Directory-name prefix used by harness-authored plugins.
 *
 * The harness wizard writes custom skills to
 * `{pluginsBasePath}/ptah-harness-{slug}/skills/{slug}/SKILL.md`. These plugins
 * are not part of AVAILABLE_PLUGINS and are not required to appear in
 * `enabledPluginIds`, so they can only be found by scanning the plugins base
 * directory.
 *
 * The literal moved to `@ptah-extension/shared` in TASK_2026_316 — it had
 * already been spelled twice (here and in `agent-generation`'s sidecar types),
 * and `harness-sync` needed a third to filter user-layer clones by origin
 * plugin. This is a local alias over the one definition, not a fourth copy.
 */
const HARNESS_PLUGIN_PREFIX = HARNESS_PLUGIN_ID_PREFIX;

/**
 * Directory-name prefix used by skills.sh source roots.
 *
 * `skillsSh:install` writes `{pluginsBasePath}/ptah-skillssh-{owner}-{repo}/skills/{slug}/`
 * — deliberately the same shape as a harness plugin, because that shape is
 * already a first-class overlay source and needs no new concept to reach every
 * CLI. Before TASK_2026_288 the install went straight into `.claude/skills`,
 * which reached Claude alone and read as `foreign` to `ptah harness doctor`
 * forever.
 *
 * OPT-OUT, like harness plugins and unlike bundled or external ones: the user
 * asked for this specific skill by clicking Install, which is the same
 * "authored on purpose" signal, so it is active on discovery and stays active
 * until its id lands in `disabledPluginIds`.
 *
 * Defined once in `@ptah-extension/shared`, alongside the harness prefix and the
 * `isOptOutPluginId` predicate that spells out what the two have in common.
 */
const SKILLS_SH_PLUGIN_PREFIX = SKILLS_SH_PLUGIN_ID_PREFIX;

/**
 * Fallback description for a harness plugin whose skills carry no frontmatter
 * description (or whose SKILL.md files are unreadable).
 */
const HARNESS_FALLBACK_DESCRIPTION =
  'Custom skill you authored with the Ptah harness wizard.';

/** Fallback description for a skills.sh root with no readable frontmatter. */
const SKILLS_SH_FALLBACK_DESCRIPTION =
  'Skill installed from the skills.sh directory.';

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

  /**
   * `SKILL.md` paths already reported unreadable, mapped to the errno that was
   * reported for them.
   *
   * `discoverSkillsForPlugins` runs on every `plugins:list-available`, and a
   * skill directory with no `SKILL.md` fails identically every time. On the
   * machine that produced `tmp/logs/log.log` one such directory
   * (`ptah-skillssh-oso95-scroll-world/skills/scroll-world`) re-emitted the same
   * ENOENT at lines 793, 844 and 1012 of a single session — a permanently
   * broken root reported once per call, which is noise rather than news
   * (TASK_2026_315 C4).
   *
   * Keyed by errno so a path that changes failure mode — ENOENT becoming EACCES
   * after a permissions change — is reported again rather than hidden behind
   * the first entry. The entry is dropped the moment the file reads
   * successfully, so a root repaired and later broken again reports afresh.
   *
   * Only the LOG is memoised. The scan itself still runs every call, so a root
   * that becomes readable is picked up immediately with no cache to invalidate.
   */
  private readonly reportedUnreadableSkills = new Map<string, string>();

  /**
   * @param workspace Optional, and asked at CALL time rather than captured at
   *   `initialize()`, because the workspace-scoped plugin root moves when the
   *   user changes folder. A host that has not registered a workspace provider
   *   simply has no workspace scope — every workspace method returns empty and
   *   the user-global half is unaffected.
   */
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLUGIN_MARKETPLACE_TOKENS.STATE_STORE)
    private readonly externalPlugins: ExternalPluginStateStore,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { isOptional: true })
    private readonly workspace?: IWorkspaceProvider,
  ) {}

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
      skillCount: this.countBundledSkills(plugin.id) ?? plugin.skillCount,
      source: 'bundled' as const,
    }));

    return [
      ...bundled,
      ...this.describeHarnessPlugins(),
      ...this.describeSkillsShPlugins(),
      ...this.describeExternalPlugins(),
    ];
  }

  /**
   * Build a `PluginInfo` for every skills.sh source root on disk.
   *
   * Directory-driven like {@link describeHarnessPlugins} rather than
   * record-driven like {@link describeExternalPlugins}, and the difference is
   * about who chose the bytes. An external plugin's content is a third party's
   * and is admitted only by a consent record; a skills.sh root holds one skill
   * the user picked by name from the marketplace, so the directory Ptah wrote
   * IS the record.
   *
   * Listing them here is what makes them toggleable at all: the Plugins panel
   * is where `disabledPluginIds` is set, and that is now the per-workspace
   * control that replaced the old `scope` parameter.
   */
  private describeSkillsShPlugins(): PluginInfo[] {
    return this.discoverSkillsShPluginPaths().map((pluginPath) => {
      const id = path.basename(pluginPath);
      const slug = id.slice(SKILLS_SH_PLUGIN_PREFIX.length);
      const skills = this.discoverSkillsForPlugins([pluginPath]);

      return {
        id,
        name: humanizeSlug(slug),
        description: skills[0]?.description ?? SKILLS_SH_FALLBACK_DESCRIPTION,
        category: 'external-tools' as const,
        skillCount: skills.length,
        commandCount: this.countPluginCommands(pluginPath),
        // "Recommended" is a Ptah endorsement. Third-party skills never get it.
        isDefault: false,
        keywords: [
          ...slug.split('-').filter((word) => word.length > 0),
          'skills.sh',
        ],
        source: 'skillssh' as const,
      };
    });
  }

  /**
   * Build a `PluginInfo` for every externally-installed plugin.
   *
   * Driven by the CONSENT RECORD, not by a directory scan — the same rule that
   * governs `resolvePluginPaths`. A record whose directory has since vanished
   * still appears here (with a zero skill count) rather than disappearing
   * silently, so the user can see it and uninstall it. The reverse, a directory
   * with no record, stays invisible: nothing gets promoted into the plugin
   * catalogue by landing on disk.
   */
  private describeExternalPlugins(): PluginInfo[] {
    if (!this.pluginsBasePath) return [];
    const pluginsBasePath = this.pluginsBasePath;

    return this.externalPlugins.listInstalled().map((record) => {
      const coordinate = parseExternalPluginId(record.pluginId);
      const pluginPath = coordinate
        ? externalPluginDir(pluginsBasePath, coordinate)
        : null;
      const skills = pluginPath
        ? this.discoverSkillsForPlugins([pluginPath])
        : [];

      return {
        id: record.pluginId,
        name: record.displayName,
        description:
          skills[0]?.description ??
          `Installed from ${record.source} (version ${record.version}).`,
        category: 'external-tools' as const,
        skillCount: skills.length,
        commandCount: pluginPath ? this.countPluginCommands(pluginPath) : 0,
        // "Recommended" is a Ptah endorsement. Third-party plugins never get it.
        isDefault: false,
        keywords: [
          ...record.plugin.split('-').filter((word) => word.length > 0),
          'external',
          record.source,
        ],
        source: 'external' as const,
      };
    });
  }

  /**
   * Real skill count for a bundled plugin, or null when it cannot be counted.
   *
   * The catalogue number above is a pre-download placeholder — bundled plugins
   * ship from GitHub at runtime, so before the first download there is no
   * `skills/` tree to read. Once there is one, disk wins.
   *
   * This exists because the browser modal renders the count as a badge and the
   * per-skill list underneath it from `plugins:list-skills`, which has always
   * read disk. A hand-maintained constant drifts the first time someone adds a
   * skill without bumping it, and the badge then contradicts the list directly
   * below itself.
   */
  private countBundledSkills(pluginId: string): number | null {
    if (!this.pluginsBasePath) return null;

    const pluginPath = path.join(this.pluginsBasePath, pluginId);
    if (!fs.existsSync(path.join(pluginPath, 'skills'))) return null;

    return this.discoverSkillsForPlugins([pluginPath]).length;
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
    // The merged view, so a workspace-scoped skill is listed — and therefore
    // toggleable, since this list is also the allowlist `plugins:save-config`
    // filters `disabledPluginIds` against.
    return this.resolveHarnessOverlayPaths().map((pluginPath) => {
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
          // The one visible difference between the two scopes. `PluginInfo` has
          // no scope field and adding one would ripple through the frontend
          // contract for a badge; a keyword is already how this list is
          // filtered and searched.
          ...(this.isWorkspaceScopedPluginPath(pluginPath)
            ? ['workspace']
            : ['global']),
        ],
        source: 'harness' as const,
      };
    });
  }

  /** True when `pluginPath` lives under `{ws}/.ptah/plugins`. */
  private isWorkspaceScopedPluginPath(pluginPath: string): boolean {
    const workspacePluginsPath = this.getWorkspacePluginsBasePath();
    if (workspacePluginsPath === null) return false;
    return (
      path.resolve(path.dirname(pluginPath)) ===
      path.resolve(workspacePluginsPath)
    );
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
        disabledAgentIds: [],
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
        disabledAgentIds: [],
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
      // Same idiom, same reason: absent on every config persisted before agents
      // became individually toggleable, and read as "nothing explicitly
      // disabled" — which is exactly the ungated behaviour those configs
      // already had. No migration.
      disabledAgentIds: Array.isArray(stored.disabledAgentIds)
        ? stored.disabledAgentIds
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
   * `disabledPluginIds` and `disabledAgentIds` are preserve-on-omit: callers
   * that predate harness plugin toggling (`harness:start-new-project`, the CLI)
   * pass only `enabledPluginIds`/`disabledSkillIds`, and must not silently
   * re-enable a plugin or an agent the user turned off. Pass an explicit `[]`
   * to clear either denylist.
   *
   * @param config - Plugin configuration to save (enabledPluginIds will be persisted)
   * @throws Error if workspaceState is not initialized
   */
  async saveWorkspacePluginConfig(
    config: Pick<
      PluginConfigState,
      | 'enabledPluginIds'
      | 'disabledSkillIds'
      | 'disabledPluginIds'
      | 'disabledAgentIds'
    >,
  ): Promise<void> {
    if (!this.workspaceState) {
      throw new SdkError(
        'PluginLoaderService not initialized: workspaceState is null',
      );
    }

    // One read for both preserved denylists — two calls would re-read the
    // stored config between them for no gain.
    const persisted = this.getWorkspacePluginConfig();
    const disabledPluginIds =
      config.disabledPluginIds ?? persisted.disabledPluginIds ?? [];
    const disabledAgentIds =
      config.disabledAgentIds ?? persisted.disabledAgentIds ?? [];

    const configToSave: PluginConfigState = {
      enabledPluginIds: config.enabledPluginIds,
      disabledSkillIds: config.disabledSkillIds,
      disabledPluginIds,
      disabledAgentIds,
      lastUpdated: new Date().toISOString(),
    };

    await this.workspaceState.update(PLUGIN_CONFIG_KEY, configToSave);

    this.logger.debug('[PluginLoaderService] Plugin config saved', {
      enabledCount: configToSave.enabledPluginIds.length,
      enabledPluginIds: configToSave.enabledPluginIds,
      disabledSkillCount: configToSave.disabledSkillIds.length,
      disabledPluginIds,
      disabledAgentIds,
      lastUpdated: configToSave.lastUpdated,
    });
  }

  /**
   * Resolve plugin IDs to absolute directory paths.
   *
   * Maps each valid plugin ID to its absolute path under the plugins base
   * directory. An ID is valid when it names a bundled plugin, a
   * `ptah-harness-*` directory that actually exists on disk, or an external
   * plugin with a consent record; anything else is filtered out with a warning
   * to prevent arbitrary path construction (security).
   *
   * Each kind is kept out of the path by a different mechanism, and none of
   * them is "the string looks fine":
   * - bundled ids are a fixed set, so `ptah-core/../../etc` is simply absent
   *   from it;
   * - harness ids are validated against `discoverHarnessPluginPaths()`, which
   *   only ever yields direct children of the base path;
   * - external ids are validated against the consent record AND re-parsed by
   *   `parseExternalPluginId`, which rejects any segment that is not a single
   *   safe path token — so the id never reaches `path.join` as a raw string.
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
    // the hot path (session start with bundled IDs) stays a pure Map lookup.
    //
    // A MAP of id -> absolute path, not a set of ids: a workspace-scoped
    // harness plugin lives under `{ws}/.ptah/plugins`, so an id alone can no
    // longer be joined onto the global base path to find it.
    const harnessPaths = enabledPluginIds.some((id) =>
      id.startsWith(HARNESS_PLUGIN_PREFIX),
    )
      ? new Map(
          this.resolveHarnessOverlayPaths().map((p) => [path.basename(p), p]),
        )
      : new Map<string, string>();

    const resolvable = new Map<string, string>();
    for (const id of enabledPluginIds) {
      const pluginPath = this.resolveSinglePluginPath(
        id,
        pluginsBasePath,
        harnessPaths,
      );
      if (pluginPath === null) {
        this.logger.warn(
          '[PluginLoaderService] Unknown plugin ID filtered out',
          { pluginId: id },
        );
        continue;
      }
      resolvable.set(id, pluginPath);
    }

    const validIds = [...resolvable.keys()];
    const paths = [...resolvable.values()].filter((pluginPath) => {
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
   * Absolute directory for one plugin id, or null when the id is not allowed.
   *
   * THE ALLOWLIST. Every branch returns a path only after proving the id
   * belongs to a category that has already been authorized:
   *
   * - external: `isInstalled` consults the persisted consent record. An id that
   *   was never installed through the consent flow returns null here and is
   *   rejected exactly like a made-up bundled id — which is the security
   *   property the whole external-marketplace feature rests on. Widening this
   *   to "any id starting with `external:`", or to "any directory present under
   *   `external/`", would turn plugin loading into arbitrary code loading.
   * - harness: must be a directory the scan actually found, and the SCAN
   *   supplies the path. The id is never joined onto a base path, which is
   *   what lets a workspace-scoped harness plugin resolve to
   *   `{ws}/.ptah/plugins/{id}` without the caller knowing which scope it came
   *   from — and keeps the "only ever a direct child of a root we scanned"
   *   property intact for both roots.
   * - bundled: must be in the compile-time set.
   */
  private resolveSinglePluginPath(
    id: string,
    pluginsBasePath: string,
    harnessPaths: ReadonlyMap<string, string>,
  ): string | null {
    if (isExternalPluginId(id)) {
      if (!this.externalPlugins.isInstalled(id)) return null;
      const coordinate = parseExternalPluginId(id);
      if (!coordinate) return null;
      return externalPluginDir(pluginsBasePath, coordinate);
    }

    const harnessPath = harnessPaths.get(id);
    if (harnessPath !== undefined) return harnessPath;

    if (KNOWN_PLUGIN_IDS.has(id)) {
      return path.join(pluginsBasePath, id);
    }

    return null;
  }

  /**
   * Get the current disabled skill IDs from workspace config.
   * Convenience method for the harness reconciler's source resolver.
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
    return this.discoverPrefixedPluginPaths(HARNESS_PLUGIN_PREFIX);
  }

  /**
   * Discover skills.sh source roots (`ptah-skillssh-*`) under the plugins base
   * path.
   *
   * Separate from {@link discoverHarnessPluginPaths} even though the scan is
   * identical, because the two feed different places on purpose. BOTH reach
   * `resolveCurrentPluginPaths` (the harness desired state); only the harness
   * one reaches `buildMirrorSources` in each host.
   *
   * That asymmetry is the load-bearing part of uninstall. The user-layer mirror
   * CLONES a plugin's skills into `~/.ptah/user/skills` create-if-absent, and
   * the user layer is the desired state's base — so a cloned skills.sh skill
   * would survive the deletion of its source root and keep propagating into
   * every target forever. Overlay-only means `skillsSh:uninstall` deletes the
   * one copy that exists and the reconciler's removal sweep clears the rest.
   */
  discoverSkillsShPluginPaths(): string[] {
    return this.discoverPrefixedPluginPaths(SKILLS_SH_PLUGIN_PREFIX);
  }

  /**
   * The workspace-scoped plugin root, `{ws}/.ptah/plugins`, or null when no
   * folder is open (or no workspace provider is registered on this host).
   *
   * Public because `ptah.harness.createSkill` writes into it and must not
   * re-derive the path — see `workspacePluginsDir` in shared.
   */
  getWorkspacePluginsBasePath(): string | null {
    return workspacePluginsDir(this.workspace?.getWorkspaceRoot());
  }

  /**
   * Discover harness plugin directories under `{ws}/.ptah/plugins`.
   *
   * DELIBERATELY separate from {@link discoverHarnessPluginPaths}, and the
   * asymmetry is the same load-bearing one `discoverSkillsShPluginPaths`
   * documents. Both reach `resolveCurrentPluginPaths` (the harness desired
   * state); only the USER-GLOBAL one reaches `buildMirrorSources` in each host.
   *
   * That is what makes the scope real. The user-layer mirror CLONES a plugin's
   * skills into `~/.ptah/user/skills` create-if-absent, and the user layer is
   * the desired state's BASE — so a mirrored workspace skill would outlive its
   * workspace and propagate into every other project forever, which is exactly
   * the scoping the caller asked to avoid. Overlay-only means the skill is
   * desired state HERE and nowhere else, and the reconciler's removal sweep
   * clears its copies the moment the folder changes.
   *
   * Do not "fix" this by adding it to `buildMirrorSources`.
   */
  discoverWorkspaceHarnessPluginPaths(): string[] {
    const workspacePluginsPath = this.getWorkspacePluginsBasePath();
    if (workspacePluginsPath === null) return [];
    return this.scanPrefixedPluginDirs(
      workspacePluginsPath,
      HARNESS_PLUGIN_PREFIX,
    );
  }

  /**
   * Every harness plugin backing the CURRENT desired state: the user-global
   * roots plus the workspace ones, with the workspace winning a slug clash.
   *
   * Workspace-wins is the more-specific-scope rule, and a clash is reported
   * rather than resolved in silence — the shadowed skill still exists on disk
   * and its author is entitled to know why it stopped appearing here.
   */
  private resolveHarnessOverlayPaths(): string[] {
    const byId = new Map<string, string>();
    for (const pluginPath of this.discoverHarnessPluginPaths()) {
      byId.set(path.basename(pluginPath), pluginPath);
    }
    for (const pluginPath of this.discoverWorkspaceHarnessPluginPaths()) {
      const id = path.basename(pluginPath);
      const shadowed = byId.get(id);
      if (shadowed !== undefined) {
        this.logger.warn(
          '[PluginLoaderService] Workspace harness plugin shadows a user-global one of the same id',
          { pluginId: id, using: pluginPath, shadowed },
        );
      }
      byId.set(id, pluginPath);
    }
    return [...byId.values()];
  }

  /** Direct child directories of the plugins base path matching `prefix`. */
  private discoverPrefixedPluginPaths(prefix: string): string[] {
    if (!this.pluginsBasePath) return [];
    return this.scanPrefixedPluginDirs(this.pluginsBasePath, prefix);
  }

  /** Direct child directories of `baseDir` whose name starts with `prefix`. */
  private scanPrefixedPluginDirs(baseDir: string, prefix: string): string[] {
    let entries: string[];
    try {
      entries = fs.readdirSync(baseDir);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          '[PluginLoaderService] Failed to read plugins directory',
          {
            path: baseDir,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      return [];
    }

    const paths: string[] = [];
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      const pluginPath = path.join(baseDir, entry);
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
   * Resolve the plugin paths that currently back the harness desired state: the
   * enabled bundled plugins PLUS every `ptah-harness-*` (user-global AND
   * workspace-scoped) and `ptah-skillssh-*` directory the user has NOT
   * explicitly disabled.
   *
   * This is the single source of truth for the reconciler's overlay, and it
   * encodes both activation models:
   * - bundled/external → opt-in, so only `enabledPluginIds` are included;
   * - harness/skills.sh → opt-out, so every discovered directory is included
   *   unless its id appears in `disabledPluginIds`.
   *
   * Both halves are filtered by `disabledPluginIds` so an explicit disable
   * always wins. That exclusion is the whole point of the toggle:
   * The harness reconciler removes any managed copy whose skill is missing from the
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
    const optOutPaths = [
      ...this.resolveHarnessOverlayPaths(),
      ...this.discoverSkillsShPluginPaths(),
    ].filter((pluginPath) => !disabledIds.has(path.basename(pluginPath)));

    return Array.from(new Set([...enabledPaths, ...optOutPaths]));
  }

  /**
   * Enumerate all skills within the given plugin paths, returning stable skill IDs.
   *
   * For each plugin path, reads the skills/ directory and looks for subdirectories
   * containing a SKILL.md file. Parses YAML frontmatter for display name and description.
   * The skillId is the directory name (matching HarnessManifestBuilder skill slugs).
   *
   * @param pluginPaths - Absolute paths to plugin directories
   * @returns Flat list of PluginSkillEntry with directory-name-based skillId
   */
  discoverSkillsForPlugins(pluginPaths: string[]): PluginSkillEntry[] {
    const skills: PluginSkillEntry[] = [];
    const disabledSkillIds = new Set(this.getDisabledSkillIds());

    for (const pluginPath of pluginPaths) {
      const pluginId = this.pluginIdForPath(pluginPath);
      const source = this.pluginSourceForPath(pluginPath, pluginId);
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
          this.reportedUnreadableSkills.delete(skillMdPath);
        } catch (error: unknown) {
          this.reportUnreadableSkill(skillMdPath, error);
          continue;
        }

        const { name, description } = this.parseFrontmatter(content);

        skills.push({
          skillId: entry,
          descriptorId: buildSkillDescriptorId(pluginId, entry),
          invocationName: entry,
          displayName: name || entry,
          description: description || name || entry,
          pluginId,
          sourceId: pluginId,
          source,
          invocability: disabledSkillIds.has(entry)
            ? 'not-invocable'
            : 'invocable',
        });
      }
    }

    return skills;
  }

  /**
   * Report a skill directory whose `SKILL.md` could not be read — once per
   * path, per failure mode.
   *
   * Deliberately still DEBUG and still non-fatal. A half-written skill folder is
   * a real condition this method must survive (see the comment at the read
   * site), and the user cannot act on a log line either way; the defect being
   * fixed is repetition, not level. Nothing else changes: the skill is skipped
   * exactly as before and the rest of the plugin still lists.
   */
  private reportUnreadableSkill(skillMdPath: string, error: unknown): void {
    const code =
      typeof error === 'object' &&
      error !== null &&
      typeof (error as NodeJS.ErrnoException).code === 'string'
        ? ((error as NodeJS.ErrnoException).code as string)
        : '';

    if (this.reportedUnreadableSkills.get(skillMdPath) === code) return;
    this.reportedUnreadableSkills.set(skillMdPath, code);

    this.logger.debug(
      '[PluginLoaderService] Skipping skill without a readable SKILL.md',
      {
        path: skillMdPath,
        code: code === '' ? undefined : code,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }

  /**
   * Resolve the stable parent plugin identifier for a discovered path.
   *
   * External plugin ids are coordinates rather than directory basenames, so
   * preserve their canonical `external:owner/repo/plugin` identity.
   */
  private pluginIdForPath(pluginPath: string): string {
    if (!this.pluginsBasePath) return path.basename(pluginPath);

    const externalRoot = path.join(this.pluginsBasePath, 'external');
    const relative = path.relative(externalRoot, pluginPath);
    const segments = relative.split(path.sep);
    if (
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      segments.length === 3 &&
      segments.every((segment) => segment.length > 0)
    ) {
      return `external:${segments.join('/')}`;
    }

    return path.basename(pluginPath);
  }

  /** Derive source semantics from the owned plugin path and canonical id. */
  private pluginSourceForPath(
    pluginPath: string,
    pluginId: string,
  ): PluginSource {
    if (isExternalPluginId(pluginId)) return 'external';

    const basename = path.basename(pluginPath);
    if (basename.startsWith(HARNESS_PLUGIN_PREFIX)) return 'harness';
    if (basename.startsWith(SKILLS_SH_PLUGIN_PREFIX)) return 'skillssh';
    return 'bundled';
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
