import type { AuthEnv } from '@ptah-extension/shared';

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
  configureAuthentication(rawAuthMethod: string): Promise<AuthResult>;
  clearAuthentication(): void;
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
}
