import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { HarnessSourceState } from '../sources/harness-source.port';
import {
  HarnessManifestBuilder,
  isAgentSelectedForSync,
} from './harness-manifest.builder';

describe('isAgentSelectedForSync', () => {
  it.each([
    { agentSyncEnabled: false, disabledAgentIds: undefined, expected: false },
    { agentSyncEnabled: false, disabledAgentIds: [], expected: false },
    {
      agentSyncEnabled: false,
      disabledAgentIds: ['reviewer'],
      expected: false,
    },
    { agentSyncEnabled: true, disabledAgentIds: ['reviewer'], expected: false },
    {
      agentSyncEnabled: undefined,
      disabledAgentIds: ['reviewer'],
      expected: false,
    },
    { agentSyncEnabled: true, disabledAgentIds: undefined, expected: true },
    {
      agentSyncEnabled: undefined,
      disabledAgentIds: undefined,
      expected: true,
    },
    { agentSyncEnabled: true, disabledAgentIds: [], expected: true },
    { agentSyncEnabled: true, disabledAgentIds: ['writer'], expected: true },
    { agentSyncEnabled: true, disabledAgentIds: ['Reviewer'], expected: true },
    {
      agentSyncEnabled: true,
      disabledAgentIds: ['reviewer.md'],
      expected: true,
    },
    {
      agentSyncEnabled: true,
      disabledAgentIds: [' reviewer '],
      expected: true,
    },
  ])(
    'selects reviewer with $agentSyncEnabled / $disabledAgentIds as $expected',
    ({ agentSyncEnabled, disabledAgentIds, expected }) => {
      expect(
        isAgentSelectedForSync(
          { agentSyncEnabled, disabledAgentIds },
          'reviewer',
        ),
      ).toBe(expected);
    },
  );

  it('accepts absent options and does not mutate a frozen selection', () => {
    expect(isAgentSelectedForSync({}, 'reviewer')).toBe(true);
    const selection = Object.freeze({
      agentSyncEnabled: true,
      disabledAgentIds: Object.freeze(['writer']),
    });

    expect(isAgentSelectedForSync(selection, 'reviewer')).toBe(true);
    expect(isAgentSelectedForSync(selection, 'writer')).toBe(false);
    expect(selection.disabledAgentIds).toEqual(['writer']);
  });
});

describe('HarnessManifestBuilder agent selection', () => {
  let root: string;
  let sources: HarnessSourceState;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-agent-enablement-'));
    const agentsRoot = join(root, 'agents');
    mkdirSync(agentsRoot);
    for (const slug of ['reviewer', 'writer']) {
      writeFileSync(join(agentsRoot, `${slug}.md`), `# ${slug}\n`, 'utf-8');
    }
    sources = {
      layout: {
        agentsRoot,
        skillsRoot: join(root, 'skills'),
        commandsRoot: join(root, 'commands'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    { agentSyncEnabled: false, disabledAgentIds: undefined, expected: [] },
    {
      agentSyncEnabled: true,
      disabledAgentIds: undefined,
      expected: ['reviewer', 'writer'],
    },
    {
      agentSyncEnabled: undefined,
      disabledAgentIds: undefined,
      expected: ['reviewer', 'writer'],
    },
    {
      agentSyncEnabled: true,
      disabledAgentIds: ['reviewer'],
      expected: ['writer'],
    },
    {
      agentSyncEnabled: undefined,
      disabledAgentIds: ['reviewer'],
      expected: ['writer'],
    },
    {
      agentSyncEnabled: true,
      disabledAgentIds: ['Reviewer', 'writer.md'],
      expected: ['reviewer', 'writer'],
    },
  ])(
    'preserves manifest agents for $agentSyncEnabled / $disabledAgentIds',
    async ({ agentSyncEnabled, disabledAgentIds, expected }) => {
      const desired = await new HarnessManifestBuilder().build(
        { ...sources, disabledAgentIds },
        { agentSyncEnabled },
      );

      expect(desired.agents.map(({ slug }) => slug)).toEqual(expected);
      expect(desired.collisions).toEqual([]);
    },
  );
});
