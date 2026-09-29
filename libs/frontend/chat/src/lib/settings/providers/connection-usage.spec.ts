import { connectionUsage, type ConnectionUsageSources, type UsedBy } from './connection-usage';

const lanes = (overrides: Partial<Record<'archaeologist' | 'synthesis' | 'judge' | 'replay', string>> = {}) => ({
  archaeologist: { provider: overrides.archaeologist ?? '' },
  synthesis: { provider: overrides.synthesis ?? '' },
  judge: { provider: overrides.judge ?? '' },
  replay: { provider: overrides.replay ?? '' },
});

/** The routing the user approved in prototypes/final (BRIEF data). */
const PROTOTYPE: ConnectionUsageSources = {
  mainProviderId: 'claude-cli',
  curatorProvider: 'openai-codex',
  lanes: lanes({ judge: 'moonshot' }),
  judgeProvider: '',
  cliAgents: [{ id: 'glm-instance-1', name: 'Glm', providerId: 'ollama-cloud' }],
};

const NOTHING_LOADED: ConnectionUsageSources = {
  mainProviderId: undefined, curatorProvider: null, lanes: null, judgeProvider: null, cliAgents: null,
};

const usageOf = (sources: ConnectionUsageSources) => connectionUsage(sources).byProvider;
const labels = (entries: readonly UsedBy[] | undefined) => (entries ?? []).map((entry) => entry.label);

describe('connectionUsage', () => {
  it('reproduces the prototype: Claude, Moonshot, Codex, Ollama Cloud and an unused custom gateway', () => {
    const result = connectionUsage(PROTOTYPE);
    const usage = result.byProvider;

    expect(result.complete).toBe(true);
    expect(usage['claude-cli']).toEqual([
      { id: 'main-agent', label: 'Main agent', kind: 'main-agent', followsMain: false },
      { id: 'archaeologist', label: 'Archaeologist lane', kind: 'background-role', followsMain: true },
      { id: 'synthesis', label: 'Synthesis lane', kind: 'background-role', followsMain: true },
      { id: 'replay', label: 'Replay lane', kind: 'background-role', followsMain: true },
      { id: 'judging-enhancement', label: 'Judging & enhancement', kind: 'background-role', followsMain: true },
    ]);
    expect(usage['moonshot']).toEqual([{ id: 'judge', label: 'Judge lane', kind: 'background-role', followsMain: false }]);
    expect(labels(usage['ollama-cloud'])).toEqual(['Glm (Ptah CLI agent)']);
    expect(usage['ollama-cloud']?.[0]).toMatchObject({ id: 'ptah-cli:glm-instance-1', kind: 'ptah-cli' });
    // Complete and absent: the drawer may say "Not used yet".
    expect(usage['sovereigneg']).toBeUndefined();
    expect(Object.keys(usage).sort()).toEqual(['claude-cli', 'moonshot', 'ollama-cloud', 'openai-codex']);
  });

  it('excludes system CLIs: OpenAI Codex lists only the memory curator (Codex CLI has its own auth)', () => {
    expect(usageOf(PROTOTYPE)['openai-codex']).toEqual([
      { id: 'memory-curator', label: 'Memory curator', kind: 'background-role', followsMain: false },
    ]);
  });

  it('keeps a fixed order: main agent, curator, lanes, judging, then Ptah CLI agents in list order', () => {
    const usage = usageOf({
      mainProviderId: 'p',
      curatorProvider: 'p',
      lanes: lanes({ archaeologist: 'p', synthesis: 'p', judge: 'p', replay: 'p' }),
      judgeProvider: 'p',
      cliAgents: [{ id: 'b', name: 'Beta', providerId: 'p' }, { id: 'a', name: 'Alpha', providerId: 'p' }],
    });
    expect(labels(usage['p'])).toEqual([
      'Main agent', 'Memory curator', 'Archaeologist lane', 'Synthesis lane', 'Judge lane', 'Replay lane',
      'Judging & enhancement', 'Beta (Ptah CLI agent)', 'Alpha (Ptah CLI agent)',
    ]);
  });

  it('a role that names the main provider explicitly does not "follow" it', () => {
    const usage = usageOf({ ...PROTOTYPE, curatorProvider: 'claude-cli' });
    expect(usage['claude-cli']?.find((entry) => entry.id === 'memory-curator')?.followsMain).toBe(false);
  });

  it('treats a whitespace-only provider as following the main agent', () => {
    const usage = usageOf({ ...PROTOTYPE, curatorProvider: '  ' });
    expect(usage['claude-cli']?.find((entry) => entry.id === 'memory-curator')?.followsMain).toBe(true);
  });

  it('route loaded with no main agent: complete, and following roles are attributed to nothing', () => {
    const result = connectionUsage({ ...PROTOTYPE, mainProviderId: null });
    expect(result.complete).toBe(true);
    expect(result.byProvider['claude-cli']).toBeUndefined();
    expect(Object.values(result.byProvider).flat().some((entry) => entry.followsMain)).toBe(false);
    expect(labels(result.byProvider['moonshot'])).toEqual(['Judge lane']);
  });

  it('route not loaded: incomplete, and nothing is attributed through the main agent', () => {
    const result = connectionUsage({ ...PROTOTYPE, mainProviderId: undefined });
    expect(result.complete).toBe(false);
    expect(result.byProvider['claude-cli']).toBeUndefined();
    expect(labels(result.byProvider['moonshot'])).toEqual(['Judge lane']);
  });

  it.each<[string, Partial<ConnectionUsageSources>]>([
    ['memory', { curatorProvider: null }],
    ['lanes', { lanes: null }],
    ['judging', { judgeProvider: null }],
    ['Ptah CLI agents', { cliAgents: null }],
  ])('an unloaded %s section makes the result incomplete and contributes nothing', (_name, unloaded) => {
    const loaded = connectionUsage(PROTOTYPE).byProvider;
    const result = connectionUsage({ ...PROTOTYPE, ...unloaded });
    expect(result.complete).toBe(false);
    expect(Object.values(result.byProvider).flat().length).toBeLessThan(Object.values(loaded).flat().length);
  });

  it('only the main agent is listed while every other section is unloaded', () => {
    expect(usageOf({ ...NOTHING_LOADED, mainProviderId: 'claude-cli' })).toEqual({
      'claude-cli': [{ id: 'main-agent', label: 'Main agent', kind: 'main-agent', followsMain: false }],
    });
  });

  it('skips a Ptah CLI agent without a provider', () => {
    const usage = usageOf({ ...PROTOTYPE, cliAgents: [{ id: 'x', name: 'Orphan', providerId: ' ' }] });
    expect(Object.values(usage).flat().some((entry) => entry.kind === 'ptah-cli')).toBe(false);
  });

  it('returns an empty, incomplete result when nothing is loaded', () => {
    expect(connectionUsage(NOTHING_LOADED)).toEqual({ byProvider: {}, complete: false });
  });
});
