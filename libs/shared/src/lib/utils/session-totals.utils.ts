/**
 * Session Totals Calculation Utilities
 *
 * This module provides utilities for calculating cumulative token and cost
 * totals across all messages in a chat session.
 */

import { ExecutionChatMessage } from '../types/execution';

/**
 * Session totals calculated from messages
 */
export interface SessionTotals {
  readonly totalTokensInput: number;
  readonly totalTokensOutput: number;
  readonly totalCost: number;
  readonly messagesWithCost: number; // Count of messages contributing to totals
}

/**
 * Calculate session totals from messages array
 *
 * This function aggregates token counts and costs across all messages in a session.
 * It gracefully handles messages without token or cost data by skipping them.
 *
 * @param messages - Array of ExecutionChatMessage
 * @returns Session totals with token counts, total cost, and message count
 *
 * @example
 * ```typescript
 * const totals = calculateSessionTotals(messages);
 * console.log(totals.totalCost); // 0.0420
 * console.log(totals.totalTokensInput); // 5000
 * console.log(totals.totalTokensOutput); // 2000
 * console.log(totals.messagesWithCost); // 3
 * ```
 *
 * @example
 * ```typescript
 * // Empty array returns zeros
 * const totals = calculateSessionTotals([]);
 * // Returns: { totalTokensInput: 0, totalTokensOutput: 0, totalCost: 0.0000, messagesWithCost: 0 }
 * ```
 *
 * @example
 * ```typescript
 * // Messages without tokens/cost are gracefully skipped
 * const messages = [
 *   { tokens: { input: 100, output: 50 }, cost: 0.0010 },
 *   { tokens: undefined, cost: undefined }, // Skipped
 *   { tokens: { input: 200, output: 100 }, cost: 0.0025 }
 * ];
 * const totals = calculateSessionTotals(messages);
 * // Returns: { totalTokensInput: 300, totalTokensOutput: 150, totalCost: 0.0035, messagesWithCost: 2 }
 * ```
 */
export function calculateSessionTotals(
  messages: readonly ExecutionChatMessage[],
): SessionTotals {
  let totalTokensInput = 0;
  let totalTokensOutput = 0;
  let totalCost = 0;
  let messagesWithCost = 0;

  for (const message of messages) {
    // Sum token counts if tokens field exists
    if (message.tokens) {
      totalTokensInput += message.tokens.input;
      totalTokensOutput += message.tokens.output;
    }

    // Sum cost if cost field exists
    if (message.cost !== undefined) {
      totalCost += message.cost;
      messagesWithCost++;
    }
  }

  // Round total cost to 4 decimal places to avoid floating-point accumulation errors
  totalCost = Math.round(totalCost * 10000) / 10000;

  return {
    totalTokensInput,
    totalTokensOutput,
    totalCost,
    messagesWithCost,
  };
}
