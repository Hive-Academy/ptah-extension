/**
 * CompactionConfigProvider — the settings boundary for compaction
 * (TASK_2026_414). An unset threshold is NOT a 100000 default: it means the
 * runtime decides. An invalid persisted value warns and is treated as unset,
 * never clamped.
 */

import 'reflect-metadata';

import { FILE_BASED_SETTINGS_DEFAULTS } from '@ptah-extension/platform-core';
import type { ConfigManager, Logger } from '@ptah-extension/vscode-core';
import { CompactionConfigProvider } from './compaction-config-provider';

function makeProvider(values: Record<string, unknown>): {
  provider: CompactionConfigProvider;
  warn: jest.Mock;
} {
  const warn = jest.fn();
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn,
    error: jest.fn(),
  } as unknown as Logger;
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigManager;
  return { provider: new CompactionConfigProvider(config, logger), warn };
}

const ENV_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe('CompactionConfigProvider.getConfig', () => {
  it('unset threshold → null, with no warning', () => {
    const { provider, warn } = makeProvider({});
    expect(provider.getConfig()).toEqual({
      enabled: true,
      contextTokenThreshold: null,
      envWindow: null,
      toolOutputBudgetTokens: 2500,
      subagentHandoffTokens: 150_000,
      rotationSuggestTokens: 300_000,
      subagentStopWeightedTokens: 3_000_000,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('a null threshold (the contributed default) → null, with no warning', () => {
    const { provider, warn } = makeProvider({ 'compaction.threshold': null });
    expect(provider.getConfig().contextTokenThreshold).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('explicit 120000 → 120000', () => {
    const { provider } = makeProvider({ 'compaction.threshold': 120_000 });
    expect(provider.getConfig().contextTokenThreshold).toBe(120_000);
  });

  it('accepts the inclusive bounds 100000 and 1000000', () => {
    expect(
      makeProvider({ 'compaction.threshold': 100_000 }).provider.getConfig()
        .contextTokenThreshold,
    ).toBe(100_000);
    expect(
      makeProvider({ 'compaction.threshold': 1_000_000 }).provider.getConfig()
        .contextTokenThreshold,
    ).toBe(1_000_000);
  });

  it.each([
    ['below the minimum', 50_000],
    ['above the maximum', 1_000_001],
    ['not an integer', 150_000.5],
    ['a string', '150000'],
  ])('invalid persisted threshold (%s) → warn + null', (_label, value) => {
    const { provider, warn } = makeProvider({ 'compaction.threshold': value });
    expect(provider.getConfig().contextTokenThreshold).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid compaction threshold'),
      expect.objectContaining({
        providedType: typeof value,
        validRange: [100_000, 1_000_000],
      }),
    );
  });

  it('reads compaction.enabled and defaults it to true', () => {
    expect(
      makeProvider({ 'compaction.enabled': false }).provider.getConfig()
        .enabled,
    ).toBe(false);
    expect(makeProvider({}).provider.getConfig().enabled).toBe(true);
  });
});

describe('CompactionConfigProvider.getConfig — budget keys', () => {
  const BUDGETS = [
    ['compaction.toolOutputBudgetTokens', 'toolOutputBudgetTokens', 2500],
    ['compaction.subagentHandoffTokens', 'subagentHandoffTokens', 150_000],
    ['compaction.rotationSuggestTokens', 'rotationSuggestTokens', 300_000],
    [
      'compaction.subagentStopWeightedTokens',
      'subagentStopWeightedTokens',
      3_000_000,
    ],
  ] as const;

  it.each(BUDGETS)('%s: a valid value is read', (key, field) => {
    const { provider, warn } = makeProvider({ [key]: 4321 });
    expect(provider.getConfig()[field]).toBe(4321);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(BUDGETS)(
    '%s: unset or null → default, no warning',
    (key, field, d) => {
      expect(makeProvider({}).provider.getConfig()[field]).toBe(d);
      const { provider, warn } = makeProvider({ [key]: null });
      expect(provider.getConfig()[field]).toBe(d);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a non-integer', 12.5],
    ['zero', 0],
    ['negative', -5],
    ['a string', '2500'],
    ['NaN', Number.NaN],
    ['a boolean', true],
  ])('invalid hand-edited value (%s) → default + warn', (_label, value) => {
    for (const [key, field, d] of BUDGETS) {
      const { provider, warn } = makeProvider({ [key]: value });
      expect(provider.getConfig()[field]).toBe(d);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`Invalid ${key}`),
        expect.objectContaining({ defaultValue: d }),
      );
    }
  });

  it('pins every budget key as a positive safe integer in the platform-core defaults', () => {
    for (const [key] of BUDGETS) {
      const value: unknown = FILE_BASED_SETTINGS_DEFAULTS[key];
      expect(Number.isSafeInteger(value) && (value as number) > 0).toBe(true);
    }
  });

  it('warns once per key+value across repeated getConfig() calls', () => {
    const { provider, warn } = makeProvider({
      'compaction.toolOutputBudgetTokens': -5,
    });
    provider.getConfig();
    provider.getConfig();
    provider.getConfig();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not change how compaction.threshold is read', () => {
    const { provider } = makeProvider({
      'compaction.threshold': 120_000,
      'compaction.toolOutputBudgetTokens': -1,
    });
    expect(provider.getConfig().contextTokenThreshold).toBe(120_000);
  });
});

describe('CompactionConfigProvider.getConfig — CLAUDE_CODE_AUTO_COMPACT_WINDOW (read for the log only)', () => {
  it('a valid env window is reported and not warned about', () => {
    process.env[ENV_KEY] = '250000';
    const { provider, warn } = makeProvider({
      'compaction.threshold': 150_000,
    });
    const config = provider.getConfig();
    expect(config.envWindow).toBe(250_000);
    // The setting is still read and validated on its own.
    expect(config.contextTokenThreshold).toBe(150_000);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once across repeated getConfig() calls for an invalid threshold and an env window', () => {
    process.env[ENV_KEY] = '50000';
    const { provider, warn } = makeProvider({ 'compaction.threshold': 5 });
    provider.getConfig();
    provider.getConfig();
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(
      messages.filter((m) => m.includes('Invalid compaction threshold')),
    ).toHaveLength(1);
    expect(
      messages.filter((m) => m.includes('the runtime clamps it')),
    ).toHaveLength(1);
  });

  it('an empty env value is unset, with no warning', () => {
    process.env[ENV_KEY] = '  ';
    const { provider, warn } = makeProvider({});
    expect(provider.getConfig().envWindow).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-100'])(
    'a value the runtime ignores (%p) → null + visible warning, raw text not echoed',
    (raw) => {
      process.env[ENV_KEY] = raw;
      const { provider, warn } = makeProvider({});
      expect(provider.getConfig().envWindow).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('the runtime ignores it'),
        { rawLength: raw.length },
      );
    },
  );

  it.each([
    ['50000', 100_000],
    ['5000000', 1_000_000],
  ])(
    'an out-of-range value (%p) → the clamped window + visible warning',
    (raw, expected) => {
      process.env[ENV_KEY] = raw;
      const { provider, warn } = makeProvider({});
      expect(provider.getConfig().envWindow).toBe(expected);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('the runtime clamps it'),
        {
          effectiveWindow: expected,
          validRange: [100_000, 1_000_000],
        },
      );
    },
  );
});
