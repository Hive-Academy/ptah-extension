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
