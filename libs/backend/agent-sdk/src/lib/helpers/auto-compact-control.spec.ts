/**
 * resolveAutoCompactControl — the pure mapping from Ptah's compaction settings
 * to the flag-tier keys the pinned runtime honours (TASK_2026_414), plus the
 * effective window and its source (TASK_2026_597, A1).
 *
 * Contract: unset means the runtime decides (no key), disabled is explicit
 * (`autoCompactEnabled: false`), and only a valid user window (or a valid
 * class default) is sent. An out-of-range window is never clamped into range.
 * Precedence of the effective window: env → setting → class default → runtime.
 */

import {
  A1_DEFAULT_WINDOW,
  autoCompactModelClass,
  isFirstPartyAnthropicBaseUrl,
  isValidAutoCompactWindow,
  parseAutoCompactWindowEnv,
  resolveAutoCompactControl,
  SDK_AUTO_COMPACT_WINDOW_MAX,
  SDK_AUTO_COMPACT_WINDOW_MIN,
} from './auto-compact-control';

describe('resolveAutoCompactControl', () => {
  it('disabled → autoCompactEnabled false and no window', () => {
    expect(
      resolveAutoCompactControl({ enabled: false, windowTokens: 150_000 }),
    ).toEqual({
      autoCompactEnabled: false,
      effectiveWindow: null,
      source: 'setting',
    });
  });

  it('enabled with no threshold → no keys (the runtime decides)', () => {
    const control = resolveAutoCompactControl({
      enabled: true,
      windowTokens: null,
    });
    expect(control).toEqual({ effectiveWindow: null, source: 'runtime' });
    expect('autoCompactEnabled' in control).toBe(false);
    expect('autoCompactWindow' in control).toBe(false);
  });

  it('enabled with a valid threshold → that exact window', () => {
    expect(
      resolveAutoCompactControl({ enabled: true, windowTokens: 150_000 }),
    ).toEqual({
      autoCompactWindow: 150_000,
      effectiveWindow: 150_000,
      source: 'setting',
    });
  });

  it('accepts both inclusive bounds', () => {
    expect(
      resolveAutoCompactControl({
        enabled: true,
        windowTokens: SDK_AUTO_COMPACT_WINDOW_MIN,
      }),
    ).toMatchObject({ autoCompactWindow: 100_000 });
    expect(
      resolveAutoCompactControl({
        enabled: true,
        windowTokens: SDK_AUTO_COMPACT_WINDOW_MAX,
      }),
    ).toMatchObject({ autoCompactWindow: 1_000_000 });
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
      ).toEqual({ effectiveWindow: null, source: 'runtime' });
    },
  );
});

