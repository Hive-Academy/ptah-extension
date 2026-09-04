/**
 * Auth Module
 *
 * Exports types/interfaces, ModelResolver, strategy implementations, and the
 * effective auth-route resolver.
 */
export type {
  IAuthStrategy,
  AuthConfigureResult,
  AuthConfigureContext,
} from './auth-strategy.types';
export { ModelResolver } from './model-resolver';
export { ProviderQuotaError } from './provider-quota.error';
export {
  ProviderQuotaStore,
  providerQuotaStore,
  parseRetryAfterMs,
  PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS,
  type ProviderQuotaState,
} from './provider-quota.store';
export {
  ActiveProviderResolver,
  type ActiveAuth,
} from './active-provider-resolver';
export {
  ApiKeyStrategy,
  OAuthProxyStrategy,
  LocalNativeStrategy,
  LocalProxyStrategy,
  CliStrategy,
} from './strategies';
export {
  resolveEffectiveAuthRoute,
  type EffectiveRouteProvider,
  type EffectiveRouteConfig,
  type EffectiveRouteResult,
} from './effective-route';
