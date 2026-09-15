/**
 * Records explicit use of memories without affecting the caller's result.
 *
 * Implementations never throw. Empty or unknown ids are a no-op, and using an
 * archival memory restores it to the recall tier.
 */
export interface IMemoryUsageRecorder {
  recordUse(memoryIds: readonly string[]): void;
}
