import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  type AuthEnv,
  type ModelPricing,
  isDirectAnthropic,
  getAnthropicProvider,
  isSubscriptionCoveredProvider,
  findModelPricing,
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
  private readonly unservableTierModelsWarned = new Set<string>();

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
      this.warnUnservableTierValue(model, env);
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
      this.warnUnservableTierValue(lower, env);
      return lower;
    }
    return model;
  }

  /**
   * Say so, once, when a TIER-SHAPED value is about to leave verbatim for a
   * provider that has no mapping to turn it into a real model id.
   *
   * Only two kinds of value reach here: a dated `claude-*` id whose tier env
   * var is unset, and a bare tier alias no `defaultTiers` entry covers. Neither
   * names a model any non-Anthropic endpoint can serve, so the request 404s
   * with nothing in Ptah's own logs to explain why. An unrecognised string
   * (`kimi-k2.5`, `gpt-5.3-codex`) is NOT warned about — that is a real model
   * id the user or the provider picked, and passing it through is correct.
   *
   * This is a diagnostic, never a fallback: there is no id for THIS function
   * to substitute. `openrouter`, `lm-studio` and `requesty` declare no
   * `defaultTiers` (each for a documented reason — a dynamic catalogue, a
   * locally-loaded model, an unverifiable tier map), so on those three the
   * value cannot be resolved from static data, on ANY path — the foreground
   * chat sends a bare `'opus'` in exactly the same situation
   * (`chat-session.service.ts:418` substitutes `'default'`, which recurses to
   * `'opus'` here).
   *
   * Since TASK_2026_262 that is no longer where it ends. Fetching the
   * provider's LIVE model list is still not this function's job — but it is
   * now somebody's. `ProviderModelsService.applyPersistedTiers` derives the
   * tiers from the catalogue the provider itself returned and writes them into
   * the very env vars both branches above read, so reaching this warn means
   * the catalogue has not landed yet or could not be fetched at all: a
   * transient or broken state rather than a permanent shape.
   *
   * The warn is deliberately kept exactly as wide as it was. It is now the
   * only signal for the cases the live list does not reach — a first message
   * sent inside the refresh window, a local server that was offline at
   * activation — and narrowing it would hide precisely what still needs
   * measuring before anyone decides whether an unresolvable tier should be a
   * hard error (TASK_2026_262 Q2).
   *
   * Keyed per provider+value so a model list being re-resolved for the picker
   * cannot turn one misconfiguration into a log flood.
   */
  private warnUnservableTierValue(value: string, env: AuthEnv): void {
    if (isDirectAnthropic(env)) return;
    const providerId = getActiveProviderId(env);
    if (!providerId) return;

    const key = `${providerId}:${value}`;
    if (this.unservableTierModelsWarned.has(key)) return;
    this.unservableTierModelsWarned.add(key);
    this.logger.warn(
      `[ModelResolver] No tier mapping resolved '${value}' under provider '${providerId}', so it will be sent verbatim and the endpoint will most likely reject it. Its model catalog has not been fetched yet, or could not be fetched — check the provider is reachable, or select an explicit model for it. (Logged once per provider and value.)`,
    );
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

  /**
   * Whether the active provider bills a flat subscription instead of per token.
   *
   * Derived from the auth env on every call rather than cached, so it can never
   * disagree with the provider the session is actually running against.
   */
  isSubscriptionCovered(envOverride?: AuthEnv): boolean {
    const env = envOverride ?? this.authEnv;
    if (isDirectAnthropic(env)) return false;
    return isSubscriptionCoveredProvider(getActiveProviderId(env));
  }

  /**
   * Resolve a model id to the rates that apply to it, under the active provider.
   *
   * The single chokepoint for "what does this turn cost". Every provider —
   * subscription or usage-billed — is costed from the same published rates, so
   * the dashboard reports consumption the way `claude /usage` and the Codex CLI
   * do. `subscriptionCovered` rides along so surfaces can say the fee is flat;
   * it never changes the number.
   */
  resolveForCost(
    modelId: string,
    envOverride?: AuthEnv,
  ): {
    modelId: string;
    pricing: ModelPricing | null;
    subscriptionCovered: boolean;
  } {
    const env = envOverride ?? this.authEnv;
    const resolved = this.resolveForPricing(modelId, env);
    return {
      modelId: resolved,
      pricing: findModelPricing(resolved),
      subscriptionCovered: this.isSubscriptionCovered(env),
    };
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
