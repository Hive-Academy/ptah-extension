/**
 * Provider RPC Handlers (TASK_2025_132 - generalized from OpenRouterRpcHandlers)
 *
 * Handles provider-related RPC methods for model listing and tier configuration:
 * - provider:listModels - Fetch models from provider API (or return static list)
 * - provider:setModelTier - Set model for a tier (Sonnet/Opus/Haiku)
 * - provider:getModelTiers - Get current tier mappings
 * - provider:clearModelTier - Clear a tier override (reset to default)
 *
 * Supports all Anthropic-compatible providers (OpenRouter, Moonshot, Z.AI).
 */

import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import {
  Logger,
  RpcHandler,
  TOKENS,
  ConfigManager,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  ProviderModelsService,
  SDK_TOKENS,
  DEFAULT_PROVIDER_ID,
  getAnthropicProvider,
} from '@ptah-extension/agent-sdk';
import {
  ProviderListModelsParams,
  ProviderListModelsResult,
  ProviderSetModelTierParams,
  ProviderSetModelTierResult,
  ProviderGetModelTiersParams,
  ProviderGetModelTiersResult,
  ProviderClearModelTierParams,
  ProviderClearModelTierResult,
} from '@ptah-extension/shared';

/**
 * RPC handlers for provider model operations
 */
@injectable()
export class ProviderRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecretsService: IAuthSecretsService,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService
  ) {}

  /**
   * Register all provider RPC methods
   */
  register(): void {
    this.registerListModels();
    this.registerSetModelTier();
    this.registerGetModelTiers();
    this.registerClearModelTier();

    this.logger.debug('Provider RPC handlers registered', {
      methods: [
        'provider:listModels',
        'provider:setModelTier',
        'provider:getModelTiers',
        'provider:clearModelTier',
      ],
    });
  }

  /**
   * Resolve the provider ID from params or config
   */
  private resolveProviderId(providerId?: string): string {
    if (providerId) return providerId;
    return this.configManager.getWithDefault<string>(
      'anthropicProviderId',
      DEFAULT_PROVIDER_ID
    );
  }

  /**
   * provider:listModels - Fetch models from provider API (or return static list)
   */
  private registerListModels(): void {
    const ListModelsSchema = z.object({
      toolUseOnly: z.boolean().optional(),
      providerId: z.string().optional(),
    });

    this.rpcHandler.registerMethod<
      ProviderListModelsParams,
      ProviderListModelsResult
    >('provider:listModels', async (params) => {
      try {
        const validated = ListModelsSchema.parse(params);
        const providerId = this.resolveProviderId(validated.providerId);

        this.logger.debug('RPC: provider:listModels called', {
          providerId,
          toolUseOnly: validated.toolUseOnly,
        });

        // Get API key from per-provider storage (may be null for static-model providers)
        const apiKey = await this.authSecretsService.getProviderKey(providerId);

        // Guard: dynamic providers need an API key to fetch models
        if (!apiKey) {
          const provider = getAnthropicProvider(providerId);
          const isDynamic =
            provider?.modelsEndpoint &&
            (!provider.staticModels || provider.staticModels.length === 0);
          if (isDynamic) {
            this.logger.debug(
              'RPC: provider:listModels skipped - no API key for dynamic provider',
              { providerId }
            );
            return { models: [], totalCount: 0, isStatic: false };
          }
        }

        // Fetch models (service handles static vs dynamic internally)
        const result = await this.providerModels.fetchModels(
          providerId,
          apiKey ?? null,
          validated.toolUseOnly ?? false
        );

        this.logger.info('RPC: provider:listModels completed', {
          providerId,
          count: result.models.length,
          totalCount: result.totalCount,
          isStatic: result.isStatic,
        });

        return result;
      } catch (error) {
        this.logger.error(
          'RPC: provider:listModels failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
  }

  /**
   * provider:setModelTier - Set model for a tier (Sonnet/Opus/Haiku)
   */
  private registerSetModelTier(): void {
    const SetModelTierSchema = z.object({
      tier: z.enum(['sonnet', 'opus', 'haiku']),
      modelId: z.string().min(1),
      providerId: z.string().optional(),
    });

    this.rpcHandler.registerMethod<
      ProviderSetModelTierParams,
      ProviderSetModelTierResult
    >('provider:setModelTier', async (params) => {
      try {
        const validated = SetModelTierSchema.parse(params);
        const providerId = this.resolveProviderId(validated.providerId);

        this.logger.debug('RPC: provider:setModelTier called', {
          providerId,
          tier: validated.tier,
          modelId: validated.modelId,
        });

        await this.providerModels.setModelTier(
          providerId,
          validated.tier,
          validated.modelId
        );

        this.logger.info('RPC: provider:setModelTier completed', {
          providerId,
          tier: validated.tier,
          modelId: validated.modelId,
        });

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: provider:setModelTier failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /**
   * provider:getModelTiers - Get current tier mappings
   */
  private registerGetModelTiers(): void {
    const GetModelTiersSchema = z.object({
      providerId: z.string().optional(),
    });

    this.rpcHandler.registerMethod<
      ProviderGetModelTiersParams,
      ProviderGetModelTiersResult
    >('provider:getModelTiers', async (params) => {
      try {
        const validated = GetModelTiersSchema.parse(params ?? {});
        const providerId = this.resolveProviderId(validated.providerId);

        this.logger.debug('RPC: provider:getModelTiers called', { providerId });

        const tiers = this.providerModels.getModelTiers(providerId);

        this.logger.debug('RPC: provider:getModelTiers result', {
          providerId,
          tiers,
        });

        return tiers;
      } catch (error) {
        this.logger.error(
          'RPC: provider:getModelTiers failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
  }

  /**
   * provider:clearModelTier - Clear a tier override (reset to default)
   */
  private registerClearModelTier(): void {
    const ClearModelTierSchema = z.object({
      tier: z.enum(['sonnet', 'opus', 'haiku']),
      providerId: z.string().optional(),
    });

    this.rpcHandler.registerMethod<
      ProviderClearModelTierParams,
      ProviderClearModelTierResult
    >('provider:clearModelTier', async (params) => {
      try {
        const validated = ClearModelTierSchema.parse(params);
        const providerId = this.resolveProviderId(validated.providerId);

        this.logger.debug('RPC: provider:clearModelTier called', {
          providerId,
          tier: validated.tier,
        });

        await this.providerModels.clearModelTier(providerId, validated.tier);

        this.logger.info('RPC: provider:clearModelTier completed', {
          providerId,
          tier: validated.tier,
        });

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: provider:clearModelTier failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }
}
