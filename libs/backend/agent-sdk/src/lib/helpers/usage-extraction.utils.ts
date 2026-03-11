/**
 * Usage Extraction Utilities
 *
 * Shared utilities for extracting token usage from various message formats:
 * - SDK ResultMessage (real-time streaming)
 * - JSONL message.usage (session history replay)
 *
 * Both formats use the same underlying Claude API usage fields,
 * just wrapped differently.
 */

import type { MessageTokenUsage } from '@ptah-extension/shared';

/**
 * Raw Claude API usage format (used in both SDK messages and JSONL files)
 */
export interface ClaudeApiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Extract MessageTokenUsage from Claude API usage format
 *
 * This handles both SDK real-time streaming and JSONL history replay,
 * as both use the same underlying Claude API usage structure.
 *
 * @param usage - Raw Claude API usage object
 * @returns Normalized MessageTokenUsage or undefined if invalid
 */
export function extractTokenUsage(
  usage: ClaudeApiUsage | undefined | null
): MessageTokenUsage | undefined {
  if (!usage) {
    return undefined;
  }

  // Validate required fields
  if (
    typeof usage.input_tokens !== 'number' ||
    typeof usage.output_tokens !== 'number'
  ) {
    return undefined;
  }

  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheCreation: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Calculate approximate cost from token usage
 *
 * Uses Claude's pricing model (as of 2025):
 * - Input: $3 per 1M tokens
 * - Output: $15 per 1M tokens
 * - Cache Read: $0.30 per 1M tokens (90% cheaper than input)
 * - Cache Creation: $3.75 per 1M tokens
 *
 * Note: This is an approximation. Actual costs may vary by model.
 *
 * @param tokens - Token usage
 * @returns Estimated cost in USD
 */
export function estimateCostFromTokens(tokens: MessageTokenUsage): number {
  const inputCost = tokens.input * (3 / 1_000_000);
  const outputCost = tokens.output * (15 / 1_000_000);
  const cacheReadCost = (tokens.cacheRead ?? 0) * (0.3 / 1_000_000);
  const cacheCreationCost = (tokens.cacheCreation ?? 0) * (3.75 / 1_000_000);

  return inputCost + outputCost + cacheReadCost + cacheCreationCost;
}
