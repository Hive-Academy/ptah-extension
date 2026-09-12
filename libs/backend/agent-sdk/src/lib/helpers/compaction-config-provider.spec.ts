/**
 * CompactionConfigProvider — the settings boundary for compaction
 * (TASK_2026_414). An unset threshold is NOT a 100000 default: it means the
 * runtime decides. An invalid persisted value warns and is treated as unset,
 * never clamped.
 */

import 'reflect-metadata';

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

describe('CompactionConfigProvider.getConfig', () => {
  it('unset threshold → null, with no warning', () => {
    const { provider, warn } = makeProvider({});
    expect(provider.getConfig()).toEqual({
      enabled: true,
      contextTokenThreshold: null,
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
