import type { ParentCompletionOutboxEntry } from './parent-delivery/parent-envelope.schema';

export type LaneCheckpointResult = 'durable' | 'failed' | 'not-applicable';

/** Writes the terminal replay record before the live completion signal. */
export interface LaneTerminalCheckpoint {
  checkpoint(entry: ParentCompletionOutboxEntry): Promise<LaneCheckpointResult>;
}
