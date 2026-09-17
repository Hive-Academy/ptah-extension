// GENERATED CODE SHAPES — DO NOT MODIFY BY HAND.
// Selected from `codex-cli 0.147.0 app-server generate-ts`; unrelated protocol
// types were intentionally omitted. Runtime validation lives in the adjacent
// codex-account.schemas.ts projection.
// Its generated `bigint` int64 fields are represented below as exact decimal
// strings because this artifact describes Ptah's JSON/RPC-safe boundary shape.

export type PlanType = 'free' | 'go' | 'plus' | 'pro' | 'prolite' | 'team' |
  'self_serve_business_prolite' | 'self_serve_business_usage_based' |
  'business' | 'ent26' | 'enterprise_cbp_automation' |
  'enterprise_cbp_usage_based' | 'enterprise' | 'edu' | 'unknown';

export type Account = { type: 'apiKey' } | {
  type: 'chatgpt'; email: string | null; planType: PlanType;
} | { type: 'amazonBedrock'; usesCodexManagedCredentials: boolean };

export type GetAccountResponse = {
  account: Account | null;
  requiresOpenaiAuth: boolean;
};

export type RateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

export type RateLimitSnapshot = {
  limitId: string | null;
  limitName: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  credits: unknown | null;
  individualLimit: unknown | null;
  spendControlReached: boolean | null;
  planType: PlanType | null;
  rateLimitReachedType: string | null;
};

export type GetAccountRateLimitsResponse = {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId: { [key: string]: RateLimitSnapshot | undefined } | null;
  rateLimitResetCredits: unknown | null;
};

export type AccountTokenUsageSummary = {
  /** JSON/RPC-safe projection of generated int64 fields. */
  lifetimeTokens: string | null;
  peakDailyTokens: string | null;
  longestRunningTurnSec: string | null;
  currentStreakDays: string | null;
  longestStreakDays: string | null;
};

export type AccountTokenUsageDailyBucket = { startDate: string; tokens: string };

export type GetAccountTokenUsageResponse = {
  summary: AccountTokenUsageSummary;
  dailyUsageBuckets: AccountTokenUsageDailyBucket[] | null;
};
