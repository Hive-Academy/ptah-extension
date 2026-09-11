/**
 * resolveAutoCompactControl — the pure mapping from Ptah's compaction settings
 * to the flag-tier keys the pinned runtime honours (TASK_2026_414).
 *
 * Contract: unset means the runtime decides (no key), disabled is explicit
 * (`autoCompactEnabled: false`), and only a valid user window is sent. An
 * out-of-range window is never clamped into range.
 */

import {
  isValidAutoCompactWindow,
  resolveAutoCompactControl,
  SDK_AUTO_COMPACT_WINDOW_MAX,
  SDK_AUTO_COMPACT_WINDOW_MIN,
} from './auto-compact-control';

describe('resolveAutoCompactControl', () => {
  it('disabled → autoCompactEnabled false and no window', () => {
    expect(
      resolveAutoCompactControl({ enabled: false, windowTokens: 150_000 }),
    ).toEqual({ autoCompactEnabled: false });
  });

  it('enabled with no threshold → no keys (the runtime decides)', () => {
    const control = resolveAutoCompactControl({
      enabled: true,
      windowTokens: null,
    });
    expect(control).toEqual({});
    expect('autoCompactEnabled' in control).toBe(false);
    expect('autoCompactWindow' in control).toBe(false);
  });

  it('enabled with a valid threshold → that exact window', () => {
    expect(
      resolveAutoCompactControl({ enabled: true, windowTokens: 150_000 }),
    ).toEqual({ autoCompactWindow: 150_000 });
  });

  it('accepts both inclusive bounds', () => {
    expect(
      resolveAutoCompactControl({
        enabled: true,
        windowTokens: SDK_AUTO_COMPACT_WINDOW_MIN,
      }),
    ).toEqual({ autoCompactWindow: 100_000 });
    expect(
      resolveAutoCompactControl({
        enabled: true,
        windowTokens: SDK_AUTO_COMPACT_WINDOW_MAX,
      }),
    ).toEqual({ autoCompactWindow: 1_000_000 });
  });

  it.each([
    ['below the minimum', 99_999],
    ['above the maximum', 1_000_001],
    ['not an integer', 150_000.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])(
    'never clamps an invalid window into range — %s → no window',
    (_label, windowTokens) => {
      expect(
        resolveAutoCompactControl({ enabled: true, windowTokens }),
      ).toEqual({});
    },
  );
});

describe('isValidAutoCompactWindow', () => {
  it('mirrors the runtime schema: integer in [100000, 1000000]', () => {
    expect(isValidAutoCompactWindow(100_000)).toBe(true);
    expect(isValidAutoCompactWindow(1_000_000)).toBe(true);
    expect(isValidAutoCompactWindow(99_999)).toBe(false);
    expect(isValidAutoCompactWindow(1_000_001)).toBe(false);
    expect(isValidAutoCompactWindow(123_456.7)).toBe(false);
    expect(isValidAutoCompactWindow('150000')).toBe(false);
    expect(isValidAutoCompactWindow(null)).toBe(false);
    expect(isValidAutoCompactWindow(undefined)).toBe(false);
  });
});
