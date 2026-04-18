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
 * TASK_2025_203: Moved to @ptah-extension/rpc-handlers (replaced vscode.lm with IModelDiscovery)
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
import type { IModelDiscovery } from '../platform-abstractions';
import {
  ProviderModelsService,
  SdkAgentAdapter,
  SDK_TOKENS,
  DEFAULT_PROVIDER_ID,
  ANTHROPIC_DIRECT_PROVIDER_ID,
  getAnthropicProvider,
  COPILOT_PROVIDER_ENTRY,
  CODEX_PROVIDER_ENTRY,
} from '@ptah-extension/agent-sdk';
import { CliDetectionService } from '@ptah-extension/llm-abstraction';
import {
  ProviderListModelsParams,
  ProviderListModelsResult,
  ProviderModelInfo,
  ProviderSetModelTierParams,
  ProviderSetModelTierResult,
  ProviderGetModelTiersParams,
  ProviderGetModelTiersResult,
  ProviderClearModelTierParams,
  ProviderClearModelTierResult,
  getModelPricingDescription,
  getModelContextWindow,
} from '@ptah-extension/shared';
import type { AuthEnv } from '@ptah-extension/shared';

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
    private readonly providerModels: ProviderModelsService,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService,
    @inject(TOKENS.MODEL_DISCOVERY)
    private readonly modelDiscovery: IModelDiscovery,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private readonly authEnv: AuthEnv,
  ) {}

  /**
   * Register all provider RPC methods
   */
  register(): void {
    this.registerCopilotDynamicFetcher();
    this.registerCodexDynamicFetcher();
    this.registerAnthropicDirectFetcher();
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
   * Register a dynamic fetcher for GitHub Copilot models.
   *
   * Uses a unified cascade that matches what the user actually has access to:
   * 1. VS Code LM API (selectChatModels) — subscription-filtered, most reliable
   * 2. Copilot CLI SDK (client.listModels) — also subscription-filtered
   * 3. Static fallback list from COPILOT_PROVIDER_ENTRY
   *
   * This ensures the model selector only shows models the user can actually use,
   * preventing "model not supported" errors at runtime.
   */
  private registerCopilotDynamicFetcher(): void {
    this.providerModels.registerDynamicFetcher('github-copilot', async () => {
      // 1. Try platform model discovery — returns only models the user's subscription covers
      try {
        const platformModels = await this.modelDiscovery.getCopilotModels();
        if (platformModels.length > 0) {
          this.logger.info(
            `[ProviderRpc] Fetched ${platformModels.length} Copilot models from platform discovery`,
          );
          return platformModels.map((m) => ({
            id: m.id,
            name: this.formatCopilotModelName(m.id),
            description: '',
            contextLength: m.contextLength,
            supportsToolUse: true,
          }));
        }
      } catch (error) {
        this.logger.debug(
          `[ProviderRpc] Platform model discovery unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      // 2. Try Copilot CLI SDK — also subscription-filtered
      try {
        const copilotAdapter = this.cliDetection.getAdapter('copilot');
        if (copilotAdapter?.listModels) {
          const cliModels = await copilotAdapter.listModels();
          if (cliModels.length > 0) {
            this.logger.info(
              `[ProviderRpc] Fetched ${cliModels.length} Copilot models from CLI SDK`,
            );
            return cliModels.map((m) => ({
              id: m.id,
              name: m.name || this.formatCopilotModelName(m.id),
              description: '',
              contextLength: 0,
              supportsToolUse: true,
            }));
          }
        }
      } catch (error) {
        this.logger.debug(
          `[ProviderRpc] Copilot CLI SDK unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      // 3. Static fallback
      this.logger.info(
        '[ProviderRpc] Using static Copilot model list (VS Code LM and CLI both unavailable)',
      );
      return (COPILOT_PROVIDER_ENTRY.staticModels ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description ?? '',
        contextLength: m.contextLength ?? 0,
        supportsToolUse: m.supportsToolUse ?? false,
      }));
    });
  }

  /**
   * Register a dynamic fetcher for OpenAI Codex models.
   *
   * Cascade:
   * 1. VS Code LM API (selectChatModels) — Codex models may not appear here,
   *    but we check for consistency with the Copilot fetcher pattern.
   * 2. Static fallback list from CODEX_PROVIDER_ENTRY (primary source).
   */
  private registerCodexDynamicFetcher(): void {
    this.providerModels.registerDynamicFetcher('openai-codex', async () => {
      // 1. Try platform model discovery — Codex models may not be available, but check anyway
      try {
        const platformModels = await this.modelDiscovery.getCodexModels();
        // Filter to known Codex model IDs
        const codexModelIds = new Set(
          (CODEX_PROVIDER_ENTRY.staticModels ?? []).map((m) => m.id),
        );
        const matched = platformModels.filter((m) => codexModelIds.has(m.id));
        if (matched.length > 0) {
          this.logger.info(
            `[ProviderRpc] Fetched ${matched.length} Codex models from platform discovery`,
          );
          return matched.map((m) => ({
            id: m.id,
            name: this.formatCopilotModelName(m.id),
            description: '',
            contextLength: m.contextLength,
            supportsToolUse: true,
          }));
        }
      } catch (error) {
        this.logger.debug(
          `[ProviderRpc] Platform model discovery unavailable for Codex: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      // 2. Static fallback (primary source for Codex)
      this.logger.info('[ProviderRpc] Using static Codex model list');
      return (CODEX_PROVIDER_ENTRY.staticModels ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description ?? '',
        contextLength: m.contextLength ?? 0,
        supportsToolUse: m.supportsToolUse ?? false,
      }));
    });
  }

  /**
   * Register a dynamic model fetcher for direct Anthropic auth (oauth/apiKey/claudeCli).
   *
   * TASK_2025_270: 'anthropic' is a virtual provider ID for direct Claude auth
   * users — it is NOT in the ANTHROPIC_PROVIDERS registry.
   *
   * Cascade:
   * 1. API key present → /v1/models API (returns specific model versions)
   * 2. SDK supportedModels() (works for all auth methods including CLI/OAuth)
   *
   * Both paths populate contextLength dynamically from the pricing map.
   * SdkModelService.getSupportedModels() provides its own static fallback
   * when all dynamic sources fail, so no hardcoded tier list is needed here.
   */
  private registerAnthropicDirectFetcher(): void {
    this.providerModels.registerDynamicFetcher(
      ANTHROPIC_DIRECT_PROVIDER_ID,
      async (): Promise<ProviderModelInfo[]> => {
        const hasApiKey = !!this.authEnv.ANTHROPIC_API_KEY;

        try {
          if (hasApiKey) {
            const apiModels = await this.sdkAdapter.getApiModels();
            if (apiModels.length > 0) {
              this.logger.info(
                `[ProviderRpc] Fetched ${apiModels.length} models from /v1/models (API key)`,
              );
              return apiModels.map((m) => ({
                id: m.value,
                name: m.displayName,
                description: getModelPricingDescription(m.value),
                contextLength: getModelContextWindow(m.value),
                supportsToolUse: true,
              }));
            }
          }

          const sdkModels = await this.sdkAdapter.getSupportedModels();
          this.logger.info(
            `[ProviderRpc] Fetched ${sdkModels.length} models from SDK supportedModels()`,
          );
          return sdkModels.map((m) => ({
            id: m.value,
            name: m.displayName,
            description: m.description || getModelPricingDescription(m.value),
            contextLength: getModelContextWindow(m.value),
            supportsToolUse: true,
          }));
        } catch (error) {
          this.logger.warn(
            `[ProviderRpc] Failed to fetch Anthropic direct models, falling back to SDK: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          const fallbackModels = await this.sdkAdapter.getSupportedModels();
          return fallbackModels.map((m) => ({
            id: m.value,
            name: m.displayName,
            description: m.description || getModelPricingDescription(m.value),
            contextLength: getModelContextWindow(m.value),
            supportsToolUse: true,
          }));
        }
      },
    );
  }

  /** Convert model ID slug to display name: "gpt-5.3-codex" → "GPT 5.3 Codex" */
  private formatCopilotModelName(id: string): string {
    return id
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');
  }

  /**
   * Resolve the provider ID from params or config
   */
  private resolveProviderId(providerId?: string): string {
    if (providerId) return providerId;
    return this.configManager.getWithDefault<string>(
      'anthropicProviderId',
      DEFAULT_PROVIDER_ID,
    );
  }

  /**
   * provider:listModels - Fetch models from provider API (or return static list)
   *
   * Provider ID routing:
   * - Registry providers (openrouter, moonshot, z-ai, github-copilot, openai-codex, etc.):
   *   Resolved via ANTHROPIC_PROVIDERS registry → fetchModels() handles static/dynamic paths.
   * - 'anthropic' (virtual provider for direct OAuth/API key auth, TASK_2025_270):
   *   NOT in the registry. Handled via dynamic fetcher registered by
   *   registerAnthropicDirectFetcher() — ProviderModelsService.fetchModels() checks
   *   dynamic fetchers before the registry lookup, so this works without a registry entry.
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
      const validated = ListModelsSchema.parse(params);
      const providerId = this.resolveProviderId(validated.providerId);

      try {
        this.logger.debug('RPC: provider:listModels called', {
          providerId,
          toolUseOnly: validated.toolUseOnly,
        });

        // Get API key from per-provider storage (may be null for static-model providers)
        const apiKey = await this.authSecretsService.getProviderKey(providerId);

        // Guard: purely dynamic providers (no static fallback) need an API key
        if (!apiKey) {
          const provider = getAnthropicProvider(providerId);
          const isPurelyDynamic =
            provider?.modelsEndpoint &&
            (!provider.staticModels || provider.staticModels.length === 0);
          if (isPurelyDynamic) {
            this.logger.debug(
              'RPC: provider:listModels skipped - no API key for dynamic provider',
              { providerId },
            );
            return { models: [], totalCount: 0, isStatic: false };
          }
        }

        // Fetch models (service handles static vs dynamic internally)
        const result = await this.providerModels.fetchModels(
          providerId,
          apiKey ?? null,
          validated.toolUseOnly ?? false,
        );

        this.logger.info('RPC: provider:listModels completed', {
          providerId,
          count: result.models.length,
          totalCount: result.totalCount,
          isStatic: result.isStatic,
        });

        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Auth failures: return empty models + error message instead of throwing
        if (
          errorMsg.includes('401') ||
          errorMsg.includes('403') ||
          errorMsg.includes('Unauthorized') ||
          errorMsg.includes('Forbidden') ||
          errorMsg.includes('invalid or expired')
        ) {
          const provider = getAnthropicProvider(providerId);
          const providerName = provider?.name ?? providerId;
          this.logger.warn(
            'RPC: provider:listModels - auth failed, returning empty result',
            { providerId, error: errorMsg },
          );
          return {
            models: [],
            totalCount: 0,
            isStatic: false,
            error: `API key is invalid or expired. Delete and re-enter your ${providerName} key.`,
          };
        }

        this.logger.error(
          'RPC: provider:listModels failed',
          error instanceof Error ? error : new Error(String(error)),
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
          validated.modelId,
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
          error instanceof Error ? error : new Error(String(error)),
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
          error instanceof Error ? error : new Error(String(error)),
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
          error instanceof Error ? error : new Error(String(error)),
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }
}
