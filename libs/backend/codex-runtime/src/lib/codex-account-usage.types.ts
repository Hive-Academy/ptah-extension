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
export interface CodexRateWindow {
  readonly usedPercent: number;
  readonly windowDurationMins?: number | null;
  readonly resetsAt?: number | null;
}

export interface CodexRateLimitBucket {
  /** Opaque stable bucket key; native identifiers are never exposed. */
  readonly id: string;
  readonly label: string;
  readonly primary?: CodexRateWindow;
  readonly secondary?: CodexRateWindow;
  readonly rateLimitReachedType?: string;
  readonly spendControlReached?: boolean;
  readonly individualLimit?: {
    readonly limit: string;
    readonly used: string;
    readonly remainingPercent: number;
    readonly resetsAt: number;
  };
  readonly credits?: {
    readonly balance?: string;
    readonly hasCredits: boolean;
    readonly unlimited: boolean;
  };
}

export interface CodexAccountUsageResult {
  readonly status: CodexAccountUsageStatus;
  readonly providerId: string;
  readonly fetchedAt?: number;
  readonly staleSince?: number;
  readonly account?: { readonly planType: string };
  /** Active Codex bucket first, then other native buckets in lexical order. */
  readonly buckets?: readonly CodexRateLimitBucket[];
  readonly resetCreditsAvailable?: boolean;
  readonly upsellAvailable?: boolean;
  readonly quota?: {
    readonly primary?: CodexRateWindow;
    readonly secondary?: CodexRateWindow;
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
