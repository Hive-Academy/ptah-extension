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
 * ...and the external marketplace surface (TASK_2026_270):
 * - plugins:list-marketplaces / :add-marketplace / :remove-marketplace
 * - plugins:browse-marketplace
 * - plugins:install-external / :uninstall-external
 *
 * Activation asymmetry these handlers must preserve: bundled plugins are
 * opt-in via `enabledPluginIds`, harness-authored ones are opt-out via
 * `disabledPluginIds`. External plugins are opt-in like bundled, and a
 * successful install flips them on here — the consent dialog was the decision
 * point, so a second switch would be ceremony. See `PluginSource` in
 * `@ptah-extension/shared`.
 *
 * WHAT THIS FILE MUST NOT DO: decide whether consent was given.
 * `ExternalPluginInstallerService` owns that, and it answers from the plan it
 * minted, not from anything a caller sends. Keep it that way — an `if` here
 * that skips straight to `confirmInstall` would be a silent bypass of the
 * entire consent gate.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  HARNESS_SYNC_TOKENS,
  type HarnessPropagationService,
} from '@ptah-extension/harness-sync';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { CommandDiscoveryService } from '@ptah-extension/workspace-intelligence';
import {
  ExternalPluginInstallerService,
  MarketplaceRegistryService,
  PLUGIN_MARKETPLACE_TOKENS,
  PluginMarketplaceError,
} from '@ptah-extension/plugin-marketplace';
import type {
  HarnessHealth,
  PluginInfo,
  PluginConfigState,
  PluginSkillEntry,
  ExternalConsentReason,
  ExternalInstallResponse,
  ExternalInstallResult,
  ExternalMarketplace,
  ExternalMarketplaceBrowseResult,
  ExternalSkillCollision,
  ExternalUninstallResult,
  ListMarketplacesResult,
} from '@ptah-extension/shared';
import type { RpcMethodName } from '@ptah-extension/shared';
import {
  ExternalInstallParamsSchema,
  ExternalUninstallParamsSchema,
  MarketplaceBrowseParamsSchema,
  MarketplaceSourceParamsSchema,
} from './plugin-rpc.schema';

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
    'plugins:list-marketplaces',
    'plugins:add-marketplace',
    'plugins:remove-marketplace',
    'plugins:browse-marketplace',
    'plugins:install-external',
    'plugins:uninstall-external',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(HARNESS_SYNC_TOKENS.PROPAGATION)
    private readonly harnessPropagation: HarnessPropagationService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.COMMAND_DISCOVERY_SERVICE)
    private readonly commandDiscovery: CommandDiscoveryService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(PLUGIN_MARKETPLACE_TOKENS.REGISTRY)
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    @inject(PLUGIN_MARKETPLACE_TOKENS.INSTALLER)
    private readonly externalInstaller: ExternalPluginInstallerService,
  ) {}

  /**
   * Register all plugin RPC methods
   */
  register(): void {
    this.registerListAvailable();
    this.registerGetConfig();
    this.registerSaveConfig();
    this.registerListSkills();
    this.registerListMarketplaces();
    this.registerAddMarketplace();
    this.registerRemoveMarketplace();
    this.registerBrowseMarketplace();
    this.registerInstallExternal();
    this.registerUninstallExternal();

    this.logger.debug('Plugin RPC handlers registered', {
      methods: PluginRpcHandlers.METHODS,
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
        // The reconciler re-reads the config we just saved through its source
        // resolver, so the newly disabled skills are reaped and the newly
        // enabled ones copied in the same pass.
        //
        // `skipUserLayerRefresh` because this is the one trigger that provably
        // cannot need it: enabling or disabling a plugin changes which sources
        // the desired state FILTERS IN, never what any source contains. Paying
        // for a full mirror + reconcileAll on every checkbox toggle would make
        // the Plugins panel feel broken for no gain.
        await this.reconcileHarness('plugins:save-config', {
          skipUserLayerRefresh: true,
        });

        this.logger.debug('RPC: plugins:save-config success', {
          enabledCount: enabledPluginIds.length,
          disabledSkillCount: validatedDisabledSkillIds.length,
          disabledPluginCount: disabledPluginIds?.length,
          pluginPaths: pluginPaths.length,
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

  /**
   * plugins:list-marketplaces - Registered external marketplaces + suggestions
   *
   * Suggestions (currently `dotnet/skills`) are served from the backend rather
   * than hardcoded in the UI so the recommendation list is one thing, not two.
   */
  private registerListMarketplaces(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      ListMarketplacesResult
    >('plugins:list-marketplaces', async () =>
      this.guard('registerListMarketplaces', () =>
        Promise.resolve(this.marketplaceRegistry.listMarketplaces()),
      ),
    );
  }

  /**
   * plugins:add-marketplace - Register an `owner/repo`
   *
   * The registry fetches and validates the manifest before persisting, so a
   * repo that is not a marketplace fails here rather than half-registering.
   */
  private registerAddMarketplace(): void {
    this.rpcHandler.registerMethod<
      { source: string },
      { marketplace: ExternalMarketplace }
    >('plugins:add-marketplace', async (params) => {
      const parsed = MarketplaceSourceParamsSchema.parse(params);
      return this.guard('registerAddMarketplace', async () => ({
        marketplace: await this.marketplaceRegistry.addMarketplace(
          parsed.source,
        ),
      }));
    });
  }

  /** plugins:remove-marketplace - Deregister. Installed plugins are kept. */
  private registerRemoveMarketplace(): void {
    this.rpcHandler.registerMethod<{ source: string }, { removed: boolean }>(
      'plugins:remove-marketplace',
      async (params) => {
        const parsed = MarketplaceSourceParamsSchema.parse(params);
        return this.guard('registerRemoveMarketplace', async () => ({
          removed: await this.marketplaceRegistry.removeMarketplace(
            parsed.source,
          ),
        }));
      },
    );
  }

  /** plugins:browse-marketplace - Plugins a registered marketplace advertises. */
  private registerBrowseMarketplace(): void {
    this.rpcHandler.registerMethod<
      { source: string; refresh?: boolean },
      ExternalMarketplaceBrowseResult
    >('plugins:browse-marketplace', async (params) => {
      const parsed = MarketplaceBrowseParamsSchema.parse(params);
      return this.guard('registerBrowseMarketplace', () =>
        this.marketplaceRegistry.browse(parsed.source, {
          refresh: parsed.refresh,
        }),
      );
    });
  }

  /**
   * plugins:install-external - The two-call consent protocol
   *
   * No `consentToken` ⇒ build a plan, write nothing, return
   * `status: 'consent-required'`. With a token ⇒ install exactly the payload
   * that plan described.
   *
   * The handler is deliberately thin here: it does NOT decide whether consent
   * was given. `ExternalPluginInstallerService.confirmInstall` rejects an
   * unknown or expired token, so there is no branch in this file that could be
   * edited into a bypass. What the handler adds is the two things the
   * installer cannot know — which skills are currently junctioned (for the
   * collision warning) and how to activate the plugin once it is on disk.
   */
  private registerInstallExternal(): void {
    this.rpcHandler.registerMethod<
      { source: string; plugin: string; consentToken?: string },
      ExternalInstallResponse
    >('plugins:install-external', async (params) => {
      const parsed = ExternalInstallParamsSchema.parse(params);

      return this.guard('registerInstallExternal', async () => {
        if (!parsed.consentToken) {
          return this.buildConsentResponse(
            parsed.source,
            parsed.plugin,
            'not-yet-approved',
          );
        }

        let result: ExternalInstallResult;
        try {
          result = await this.externalInstaller.confirmInstall(
            parsed.consentToken,
          );
        } catch (error: unknown) {
          // A token that no longer validates is not an error the user can do
          // anything with — the plan expired, the host restarted, or upstream
          // moved. Re-plan and ask again rather than dead-ending, so consent
          // is re-obtained against current facts. This is also the version-
          // change path: the token hashes the payload, so a new upstream
          // version can never satisfy an old approval.
          if (
            error instanceof PluginMarketplaceError &&
            error.code === 'consent-required'
          ) {
            return this.buildConsentResponse(
              parsed.source,
              parsed.plugin,
              'approval-expired',
            );
          }
          throw error;
        }

        const collisions = await this.activateExternalPlugin(result.pluginId);

        this.logger.debug('RPC: plugins:install-external installed', {
          pluginId: result.pluginId,
          version: result.installedVersion,
          filesWritten: result.filesWritten,
          skipped: result.skippedBinaryFiles.length,
          collisions: collisions.length,
        });

        return {
          status: 'installed' as const,
          result: { ...result, collisions },
        };
      });
    });
  }

  /** plugins:uninstall-external - Remove the tree, the record and the toggle. */
  private registerUninstallExternal(): void {
    this.rpcHandler.registerMethod<
      { pluginId: string },
      ExternalUninstallResult
    >('plugins:uninstall-external', async (params) => {
      const parsed = ExternalUninstallParamsSchema.parse(params);

      return this.guard('registerUninstallExternal', async () => {
        const removed = await this.externalInstaller.uninstall(parsed.pluginId);
        if (removed) {
          await this.deactivateExternalPlugin(parsed.pluginId);
        }
        return { pluginId: parsed.pluginId, removed };
      });
    });
  }

  /**
   * Build a fresh plan and wrap it as a `consent-required` response.
   *
   * The one place a plan is enriched with collisions, so the "first ask" and
   * the "ask again" paths cannot drift into showing different information.
   */
  private async buildConsentResponse(
    source: string,
    plugin: string,
    reason: ExternalConsentReason,
  ): Promise<ExternalInstallResponse> {
    const plan = await this.externalInstaller.planInstall(source, plugin);
    return {
      status: 'consent-required',
      reason,
      plan: {
        ...plan,
        collisions: this.predictCollisions(plan.pluginId, plan.skills),
      },
    };
  }

  /**
   * Turn a freshly-installed plugin on in this workspace and re-junction.
   *
   * Installing implies enabling: the consent dialog already listed the skills,
   * the scripts and the declared MCP servers, so making the user find a second
   * switch afterwards would add ceremony without adding a decision.
   *
   * @returns the skills that ended up shadowed by an already-active skill.
   */
  private async activateExternalPlugin(
    pluginId: string,
  ): Promise<ExternalSkillCollision[]> {
    const config = this.pluginLoader.getWorkspacePluginConfig();
    const enabledPluginIds = [
      ...new Set([...config.enabledPluginIds, pluginId]),
    ];

    await this.pluginLoader.saveWorkspacePluginConfig({
      enabledPluginIds,
      disabledSkillIds: config.disabledSkillIds,
      // Undefined preserves the persisted denylist — see saveWorkspacePluginConfig.
      disabledPluginIds: undefined,
    });

    this.commandDiscovery.invalidateCache();
    const health = await this.reconcileHarness('plugins:install-external');

    // Now that the copies have been rebuilt, report what actually lost, rather
    // than what we predicted would lose. The reconciler records a collision for
    // every source that could not claim its slug; we only care about the ones
    // this plugin brought.
    return (health?.collisions ?? [])
      .filter((collision) => collision.shadowedPluginId === pluginId)
      .map((collision) => ({
        skillName: collision.slug,
        shadowedBy: this.findSkillOwner(collision.slug) ?? 'another plugin',
      }));
  }

  /**
   * Drop an uninstalled plugin from the workspace config and re-propagate.
   *
   * Unlike `save-config`, this one MUST refresh the user layer, which is why it
   * passes no `skipUserLayerRefresh`. `uninstall()` deleted the plugin tree
   * under `~/.ptah/plugins/external/`, but the user-layer CLONES of its skills
   * are still sitting in `~/.ptah/user/skills` — and the user layer is the
   * desired state. A bare reconcile therefore saw the uninstalled plugin's
   * skills as still wanted and kept copying them into every target forever
   * (TASK_2026_278 defect 7). `reconcileAll`'s reap pass, which the refresher
   * runs, is the only thing that removes them.
   */
  private async deactivateExternalPlugin(pluginId: string): Promise<void> {
    const config = this.pluginLoader.getWorkspacePluginConfig();

    await this.pluginLoader.saveWorkspacePluginConfig({
      enabledPluginIds: config.enabledPluginIds.filter((id) => id !== pluginId),
      disabledSkillIds: config.disabledSkillIds,
      disabledPluginIds: (config.disabledPluginIds ?? []).filter(
        (id) => id !== pluginId,
      ),
    });

    this.commandDiscovery.invalidateCache();
    await this.reconcileHarness('plugins:uninstall-external');
  }

  /**
   * Reconcile `{ws}/.claude/{skills,commands}` after a config change.
   *
   * Non-fatal: an RPC that saved the user's plugin selection must report
   * success even if the workspace copy failed, because the selection IS saved
   * and the next activation heals the copy. Returns the health report so
   * callers can read the collision list, or `null` when there is no workspace.
   */
  private async reconcileHarness(
    reason: string,
    options: { skipUserLayerRefresh?: boolean } = {},
  ): Promise<HarnessHealth | null> {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (workspaceRoot === undefined || workspaceRoot === null) return null;
    try {
      return await this.harnessPropagation.propagate(
        workspaceRoot,
        reason,
        options,
      );
    } catch (error: unknown) {
      this.logger.warn('Harness reconcile failed (non-fatal)', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Which skills in `candidateSkills` an already-active skill would shadow.
   *
   * Computed here, not in the marketplace lib, because "currently installed in
   * the workspace" is state that lib has no business knowing. Prediction is
   * necessarily approximate — it compares names against the skills discoverable
   * right now — which is why the post-install result reports the real outcome
   * from `HarnessHealth.collisions` instead of repeating this.
   */
  private predictCollisions(
    pluginId: string,
    candidateSkills: string[],
  ): ExternalSkillCollision[] {
    if (candidateSkills.length === 0) return [];

    const owners = this.activeSkillOwners();

    return candidateSkills
      .filter((skillName) => {
        const owner = owners.get(skillName);
        return owner !== undefined && owner !== pluginId;
      })
      .map((skillName) => ({
        skillName,
        shadowedBy: owners.get(skillName) ?? 'another plugin',
      }));
  }

  /** Owner plugin id for every skill currently discoverable, first wins. */
  private activeSkillOwners(): Map<string, string> {
    const owners = new Map<string, string>();
    const active = this.pluginLoader.discoverSkillsForPlugins(
      this.pluginLoader.resolveCurrentPluginPaths(),
    );

    for (const skill of active) {
      if (!owners.has(skill.skillId)) owners.set(skill.skillId, skill.pluginId);
    }

    return owners;
  }

  /** Plugin id that currently owns `skillName`, or undefined. */
  private findSkillOwner(skillName: string): string | undefined {
    return this.activeSkillOwners().get(skillName);
  }

  /**
   * Run `operation`, logging + reporting failures once.
   *
   * `PluginMarketplaceError` messages are written for end users and are
   * re-thrown verbatim. Anything else is reported to Sentry and re-thrown with
   * its own message — these are Ptah's own errors, not third-party library
   * output, so there is nothing here to sanitize away.
   */
  private async guard<T>(
    errorSource: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof PluginMarketplaceError) {
        this.logger.warn(`RPC: plugins external operation rejected`, {
          errorSource,
          code: error.code,
          message: error.message,
        });
        throw error;
      }

      const normalized =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`RPC: plugins external operation failed`, normalized);
      this.sentryService.captureException(normalized, {
        errorSource: `PluginRpcHandlers.${errorSource}`,
      });
      throw normalized;
    }
  }
}
