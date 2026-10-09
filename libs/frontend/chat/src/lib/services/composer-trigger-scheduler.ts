import { InjectionToken } from '@angular/core';

/**
 * Rollback switch for Phase 5 composer trigger scheduling. `false` restores
 * the former immediate suggestion projection without changing draft or stream
 * state.
 */
export const COMPOSER_TRIGGER_CACHE_ENABLED = new InjectionToken<boolean>(
  'COMPOSER_TRIGGER_CACHE_ENABLED',
  { providedIn: 'root', factory: () => true },
);

export const TRIGGER_PROJECTION_DEBOUNCE_MS = 50;
export const MAX_CACHED_TRIGGER_QUERIES = 24;
