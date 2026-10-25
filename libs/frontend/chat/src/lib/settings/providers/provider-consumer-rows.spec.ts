import type { ProvidersSettingsSection } from '@ptah-extension/core';
import {
  BACKGROUND_ROLE_IDS,
  ENHANCEMENT_HELPER_COPY,
  PROVIDER_CONSUMER_IDS,
  buildConsumerRows,
  consumerPatch,
  formatResolvedSummary,
  providerReadiness,
  toBackendEnhancementModel,
  toPickerModel,
  type ConsumerSources,
} from './provider-consumer-rows';

const ready = <T>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });
const route = { driverProviderId: 'anthropic', resolvedAuthModality: 'api-key' };
const sources = (): ConsumerSources => ({
  memory: ready({ curatorProvider: '', curatorModel: '' }),
  enhancement: ready({ provider: 'kimi-code', model: 'inherit', timeoutMs: 120000 }),
});

describe('provider consumer rows', () => {
  it('shows Memory curator and Enhancement before the separate decision model', () => {
    expect(PROVIDER_CONSUMER_IDS).toEqual(['memory-curator', 'enhancement']);
    expect(BACKGROUND_ROLE_IDS).toEqual(['memory-curator', 'enhancement', 'decision']);
    const rows = buildConsumerRows(sources(), route, () => null);
    expect(rows.map((row) => row.name)).toEqual(['Memory curator', 'Enhancement']);
    expect(rows.map((row) => row.retryKey)).toEqual(['memory', 'enhancement']);
    expect(rows[1]).toEqual(expect.objectContaining({
      helperCopy: ENHANCEMENT_HELPER_COPY,
      provider: 'kimi-code',
      model: '',
      providerFieldName: 'Enhancement provider',
      modelFieldName: 'Enhancement model',
    }));
  });

  it('uses the new setting keys for scope and shows an override', () => {
    const keys: string[] = [];
    const row = buildConsumerRows(sources(), route, (key) => {
      keys.push(key);
      return { scope: key.endsWith('.model') ? 'workspace' : 'global', hasOverride: key.endsWith('.model') };
    })[1];
    expect(keys).toEqual([
      'memory.curatorProvider', 'memory.curatorModel',
      'skills.enhancement.provider', 'skills.enhancement.model',
    ]);
    expect(row.modelScope).toBe('workspace');
    expect(row.scopeShown).toBe(true);
  });

  it('distinguishes unloaded and loaded sections', () => {
    const unloaded: ConsumerSources = {
      ...sources(),
      enhancement: { status: 'unloaded', data: null, error: null },
    };
    expect(buildConsumerRows(unloaded, route, () => null)[1]).toEqual(
      expect.objectContaining({ loaded: false, sectionStatus: 'unloaded' }),
    );
    expect(buildConsumerRows(sources(), route, () => null)[1].loaded).toBe(true);
  });

  it('round trips the inherit model sentinel in enhancement assignments', () => {
    expect(toPickerModel('inherit')).toBe('');
    expect(toBackendEnhancementModel('  ')).toBe('inherit');
    expect(toBackendEnhancementModel(' kimi ')).toBe('kimi');
    expect(consumerPatch('enhancement', 'kimi-code', '')).toEqual({
      enhancement: { provider: 'kimi-code', model: 'inherit' },
    });
    expect(consumerPatch('memory-curator', 'kimi-code', 'kimi')).toEqual({
      memory: { curatorProvider: 'kimi-code', curatorModel: 'kimi' },
    });
  });

  it('describes inherited and direct routes', () => {
    expect(formatResolvedSummary(null, '', '', 'haiku')).toContain('Active provider');
    const inherited = buildConsumerRows(sources(), route, () => null)[0];
    const direct = buildConsumerRows(sources(), route, () => null)[1];
    expect(inherited.followsMain).toBe(true);
    expect(direct.followsMain).toBe(false);
    expect(direct.cellLabel).toContain('Kimi Code');
  });

  it('keeps provider readiness checks', () => {
    expect(providerReadiness('anthropic', [{ id: 'anthropic', status: 'connected' }], true)).toBeNull();
    expect(providerReadiness('', [], false)).toEqual(expect.objectContaining({ blocking: true }));
  });
});
