/**
 * Plugin Loader Service - Manages plugin metadata and per-workspace plugin configuration
 *
 * Responsibilities:
 * - Provide hardcoded metadata for bundled Ptah plugins
 * - Read/write per-workspace plugin configuration from VS Code workspaceState
 * - Resolve plugin IDs to absolute directory paths for SDK consumption
 *
 * Design:
 * - Initialized from main.ts with pluginsBasePath and workspaceState (late initialization)
 * - All methods gracefully handle uninitialized state (null pluginsBasePath/workspaceState)
 * - Plugin IDs are validated against the known set to prevent arbitrary path construction
 *
 * @see TASK_2025_153 - Plugin Configuration Feature
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
 */
const AVAILABLE_PLUGINS: ReadonlyArray<PluginInfo> = [
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
];

/** Set of valid plugin IDs for path validation */
const KNOWN_PLUGIN_IDS = new Set(AVAILABLE_PLUGINS.map((p) => p.id));

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
   * Get metadata for all available bundled plugins.
   *
   * Returns hardcoded metadata for the 4 Ptah plugins.
   * This does not require initialization (metadata is static).
   *
   * @returns Array of PluginInfo objects with plugin metadata
   */
  getAvailablePlugins(): PluginInfo[] {
    return [...AVAILABLE_PLUGINS];
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
        lastUpdated: undefined,
      };
    }

    const stored =
      this.workspaceState.get<PluginConfigState>(PLUGIN_CONFIG_KEY);

    if (!stored || !Array.isArray(stored.enabledPluginIds)) {
      return {
        enabledPluginIds: [],
        disabledSkillIds: [],
        lastUpdated: undefined,
      };
    }

    return {
      enabledPluginIds: stored.enabledPluginIds,
      disabledSkillIds: Array.isArray(stored.disabledSkillIds)
        ? stored.disabledSkillIds
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
   * @param config - Plugin configuration to save (enabledPluginIds will be persisted)
   * @throws Error if workspaceState is not initialized
   */
  async saveWorkspacePluginConfig(
    config: Pick<PluginConfigState, 'enabledPluginIds' | 'disabledSkillIds'>,
  ): Promise<void> {
    if (!this.workspaceState) {
      throw new SdkError(
        'PluginLoaderService not initialized: workspaceState is null',
      );
    }

    const configToSave: PluginConfigState = {
      enabledPluginIds: config.enabledPluginIds,
      disabledSkillIds: config.disabledSkillIds,
      lastUpdated: new Date().toISOString(),
    };

    await this.workspaceState.update(PLUGIN_CONFIG_KEY, configToSave);

    this.logger.debug('[PluginLoaderService] Plugin config saved', {
      enabledCount: configToSave.enabledPluginIds.length,
      enabledPluginIds: configToSave.enabledPluginIds,
      disabledSkillCount: configToSave.disabledSkillIds.length,
      lastUpdated: configToSave.lastUpdated,
    });
  }

  /**
   * Resolve plugin IDs to absolute directory paths.
   *
   * Maps each valid plugin ID to its absolute path under the extension's
   * assets/plugins/ directory. Invalid or unknown plugin IDs are filtered out
   * to prevent arbitrary path construction (security).
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

    const validIds = enabledPluginIds.filter((id) => {
      const isValid = KNOWN_PLUGIN_IDS.has(id);
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
   * Resolve plugin paths for currently enabled plugins.
   * Convenience method for SkillJunctionService callbacks.
   */
  resolveCurrentPluginPaths(): string[] {
    const config = this.getWorkspacePluginConfig();
    return this.resolvePluginPaths(config.enabledPluginIds);
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
      try {
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
          try {
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            const { name, description } = this.parseFrontmatter(content);

            skills.push({
              skillId: entry,
              displayName: name || entry,
              description: description || name || entry,
              pluginId,
            });
          } catch {
            // SKILL.md not readable — skip this skill
          }
        }
      } catch {
        // Plugin path not accessible — skip
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
