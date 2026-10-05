import { formatDurationMs, formatUsdCost } from './usage-format.utils';

describe('formatUsdCost', () => {
  it.each([
    [null, null],
    [undefined, null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    [0, '$0.0000'],
    [0.0042, '$0.0042'],
    [0.01, '$0.01'],
    [1.234, '$1.23'],
  ] as const)('formats %s as %s', (cost, expected) => {
    expect(formatUsdCost(cost)).toBe(expected);
  });
});

describe('formatDurationMs', () => {
  it.each([
    [0, '0ms'],
    [99, '1m 39s'],
    [100, '100ms'],
    [999, '999ms'],
    [1_000, '1.0s'],
    [59_999, '60.0s'],
    [60_000, '1m'],
    [61_500, '1m 2s'],
  ] as const)('formats %i as %s', (durationMs, expected) => {
    expect(formatDurationMs(durationMs)).toBe(expected);
  });
});