describe('resolveAutoCompactControl — A1 precedence (env → setting → default → runtime)', () => {
  const DEFAULTS = { claude: 200_000, proxied: 300_000 } as const;

  it('ships with every class default null', () => {
    expect(A1_DEFAULT_WINDOW).toEqual({ claude: null, proxied: null });
  });

  it.each(['claude', 'proxied'] as const)(
    'null defaults change nothing for the %s class (no behaviour change)',
    (modelClass) => {
      expect(
        resolveAutoCompactControl({
          enabled: true,
          windowTokens: null,
          modelClass,
          envWindow: null,
        }),
      ).toEqual({ effectiveWindow: null, source: 'runtime' });
      expect(
        resolveAutoCompactControl({
          enabled: true,
          windowTokens: 150_000,
          modelClass,
        }),
      ).toEqual({
        autoCompactWindow: 150_000,
        effectiveWindow: 150_000,
        source: 'setting',
      });
    },
  );

  it('env wins over the setting for the effective window; keys unchanged', () => {
    expect(
      resolveAutoCompactControl(
        {
          enabled: true,
          windowTokens: 150_000,
          modelClass: 'claude',
          envWindow: 250_000,
        },
        DEFAULTS,
      ),
    ).toEqual({
      autoCompactWindow: 150_000,
      effectiveWindow: 250_000,
      source: 'env',
    });
  });

  it('env wins over a class default too', () => {
    expect(
      resolveAutoCompactControl(
        {
          enabled: true,
          windowTokens: null,
          modelClass: 'proxied',
          envWindow: 120_000,
        },
        DEFAULTS,
      ),
    ).toEqual({
      autoCompactWindow: 300_000,
      effectiveWindow: 120_000,
      source: 'env',
    });
  });

  it('env with no setting and no default → source env, no keys', () => {
    expect(
      resolveAutoCompactControl({
        enabled: true,
        windowTokens: null,
        modelClass: 'claude',
        envWindow: 400_000,
      }),
    ).toEqual({ effectiveWindow: 400_000, source: 'env' });
  });

  it('setting wins over the class default', () => {
    expect(
      resolveAutoCompactControl(
        { enabled: true, windowTokens: 500_000, modelClass: 'claude' },
        DEFAULTS,
      ),
    ).toEqual({
      autoCompactWindow: 500_000,
      effectiveWindow: 500_000,
      source: 'setting',
    });
  });

  it.each([
    ['claude', 200_000],
    ['proxied', 300_000],
  ] as const)(
    'no setting → the %s class default is sent with source=default',
    (modelClass, expected) => {
      expect(
        resolveAutoCompactControl(
          { enabled: true, windowTokens: null, modelClass },
          DEFAULTS,
        ),
      ).toEqual({
        autoCompactWindow: expected,
        effectiveWindow: expected,
        source: 'default',
      });
    },
  );

  it('an invalid setting falls through to the class default', () => {
    expect(
      resolveAutoCompactControl(
        { enabled: true, windowTokens: 50_000, modelClass: 'claude' },
        DEFAULTS,
      ),
    ).toMatchObject({ autoCompactWindow: 200_000, source: 'default' });
  });

  it('no model class → no class default applies', () => {
    expect(
      resolveAutoCompactControl(
        { enabled: true, windowTokens: null },
        DEFAULTS,
      ),
    ).toEqual({ effectiveWindow: null, source: 'runtime' });
  });

  it('an out-of-range class default is never sent', () => {
    expect(
      resolveAutoCompactControl(
        { enabled: true, windowTokens: null, modelClass: 'claude' },
        { claude: 50_000, proxied: null },
      ),
    ).toEqual({ effectiveWindow: null, source: 'runtime' });
  });

  it('disabled ignores env, setting and default alike', () => {
    expect(
      resolveAutoCompactControl(
        {
          enabled: false,
          windowTokens: 150_000,
          modelClass: 'claude',
          envWindow: 250_000,
        },
        DEFAULTS,
      ),
    ).toEqual({
      autoCompactEnabled: false,
      effectiveWindow: null,
      source: 'setting',
    });
  });
});

describe('parseAutoCompactWindowEnv — mirrors the runtime env read', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['   ', null],
    ['abc', null],
    ['0', null],
    ['-5', null],
    ['250000', 250_000],
    [' 250000 ', 250_000],
    ['100000', 100_000],
    ['1000000', 1_000_000],
    ['50000', 100_000],
    ['2000000', 1_000_000],
  ] as const)('%p → %p', (raw, expected) => {
    expect(parseAutoCompactWindowEnv(raw)).toBe(expected);
  });
});

describe('autoCompactModelClass / isFirstPartyAnthropicBaseUrl', () => {
  it.each([
    [undefined, 'claude'],
    ['', 'claude'],
    ['  ', 'claude'],
    ['https://api.anthropic.com', 'claude'],
    ['https://api.anthropic.com/', 'claude'],
    ['HTTP://API.ANTHROPIC.COM', 'claude'],
    ['http://127.0.0.1:8123', 'proxied'],
    ['https://openrouter.ai/api', 'proxied'],
    ['https://api.anthropic.com/v1', 'proxied'],
    ['https://api.anthropic.com.evil.test', 'proxied'],
  ] as const)('%p → %s', (baseUrl, expected) => {
    expect(autoCompactModelClass(baseUrl)).toBe(expected);
    expect(isFirstPartyAnthropicBaseUrl(baseUrl)).toBe(expected === 'claude');
  });
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
