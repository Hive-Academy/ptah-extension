/**
 * Per-tab payload shapes used by TabManagerService intent mutators.
 *
 * Extracted from `tab-manager.service.ts` during TASK_2026_105 Wave G2 Phase 2
 * (chat-state lib extraction) so that consumer services in `@ptah-extension/chat`
 * can keep importing the payload types without re-importing the service module.
 *
 * These types live here (not in `@ptah-extension/chat-types`) because they are
 * specific to TabManagerService's mutator surface — they are not part of the
 * persisted/wire shape captured by `chat-types`.
 */

/**
 * Stats payload accumulated for the active model usage display.
 */
export interface LiveModelStatsPayload {
  model: string;
  contextUsed: number;
  contextWindow: number;
  contextPercent: number;
}

/**
 * Aggregate stats persisted on a tab when a session is loaded from disk
 * or when previous turn totals must be carried across compaction.
 */
export interface PreloadedStatsPayload {
  totalCost: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  messageCount: number;
}
