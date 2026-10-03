import type { ProvidersSettingsSection } from '@ptah-extension/core';
import {
  JUDGING_HELPER_COPY, buildConsumerRows, consumerPatch, formatResolvedSummary, makeRow, providerReadiness, toBackendJudgeModel,
  toPickerModel, type ConsumerSources,
} from './provider-consumer-rows';

const ready = <T,>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });
const unloaded = <T,>(): ProvidersSettingsSection<T> => ({ status: 'unloaded', data: null, error: null });
const ROUTE = { driverProviderId: 'anthropic', resolvedAuthModality: 'api-key' };
const noScope = () => null;

function sources(overrides: Partial<ConsumerSources> = {}): ConsumerSources {
  return {
    memory: ready({ curatorProvider: '', curatorModel: '' }),
    lanes: ready({
      archaeologist: { provider: '', model: '', defaultTier: 'haiku' as const, toolUse: 'required' },
      synthesis: { provider: 'moonshot', model: 'kimi-k2.5', defaultTier: 'sonnet' as const, toolUse: 'none' },
      judge: { provider: 'moonshot', model: '', defaultTier: 'haiku' as const, toolUse: 'none' },
      replay: { provider: '', model: '', defaultTier: 'haiku' as const, toolUse: 'none' },
    }),
    judging: ready({ judgeProvider: '', judgeModel: 'inherit' }),
    ...overrides,
  };
}

