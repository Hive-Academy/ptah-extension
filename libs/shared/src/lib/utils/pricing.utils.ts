/**
 * Claude Sonnet 4.5 Pricing Utilities
 *
 * Source: https://www.anthropic.com/pricing
 * Last updated: 2024-12-06
 *
 * This module provides pricing constants and cost calculation functions
 * for Claude Sonnet 4.5 API usage tracking.
 */

/**
 * Claude Sonnet 4.5 Pricing (as of December 2024)
 * Source: https://www.anthropic.com/pricing
 * Last updated: 2024-12-06
 */
export const CLAUDE_SONNET_4_5_PRICING = {
  /** Input tokens: $3.00 per 1M tokens */
  INPUT_PER_TOKEN: 0.000003,
  /** Output tokens: $15.00 per 1M tokens */
  OUTPUT_PER_TOKEN: 0.000015,
  /** Cache read tokens: $0.30 per 1M tokens */
  CACHE_READ_PER_TOKEN: 0.0000003,
  /** Cache creation tokens: $3.75 per 1M tokens */
  CACHE_CREATION_PER_TOKEN: 0.0000038,
} as const;

/**
 * Token breakdown for cost calculation
 */
export interface TokenBreakdown {
  readonly input: number;
  readonly output: number;
  readonly cacheHit?: number; // cache read tokens
  readonly cacheCreation?: number; // cache write tokens
}

/**
 * Calculate message cost in USD
 *
 * @param tokens - Token breakdown from message
 * @returns Cost in USD (e.g., 0.0042 for $0.0042), rounded to 4 decimal places
 *
 * @example
 * ```typescript
 * const cost = calculateMessageCost({
 *   input: 1000,
 *   output: 500,
 *   cacheHit: 200
 * });
 * // Returns: 0.0078 ($0.0078)
 * ```
 *
 * @example
 * ```typescript
 * // Zero tokens returns 0.0000
 * const cost = calculateMessageCost({
 *   input: 0,
 *   output: 0
 * });
 * // Returns: 0.0000
 * ```
 *
 * @example
 * ```typescript
 * // Undefined cache tokens are treated as 0
 * const cost = calculateMessageCost({
 *   input: 5000,
 *   output: 2000
 * });
 * // cacheHit and cacheCreation are undefined, treated as 0
 * // Returns: 0.0450
 * ```
 */
export function calculateMessageCost(tokens: TokenBreakdown): number {
  const inputCost = tokens.input * CLAUDE_SONNET_4_5_PRICING.INPUT_PER_TOKEN;
  const outputCost = tokens.output * CLAUDE_SONNET_4_5_PRICING.OUTPUT_PER_TOKEN;
  const cacheReadCost =
    (tokens.cacheHit ?? 0) * CLAUDE_SONNET_4_5_PRICING.CACHE_READ_PER_TOKEN;
  const cacheCreationCost =
    (tokens.cacheCreation ?? 0) *
    CLAUDE_SONNET_4_5_PRICING.CACHE_CREATION_PER_TOKEN;

  // Round to 4 decimal places for sub-cent accuracy
  return (
    Math.round(
      (inputCost + outputCost + cacheReadCost + cacheCreationCost) * 10000
    ) / 10000
  );
}
