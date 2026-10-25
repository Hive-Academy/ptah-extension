/** Compatibility DTO: unknown usage stays absent, never synthesized as zero. */
export type CodexUsageEligibility =
  'supported' | 'unsupported-auth' | 'unsupported-config';
export type CodexAccountUsageStatus =
  | 'available'
  | 'unsupported-auth'
  | 'unsupported-config'
  | 'provider-unsupported'
  | 'cli-unavailable'
  | 'cli-version-unsupported'
  | 'service-unavailable'
  | 'stale';
export interface CodexAccountUsageResult {
  readonly status: CodexAccountUsageStatus;
  readonly providerId: string;
  readonly fetchedAt?: number;
  readonly staleSince?: number;
  readonly account?: { readonly planType: string };
  readonly quota?: {
    readonly primary?: {
      readonly usedPercent: number;
      readonly windowDurationMins?: number | null;
      readonly resetsAt?: number | null;
    };
    readonly secondary?: {
      readonly usedPercent: number;
      readonly windowDurationMins?: number | null;
      readonly resetsAt?: number | null;
    };
    readonly rateLimitReachedType?: string;
  };
  readonly activity?: {
    readonly lifetimeTokens?: string | null;
    readonly dailyUsage: ReadonlyArray<{
      readonly startDate: string;
      readonly tokens: string;
    }>;
  };
}
