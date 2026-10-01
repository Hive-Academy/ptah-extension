import type { CliDetectionResult, PtahCliSummary } from '@ptah-extension/shared';
import {
  cliMatrixRows,
  type CliMatrixRow,
  type CliMatrixSources,
  type InstanceCliMatrixRow,
  type SystemCliMatrixRow,
} from './cli-matrix-rows';
import { cliPermissionNote } from './cli-permission-notes';

type Orchestration = NonNullable<CliMatrixSources['orchestration']>;

const detected = (cli: CliDetectionResult['cli'], installed: boolean, extra: Partial<CliDetectionResult> = {}): CliDetectionResult => ({
  cli, installed, messagingMode: 'none', ...extra,
});

const orchestration = (overrides: Partial<Orchestration> = {}): Orchestration => ({
  detectedClis: [],
  disabledClis: [],
  preferredAgentOrder: [],
  copilotAutoApprove: true,
  codexModel: '', copilotModel: '', cursorModel: '', antigravityModel: '', opencodeModel: '', piModel: '',
  codexReasoningEffort: '', copilotReasoningEffort: '', piReasoningEffort: '',
  ...overrides,
});

const agent = (overrides: Partial<PtahCliSummary> = {}): PtahCliSummary => ({
  id: 'glm-1', name: 'Glm', providerName: 'Ollama Cloud', providerId: 'ollama-cloud',
  hasApiKey: true, hasStoredKey: true, status: 'available', enabled: true, modelCount: 12,
  ...overrides,
});

const EMPTY: CliMatrixSources = { orchestration: null, cliAgents: null, cliModels: null, cliTest: null };
const ids = (rows: readonly CliMatrixRow[]) => rows.map((row) => row.id);
const system = (row: CliMatrixRow | undefined): SystemCliMatrixRow => {
  if (row?.kind !== 'system') throw new Error('expected a system row');
  return row;
};
const instance = (row: CliMatrixRow | undefined): InstanceCliMatrixRow => {
  if (row?.kind !== 'instance') throw new Error('expected an instance row');
  return row;
};

/** The prototype data set (prototypes/final, BRIEF), minus the quota state (D11). */
const PROTOTYPE_ORCHESTRATION = orchestration({
    detectedClis: [
      detected('codex', true, { version: '1.4' }),
      detected('copilot', true, { version: '1.8' }),
      detected('cursor', false),
      detected('antigravity', true, { version: '2.0' }),
      detected('opencode', true, { version: '0.9' }),
      detected('pi', false),
      // The host also reports instances through detection; the matrix takes them from cliAgents().
      detected('ptah-cli', true, { ptahCliId: 'glm-1', ptahCliName: 'Glm' }),
    ],
    disabledClis: ['copilot'],
    preferredAgentOrder: ['codex', 'antigravity', 'glm-1', 'copilot'],
    codexModel: 'gpt-5.5-codex',
    codexReasoningEffort: 'medium',
    opencodeModel: 'opencode/nemotron-3-ultra-free',
});
const PROTOTYPE: CliMatrixSources = {
  orchestration: PROTOTYPE_ORCHESTRATION,
  cliAgents: [agent()],
  cliModels: { 'glm-1': { selectedModel: 'glm-5.3:cloud', tierMappings: { sonnet: 'glm-5.3', opus: 'glm-4.7', haiku: 'glm-4.5' } } },
  cliTest: { id: 'glm-1', success: true, latencyMs: 112, reason: null },
};

