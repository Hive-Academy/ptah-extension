import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  type AuthEnv,
  isDirectAnthropic,
  getAnthropicProvider,
} from '@ptah-extension/shared';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import {
  TIER_ENV_VAR_MAP,
  getActiveProviderId,
  type ModelTier,
  type EnvMappedTier,
} from '@ptah-extension/agent-sdk';

const MODEL_TIER_VALUES: ReadonlySet<string> = new Set([
  'opus',
  'sonnet',
  'haiku',
  'default',
]);

@injectable()
export class ModelResolver {
  private readonly unmappedThirdPartyModelsLogged = new Set<string>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
  ) {}

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
      if (isDirectAnthropic(env)) return lower;
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
        const defaultTiers = this.getDefaultTiers(env);
        const fallback =
          defaultTiers?.[override.toLowerCase() as EnvMappedTier];
        if (fallback) {
          this.logger.warn(
            `[ModelResolver] Circular env override for ${envKey}: '${override}' → forced to '${fallback}'`,
          );
          return fallback;
        }
        return override;
      }
    }
    if (this.isModelTier(lower)) {
      if (isDirectAnthropic(env)) {
        return lower;
      }
      const defaultTiers = this.getDefaultTiers(env);
      if (defaultTiers && lower in defaultTiers) {
        return defaultTiers[lower as EnvMappedTier];
      }
      return lower;
    }
    return model;
  }

  resolveForPricing(modelId: string, envOverride?: AuthEnv): string {
    if (!modelId) return modelId;

    const env = envOverride ?? this.authEnv;
    if (isDirectAnthropic(env)) {
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

  private getDefaultTiers(env: AuthEnv): Record<EnvMappedTier, string> | null {
    const activeProviderId = getActiveProviderId(env);
    if (!activeProviderId) return null;
    const provider = getAnthropicProvider(activeProviderId);
    return provider?.defaultTiers ?? null;
  }

  private isModelTier(value: string): value is ModelTier {
    return MODEL_TIER_VALUES.has(value);
  }

  private isEnvMappedTier(value: string): value is EnvMappedTier {
    return value in TIER_ENV_VAR_MAP;
  }
}
