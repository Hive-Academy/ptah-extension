/**
 * Unit tests for `calculateSessionTotals`.
 *
 * Pure aggregator — builds minimal `ExecutionChatMessage` fixtures to
 * exercise branch coverage (tokens present/absent, cost present/absent,
 * empty array, floating-point rounding).
 */

import type { ExecutionChatMessage } from '../types/execution';
import { calculateSessionTotals } from './session-totals.utils';

/**
 * Build a minimal ExecutionChatMessage suitable for aggregation tests.
 * Only the fields consumed by `calculateSessionTotals` are set.
 */
function makeMessage(
  partial: Partial<ExecutionChatMessage> = {},
): ExecutionChatMessage {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2, 8),
    role: 'assistant',
    timestamp: Date.now(),
    streamingState: null,
    ...partial,
  };
}

describe('calculateSessionTotals', () => {
  it('returns zeros for an empty message array', () => {
    const totals = calculateSessionTotals([]);

    expect(totals).toEqual({
      totalTokensInput: 0,
      totalTokensOutput: 0,
      totalCost: 0,
      messagesWithCost: 0,
    });
  });

  it('aggregates tokens and cost across messages', () => {
    const messages = [
      makeMessage({ tokens: { input: 100, output: 50 }, cost: 0.001 }),
      makeMessage({ tokens: { input: 200, output: 100 }, cost: 0.0025 }),
      makeMessage({ tokens: { input: 50, output: 25 }, cost: 0.0005 }),
    ];

    const totals = calculateSessionTotals(messages);

    expect(totals.totalTokensInput).toBe(350);
    expect(totals.totalTokensOutput).toBe(175);
    expect(totals.totalCost).toBe(0.004);
    expect(totals.messagesWithCost).toBe(3);
  });

  it('skips messages without tokens (no input/output contribution)', () => {
    const messages = [
      makeMessage({ tokens: { input: 100, output: 50 }, cost: 0.001 }),
      makeMessage({ cost: 0.002 }), // tokens missing
      makeMessage({ tokens: { input: 10, output: 5 } }), // cost missing
    ];

    const totals = calculateSessionTotals(messages);

    expect(totals.totalTokensInput).toBe(110);
    expect(totals.totalTokensOutput).toBe(55);
    expect(totals.totalCost).toBe(0.003);
    // Only two messages contributed to cost.
    expect(totals.messagesWithCost).toBe(2);
  });

  it('treats cost === 0 as a contributing message (not undefined)', () => {
    const messages = [
      makeMessage({ tokens: { input: 1, output: 1 }, cost: 0 }),
    ];

    const totals = calculateSessionTotals(messages);

    expect(totals.totalCost).toBe(0);
    expect(totals.messagesWithCost).toBe(1);
  });

  it('rounds totalCost to 4 decimal places (avoids FP drift)', () => {
    // Many tiny non-representable floats that would otherwise accumulate
    // precision noise (e.g. 0.1 + 0.2 !== 0.3).
    const messages = [
      makeMessage({ cost: 0.1 }),
      makeMessage({ cost: 0.2 }),
      makeMessage({ cost: 0.3 }),
    ];

    const totals = calculateSessionTotals(messages);
    expect(totals.totalCost).toBe(0.6);
  });

  it('handles messages with only zero-value token fields', () => {
    const messages = [
      makeMessage({ tokens: { input: 0, output: 0 }, cost: 0.0001 }),
    ];
    const totals = calculateSessionTotals(messages);
    expect(totals.totalTokensInput).toBe(0);
    expect(totals.totalTokensOutput).toBe(0);
    expect(totals.messagesWithCost).toBe(1);
    expect(totals.totalCost).toBe(0.0001);
  });

  it('accepts a readonly array (type compatibility)', () => {
    const frozen: readonly ExecutionChatMessage[] = Object.freeze([
      makeMessage({ tokens: { input: 10, output: 5 }, cost: 0.0001 }),
    ]);
    const totals = calculateSessionTotals(frozen);
    expect(totals.totalTokensInput).toBe(10);
  });
});