describe('provider-consumer-rows (Batch 35: pure row derivation)', () => {
  it('builds the six rows in the fixed order with their names, the judging helper copy only on the last', () => {
    const rows = buildConsumerRows(sources(), ROUTE, noScope);
    expect(rows.map((row) => row.id)).toEqual(['memory-curator', 'archaeologist', 'synthesis', 'judge', 'replay', 'judging-enhancement']);
    expect(rows.map((row) => row.name)).toEqual([
      'Memory curator', 'Archaeologist lane', 'Synthesis lane', 'Judge lane', 'Replay lane', 'Judging & enhancement',
    ]);
    expect(rows.map((row) => row.helperCopy)).toEqual([null, null, null, null, null, JUDGING_HELPER_COPY]);
    expect(rows.map((row) => row.retryKey)).toEqual(['memory', 'lanes', 'lanes', 'lanes', 'lanes', 'judging']);
  });

  it('reads each lane\'s tier and tool-use need, and the judge model through the "inherit" sentinel', () => {
    const rows = buildConsumerRows(sources(), ROUTE, noScope);
    expect(rows[1]).toEqual(expect.objectContaining({ defaultTier: 'haiku', requiresToolUse: true }));
    expect(rows[2]).toEqual(expect.objectContaining({ defaultTier: 'sonnet', requiresToolUse: false, provider: 'moonshot', model: 'kimi-k2.5' }));
    expect(rows[5].model).toBe('');
  });

  it('labels a role without a provider as following the main agent, and an own provider as "{provider} · {model}"', () => {
    const rows = buildConsumerRows(sources(), ROUTE, noScope);
    expect(rows[1]).toEqual(expect.objectContaining({
      followsMain: true, cellLabel: 'Follows main agent → anthropic', tierLabel: 'haiku tier',
      resolvedSummary: 'Follows main agent → anthropic · api-key → Default (haiku tier)',
    }));
    expect(rows[2]).toEqual(expect.objectContaining({
      followsMain: false, cellLabel: 'Moonshot (Kimi) · kimi-k2.5', tierLabel: 'direct model', resolvedSummary: 'Moonshot (Kimi) · kimi-k2.5',
    }));
    expect(rows[3].cellLabel).toBe('Moonshot (Kimi) · Default (haiku tier)');
  });

  it('says "Active provider" while the main agent\'s route has not loaded', () => {
    expect(formatResolvedSummary(null, '', '', 'haiku')).toBe('Follows main agent → Active provider → Default (haiku tier)');
    expect(buildConsumerRows(sources(), null, noScope)[0].cellLabel).toBe('Follows main agent → Active provider');
  });

  it('marks an unloaded section as not loaded (an empty read is loaded), keeping its status', () => {
    const rows = buildConsumerRows(sources({ memory: unloaded() }), ROUTE, noScope);
    expect(rows[0]).toEqual(expect.objectContaining({ loaded: false, sectionStatus: 'unloaded' }));
    expect(rows[1]).toEqual(expect.objectContaining({ loaded: true, sectionStatus: 'ready' }));
  });

  it('takes each key\'s scope source, and shows Mixed sources when it is unknown (Decision 6)', () => {
    const scopeOf = (key: string) => (key === 'memory.curatorProvider' ? { scope: 'workspace' as const, hasOverride: true } : null);
    const [memory, lane] = buildConsumerRows(sources(), ROUTE, scopeOf);
    expect(memory.providerScope).toBe('workspace');
    expect(memory.providerOverride).toBe(true);
    expect(memory.modelScope).toBe('mixed');
    expect(memory.modelOverride).toBe(false);
    expect(lane.providerFieldName).toBe('Archaeologist lane provider');
    expect(lane.modelFieldName).toBe('Archaeologist lane model');
  });

  it('V36-6 / D16: shows the scope only for a role with a non-inherited value', () => {
    const inherited = () => ({ scope: 'global' as const, hasOverride: false });
    expect(buildConsumerRows(sources(), ROUTE, inherited).map((row) => row.scopeShown)).toEqual([false, false, false, false, false, false]);
    const judgeOverride = (key: string) => (key === 'skillSynthesis.judge.model'
      ? { scope: 'app' as const, hasOverride: true } : inherited());
    expect(buildConsumerRows(sources(), ROUTE, judgeOverride).map((row) => row.scopeShown))
      .toEqual([false, false, false, true, false, false]);
    // Unknown provenance is Mixed sources, which is shown (never a guessed scope).
    expect(buildConsumerRows(sources(), ROUTE, noScope).every((row) => row.scopeShown)).toBe(true);
  });

  it('makeRow passes the setting keys to the scope lookup', () => {
    const keys: string[] = [];
    makeRow({
      id: 'judge', name: 'Judge lane', helperCopy: null, tier: 'haiku', toolUse: false, provider: '', model: '',
      providerKey: 'skillSynthesis.judge.provider', modelKey: 'skillSynthesis.judge.model', section: ready({}), retryKey: 'lanes',
    }, ROUTE, (key) => { keys.push(key); return null; });
    expect(keys).toEqual(['skillSynthesis.judge.provider', 'skillSynthesis.judge.model']);
  });

  it('builds the patch for each role; the judging model "" is written as "inherit"', () => {
    expect(consumerPatch('memory-curator', 'moonshot', 'kimi')).toEqual({ memory: { curatorProvider: 'moonshot', curatorModel: 'kimi' } });
    expect(consumerPatch('replay', '', '')).toEqual({ lanes: { replay: { provider: '', model: '' } } });
    expect(consumerPatch('judging-enhancement', 'moonshot', '')).toEqual({ judging: { judgeProvider: 'moonshot', judgeModel: 'inherit' } });
    expect(toPickerModel('inherit')).toBe('');
    expect(toBackendJudgeModel(' kimi ')).toBe('kimi');
  });

  describe('providerReadiness (fixed sentences only)', () => {
    const PROVIDERS = [
      { id: 'anthropic', status: 'connected' }, { id: 'lmstudio', status: 'skipped' }, { id: 'ollama', status: 'needs-key' },
      { id: 'x-cli', status: 'not-installed' }, { id: 'remote', status: 'unreachable' }, { id: 'old', status: 'unauthenticated' },
    ];

    it('needs nothing for a connected provider, or for following an active main agent', () => {
      expect(providerReadiness('anthropic', PROVIDERS, true)).toBeNull();
      expect(providerReadiness('', PROVIDERS, true)).toBeNull();
    });

    it('blocks following the main agent while no main provider is active', () => {
      expect(providerReadiness('', PROVIDERS, false)).toEqual({
        message: 'Choose a provider to start the main agent.', setupProviderId: '', providerDisplayName: 'main provider', blocking: true,
      });
    });

    it('only notes an uncheckable provider (no Set up link, not blocking)', () => {
      expect(providerReadiness('lmstudio', PROVIDERS, true)).toEqual(expect.objectContaining({ blocking: false, setupProviderId: null }));
    });

    it.each([
      ['ollama', 'Add an API key to connect Ollama.'],
      ['x-cli', 'Install x-cli to use this connection.'],
      ['remote', 'Could not reach remote; check the connection and retry.'],
      ['old', 'Your credential is missing or expired; authenticate again.'],
      ['unlisted', 'Set up unlisted when you are ready.'],
    ])('blocks %s with its sentence and a Set up link', (id, message) => {
      expect(providerReadiness(id, PROVIDERS, true)).toEqual(expect.objectContaining({ message, blocking: true, setupProviderId: id }));
    });
  });
});
