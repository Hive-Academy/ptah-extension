/**
 * Plugin Loader Service - Manages plugin metadata and per-workspace plugin configuration
 *
 * Responsibilities:
 * - Provide hardcoded metadata for bundled Hive Academy plugins
 * - Read/write per-workspace plugin configuration from VS Code workspaceState
 * - Resolve plugin IDs to absolute directory paths for SDK consumption
 *
 * Design:
 * - Initialized from main.ts with extensionPath and workspaceState (late initialization)
 * - All methods gracefully handle uninitialized state (null extensionPath/workspaceState)
 * - Plugin IDs are validated against the known set to prevent arbitrary path construction
 *
 * @see TASK_2025_153 - Plugin Configuration Feature
 */

import * as path from 'path';
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { PluginInfo, PluginConfigState } from '@ptah-extension/shared';
import type * as vscode from 'vscode';

/** VS Code workspaceState key for plugin configuration */
const PLUGIN_CONFIG_KEY = 'ptah.plugins.config';

/**
 * Hardcoded metadata for all bundled Hive Academy plugins.
 *
 * Each entry corresponds to a directory under assets/plugins/ in the extension.
 * The metadata is used by the frontend Plugin Browser UI for display and filtering.
 */
const AVAILABLE_PLUGINS: ReadonlyArray<PluginInfo> = [
  {
    id: 'hive-academy-core',
    name: 'Hive Academy Core',
    description:
      'Core development tools including orchestration, code review, testing, and documentation agents',
    category: 'core-tools',
    skillCount: 7,
    commandCount: 5,
    isDefault: true,
    keywords: ['orchestrate', 'review', 'test', 'document', 'core'],
  },
  {
    id: 'hive-academy-nx-saas',
    name: 'Hive Academy Nx SaaS',
    description:
      'Backend tools for Nx monorepo, NestJS, Prisma, and Neon PostgreSQL workflows',
    category: 'backend-tools',
    skillCount: 4,
    commandCount: 1,
    isDefault: false,
    keywords: ['nx', 'nestjs', 'prisma', 'neon', 'backend', 'saas'],
  },
  {
    id: 'hive-academy-angular',
    name: 'Hive Academy Angular',
    description:
      'Frontend tools for Angular development with GSAP animations and 3D scene creation',
    category: 'frontend-tools',
    skillCount: 3,
    commandCount: 0,
    isDefault: false,
    keywords: ['angular', 'gsap', 'animation', '3d', 'frontend'],
  },
  {
    id: 'hive-academy-react',
    name: 'Hive Academy React',
    description:
      'Frontend tools for React development with modern patterns',
    category: 'frontend-tools',
    skillCount: 3,
    commandCount: 0,
    isDefault: false,
    keywords: ['react', 'frontend', 'hooks', 'components'],
  },
] as const;

/** Set of valid plugin IDs for path validation */
const KNOWN_PLUGIN_IDS = new Set(AVAILABLE_PLUGINS.map((p) => p.id));

/**
 * Manages plugin discovery and per-workspace plugin configuration.
 *
 * Pattern: Late-initialized service (similar to CompactionConfigProvider)
 * Single Responsibility: Plugin metadata + workspace configuration management
 *
 * Late initialization via `initialize()` is required because:
 * - extensionPath comes from vscode.ExtensionContext (available at activation)
 * - workspaceState comes from vscode.ExtensionContext (available at activation)
 * - DI registration happens before these values are available
 *
 * @example
 * ```typescript
 * // In main.ts after DI setup
 * const pluginLoader = container.resolve<PluginLoaderService>(SDK_TOKENS.SDK_PLUGIN_LOADER);
 * pluginLoader.initialize(context.extensionPath, context.workspaceState);
 *
 * // In RPC handlers
 * const plugins = pluginLoader.getAvailablePlugins();
 * const config = pluginLoader.getWorkspacePluginConfig();
 * const paths = pluginLoader.resolvePluginPaths(config.enabledPluginIds);
 * ```
 */
@injectable()
export class PluginLoaderService {
  /** Absolute path to the extension installation directory */
  private extensionPath: string | null = null;

  /** VS Code Memento for per-workspace persistent state */
  private workspaceState: vscode.Memento | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger
  ) {}

  /**
   * Initialize the plugin loader with extension context values.
   *
   * Must be called once during extension activation, after DI setup.
   * Without initialization, path resolution returns empty arrays and
   * configuration returns defaults.
   *
   * @param extensionPath - Absolute path to the extension directory (from context.extensionPath)
   * @param workspaceState - VS Code Memento for per-workspace state (from context.workspaceState)
   */
  initialize(extensionPath: string, workspaceState: vscode.Memento): void {
    this.extensionPath = extensionPath;
    this.workspaceState = workspaceState;

    this.logger.debug('[PluginLoaderService] Initialized', {
      extensionPath,
      hasWorkspaceState: true,
    });
  }

  /**
   * Get metadata for all available bundled plugins.
   *
   * Returns hardcoded metadata for the 4 Hive Academy plugins.
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
        '[PluginLoaderService] workspaceState not initialized, returning default config'
      );
      return { enabledPluginIds: [], lastUpdated: undefined };
    }

    const stored =
      this.workspaceState.get<PluginConfigState>(PLUGIN_CONFIG_KEY);

    if (!stored) {
      return { enabledPluginIds: [], lastUpdated: undefined };
    }

    return stored;
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
  async saveWorkspacePluginConfig(config: PluginConfigState): Promise<void> {
    if (!this.workspaceState) {
      throw new Error(
        'PluginLoaderService not initialized: workspaceState is null'
      );
    }

    const configToSave: PluginConfigState = {
      enabledPluginIds: config.enabledPluginIds,
      lastUpdated: new Date().toISOString(),
    };

    await this.workspaceState.update(PLUGIN_CONFIG_KEY, configToSave);

    this.logger.debug('[PluginLoaderService] Plugin config saved', {
      enabledCount: configToSave.enabledPluginIds.length,
      enabledPluginIds: configToSave.enabledPluginIds,
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
    if (!this.extensionPath) {
      this.logger.debug(
        '[PluginLoaderService] extensionPath not initialized, returning empty paths'
      );
      return [];
    }

    const validIds = enabledPluginIds.filter((id) => {
      const isValid = KNOWN_PLUGIN_IDS.has(id);
      if (!isValid) {
        this.logger.warn(
          '[PluginLoaderService] Unknown plugin ID filtered out',
          { pluginId: id }
        );
      }
      return isValid;
    });

    const paths = validIds.map((id) =>
      path.join(this.extensionPath!, 'assets', 'plugins', id)
    );

    this.logger.debug('[PluginLoaderService] Resolved plugin paths', {
      requestedCount: enabledPluginIds.length,
      resolvedCount: paths.length,
      pluginIds: validIds,
    });

    return paths;
  }
}