describe('cliMatrixRows', () => {
  it('is empty while nothing has loaded', () => {
    expect(cliMatrixRows(EMPTY)).toEqual({ installed: [], uninstalled: [] });
  });

  describe('order and grouping (#71)', () => {
    it('reproduces the prototype: ranked installed rows, then the uninstalled group', () => {
      const rows = cliMatrixRows(PROTOTYPE);
      expect(ids(rows.installed)).toEqual(['codex', 'antigravity', 'glm-1', 'copilot', 'opencode']);
      expect(ids(rows.uninstalled)).toEqual(['cursor', 'pi']);
    });

    it('skips detection rows that carry a ptahCliId; instances come only from cliAgents()', () => {
      const rows = cliMatrixRows({ ...PROTOTYPE, cliAgents: [] });
      expect(ids(rows.installed)).not.toContain('glm-1');
      expect(rows.installed.every((row) => row.kind === 'system')).toBe(true);
    });

    it('keeps input order (detection, then instances) without a preferred order', () => {
      const rows = cliMatrixRows({
        ...PROTOTYPE,
        orchestration: { ...PROTOTYPE_ORCHESTRATION, preferredAgentOrder: [] },
        cliAgents: [agent({ id: 'b', name: 'B' }), agent({ id: 'a', name: 'A' })],
      });
      expect(ids(rows.installed)).toEqual(['codex', 'copilot', 'antigravity', 'opencode', 'b', 'a']);
    });

    it('puts unranked ids after ranked ones, keeps their input order and ignores unknown ids', () => {
      const rows = cliMatrixRows({
        ...PROTOTYPE,
        orchestration: { ...PROTOTYPE_ORCHESTRATION, preferredAgentOrder: ['gone', 'opencode', 'glm-1', 'opencode'] },
      });
      expect(ids(rows.installed)).toEqual(['opencode', 'glm-1', 'codex', 'copilot', 'antigravity']);
    });

    it('does not rank uninstalled CLIs into the installed list', () => {
      const rows = cliMatrixRows({
        ...PROTOTYPE,
        orchestration: { ...PROTOTYPE_ORCHESTRATION, preferredAgentOrder: ['pi', 'cursor'] },
      });
      expect(ids(rows.installed)).not.toContain('pi');
      expect(ids(rows.uninstalled)).toEqual(['cursor', 'pi']);
    });

    it('lists instances without system rows when orchestration has not loaded', () => {
      const rows = cliMatrixRows({ ...EMPTY, cliAgents: [agent()] });
      expect(ids(rows.installed)).toEqual(['glm-1']);
      expect(rows.uninstalled).toEqual([]);
    });

    it('lists a duplicated detection entry once', () => {
      const rows = cliMatrixRows({
        ...EMPTY,
        orchestration: orchestration({ detectedClis: [detected('codex', true), detected('codex', false)] }),
      });
      expect(ids(rows.installed)).toEqual(['codex']);
      expect(rows.uninstalled).toEqual([]);
    });
  });

  describe('system rows (D11: only what detection reports)', () => {
    const rows = cliMatrixRows(PROTOTYPE);
    const row = (id: string) => system([...rows.installed, ...rows.uninstalled].find((entry) => entry.id === id));

    it('shows Ready for an installed, enabled CLI with its model, effort and version', () => {
      expect(row('codex')).toMatchObject({
        name: 'Codex', status: { kind: 'ready', label: 'Ready', tone: 'success' }, enabled: true, interactive: true,
        version: '1.4', provider: 'OpenAI Codex',
        model: { key: 'codexModel', value: 'gpt-5.5-codex' }, effort: { key: 'codexReasoningEffort', value: 'medium' },
        credentialAction: false,
      });
    });

    it('shows Disabled for a CLI in disabledClis and makes its cells plain text', () => {
      expect(row('copilot')).toMatchObject({
        status: { kind: 'disabled', label: 'Disabled' }, enabled: false, interactive: false,
      });
    });

    it('shows Not installed with no provider and no interactive cells', () => {
      expect(row('pi')).toMatchObject({
        status: { kind: 'not-installed', label: 'Not installed' }, installed: false, interactive: false, provider: null,
      });
    });

    it('keeps Not installed for a CLI that is also in disabledClis', () => {
      const disabledPi = cliMatrixRows({
        ...PROTOTYPE, orchestration: { ...PROTOTYPE_ORCHESTRATION, disabledClis: ['pi'] },
      });
      expect(system(disabledPi.uninstalled.find((entry) => entry.id === 'pi')).status.kind).toBe('not-installed');
    });

    it('keeps Cursor actionable in the Uninstalled group: Needs API key and the Credentials action', () => {
      expect(row('cursor')).toMatchObject({
        status: { kind: 'needs-key', label: 'Needs API key', tone: 'warning' },
        installed: false, interactive: false, credentialAction: true,
      });
    });

    it('shows Cursor Ready once a key resolves, without its "sdk" version', () => {
      const result = cliMatrixRows({
        ...EMPTY, orchestration: orchestration({ detectedClis: [detected('cursor', true, { version: 'sdk' })] }),
      });
      expect(system(result.installed[0])).toMatchObject({
        status: { kind: 'ready' }, version: null, credentialAction: true, provider: 'Cursor',
      });
    });

    it('has no effort cell for Cursor, Antigravity and opencode, and Pi uses piReasoningEffort', () => {
      expect(row('antigravity').effort).toBeNull();
      expect(row('opencode').effort).toBeNull();
      expect(row('cursor').effort).toBeNull();
      const pi = cliMatrixRows({
        ...EMPTY,
        orchestration: orchestration({ detectedClis: [detected('pi', true)], piModel: 'openai/gpt-4o', piReasoningEffort: 'max' }),
      });
      expect(system(pi.installed[0])).toMatchObject({
        model: { key: 'piModel', value: 'openai/gpt-4o' }, effort: { key: 'piReasoningEffort', value: 'max' }, provider: 'openai',
      });
    });

    it('takes the opencode provider from its provider/model id, and none for the CLI default', () => {
      expect(row('opencode').provider).toBe('opencode');
      const unset = cliMatrixRows({ ...EMPTY, orchestration: orchestration({ detectedClis: [detected('opencode', true)] }) });
      expect(system(unset.installed[0]).provider).toBeNull();
    });

    it('treats missing optional model and effort fields as the CLI default', () => {
      const partial = orchestration({ detectedClis: [detected('antigravity', true), detected('pi', true)] });
      const { antigravityModel: _a, piModel: _p, piReasoningEffort: _e, ...rest } = partial;
      const result = cliMatrixRows({ ...EMPTY, orchestration: rest as Orchestration });
      expect(system(result.installed[0]).model.value).toBe('');
      expect(system(result.installed[1]).effort?.value).toBe('');
    });

    it('never reports a quota or test state for a system CLI', () => {
      for (const entry of [...rows.installed, ...rows.uninstalled]) {
        if (entry.kind !== 'system') continue;
        expect(['ready', 'disabled', 'not-installed', 'needs-key']).toContain(entry.status.kind);
        expect('lastTest' in entry).toBe(false);
      }
    });

    it('attaches each CLI\'s permission note, with Copilot\'s saved auto-approve', () => {
      expect(row('codex').permission).toEqual(cliPermissionNote('codex'));
      expect(row('copilot').permission.badge).toBe('Auto-approve: On');
      const off = cliMatrixRows({ ...PROTOTYPE, orchestration: { ...PROTOTYPE_ORCHESTRATION, copilotAutoApprove: false } });
      expect(system(off.installed.find((entry) => entry.id === 'copilot')).permission.badge).toBe('Auto-approve: Off');
    });
  });

  describe('Ptah instance rows', () => {
    const glm = (overrides: Partial<PtahCliSummary> = {}, sources: Partial<CliMatrixSources> = {}) =>
      instance(cliMatrixRows({ ...PROTOTYPE, cliAgents: [agent(overrides)], ...sources }).installed
        .find((row) => row.kind === 'instance'));

    it.each([
      ['available', 'ready', 'Ready', 'success'],
      ['error', 'error', 'Error', 'error'],
      ['initializing', 'initializing', 'Initializing', 'info'],
      ['unconfigured', 'needs-key', 'Needs API key', 'warning'],
    ] as const)('maps status %s to %s (#43)', (status, kind, label, tone) => {
      expect(glm({ status }).status).toEqual({ kind, label, tone });
    });

    it('shows Disabled for a switched-off instance whatever its runtime status', () => {
      expect(glm({ enabled: false, status: 'error' })).toMatchObject({
        status: { kind: 'disabled', label: 'Disabled' }, enabled: false, interactive: false,
      });
    });

    it('derives the key status from hasStoredKey and hasApiKey (#44)', () => {
      expect(glm({ hasStoredKey: true, hasApiKey: true }).keyStatus).toEqual({ kind: 'key-set', label: 'Key set' });
      expect(glm({ hasStoredKey: false, hasApiKey: true }).keyStatus).toEqual({ kind: 'keyless', label: 'Cloud sign-in' });
      expect(glm({ hasStoredKey: false, hasApiKey: true, providerId: 'ollama' }).keyStatus)
        .toEqual({ kind: 'keyless', label: 'No key needed' });
      expect(glm({ hasStoredKey: false, hasApiKey: false, providerId: 'moonshot' }).keyStatus)
        .toEqual({ kind: 'missing', label: 'No API key' });
    });

    it('shows tier badges in Sonnet, Opus, Haiku order (#54)', () => {
      expect(glm().tiers).toEqual([
        { tier: 'sonnet', label: 'Sonnet', model: 'glm-5.3' },
        { tier: 'opus', label: 'Opus', model: 'glm-4.7' },
        { tier: 'haiku', label: 'Haiku', model: 'glm-4.5' },
      ]);
    });

    it('drops blank tier mappings and keeps an empty list when none is mapped', () => {
      expect(glm({}, { cliModels: { 'glm-1': { tierMappings: { sonnet: '  ', haiku: 'glm-4.5' } } } }).tiers)
        .toEqual([{ tier: 'haiku', label: 'Haiku', model: 'glm-4.5' }]);
      expect(glm({}, { cliModels: { 'glm-1': {} } })).toMatchObject({ tiers: [], selectedModel: '' });
    });

    it('reports tiers and model as unknown while cliModels has not loaded or lacks the instance', () => {
      expect(glm({}, { cliModels: null })).toMatchObject({ tiers: null, selectedModel: null });
      expect(glm({}, { cliModels: { other: { selectedModel: 'x' } } })).toMatchObject({ tiers: null, selectedModel: null });
    });

    it('carries the saved direct model and the provider connection', () => {
      expect(glm()).toMatchObject({ selectedModel: 'glm-5.3:cloud', provider: 'Ollama Cloud', providerId: 'ollama-cloud' });
    });

    it('carries the last test result (#52) only for the instance that was tested', () => {
      expect(glm().lastTest).toEqual({ success: true, latencyMs: 112, reason: null });
      expect(glm({}, { cliTest: { id: 'other', success: false, latencyMs: null, reason: 'Timed out.' } }).lastTest).toBeNull();
      expect(glm({}, { cliTest: null }).lastTest).toBeNull();
      expect(glm({}, { cliTest: { id: 'glm-1', success: false, latencyMs: null, reason: 'Invalid API key.' } }).lastTest)
        .toEqual({ success: false, latencyMs: null, reason: 'Invalid API key.' });
    });

    it('uses the Ptah instance permission note', () => {
      expect(glm().permission).toEqual(cliPermissionNote('ptah-cli'));
    });
  });
});
