// GENERATED CODE SHAPES — DO NOT MODIFY BY HAND.
// Selected from `codex-cli 0.155.1 app-server generate-ts`; unrelated protocol
// types were intentionally omitted, and nested types Ptah does not read
// (credits, spend-control, reset credits, upsell, thread usage) are `unknown`.
// Runtime validation lives in the adjacent codex-account.schemas.ts projection.
// Its generated `bigint` int64 fields are represented below as exact decimal
// strings because this artifact describes Ptah's JSON/RPC-safe boundary shape.

export type PlanType = 'free' | 'go' | 'plus' | 'pro' | 'prolite' | 'team' |
  'self_serve_business_prolite' | 'self_serve_business_usage_based' |
  'business' | 'ent26' | 'enterprise_cbp_automation' |
  'enterprise_cbp_usage_based' | 'enterprise' | 'edu' | 'edu_plus' |
  'edu_pro' | 'unknown';

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

export type RateLimitReachedType = 'rate_limit_reached' |
  'workspace_owner_credits_depleted' | 'workspace_member_credits_depleted' |
  'workspace_owner_usage_limit_reached' | 'workspace_member_usage_limit_reached';

export type RateLimitSnapshot = {
  limitId: string | null;
  limitName: string | null;
  /** Normal model whose display name and reasoning options describe this quota alias. */
  normalModelSlug: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  credits: unknown | null;
  individualLimit: unknown | null;
  /** Backend-reported spend-control state. `null` is unavailable, not a recovery. */
  spendControlReached: boolean | null;
  planType: PlanType | null;
  rateLimitReachedType: RateLimitReachedType | null;
};

export type GetAccountRateLimitsResponse = {
  /** Backend permission for ordinary included usage; `null` means unavailable. */
  ordinaryUsageAllowed: boolean | null;
  /** Backward-compatible single-bucket view; mirrors the historical payload. */
  rateLimits: RateLimitSnapshot;
  /** Multi-bucket view keyed by metered `limit_id` (for example, `codex`). */
  rateLimitsByLimitId: { [key: string]: RateLimitSnapshot | undefined } | null;
  rateLimitResetCredits: unknown | null;
  /** Account associated with this usage snapshot, when supplied by the backend. */
  accountId: string | null;
  rateLimitUpsell: unknown | null;
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
  /** Estimated usage when a thread was requested and its billing route is available. */
  threadUsage?: unknown | null;
};
