/**
 * Auth Module
 *
 * Exports types/interfaces, ModelResolver, strategy implementations, and the
 * effective auth-route resolver.
 */

// Strategy types and interface
export type {
  IAuthStrategy,
  AuthConfigureResult,
  AuthConfigureContext,
} from './auth-strategy.types';

// ModelResolver - single source of truth for tier→model resolution
export { ModelResolver } from './model-resolver';

// Strategy implementations
export {
  ApiKeyStrategy,
  OAuthProxyStrategy,
  LocalNativeStrategy,
  LocalProxyStrategy,
  CliStrategy,
} from './strategies';

// Effective auth-route resolver — single source of truth for "what would
// happen if I ran an agent right now?" Used by `ptah doctor` and reusable
// from the Electron settings panel + VS Code status bar.
export {
  resolveEffectiveAuthRoute,
  type EffectiveRouteProvider,
  type EffectiveRouteConfig,
  type EffectiveRouteResult,
} from './effective-route';
