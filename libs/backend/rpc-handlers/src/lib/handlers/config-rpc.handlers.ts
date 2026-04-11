/**
 * Config RPC Handlers
 *
 * Handles config-related RPC methods: config:model-*, config:autopilot-*
 * Manages model selection and autopilot configuration persistence.
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_203: Moved to @ptah-extension/rpc-handlers (removed vscode.ConfigurationTarget)
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  ConfigManager,
} from '@ptah-extension/vscode-core';
import {
  SdkAgentAdapter,
  SdkPermissionHandler,
  ProviderModelsService,
  SDK_TOKENS,
  DEFAULT_PROVIDER_ID,
  ANTHROPIC_DIRECT_PROVIDER_ID,
} from '@ptah-extension/agent-sdk';
import {
  PermissionLevel,
  ConfigModelSwitchParams,
  ConfigModelSwitchResult,
  ConfigModelGetResult,
  ConfigAutopilotToggleParams,
  ConfigAutopilotToggleResult,
  ConfigAutopilotGetResult,
  ConfigModelsListResult,
  ConfigEffortSetParams,
  ConfigEffortSetResult,
  ConfigEffortGetResult,
  getModelPricingDescription,
  type EffortLevel,
} from '@ptah-extension/shared';

/**
 * RPC handlers for configuration operations
 */
