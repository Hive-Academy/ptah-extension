/**
 * Internal Query Module
 *
 * One-shot SDK query execution for internal use (e.g., workspace analysis).
 * Completely separate from the interactive chat path.
 */
export { InternalQueryService } from './internal-query.service';
export {
  DEFAULT_INTERNAL_QUERY_LANE,
  USER_ACTION_QUERY_LANE,
  MEMORY_CURATOR_QUERY_LANE,
  SKILL_SYNTHESIS_QUERY_LANE,
  GOVERNED_BACKGROUND_LANES,
} from './internal-query-concurrency-gate';
export type {
  InternalQueryConfig,
  InternalQueryHandle,
} from './internal-query.types';
export {
  classifyThrownNetworkFailure,
  networkSignalForHttpStatus,
  QueryNetworkObserver,
} from './network-failure';
export type {
  NetworkFailureSignal,
  NetworkObservableMessage,
  QueryNetworkVerdict,
} from './network-failure';
export {
  NetworkBackoff,
  NETWORK_BACKOFF_CEILING_LEVEL,
  NETWORK_BACKOFF_INITIAL_MS,
  NETWORK_BACKOFF_MAX_MS,
  NETWORK_BACKOFF_JITTER_RATIO,
} from './network-backoff';
export type { NetworkBackoffOptions } from './network-backoff';
