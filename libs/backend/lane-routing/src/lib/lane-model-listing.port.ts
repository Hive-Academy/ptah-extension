import type { CliDetectionResult } from '@ptah-extension/shared';

export interface LaneModelEntry {
  readonly id: string;
  readonly provenance: 'reported' | 'fallback' | 'configured' | 'tier';
  readonly auto?: boolean;
}

/** Lists models for one lane within the routing call's deadline. */
export interface LaneModelListing {
  list(
    row: CliDetectionResult,
    signal: AbortSignal,
  ): Promise<readonly LaneModelEntry[]>;
}
