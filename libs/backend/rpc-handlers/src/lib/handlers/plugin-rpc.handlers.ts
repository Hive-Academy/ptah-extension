/**
 * Plugin RPC Handlers
 *
 * Handles plugin configuration RPC methods:
 * - plugins:list-available - List bundled + harness-authored plugins with metadata
 * - plugins:get-config - Get per-workspace plugin configuration
 * - plugins:save-config - Save plugin configuration (enabled plugins + disabled
 *   plugins + disabled skills)
 * - plugins:list-skills - Enumerate skills inside the given plugin IDs
 *
 * Activation asymmetry these handlers must preserve: bundled plugins are
 * opt-in via `enabledPluginIds`, harness-authored ones are opt-out via
 * `disabledPluginIds`. See `PluginSource` in `@ptah-extension/shared`.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  PluginLoaderService,
  SkillJunctionService,
} from '@ptah-extension/agent-sdk';
import { CommandDiscoveryService } from '@ptah-extension/workspace-intelligence';
import type {
  PluginInfo,
  PluginConfigState,
  PluginSkillEntry,
} from '@ptah-extension/shared';
import type { RpcMethodName } from '@ptah-extension/shared';

/**
 * RPC handlers for plugin configuration operations.
 *
 * Exposes plugin management to the frontend for:
 * - Displaying available plugins in the Plugin Browser modal
 * - Reading per-workspace plugin configuration
 * - Saving user plugin selections
 *
 * Plugin paths are resolved at session start time by ChatRpcHandlers,
 * not by these handlers. These handlers only manage metadata and config.
 */
