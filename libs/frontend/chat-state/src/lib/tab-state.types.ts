import type { ContextCapacity } from '@ptah-extension/shared';

/**
 * Per-tab payload shapes used by TabManagerService intent mutators.
 *
 * These types live here (not in `@ptah-extension/chat-types`) because they are
 * specific to TabManagerService's mutator surface — they are not part of the
 * persisted/wire shape captured by `chat-types`.
 */

/**
 * The context badge's model and window fill, derived per turn. Not an
 * accounting figure: session totals come from the backend snapshot
 * (`TabState.sessionStats`).
 */
export interface LiveModelStatsPayload {
  model: string;
  contextKnown?: boolean;
  contextCapacity?: ContextCapacity;
  contextUsed: number;
  contextWindow: number;
  contextPercent: number;
}
