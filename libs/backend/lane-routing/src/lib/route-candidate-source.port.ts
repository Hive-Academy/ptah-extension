import type { CliDetectionResult, LaneLimitState } from '@ptah-extension/shared';

/** Host adapter that reads the current candidate rows, limits, and subagent roles. */
export interface RouteCandidateSource {
  rows(): Promise<readonly CliDetectionResult[]>;
  limits(
    rows: readonly CliDetectionResult[],
  ): Promise<ReadonlyMap<string, LaneLimitState> | null>;
  roles(): Promise<readonly string[]>;
}
