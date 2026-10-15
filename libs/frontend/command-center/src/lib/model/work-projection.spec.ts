import type {
  PhaseDerivationInput,
  VendorLane,
} from '@ptah-extension/tribunal-panel/phase';
import { projectOwnedWork } from './work-projection';

const base = {
  rootTabId: 'tab',
  rootSessionId: 'root',
  children: [],
  persistedChildren: [],
  agents: [],
  runs: [],
} as const;

function phase(
  move: PhaseDerivationInput['move'],
  lanes: readonly VendorLane[] = [],
  bound: PhaseDerivationInput['laneBindings']['bound'] = new Map(),
): PhaseDerivationInput {
  return {
    move,
    specTaskId: move === 'relay' ? 'task' : null,
    laneBindings: { lanes, bound },
    agents: [],
    artifacts: move === 'relay' ? { names: new Set<string>() } : null,
  };
}

describe('projectOwnedWork', () => {
  it('rekeys a provisional child and joins persisted descendants without siblings', () => {
    const result = projectOwnedWork({
      ...base,
      children: [
        {
          tabId: 'temporary',
          sessionId: 'child-sdk',
          parentSessionId: 'root',
          state: 'running',
        },
      ],
      persistedChildren: [
        { sessionId: 'grandchild', parentSessionId: 'child-sdk' },
        { sessionId: 'sibling', parentSessionId: 'other' },
      ],
      agents: [
        {
          agentId: 'a',
          kind: 'cli',
          parentSessionId: 'grandchild',
          state: 'completed',
        },
      ],
    });
    expect(result.nodes.map((node) => node.id)).toEqual([
      'root:root',
      'child:child-sdk',
      'child:grandchild',
      'cli:a',
    ]);
    expect(result.edges).toContainEqual({
      fromId: 'child:child-sdk',
      toId: 'child:grandchild',
    });
    expect(
      result.nodes.find((node) => node.id === 'child:grandchild')?.state,
    ).toBe('unknown');
  });

  it('replaces an unknown persisted child with its live state', () => {
    const persistedChildren = [{ sessionId: 'child', parentSessionId: 'root' }];
    const persisted = projectOwnedWork({ ...base, persistedChildren });
    const live = projectOwnedWork({
      ...base,
      persistedChildren,
      children: [
        {
          tabId: 'tab-child',
          sessionId: 'child',
          parentSessionId: 'root',
          state: 'running',
        },
      ],
    });
    expect(
      persisted.nodes.find((node) => node.id === 'child:child')?.state,
    ).toBe('unknown');
    expect(live.nodes.filter((node) => node.id === 'child:child')).toEqual([
      expect.objectContaining({ state: 'running' }),
    ]);
  });

  it('projects three bound Council lanes, their agent, and a stage', () => {
    const lanes: VendorLane[] = [
      {
        laneId: 'a',
        family: 'one',
        displayName: 'Codex',
        cli: 'codex',
        agentId: 'agent-a',
      },
      {
        laneId: 'b',
        family: 'two',
        displayName: 'Cursor',
        cli: 'cursor',
        agentId: 'agent-b',
      },
      {
        laneId: 'c',
        family: 'three',
        displayName: 'Grok',
        cli: 'grok',
        agentId: 'agent-c',
      },
    ];
    const bound = new Map([
      ['a', { task: 'one', status: 'running' as const }],
      ['b', { task: 'two', status: 'completed' as const }],
      ['c', { task: 'three', status: 'timeout' as const }],
    ]);
    const result = projectOwnedWork({
      ...base,
      agents: [
        {
          agentId: 'agent-a',
          kind: 'cli',
          parentSessionId: 'root',
          runId: 'run',
          state: 'running',
        },
      ],
      runs: [
        {
          runId: 'run',
          rootSessionId: 'root',
          state: 'running',
          phase: phase('council', lanes, bound),
        },
      ],
    });
    expect(
      result.nodes.filter((node) => node.parentId === 'tribunal:run'),
    ).toEqual([
      expect.objectContaining({
        id: 'lane:run:a',
        label: 'Codex',
        providerId: 'codex',
        state: 'running',
      }),
      expect.objectContaining({
        id: 'lane:run:b',
        label: 'Cursor',
        providerId: 'cursor',
        state: 'completed',
      }),
      expect.objectContaining({
        id: 'lane:run:c',
        label: 'Grok',
        providerId: 'grok',
        state: 'failed',
      }),
      expect.objectContaining({
        id: 'phase:run:stage',
        label: 'No phase tracking',
        state: 'running',
      }),
    ]);
    expect(
      result.nodes.find((node) => node.id === 'cli:agent-a')?.parentId,
    ).toBe('lane:run:a');
    expect(result.edges).toContainEqual({
      fromId: 'lane:run:a',
      toId: 'cli:agent-a',
    });
  });

  it('keeps Relay phases and adds a lane with an optional role', () => {
    const lane: VendorLane = {
      laneId: 'plan',
      family: 'one',
      displayName: 'Codex',
      cli: 'codex',
      role: 'plan',
    };
    const result = projectOwnedWork({
      ...base,
      runs: [
        {
          runId: 'relay',
          rootSessionId: 'root',
          state: 'running',
          phase: phase('relay', [lane]),
        },
      ],
    });
    expect(result.nodes.find((node) => node.id === 'lane:relay:plan')).toEqual(
      expect.objectContaining({ label: 'Codex (plan)', state: 'queued' }),
    );
    expect(
      result.nodes
        .filter((node) => node.id.startsWith('phase:relay:'))
        .map((node) => node.id),
    ).toEqual([
      'phase:relay:plan',
      'phase:relay:architect',
      'phase:relay:implement',
      'phase:relay:review',
    ]);
  });

  it('shows an unavailable stage for a run without phase artifacts', () => {
    const result = projectOwnedWork({
      ...base,
      runs: [
        {
          runId: 'crucible',
          rootSessionId: 'root',
          state: 'awaiting input',
          phase: phase('crucible'),
        },
      ],
    });
    expect(
      result.nodes.find((node) => node.id === 'phase:crucible:stage'),
    ).toEqual(
      expect.objectContaining({
        parentId: 'tribunal:crucible',
        label: 'Phase unavailable',
        state: 'awaiting input',
      }),
    );
  });

  it('keeps two runs under one root with separate lanes and stages', () => {
    const lane: VendorLane = {
      laneId: 'shared',
      family: 'one',
      displayName: 'Codex',
      cli: 'codex',
    };
    const result = projectOwnedWork({
      ...base,
      agents: [
        { agentId: 'a', kind: 'sdk', parentSessionId: 'root', state: 'failed' },
      ],
      runs: [
        {
          runId: 'one',
          rootSessionId: 'root',
          state: 'running',
          phase: phase('forge', [lane]),
        },
        {
          runId: 'two',
          rootSessionId: 'root',
          state: 'completed',
          phase: phase('race', [lane]),
        },
      ],
    });
    expect(result.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['sdk:root:a', 'tribunal:one', 'tribunal:two']),
    );
    expect(result.nodes.filter((node) => node.id.startsWith('lane:'))).toEqual([
      expect.objectContaining({
        id: 'lane:one:shared',
        parentId: 'tribunal:one',
      }),
      expect.objectContaining({
        id: 'lane:two:shared',
        parentId: 'tribunal:two',
      }),
    ]);
    expect(
      result.nodes
        .filter((node) => node.id.endsWith(':stage'))
        .map((node) => node.state),
    ).toEqual(['running', 'completed']);
  });
});
