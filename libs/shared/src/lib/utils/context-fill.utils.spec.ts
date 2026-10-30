import {
  contextFillPercent,
  contextFillTokens,
  trustedContextWindow,
} from './context-fill.utils';
import type { ContextCapacity } from './pricing.utils';

const model = 'claude-sonnet';
const nativeCapacity: ContextCapacity = {
  tokens: 200_000,
  source: 'sdk-native',
  providerId: null,
  model,
};

describe('context fill helpers', () => {
  it('F1: sums input and both cache classes without output', () => {
    const usage = {
      input: 2_000,
      cacheRead: 120_000,
      cacheCreation: 8_000,
      output: 5_000,
    };
    expect(contextFillTokens(usage)).toBe(130_000);
    expect(contextFillTokens({ input: 2_000, cacheRead: NaN })).toBe(2_000);
    expect(contextFillTokens({})).toBe(0);
  });

  it('F2: reports 65% for a trusted 200k window', () => {
    expect(contextFillPercent(130_000, trustedContextWindow(nativeCapacity, model))).toBe(65);
  });

  it('F3: uses the observed 1M native window', () => {
    expect(
      contextFillPercent(
        130_000,
        trustedContextWindow({ ...nativeCapacity, tokens: 1_000_000 }, model),
      ),
    ).toBe(13);
  });

  it('F4: rounds to one decimal place', () => {
    expect(contextFillPercent(33_333, 200_000)).toBe(16.7);
  });

  it('F5: leaves values above 100% unclamped', () => {
    expect(contextFillPercent(210_000, 200_000)).toBe(105);
  });

  it('F6: returns null for unknown or untrusted windows', () => {
    expect(trustedContextWindow(null, model)).toBeNull();
    expect(trustedContextWindow({ ...nativeCapacity, source: 'unknown' }, model)).toBeNull();
    expect(
      trustedContextWindow({ ...nativeCapacity, source: 'provider-catalog' }, model),
    ).toBeNull();
    expect(trustedContextWindow(nativeCapacity, 'different-model')).toBeNull();
    expect(contextFillPercent(130_000, null)).toBeNull();
    expect(
      trustedContextWindow(
        { ...nativeCapacity, source: 'provider-catalog', providerId: 'openrouter' },
        model,
      ),
    ).toBe(200_000);
  });

  it('rejects invalid inputs and preserves a known zero fill', () => {
    expect(trustedContextWindow({ ...nativeCapacity, tokens: 0 }, model)).toBeNull();
    expect(trustedContextWindow({ ...nativeCapacity, tokens: Infinity }, model)).toBeNull();
    expect(contextFillPercent(0, 200_000)).toBe(0);
    expect(contextFillPercent(-1, 200_000)).toBeNull();
    expect(contextFillPercent(NaN, 200_000)).toBeNull();
    expect(contextFillPercent(1, 0)).toBeNull();
    expect(contextFillPercent(1, undefined)).toBeNull();
    expect(contextFillPercent(1, Infinity)).toBeNull();
  });
});
