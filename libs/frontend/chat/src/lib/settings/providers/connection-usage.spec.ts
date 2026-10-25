import {
  connectionUsage,
  type ConnectionUsageSources,
} from './connection-usage';

const loaded: ConnectionUsageSources = {
  mainProviderId: 'anthropic',
  curatorProvider: '',
  enhancementProvider: 'kimi-code',
  cliAgents: [{ id: 'one', name: 'One', providerId: 'kimi-code' }],
  systemClis: {
    detectedClis: [{ cli: 'codex', installed: true }],
    disabledClis: [],
  },
};

describe('connection usage', () => {
  it('attributes main, curator, Enhancement, CLI agents and the shared Codex connection', () => {
    const result = connectionUsage(loaded);
    expect(result.complete).toBe(true);
    expect(result.byProvider['anthropic'].map((entry) => entry.label)).toEqual([
      'Main agent', 'Memory curator',
    ]);
    expect(result.byProvider['anthropic'][1].followsMain).toBe(true);
    expect(result.byProvider['kimi-code'].map((entry) => entry.label)).toEqual([
      'Enhancement', 'One (Ptah CLI agent)',
    ]);
    expect(result.byProvider['openai-codex'].map((entry) => entry.label)).toEqual(['Codex CLI']);
  });

  it('attributes an inherited enhancement assignment to the main provider', () => {
    const result = connectionUsage({ ...loaded, enhancementProvider: '' });
    expect(result.byProvider['anthropic'].map((entry) => entry.id)).toEqual([
      'main-agent', 'memory-curator', 'enhancement',
    ]);
    expect(result.byProvider['anthropic'][2].followsMain).toBe(true);
  });

  it('marks an unloaded enhancement section incomplete without attributing it', () => {
    const result = connectionUsage({ ...loaded, enhancementProvider: null });
    expect(result.complete).toBe(false);
    expect(result.byProvider['kimi-code'].map((entry) => entry.id)).toEqual(['ptah-cli:one']);
  });

  it('does not attribute inherited roles when the main route has no provider', () => {
    const result = connectionUsage({
      ...loaded, mainProviderId: null, enhancementProvider: '',
    });
    expect(result.complete).toBe(true);
    expect(result.byProvider['anthropic']).toBeUndefined();
  });

  it('waits for every source before marking usage complete', () => {
    expect(connectionUsage({ ...loaded, mainProviderId: undefined }).complete).toBe(false);
    expect(connectionUsage({ ...loaded, curatorProvider: null }).complete).toBe(false);
    expect(connectionUsage({ ...loaded, cliAgents: null }).complete).toBe(false);
    expect(connectionUsage({ ...loaded, systemClis: null }).complete).toBe(false);
  });

  it('does not count a disabled Codex CLI or unassigned Ptah CLI agent', () => {
    const result = connectionUsage({
      ...loaded,
      cliAgents: [{ id: 'one', name: 'One', providerId: ' ' }],
      systemClis: {
        detectedClis: [{ cli: 'codex', installed: true }],
        disabledClis: ['codex'],
      },
    });
    expect(result.byProvider['openai-codex']).toBeUndefined();
    expect(result.byProvider['kimi-code'].map((entry) => entry.id)).toEqual(['enhancement']);
  });
});