@injectable()
export class PluginRpcHandlers {
  static readonly METHODS = [
    'plugins:list-available',
    'plugins:get-config',
    'plugins:save-config',
    'plugins:list-skills',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(SDK_TOKENS.SDK_SKILL_JUNCTION)
    private readonly skillJunction: SkillJunctionService,
    @inject(TOKENS.COMMAND_DISCOVERY_SERVICE)
    private readonly commandDiscovery: CommandDiscoveryService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Register all plugin RPC methods
   */
  register(): void {
    this.registerListAvailable();
    this.registerGetConfig();
    this.registerSaveConfig();
    this.registerListSkills();

    this.logger.debug('Plugin RPC handlers registered', {
      methods: [
        'plugins:list-available',
        'plugins:get-config',
        'plugins:save-config',
        'plugins:list-skills',
      ],
    });
  }

  /**
   * plugins:list-available - List every visible plugin with metadata
   *
   * Returns the bundled Ptah Orchestra plugins PLUS one entry per
   * harness-authored `ptah-harness-*` directory, each with names, descriptions,
   * categories, skill/command counts, keywords, and a `source` discriminator.
   * This data is used by the Plugin Browser modal for display and search.
   */
  private registerListAvailable(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { plugins: PluginInfo[] }
    >('plugins:list-available', async () => {
      try {
        this.logger.debug('RPC: plugins:list-available called');

        const plugins = this.pluginLoader.getAvailablePlugins();

        this.logger.debug('RPC: plugins:list-available success', {
          pluginCount: plugins.length,
        });

        return { plugins };
      } catch (error) {
        this.logger.error(
          'RPC: plugins:list-available failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'PluginRpcHandlers.registerListAvailable' },
        );
        throw error;
      }
    });
  }

  /**
   * plugins:get-config - Get per-workspace plugin configuration
   *
   * Returns the current workspace plugin configuration including
   * enabled plugin IDs and the last update timestamp.
   * Returns default empty config if no configuration has been saved.
   */
  private registerGetConfig(): void {
    this.rpcHandler.registerMethod<Record<string, never>, PluginConfigState>(
      'plugins:get-config',
      async () => {
        try {
          this.logger.debug('RPC: plugins:get-config called');

          const config = this.pluginLoader.getWorkspacePluginConfig();

          this.logger.debug('RPC: plugins:get-config success', {
            enabledCount: config.enabledPluginIds.length,
            lastUpdated: config.lastUpdated,
          });

          return config;
        } catch (error) {
          this.logger.error(
            'RPC: plugins:get-config failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'PluginRpcHandlers.registerGetConfig' },
          );
          throw error;
        }
      },
    );
  }

  /**
   * plugins:save-config - Save plugin configuration
   *
   * Persists the user's plugin selection and disabled skills to workspace state.
   * Re-creates skill junctions immediately so changes take effect without restart.
   *
   * @param params.enabledPluginIds - Array of plugin IDs to enable
   * @param params.disabledSkillIds - Array of skill IDs to disable (optional, preserves existing if omitted)
   * @param params.disabledPluginIds - Array of default-enabled (harness) plugin IDs to disable
   *   (optional, preserves existing if omitted)
   * @returns Success status with optional error message
   */
  private registerSaveConfig(): void {
    this.rpcHandler.registerMethod<
      {
        enabledPluginIds: string[];
        disabledSkillIds?: string[];
        disabledPluginIds?: string[];
      },
      { success: boolean; error?: string }
    >('plugins:save-config', async (params) => {
      try {
        const rawIds = params?.enabledPluginIds ?? [];
        // Includes the discovered ptah-harness-* directories, so a harness ID
        // survives this filter while a genuinely unknown ID is still dropped.
        const knownPluginIds = this.pluginLoader
          .getAvailablePlugins()
          .map((p) => p.id);
        const enabledPluginIds = [
          ...new Set(
            rawIds.filter(
              (id): id is string =>
                typeof id === 'string' && knownPluginIds.includes(id),
            ),
          ),
        ];
        const pluginPaths =
          this.pluginLoader.resolvePluginPaths(enabledPluginIds);

        // Undefined => preserve whatever is persisted (TUI/CLI clients never
        // send this field and must not re-enable a plugin the user turned off).
        const disabledPluginIds = Array.isArray(params?.disabledPluginIds)
          ? [
              ...new Set(
                params.disabledPluginIds.filter(
                  (id): id is string =>
                    typeof id === 'string' && knownPluginIds.includes(id),
                ),
              ),
            ]
          : undefined;

        let disabledSkillIds: string[];
        if (Array.isArray(params?.disabledSkillIds)) {
          disabledSkillIds = [
            ...new Set(
              params.disabledSkillIds.filter(
                (id): id is string => typeof id === 'string' && id.length > 0,
              ),
            ),
          ];
        } else {
          const existingConfig = this.pluginLoader.getWorkspacePluginConfig();
          disabledSkillIds = existingConfig.disabledSkillIds;
        }
        // Skill IDs are validated against the enabled bundled plugins PLUS
        // every harness directory: harness plugins are opt-out and so never
        // appear in enabledPluginIds, and without them the per-skill toggle for
        // a harness skill would be silently discarded as an unknown ID.
        const skillScopePaths = [
          ...new Set([
            ...pluginPaths,
            ...this.pluginLoader.discoverHarnessPluginPaths(),
          ]),
        ];
        const discoveredSkills =
          this.pluginLoader.discoverSkillsForPlugins(skillScopePaths);
        const knownSkillIds = new Set(discoveredSkills.map((s) => s.skillId));
        const validatedDisabledSkillIds = disabledSkillIds.filter((id) =>
          knownSkillIds.has(id),
        );

        if (validatedDisabledSkillIds.length !== disabledSkillIds.length) {
          this.logger.debug(
            'RPC: plugins:save-config filtered unknown disabled skill IDs',
            {
              provided: disabledSkillIds.length,
              valid: validatedDisabledSkillIds.length,
            },
          );
        }

        this.logger.debug('RPC: plugins:save-config called', {
          enabledPluginIds,
          disabledSkillIds: validatedDisabledSkillIds,
          disabledPluginIds,
        });

        await this.pluginLoader.saveWorkspacePluginConfig({
          enabledPluginIds,
          disabledSkillIds: validatedDisabledSkillIds,
          disabledPluginIds,
        });
        this.commandDiscovery.invalidateCache();
        // Junctions must be fed from resolveCurrentPluginPaths(), NOT the
        // bundled-only pluginPaths above: it reads the config we just saved and
        // adds the harness-authored ptah-harness-* directories. Passing bundled
        // paths alone makes SkillJunctionService treat every harness skill
        // junction as stale and delete it.
        const junctionPluginPaths =
          this.pluginLoader.resolveCurrentPluginPaths();
        this.skillJunction.createJunctions(
          junctionPluginPaths,
          validatedDisabledSkillIds,
        );

        this.logger.debug('RPC: plugins:save-config success', {
          enabledCount: enabledPluginIds.length,
          disabledSkillCount: validatedDisabledSkillIds.length,
          disabledPluginCount: disabledPluginIds?.length,
          pluginPaths: pluginPaths.length,
          junctionPluginPaths: junctionPluginPaths.length,
        });

        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        this.logger.error(
          'RPC: plugins:save-config failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(errorMessage),
          { errorSource: 'PluginRpcHandlers.registerSaveConfig' },
        );

        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * plugins:list-skills - Enumerate skills within specified plugins
   *
   * Returns skill metadata (ID, display name, description, parent plugin)
   * for all skills found in the given plugin IDs. Used by the frontend
   * Plugin Browser to display per-skill toggle checkboxes.
   */
  private registerListSkills(): void {
    this.rpcHandler.registerMethod<
      { pluginIds: string[] },
      { skills: PluginSkillEntry[] }
    >('plugins:list-skills', async (params) => {
      try {
        const pluginIds = Array.isArray(params?.pluginIds)
          ? params.pluginIds.filter(
              (id): id is string => typeof id === 'string',
            )
          : [];

        this.logger.debug('RPC: plugins:list-skills called', {
          pluginIds,
        });

        const pluginPaths = this.pluginLoader.resolvePluginPaths(pluginIds);
        const skills = this.pluginLoader.discoverSkillsForPlugins(pluginPaths);

        this.logger.debug('RPC: plugins:list-skills success', {
          skillCount: skills.length,
        });

        return { skills };
      } catch (error) {
        this.logger.error(
          'RPC: plugins:list-skills failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'PluginRpcHandlers.registerListSkills' },
        );
        throw error;
      }
    });
  }
}