@injectable()
export class ConfigRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    private readonly permissionHandler: SdkPermissionHandler,
  ) {}

  /**
   * Register all config RPC methods
   */
  register(): void {
    this.registerModelSwitch();
    this.registerModelGet();
    this.registerAutopilotToggle();
    this.registerAutopilotGet();
    this.registerModelsList();
    this.registerEffortGet();
    this.registerEffortSet();

    // Initialize permission handler with saved autopilot config
    // This ensures canUseTool callback respects the permission level
    // even for sessions started before any toggle RPC is received
    const autopilotEnabled = this.configManager.getWithDefault<boolean>(
      'autopilot.enabled',
      false,
    );
    const savedLevel = this.configManager.getWithDefault<PermissionLevel>(
      'autopilot.permissionLevel',
      'ask',
    );
    const effectiveLevel = autopilotEnabled ? savedLevel : 'ask';
    this.permissionHandler.setPermissionLevel(effectiveLevel);

    this.logger.debug('Config RPC handlers registered', {
      methods: [
        'config:model-switch',
        'config:model-get',
        'config:autopilot-toggle',
        'config:autopilot-get',
        'config:models-list',
        'config:effort-get',
        'config:effort-set',
      ],
      initialPermissionLevel: effectiveLevel,
    });
  }

  /**
   * config:model-switch - Switch AI model
   */
  private registerModelSwitch(): void {
    this.rpcHandler.registerMethod<
      ConfigModelSwitchParams,
      ConfigModelSwitchResult
    >('config:model-switch', async (params) => {
      try {
        const { model, sessionId } = params;

        this.logger.debug('RPC: config:model-switch called', {
          model,
          sessionId,
        });

        // Save the model (now using full API name)
        await this.configManager.set('model.selected', model);

        // Sync to active SDK session if provided
        if (sessionId) {
          try {
            await this.sdkAdapter.setSessionModel(sessionId, model);
            this.logger.debug('Model synced to active session', {
              sessionId,
              model,
            });
          } catch (syncError) {
            this.logger.warn(
              'Failed to sync model to active session (config saved)',
              syncError instanceof Error
                ? syncError
                : new Error(String(syncError)),
            );
          }
        }

        this.logger.info('Model switched successfully', { model });

        return { model };
      } catch (error) {
        this.logger.error(
          'RPC: config:model-switch failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  /**
   * config:model-get - Get current model selection
   */
  private registerModelGet(): void {
    this.rpcHandler.registerMethod<void, ConfigModelGetResult>(
      'config:model-get',
      async () => {
        try {
          this.logger.debug('RPC: config:model-get called');

          const model =
            this.configManager.get<string>('model.selected') || 'default';

          return { model };
        } catch (error) {
          this.logger.error(
            'RPC: config:model-get failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  /**
   * config:autopilot-toggle - Toggle autopilot and set permission level
   */
  private registerAutopilotToggle(): void {
    this.rpcHandler.registerMethod<
      ConfigAutopilotToggleParams,
      ConfigAutopilotToggleResult
    >('config:autopilot-toggle', async (params) => {
      try {
        const { enabled, permissionLevel, sessionId } = params;

        // Validate permission level
        const validLevels = ['ask', 'auto-edit', 'yolo', 'plan'] as const;
        if (
          !validLevels.includes(permissionLevel as (typeof validLevels)[number])
        ) {
          throw new Error(
            `Invalid permission level: ${permissionLevel}. Must be one of: ${validLevels.join(
              ', ',
            )}`,
          );
        }

        this.logger.debug('RPC: config:autopilot-toggle called', {
          enabled,
          permissionLevel,
          sessionId,
        });

        // Warn if YOLO mode is enabled (dangerous operation)
        if (enabled && permissionLevel === 'yolo') {
          this.logger.warn(
            'YOLO mode enabled - DANGEROUS: All permission prompts will be skipped',
            { enabled, permissionLevel },
          );
        }

        await this.configManager.set('autopilot.enabled', enabled);
        await this.configManager.set(
          'autopilot.permissionLevel',
          permissionLevel,
        );

        // Sync permission level to canUseTool callback (defense-in-depth)
        // This ensures the callback respects the level even if SDK's
        // setPermissionMode fails or no active session exists
        const effectiveLevel = enabled
          ? (permissionLevel as PermissionLevel)
          : 'ask';
        this.permissionHandler.setPermissionLevel(effectiveLevel);

        // Sync to active SDK session — ALWAYS, including when disabled.
        // When disabled, reset SDK to 'default' so canUseTool is invoked again.
        // Without this, the SDK session stays in bypassPermissions/acceptEdits
        // and canUseTool is never called despite the UI showing "Manual".
        if (sessionId) {
          try {
            const sdkMode = enabled
              ? this.mapPermissionToSdkMode(permissionLevel)
              : 'default';
            await this.sdkAdapter.setSessionPermissionLevel(sessionId, sdkMode);
            this.logger.debug('Permission mode synced to active session', {
              sessionId,
              sdkMode,
              enabled,
            });
          } catch (syncError) {
            this.logger.warn(
              'Failed to sync permission mode to active session (config saved)',
              syncError instanceof Error
                ? syncError
                : new Error(String(syncError)),
            );
          }
        }

        this.logger.info('Autopilot state updated', {
          enabled,
          permissionLevel,
        });

        return { enabled, permissionLevel };
      } catch (error) {
        this.logger.error(
          'RPC: config:autopilot-toggle failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  /**
   * config:autopilot-get - Get current autopilot state
   */
  private registerAutopilotGet(): void {
    this.rpcHandler.registerMethod<void, ConfigAutopilotGetResult>(
      'config:autopilot-get',
      async () => {
        try {
          this.logger.debug('RPC: config:autopilot-get called');

          const enabled = this.configManager.getWithDefault<boolean>(
            'autopilot.enabled',
            false,
          );
          const permissionLevel =
            this.configManager.getWithDefault<PermissionLevel>(
              'autopilot.permissionLevel',
              'ask',
            );

          return { enabled, permissionLevel };
        } catch (error) {
          this.logger.error(
            'RPC: config:autopilot-get failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  /**
   * config:models-list - Get available models with metadata
   *
   * TASK_2025_237: Merges two model sources:
   * 1. SDK's supportedModels() — 3 tier slots (opus/sonnet/haiku) as recommended shortcuts
   * 2. Anthropic /v1/models API — ALL available models for specific version selection
   *
   * SDK tier models appear first (as "latest" recommended options), followed by
   * additional API models not already covered by a tier. The SDK accepts any model
   * string in setModel(), so all models work regardless of source.
   */
  private registerModelsList(): void {
    this.rpcHandler.registerMethod<void, ConfigModelsListResult>(
      'config:models-list',
      async () => {
        try {
          this.logger.debug('RPC: config:models-list called');

          // Get saved model preference
          const savedModel =
            this.configManager.get<string>('model.selected') || 'default';

          // Fetch SDK tier models (always available, 3 slots)
          const sdkModels = await this.sdkAdapter.getSupportedModels();

          // Fetch API models in parallel (all available versions, non-blocking)
          const apiModels = await this.sdkAdapter.getApiModels();

          // Check if an Anthropic-compatible provider is active and get tier overrides
          const authMethod = this.configManager.getWithDefault<string>(
            'authMethod',
            'auto',
          );
          let tierOverrides: ReturnType<
            ProviderModelsService['getModelTiers']
          > | null = null;

          // TASK_2025_270: Apply tier overrides for ALL auth methods.
          // For 'oauth'/'apiKey': use 'anthropic' virtual provider ID
          // For 'openrouter': use the configured third-party provider ID
          // For 'auto': detect which auth actually resolved by checking env
          const tierProviderId = (() => {
            if (authMethod === 'oauth' || authMethod === 'apiKey')
              return ANTHROPIC_DIRECT_PROVIDER_ID;
            if (authMethod === 'openrouter')
              return this.configManager.getWithDefault<string>(
                'anthropicProviderId',
                DEFAULT_PROVIDER_ID,
              );
            // 'auto' mode: provider auth sets ANTHROPIC_BASE_URL, direct auth does not
            if (!process.env['ANTHROPIC_BASE_URL'])
              return ANTHROPIC_DIRECT_PROVIDER_ID;
            return this.configManager.getWithDefault<string>(
              'anthropicProviderId',
              DEFAULT_PROVIDER_ID,
            );
          })();

          try {
            tierOverrides = this.providerModels.getModelTiers(tierProviderId);
          } catch (e) {
            this.logger.warn(
              'Failed to read provider tier overrides',
              e instanceof Error ? e : new Error(String(e)),
            );
          }

          // --- Phase 1: Build SDK tier models (recommended shortcuts) ---
          const sdkModelIds = new Set<string>();
          const models = sdkModels.map((m) => {
            const valueLower = m.value.toLowerCase();
            const displayLower = (m.displayName || '').toLowerCase();
            const descLower = (m.description || '').toLowerCase();

            const tier = this.detectModelTier(
              valueLower,
              displayLower,
              descLower,
            );

            // Resolve 'default' to explicit tier (SDK query() quirk)
            let resolvedValue = m.value;
            if (valueLower === 'default' && tier) {
              resolvedValue = tier;
              this.logger.info(
                `Resolved SDK 'default' tier to '${resolvedValue}'`,
                { displayName: m.displayName },
              );
            }

            sdkModelIds.add(resolvedValue);

            // Apply provider tier overrides
            let providerModelId: string | null = null;
            if (tierOverrides && tier) {
              providerModelId = tierOverrides[tier] ?? null;
            }

            const description = providerModelId
              ? getModelPricingDescription(providerModelId)
              : m.description;

            return {
              id: resolvedValue,
              name: m.displayName,
              description,
              apiName: resolvedValue,
              isSelected: resolvedValue === savedModel,
              isRecommended:
                valueLower.includes('sonnet') ||
                displayLower.includes('sonnet'),
              providerModelId,
              tier,
            };
          });

          // --- Phase 2: Add API models not already covered by SDK tiers ---
          for (const apiModel of apiModels) {
            // Skip if already represented by an SDK tier model
            if (sdkModelIds.has(apiModel.id)) continue;

            const idLower = apiModel.id.toLowerCase();
            const nameLower = apiModel.displayName.toLowerCase();
            const tier = this.detectModelTier(idLower, nameLower, '');

            // Apply provider tier overrides
            let providerModelId: string | null = null;
            if (tierOverrides && tier) {
              providerModelId = tierOverrides[tier] ?? null;
            }

            const description = providerModelId
              ? getModelPricingDescription(providerModelId)
              : getModelPricingDescription(apiModel.id);

            models.push({
              id: apiModel.id,
              name: apiModel.displayName,
              description,
              apiName: apiModel.id,
              isSelected: apiModel.id === savedModel,
              isRecommended: false,
              providerModelId,
              tier,
            });
          }

          this.logger.debug('RPC: config:models-list merged', {
            sdkCount: sdkModels.length,
            apiCount: apiModels.length,
            totalCount: models.length,
            modelIds: models.map((m) => m.id),
          });

          return { models };
        } catch (error) {
          this.logger.error(
            'RPC: config:models-list failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  /**
   * Detect which tier family a model belongs to based on its value and metadata.
   * Used for provider override mapping — even full model IDs like
   * 'claude-sonnet-4-5-20250514' belong to the 'sonnet' tier family.
   *
   * @returns The detected tier, or undefined for unrecognized models
   */
  private detectModelTier(
    valueLower: string,
    displayLower: string,
    descLower: string,
  ): 'opus' | 'sonnet' | 'haiku' | undefined {
    const combined = `${valueLower} ${displayLower} ${descLower}`;
    if (combined.includes('opus')) return 'opus';
    if (combined.includes('sonnet')) return 'sonnet';
    if (combined.includes('haiku')) return 'haiku';
    return undefined;
  }

  /**
   * config:effort-get - Get saved reasoning effort level
   */
  private registerEffortGet(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      ConfigEffortGetResult
    >('config:effort-get', async () => {
      try {
        this.logger.debug('RPC: config:effort-get called');
        const effort = this.configManager.getWithDefault<string>(
          'reasoningEffort',
          '',
        );
        return {
          effort: (effort || undefined) as EffortLevel | undefined,
        };
      } catch (error) {
        this.logger.error(
          'RPC: config:effort-get failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  /**
   * config:effort-set - Save reasoning effort level
   */
  private registerEffortSet(): void {
    this.rpcHandler.registerMethod<
      ConfigEffortSetParams,
      ConfigEffortSetResult
    >('config:effort-set', async (params) => {
      try {
        const { effort } = params;
        this.logger.debug('RPC: config:effort-set called', { effort });

        await this.configManager.set('reasoningEffort', effort || '');

        this.logger.info('Reasoning effort saved', { effort });
        return { effort };
      } catch (error) {
        this.logger.error(
          'RPC: config:effort-set failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  /**
   * Map frontend permission level to SDK permission mode
   */
  private mapPermissionToSdkMode(
    level: PermissionLevel,
  ): 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' {
    const modeMap: Record<
      PermissionLevel,
      'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
    > = {
      ask: 'default',
      'auto-edit': 'acceptEdits',
      yolo: 'bypassPermissions',
      plan: 'plan',
    };
    return modeMap[level];
  }
}
