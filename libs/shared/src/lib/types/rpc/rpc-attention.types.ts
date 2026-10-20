import type { AttentionNotice } from '../messages/attention';

/** Reconcile missed pushes against authoritative pending requests. */
export type AttentionGetSnapshotParams = Record<string, never>;

export interface AttentionGetSnapshotResult {
  readonly notices: readonly AttentionNotice[];
}
