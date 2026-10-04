/**
 * SessionBudgetConfigProvider — the settings boundary for the session budget
 * (TASK_2026_597 N7). Any value outside the shared bounds, of the wrong type,
 * or a tighten/handoff pair out of order reads as the default and warns once.
 */

import 'reflect-metadata';

import type { ConfigManager, Logger } from '@ptah-extension/vscode-core';
import { SESSION_BUDGET_SETTINGS } from '@ptah-extension/shared';
import { KNOWN_CONFIG_KEYS } from '../../types/settings-export.types';
import {
  SESSION_BUDGET_DEFAULT_CONFIG,
  SessionBudgetConfigProvider,
} from './session-budget-config.provider';

function makeProvider(values: Record<string, unknown>): {
  provider: SessionBudgetConfigProvider;
  warn: jest.Mock;
  get: jest.Mock;
} {
  const warn = jest.fn();
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn,
    error: jest.fn(),
  } as unknown as Logger;
  const get = jest.fn((key: string) => values[key]);
  const config = { get } as unknown as ConfigManager;
  return {
    provider: new SessionBudgetConfigProvider(config, logger),
    warn,
    get,
  };
}

const NUMERIC_FIELDS = [
  'tokens',
  'usd',
  'fallbackWeightedTokens',
  'tightenPercent',
  'handoffPercent',
  'handoffAfterCompactions',
  'tightenWindowTokens',
] as const;

