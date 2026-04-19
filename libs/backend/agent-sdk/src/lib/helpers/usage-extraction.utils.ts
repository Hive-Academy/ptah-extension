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
  usage: ClaudeApiUsage | undefined | null,
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
