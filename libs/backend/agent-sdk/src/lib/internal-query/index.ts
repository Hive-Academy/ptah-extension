/**
 * Internal Query Module
 *
 * One-shot SDK query execution for internal use (e.g., workspace analysis).
 * Completely separate from the interactive chat path.
 */
export { InternalQueryService } from './internal-query.service';
export type {
  InternalQueryConfig,
  InternalQueryHandle,
} from './internal-query.types';
