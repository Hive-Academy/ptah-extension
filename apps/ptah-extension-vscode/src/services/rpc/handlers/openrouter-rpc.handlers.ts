/**
 * OpenRouter RPC Handlers (TASK_2025_091 Phase 2)
 *
 * Handles OpenRouter-related RPC methods for model listing and tier configuration:
 * - openrouter:listModels - Fetch models from OpenRouter API
 * - openrouter:setModelTier - Set model for a tier (Sonnet/Opus/Haiku)
 * - openrouter:getModelTiers - Get current tier mappings
 * - openrouter:clearModelTier - Clear a tier override (reset to default)
 */

import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import {
  Logger,
  RpcHandler,
  TOKENS,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { OpenRouterModelsService, SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  OpenRouterListModelsParams,
  OpenRouterListModelsResult,
  OpenRouterSetModelTierParams,
  OpenRouterSetModelTierResult,
  OpenRouterGetModelTiersResult,
  OpenRouterClearModelTierParams,
  OpenRouterClearModelTierResult,
} from '@ptah-extension/shared';

/**
 * RPC handlers for OpenRouter model operations
 */
@injectable()
export class OpenRouterRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecretsService: IAuthSecretsService,
    @inject(SDK_TOKENS.SDK_OPENROUTER_MODELS)
    private readonly openRouterModels: OpenRouterModelsService
  ) {}

  /**
   * Register all OpenRouter RPC methods
   */
  register(): void {
    this.registerListModels();
    this.registerSetModelTier();
    this.registerGetModelTiers();
    this.registerClearModelTier();

    this.logger.debug('OpenRouter RPC handlers registered', {
      methods: [
        'openrouter:listModels',
        'openrouter:setModelTier',
        'openrouter:getModelTiers',
        'openrouter:clearModelTier',
      ],
    });
  }

  /**
   * openrouter:listModels - Fetch models from OpenRouter API
   */
  private registerListModels(): void {
    const ListModelsSchema = z.object({
      toolUseOnly: z.boolean().optional(),
    });

    this.rpcHandler.registerMethod<
      OpenRouterListModelsParams,
      OpenRouterListModelsResult
    >('openrouter:listModels', async (params) => {
      try {
        const validated = ListModelsSchema.parse(params);

        this.logger.debug('RPC: openrouter:listModels called', {
          toolUseOnly: validated.toolUseOnly,
        });

        // Get OpenRouter API key from secrets
        const apiKey = await this.authSecretsService.getCredential(
          'openrouterKey'
        );

        if (!apiKey) {
          throw new Error(
            'OpenRouter API key not configured. Please add your key in Settings.'
          );
        }

        // Fetch models from OpenRouter API
        const result = await this.openRouterModels.fetchModels(
          apiKey,
          validated.toolUseOnly ?? false
        );

        this.logger.info('RPC: openrouter:listModels completed', {
          count: result.models.length,
          totalCount: result.totalCount,
        });

        return result;
      } catch (error) {
        this.logger.error(
          'RPC: openrouter:listModels failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
  }

  /**
   * openrouter:setModelTier - Set model for a tier (Sonnet/Opus/Haiku)
   */
  private registerSetModelTier(): void {
    const SetModelTierSchema = z.object({
      tier: z.enum(['sonnet', 'opus', 'haiku']),
      modelId: z.string().min(1),
    });

    this.rpcHandler.registerMethod<
      OpenRouterSetModelTierParams,
      OpenRouterSetModelTierResult
    >('openrouter:setModelTier', async (params) => {
      try {
        const validated = SetModelTierSchema.parse(params);

        this.logger.debug('RPC: openrouter:setModelTier called', {
          tier: validated.tier,
          modelId: validated.modelId,
        });

        // Set the model tier
        await this.openRouterModels.setModelTier(
          validated.tier,
          validated.modelId
        );

        this.logger.info('RPC: openrouter:setModelTier completed', {
          tier: validated.tier,
          modelId: validated.modelId,
        });

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: openrouter:setModelTier failed',
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
   * openrouter:getModelTiers - Get current tier mappings
   */
  private registerGetModelTiers(): void {
    this.rpcHandler.registerMethod<void, OpenRouterGetModelTiersResult>(
      'openrouter:getModelTiers',
      async () => {
        try {
          this.logger.debug('RPC: openrouter:getModelTiers called');

          const tiers = this.openRouterModels.getModelTiers();

          this.logger.debug('RPC: openrouter:getModelTiers result', { tiers });

          return tiers;
        } catch (error) {
          this.logger.error(
            'RPC: openrouter:getModelTiers failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );
  }

  /**
   * openrouter:clearModelTier - Clear a tier override (reset to default)
   */
  private registerClearModelTier(): void {
    const ClearModelTierSchema = z.object({
      tier: z.enum(['sonnet', 'opus', 'haiku']),
    });

    this.rpcHandler.registerMethod<
      OpenRouterClearModelTierParams,
      OpenRouterClearModelTierResult
    >('openrouter:clearModelTier', async (params) => {
      try {
        const validated = ClearModelTierSchema.parse(params);

        this.logger.debug('RPC: openrouter:clearModelTier called', {
          tier: validated.tier,
        });

        await this.openRouterModels.clearModelTier(validated.tier);

        this.logger.info('RPC: openrouter:clearModelTier completed', {
          tier: validated.tier,
        });

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: openrouter:clearModelTier failed',
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
