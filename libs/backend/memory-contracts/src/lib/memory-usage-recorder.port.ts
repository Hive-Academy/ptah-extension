/**
 * Records explicit use of memories without affecting the caller's result.
 *
 * Implementations never throw. Empty or unknown ids are a no-op, and using an
 * archival memory restores it to the recall tier.
 * Duplicate ids count once per call; implementations may cap a call at 200 ids
 * and ignore ids beyond that cap.
 */
export interface IMemoryUsageRecorder {
  recordUse(memoryIds: readonly string[]): void;
}
