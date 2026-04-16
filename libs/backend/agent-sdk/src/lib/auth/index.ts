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

// Model fetcher interface
export type {
  ModelFetcherFn,
  IModelFetcherProvider,
} from './model-fetcher.types';

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
