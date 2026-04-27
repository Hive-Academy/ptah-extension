/**
 * Deterministic correlation-id factory for tests.
 *
 * Production code uses `CorrelationId.create()` which generates a UUID v4;
 * that is unhelpful inside snapshots or equality assertions because it
 * changes on every run. `makeCorrelationId()` instead returns a monotonic,
 * branded string: `test-corr-0001`, `test-corr-0002`, ...
 *
 * The counter is process-scoped but resettable via `resetCorrelationIdCounter()`
 * so specs can opt-in to a known baseline in `beforeEach`.
 */

import type { CorrelationId } from '../../lib/types/branded.types';

let counter = 0;

export interface MakeCorrelationIdOptions {
  /** Prefix applied before the counter. Default `"test-corr"`. */
  prefix?: string;
  /** Minimum counter width with zero-padding. Default `4`. */
  width?: number;
}

/**
 * Produce the next deterministic correlation id. Cast to the branded
 * `CorrelationId` type because `shared`'s production brand validator expects
 * UUID v4; tests intentionally opt out of that format for readability.
 */
export function makeCorrelationId(
  opts: MakeCorrelationIdOptions = {},
): CorrelationId {
  const { prefix = 'test-corr', width = 4 } = opts;
  counter += 1;
  const padded = String(counter).padStart(width, '0');
  return `${prefix}-${padded}` as CorrelationId;
}

/**
 * Reset the shared counter back to zero. Call from `beforeEach` to get stable
 * snapshots across runs.
 */
export function resetCorrelationIdCounter(): void {
  counter = 0;
}
