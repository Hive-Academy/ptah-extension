/**
 * ModelResolver - Single source of truth for model ID resolution.
 *
 * Consolidates the 5 scattered model resolution paths:
 * 1. SdkModelService.resolveModelId()        â†’ this.resolve()
 * 2. resolveModelIdStatic()                   â†’ ModelResolver.resolveStatic()
 * 3. resolveActualModelForPricing()           â†’ this.resolveForPricing()
 * 4. ConfigRpcHandlers.detectModelTier()      â†’ this.detectTier()
 * 5. Circular guard in normalizeModels()      â†’ built into resolve()
 *
 * The existing functions continue to work; this class is the target that
 * all callsites will eventually migrate to.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import {
  TIER_TO_MODEL_ID,
  TIER_ENV_VAR_MAP,
  type ModelTier,
  type EnvMappedTier,
} from '@ptah-extension/agent-sdk';

@injectable()
export class ModelResolver {
  /**
   * Tracks which third-party model IDs have already produced a "no tier
   * override" debug log so we don't spam the channel during history scans
   * that process hundreds of messages.
   */
  private readonly unmappedThirdPartyModelsLogged = new Set<string>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
  ) {}

  /**
   * Resolve a model identifier to the actual model ID to use.
   *
   * Resolution priority:
   * 1. Full Claude ID (starts with 'claude-'):
   *    a. Detect tier â†’ check env var override â†’ return override if set
   *    b. No override â†’ return as-is
   * 2. Bare tier name ('opus', 'sonnet', 'haiku', 'default'):
   *    a. Check env var override â†’ return override (with circular guard)
   *    b. No override â†’ return TIER_TO_MODEL_ID hardcoded default
   * 3. Unknown â†’ return as-is (provider-specific model like 'kimi-k2')
   *
   * @param model - Model string (full ID, bare tier, or provider-specific)
   * @param envOverride - Optional AuthEnv to use instead of injected singleton
   */
  resolve(model: string, envOverride?: AuthEnv): string {
    const env = envOverride ?? this.authEnv;
    if (model.startsWith('claude-')) {
      const tier = this.detectTierFromClaudeId(model);
      if (tier) {
        const envKey = TIER_ENV_VAR_MAP[tier];
        const override = env[envKey];
        if (override && override !== model) {
          return override;
        }
      }
      return model;
    }

    const lower = model.toLowerCase();
    if (lower === 'default') {
      return this.resolve('opus', env);
    }
    if (this.isEnvMappedTier(lower)) {
      const envKey = TIER_ENV_VAR_MAP[lower as EnvMappedTier];
      const override = env[envKey];
      if (override) {
        if (
          !this.isModelTier(override.toLowerCase()) ||
          override.startsWith('claude-')
        ) {
          return override;
        }
        this.logger.warn(
          `[ModelResolver] Circular env override for ${envKey}: '${override}' â†’ forced to '${TIER_TO_MODEL_ID[override.toLowerCase() as ModelTier]}'`,
        );
        return TIER_TO_MODEL_ID[override.toLowerCase() as ModelTier];
      }
    }
    if (this.isModelTier(lower)) {
      return TIER_TO_MODEL_ID[lower as ModelTier];
    }
    return model;
  }

  /**
   * Static version for use in contexts where DI is unavailable.
   * Accepts explicit AuthEnv parameter instead of using injected singleton.
   */
  static resolveStatic(model: string, authEnv?: AuthEnv): string {
    if (model.startsWith('claude-')) {
      const lower = model.toLowerCase();
      let tier: EnvMappedTier | null = null;
      if (lower.includes('opus')) tier = 'opus';
      else if (lower.includes('sonnet')) tier = 'sonnet';
      else if (lower.includes('haiku')) tier = 'haiku';

      if (tier && authEnv) {
        const envKey = TIER_ENV_VAR_MAP[tier];
        const override = authEnv[envKey];
        if (override && override !== model) return override;
      }
      return model;
    }

    const lower = model.toLowerCase();
    if (lower === 'default')
      return ModelResolver.resolveStatic('opus', authEnv);

    if (lower in TIER_ENV_VAR_MAP && authEnv) {
      const envKey = TIER_ENV_VAR_MAP[lower as EnvMappedTier];
      const override = authEnv[envKey];
      if (override) {
        if (
          !(override.toLowerCase() in TIER_TO_MODEL_ID) ||
          override.startsWith('claude-')
        ) {
          return override;
        }
        return TIER_TO_MODEL_ID[override.toLowerCase() as ModelTier];
      }
    }

    if (lower in TIER_TO_MODEL_ID) {
      return TIER_TO_MODEL_ID[lower as ModelTier];
    }

    return model;
  }

  /**
   * Resolve a model ID for pricing lookup.
   *
   * When using a third-party provider (OpenRouter, Moonshot, Z.AI), the SDK
   * reports Claude model IDs but the actual model is the provider's equivalent.
   * E.g., on Z.AI, 'claude-sonnet-4-6' should price as 'glm-5.1'.
   */
  resolveForPricing(modelId: string, envOverride?: AuthEnv): string {
    if (!modelId) return modelId;

    const env = envOverride ?? this.authEnv;
    const baseUrl = env.ANTHROPIC_BASE_URL;
    if (!baseUrl || baseUrl.includes('api.anthropic.com')) {
      return modelId;
    }
    const resolved = this.resolve(modelId, env);

    if (
      resolved === modelId &&
      !this.unmappedThirdPartyModelsLogged.has(modelId)
    ) {
      this.unmappedThirdPartyModelsLogged.add(modelId);
      this.logger.debug(
        `[ModelResolver] resolveForPricing: no tier override for '${modelId}' on third-party provider — relying on pricing map (logged once per model).`,
      );
    }

    return resolved;
  }

  /**
   * Detect which tier family a model belongs to.
   * Works for both full Claude IDs and bare tier names.
   *
   * Replaces the scattered detectModelTier() / detectTierFromClaudeId() functions.
   */
  detectTier(model: string): 'opus' | 'sonnet' | 'haiku' | undefined {
    const lower = model.toLowerCase();
    if (lower === 'default' || lower.includes('opus')) return 'opus';
    if (lower.includes('sonnet')) return 'sonnet';
    if (lower.includes('haiku')) return 'haiku';
    return undefined;
  }

  private detectTierFromClaudeId(model: string): EnvMappedTier | null {
    const lower = model.toLowerCase();
    if (lower.includes('opus')) return 'opus';
    if (lower.includes('sonnet')) return 'sonnet';
    if (lower.includes('haiku')) return 'haiku';
    return null;
  }

  private isModelTier(value: string): value is ModelTier {
    return value in TIER_TO_MODEL_ID;
  }

  private isEnvMappedTier(value: string): value is EnvMappedTier {
    return value in TIER_ENV_VAR_MAP;
  }
}
