import { messageTokenTotal, sessionTokenTotal } from './token-usage.utils';

describe('messageTokenTotal', () => {
  it('sums input, output, cache read and cache creation', () => {
    expect(
      messageTokenTotal({
        input: 100,
        output: 20,
        cacheRead: 30,
        cacheCreation: 40,
      }),
    ).toBe(190);
  });

  it('treats absent cache counts as zero and preserves known zero', () => {
    expect(messageTokenTotal({ input: 100, output: 20 })).toBe(120);
    expect(messageTokenTotal({ input: 0, output: 0 })).toBe(0);
  });

  it('returns null for unknown or invalid counts, including an overflowing sum', () => {
    expect(messageTokenTotal(null)).toBeNull();
    expect(messageTokenTotal(undefined)).toBeNull();
    expect(messageTokenTotal({ input: NaN, output: 2 })).toBeNull();
    expect(messageTokenTotal({ input: 1, output: Infinity })).toBeNull();
    expect(
      messageTokenTotal({ input: 1, output: 2, cacheRead: -1 }),
    ).toBeNull();
    expect(
      messageTokenTotal({ input: 1, output: 2, cacheCreation: NaN }),
    ).toBeNull();
    expect(
      messageTokenTotal({ input: Number.MAX_VALUE, output: Number.MAX_VALUE }),
    ).toBeNull();
  });
});

describe('sessionTokenTotal', () => {
  it('uses the finite host count, including zero, without recomputing', () => {
    expect(sessionTokenTotal({ tokenCount: 0 })).toBe(0);
    const entry = {
      tokenCount: 7,
      tokens: { input: 100, output: 20, cacheRead: 30, cacheCreation: 40 },
    };
    expect(sessionTokenTotal(entry)).toBe(7);
  });

  it('returns null when the host count is absent or non-finite', () => {
    expect(sessionTokenTotal(null)).toBeNull();
    expect(sessionTokenTotal({})).toBeNull();
    expect(sessionTokenTotal({ tokenCount: NaN })).toBeNull();
    expect(sessionTokenTotal({ tokenCount: Infinity })).toBeNull();
  });
});
