import type { AuthEnv, ModelPricing } from '@ptah-extension/shared';

/** Result of IAuthEnvProvider.configureAuthentication. */
export interface AuthResult {
  configured: boolean;
  details: string[];
  errorMessage?: string;
}

/**
 * Port that agent-sdk uses to consume the AuthEnv singleton owned by
 * `@ptah-extension/auth-providers`. AuthManager implements this port.
 * tsyringe resolution goes through Symbol.for('SdkAuthManager').
 */
export interface IAuthEnvProvider {
  getAuthEnv(): AuthEnv;
  configureAuthentication(rawAuthMethod?: string): Promise<AuthResult>;
  clearAuthentication(): void;
  resolveActiveAuth(): { authMethod: string; providerId: string };
}

/**
 * Read-side port that agent-sdk uses to resolve model identifiers without
 * importing the concrete ModelResolver class from auth-providers (which
 * would introduce a circular dependency). The auth-providers ModelResolver
 * class structurally implements this interface.
 */
export interface IModelResolver {
  /**
   * Resolve a model identifier to the actual model ID to use.
   * Mirrors `ModelResolver.resolve` in @ptah-extension/auth-providers.
   */
  resolve(model: string, envOverride?: AuthEnv): string;

  /**
   * Resolve a model ID for pricing lookup.
   * Mirrors `ModelResolver.resolveForPricing` in @ptah-extension/auth-providers.
   */
  resolveForPricing(modelId: string, envOverride?: AuthEnv): string;

  /**
   * Detect which tier family a model belongs to.
   * Mirrors `ModelResolver.detectTier` in @ptah-extension/auth-providers.
   */
  detectTier(model: string): 'opus' | 'sonnet' | 'haiku' | undefined;

  /**
   * Whether the active provider bills a flat subscription instead of per token.
   * Mirrors `ModelResolver.isSubscriptionCovered`.
   */
  isSubscriptionCovered(envOverride?: AuthEnv): boolean;

  /**
   * Resolve a model id to the pricing that should be charged for it, under the
   * active provider. Mirrors `ModelResolver.resolveForCost`.
   */
  resolveForCost(modelId: string, envOverride?: AuthEnv): ResolvedModelPricing;
}

/**
 * A model id resolved for pricing, together with the rates that apply to it.
 *
 * Bundled deliberately: the id and the rate must come from the SAME view of
 * the active provider, or a session can be priced against a provider it never
 * ran on.
 */
export interface ResolvedModelPricing {
  /** Provider-side model id, after tier-override resolution. */
  readonly modelId: string;
  /** Published per-token rates, or `null` when genuinely unknown. */
  readonly pricing: ModelPricing | null;
  /**
   * True when the active provider bills a flat subscription. Labelling only —
   * the rates above are the same published ones either way.
   */
  readonly subscriptionCovered: boolean;
}
