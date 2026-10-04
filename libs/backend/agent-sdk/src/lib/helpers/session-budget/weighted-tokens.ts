/**
 * Weighted session tokens (TASK_2026_597 N7, decision 13).
 *
 * The session budget's fallback measure for unit `cost` when no model in the
 * session is priced (`pricingCoverage: 'none'`). Each token class is weighted
 * by its usual price relative to uncached input, so the figure tracks spend
 * without a rate card. It is compared against `fallbackWeightedTokens`, never
 * against the USD limit.
 */

/** Relative weight of each token class (uncached input = 1). */
export const SESSION_BUDGET_TOKEN_WEIGHTS = {
  input: 1,
  cacheCreation: 1.25,
  cacheRead: 0.1,
  output: 5,
} as const;

/** The four disjoint token classes of a `SessionStatsEntry`. */
export interface SessionTokenClasses {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

/** The weighted token figure of one session's token breakdown. */
export function weightedSessionTokens(tokens: SessionTokenClasses): number {
  return (
    tokens.input * SESSION_BUDGET_TOKEN_WEIGHTS.input +
    tokens.cacheCreation * SESSION_BUDGET_TOKEN_WEIGHTS.cacheCreation +
    tokens.cacheRead * SESSION_BUDGET_TOKEN_WEIGHTS.cacheRead +
    tokens.output * SESSION_BUDGET_TOKEN_WEIGHTS.output
  );
}
