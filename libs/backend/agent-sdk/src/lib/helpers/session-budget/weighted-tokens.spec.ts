/**
 * Weighted session tokens — the session budget's no-price fallback measure
 * (TASK_2026_597 N7).
 */

import {
  SESSION_BUDGET_TOKEN_WEIGHTS,
  weightedSessionTokens,
} from './weighted-tokens';

describe('weightedSessionTokens', () => {
  it('weights input 1, cache write 1.25, cache read 0.1, output 5', () => {
    expect(SESSION_BUDGET_TOKEN_WEIGHTS).toEqual({
      input: 1,
      cacheCreation: 1.25,
      cacheRead: 0.1,
      output: 5,
    });
    expect(
      weightedSessionTokens({
        input: 1,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
      }),
    ).toBe(1);
    expect(
      weightedSessionTokens({
        input: 0,
        cacheCreation: 4,
        cacheRead: 10,
        output: 2,
      }),
    ).toBeCloseTo(5 + 1 + 10, 10);
  });

  it('plan fixture: 177M cache read, 7.7M cache write, 1.1M output → 32.8M', () => {
    const weighted = weightedSessionTokens({
      input: 0,
      cacheRead: 177_000_000,
      cacheCreation: 7_700_000,
      output: 1_100_000,
    });
    expect(weighted).toBeCloseTo(32_825_000, 0);
    expect(Math.round(weighted / 100_000) / 10).toBe(32.8);
  });

  it('is 0 for an empty session', () => {
    expect(
      weightedSessionTokens({
        input: 0,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
      }),
    ).toBe(0);
  });
});
