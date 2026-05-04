/**
 * Auth Module - TASK_AUTH_REFACTOR
 *
 * Phase 1: Types, interfaces, and ModelResolver
 * Phase 2: Strategy implementations (strategies/ subdirectory)
 * Phase 3: Callsite migration to ModelResolver
 */

// Strategy types and interface
export type {
  IAuthStrategy,
  AuthConfigureResult,
  AuthConfigureContext,
} from './auth-strategy.types';

// ModelResolver - single source of truth for tier→model resolution
export { ModelResolver } from './model-resolver';

// Strategy implementations (Phase 2)
export {
  ApiKeyStrategy,
  OAuthProxyStrategy,
  LocalNativeStrategy,
  LocalProxyStrategy,
  CliStrategy,
} from './strategies';

// Effective auth-route resolver (Stream B item #7) — single source of truth
// for "what would happen if I ran an agent right now?" Used by `ptah doctor`
// and reusable from the Electron settings panel + VS Code status bar.
export {
  resolveEffectiveAuthRoute,
  type EffectiveRouteProvider,
  type EffectiveRouteConfig,
  type EffectiveRouteResult,
} from './effective-route';