describe('SessionBudgetConfigProvider.getConfig', () => {
  it('returns the shared defaults when nothing is set, with no warning', () => {
    const { provider, warn } = makeProvider({});
    expect(provider.getConfig()).toEqual({
      enabled: true,
      unit: 'tokens',
      tokens: 50_000_000,
      usd: 30,
      fallbackWeightedTokens: 9_000_000,
      tightenPercent: 50,
      handoffPercent: 80,
      handoffAfterCompactions: 3,
      tightenWindowTokens: null,
      blockAtLimit: true,
    });
    expect(provider.getConfig()).toEqual(SESSION_BUDGET_DEFAULT_CONFIG);
    expect(warn).not.toHaveBeenCalled();
  });

  describe.each(NUMERIC_FIELDS)('bounds of %s', (field) => {
    const setting = SESSION_BUDGET_SETTINGS[field];
    // A step that leaves the range for integer and fractional settings alike.
    const step = setting.integer ? 1 : 0.01;
    // A valid partner so a percent at its bound does not trip the order rule.
    const partner: Record<string, unknown> =
      field === 'tightenPercent'
        ? { 'sessionBudget.handoffPercent': 99 }
        : field === 'handoffPercent'
          ? { 'sessionBudget.tightenPercent': 10 }
          : {};

    it.each([
      ['min', setting.min],
      ['max', setting.max],
    ])('accepts the inclusive %s', (_label, value) => {
      const { provider, warn } = makeProvider({
        ...partner,
        [setting.key]: value,
      });
      expect(provider.getConfig()[field]).toBe(value);
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      ['min - 1 step', setting.min - step],
      ['max + 1 step', setting.max + step],
    ])('reads %s as the default and warns', (_label, value) => {
      const { provider, warn } = makeProvider({
        ...partner,
        [setting.key]: value,
      });
      expect(provider.getConfig()[field]).toBe(setting.default);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toEqual(
        expect.objectContaining({ key: setting.key }),
      );
    });

    it.each([
      ['a numeric string', String(setting.min)],
      ['a boolean', true],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['an object', { value: setting.min }],
    ])('reads %s as the default', (_label, value) => {
      const { provider, warn } = makeProvider({ [setting.key]: value });
      expect(provider.getConfig()[field]).toBe(setting.default);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    'tokens',
    'fallbackWeightedTokens',
    'tightenPercent',
    'handoffAfterCompactions',
    'tightenWindowTokens',
  ] as const)('rejects a fraction for the integer setting %s', (field) => {
    const setting = SESSION_BUDGET_SETTINGS[field];
    const { provider, warn } = makeProvider({
      [setting.key]: setting.min + 0.5,
    });
    expect(provider.getConfig()[field]).toBe(setting.default);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('accepts a fractional USD limit', () => {
    const { provider } = makeProvider({ 'sessionBudget.usd': 12.5 });
    expect(provider.getConfig().usd).toBe(12.5);
  });

  describe('tightenWindowTokens (nullable)', () => {
    it('reads an explicit null as null, with no warning', () => {
      const { provider, warn } = makeProvider({
        'sessionBudget.tightenWindowTokens': null,
      });
      expect(provider.getConfig().tightenWindowTokens).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it('reads a set window as that window', () => {
      const { provider } = makeProvider({
        'sessionBudget.tightenWindowTokens': 200_000,
      });
      expect(provider.getConfig().tightenWindowTokens).toBe(200_000);
    });
  });

  it.each(['tokens', 'usd', 'tightenPercent'] as const)(
    'reads null for the non-nullable %s as the default',
    (field) => {
      const setting = SESSION_BUDGET_SETTINGS[field];
      const { provider, warn } = makeProvider({ [setting.key]: null });
      expect(provider.getConfig()[field]).toBe(setting.default);
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  describe('booleans', () => {
    it.each(['enabled', 'blockAtLimit'] as const)(
      'reads false for %s',
      (field) => {
        const { provider } = makeProvider({
          [SESSION_BUDGET_SETTINGS[field].key]: false,
        });
        expect(provider.getConfig()[field]).toBe(false);
      },
    );

    it.each([
      ['a string', 'false'],
      ['a number', 0],
      ['null', null],
    ])('reads %s as the default', (_label, value) => {
      const { provider, warn } = makeProvider({
        'sessionBudget.enabled': value,
        'sessionBudget.blockAtLimit': value,
      });
      const config = provider.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.blockAtLimit).toBe(true);
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('unit', () => {
    it('reads cost', () => {
      const { provider } = makeProvider({ 'sessionBudget.unit': 'cost' });
      expect(provider.getConfig().unit).toBe('cost');
    });

    it.each([
      ['an unknown unit', 'usd'],
      ['wrong case', 'Tokens'],
      ['a number', 1],
    ])('reads %s as tokens', (_label, value) => {
      const { provider, warn } = makeProvider({ 'sessionBudget.unit': value });
      expect(provider.getConfig().unit).toBe('tokens');
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('tighten < handoff', () => {
    it('accepts tighten one below handoff', () => {
      const { provider, warn } = makeProvider({
        'sessionBudget.tightenPercent': 69,
        'sessionBudget.handoffPercent': 70,
      });
      const config = provider.getConfig();
      expect(config.tightenPercent).toBe(69);
      expect(config.handoffPercent).toBe(70);
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      ['equal', 70, 70],
      ['above', 90, 60],
    ])(
      'reads a pair with tighten %s handoff as both defaults',
      (_label, tighten, handoff) => {
        const { provider, warn } = makeProvider({
          'sessionBudget.tightenPercent': tighten,
          'sessionBudget.handoffPercent': handoff,
        });
        const config = provider.getConfig();
        expect(config.tightenPercent).toBe(50);
        expect(config.handoffPercent).toBe(80);
        expect(warn).toHaveBeenCalledTimes(1);
      },
    );

    it('falls back to both defaults when a valid handoff is below the default tighten', () => {
      const { provider } = makeProvider({ 'sessionBudget.handoffPercent': 40 });
      const config = provider.getConfig();
      expect(config.tightenPercent).toBe(50);
      expect(config.handoffPercent).toBe(80);
    });
  });

  describe('warn once per key and value', () => {
    it('does not repeat the warning for the same invalid value', () => {
      const { provider, warn } = makeProvider({ 'sessionBudget.tokens': 5 });
      provider.getConfig();
      provider.getConfig();
      provider.getConfig();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('warns again when the invalid value changes', () => {
      const values: Record<string, unknown> = { 'sessionBudget.tokens': 5 };
      const { provider, warn } = makeProvider(values);
      provider.getConfig();
      values['sessionBudget.tokens'] = 6;
      provider.getConfig();
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('never echoes a rejected string value', () => {
      const { provider, warn } = makeProvider({
        'sessionBudget.unit': 'secret-looking-text',
      });
      provider.getConfig();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        'secret-looking-text',
      );
    });
  });

  it('reads per call with no cache, so a change is seen on the next call', () => {
    const values: Record<string, unknown> = {};
    const { provider } = makeProvider(values);
    expect(provider.getConfig().tokens).toBe(50_000_000);
    values['sessionBudget.tokens'] = 2_000_000;
    expect(provider.getConfig().tokens).toBe(2_000_000);
  });

  it('returns all defaults when the store throws, warning once', () => {
    const { provider, warn, get } = makeProvider({});
    get.mockImplementation(() => {
      throw new Error('fileStore is not configured');
    });
    expect(provider.getConfig()).toEqual(SESSION_BUDGET_DEFAULT_CONFIG);
    expect(provider.getConfig()).toEqual(SESSION_BUDGET_DEFAULT_CONFIG);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the sessionBudget keys out of the settings export (AS-N7a)', () => {
    const exported: readonly string[] = KNOWN_CONFIG_KEYS;
    expect(exported.filter((key) => key.startsWith('sessionBudget.'))).toEqual(
      [],
    );
  });
});
