/**
 * Plugin RPC Handlers
 *
 * Handles plugin configuration RPC methods:
 * - plugins:list-available - List all bundled plugins with metadata
 * - plugins:get-config - Get per-workspace plugin configuration
 * - plugins:save-config - Save plugin configuration (enabled plugin IDs)
 *
 * TASK_2025_153: Plugin Configuration Feature
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  PluginLoaderService,
} from '@ptah-extension/agent-sdk';
import type {
  PluginInfo,
  PluginConfigState,
} from '@ptah-extension/shared';

/**
 * RPC handlers for plugin configuration operations.
 *
 * TASK_2025_153: Plugin Configuration Feature
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
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService
  ) {}

  /**
   * Register all plugin RPC methods
   */
  register(): void {
    this.registerListAvailable();
    this.registerGetConfig();
    this.registerSaveConfig();

    this.logger.debug('Plugin RPC handlers registered', {
      methods: [
        'plugins:list-available',
        'plugins:get-config',
        'plugins:save-config',
      ],
    });
  }

  /**
   * plugins:list-available - List all bundled plugins with metadata
   *
   * Returns the full list of available Hive Academy plugins with their
   * names, descriptions, categories, skill/command counts, and keywords.
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
          error instanceof Error ? error : new Error(String(error))
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
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );
  }

  /**
   * plugins:save-config - Save plugin configuration
   *
   * Persists the user's plugin selection to workspace state.
   * The configuration takes effect on the next chat session start.
   *
   * @param params.enabledPluginIds - Array of plugin IDs to enable
   * @returns Success status with optional error message
   */
  private registerSaveConfig(): void {
    this.rpcHandler.registerMethod<
      { enabledPluginIds: string[] },
      { success: boolean; error?: string }
    >('plugins:save-config', async (params) => {
      try {
        // Validate and sanitize input
        const rawIds = params?.enabledPluginIds ?? [];
        const knownPluginIds = this.pluginLoader
          .getAvailablePlugins()
          .map((p) => p.id);
        const enabledPluginIds = [
          ...new Set(
            rawIds.filter(
              (id): id is string =>
                typeof id === 'string' && knownPluginIds.includes(id)
            )
          ),
        ];

        this.logger.debug('RPC: plugins:save-config called', {
          enabledPluginIds,
        });

        await this.pluginLoader.saveWorkspacePluginConfig({
          enabledPluginIds,
        });

        this.logger.debug('RPC: plugins:save-config success', {
          enabledCount: enabledPluginIds.length,
        });

        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        this.logger.error(
          'RPC: plugins:save-config failed',
          error instanceof Error ? error : new Error(errorMessage)
        );

        return { success: false, error: errorMessage };
      }
    });
  }
}
