/**
 * `createMockTokenCounter` — `jest.Mocked<ITokenCounter>` with a deterministic
 * whitespace-split token estimator. Override `countTokens` for tests that
 * need a specific count.
 */

import type { ITokenCounter } from '../../interfaces/token-counter.interface';

export type MockTokenCounter = jest.Mocked<ITokenCounter>;

export interface MockTokenCounterOverrides extends Partial<ITokenCounter> {
  /** Optional fixed value returned by `getMaxInputTokens()` (default: 128_000). */
  maxInputTokens?: number | null;
}

export function createMockTokenCounter(
  overrides?: MockTokenCounterOverrides,
): MockTokenCounter {
  const maxInputTokens =
    overrides?.maxInputTokens === undefined
      ? 128_000
      : overrides.maxInputTokens;

  const mock: MockTokenCounter = {
    countTokens: jest.fn(async (text: string): Promise<number> => {
      if (!text) return 0;
      return text.trim().split(/\s+/u).length;
    }),
    getMaxInputTokens: jest.fn(
      async (): Promise<number | null> => maxInputTokens,
    ),
  };

  if (overrides?.countTokens) {
    mock.countTokens = jest.fn(overrides.countTokens);
  }
  if (overrides?.getMaxInputTokens) {
    mock.getMaxInputTokens = jest.fn(overrides.getMaxInputTokens);
  }

  return mock;
}
