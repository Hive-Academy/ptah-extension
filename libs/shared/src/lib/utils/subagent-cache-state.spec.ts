import { computeSubagentCacheState } from './subagent-cache-state';

const NOW = 1_700_000_000_000;
const FIVE_MIN = 5 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

describe('computeSubagentCacheState', () => {
  it('is cold with idle 0 when no activity was recorded', () => {
    expect(computeSubagentCacheState(undefined, '1h', NOW)).toEqual({
      cacheState: 'cold',
      effectiveTtl: '1h',
      idleMs: 0,
    });
  });

  it('treats a non-finite timestamp as missing', () => {
    expect(computeSubagentCacheState(Number.NaN, '5m', NOW)).toEqual({
      cacheState: 'cold',
      effectiveTtl: '5m',
      idleMs: 0,
    });
  });

  it('is warm with idle 0 when the timestamp is in the future', () => {
    expect(computeSubagentCacheState(NOW + 10_000, '5m', NOW)).toEqual({
      cacheState: 'warm',
      effectiveTtl: '5m',
      idleMs: 0,
    });
  });

  it.each([
    ['5m', FIVE_MIN - 1, 'warm'],
    ['5m', FIVE_MIN, 'cold'],
    ['5m', FIVE_MIN + 1, 'cold'],
    ['1h', FIVE_MIN, 'warm'],
    ['1h', ONE_HOUR - 1, 'warm'],
    ['1h', ONE_HOUR, 'cold'],
    ['1h', 0, 'warm'],
  ] as const)('ttl %s, idle %d ms -> %s', (ttl, idleMs, expected) => {
    expect(computeSubagentCacheState(NOW - idleMs, ttl, NOW)).toEqual({
      cacheState: expected,
      effectiveTtl: ttl,
      idleMs,
    });
  });
});
