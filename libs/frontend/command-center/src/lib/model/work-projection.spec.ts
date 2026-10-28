import type {
  PhaseDerivationInput,
  VendorLane,
} from '@ptah-extension/tribunal-panel/phase';
import { layoutScene } from '../scene/scene-layout';
import type { CommandWorkState } from './command-center.store';
import {
  computeAgesMs,
  projectOwnedWork,
  WORK_LABEL_MAX_LENGTH,
} from './work-projection';
import { buildStatusContext } from './status-context';

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
  it('derives the root state from streaming and pending-question context', () => {
    const rootState = (input: Parameters<typeof projectOwnedWork>[0]) =>
      projectOwnedWork(input).nodes[0]?.state;
    expect(rootState(base)).toBe('idle');
    expect(rootState({ ...base, rootTabStatus: 'streaming' })).toBe('running');
    expect(
      rootState({
        ...base,
        rootTabStatus: 'streaming',
        rootQuestionPending: true,
      }),
    ).toBe('awaiting input');
    expect(rootState({ ...base, rootTabStatus: 'ready' })).toBe('idle');
  });
  it('keeps an idle root running while owned delegated work is active', () => {
    const agent = {
      agentId: 'sdk-1',
      kind: 'sdk' as const,
      parentSessionId: base.rootSessionId,
      displayName: 'software-architect',
    };
    const rootState = (state: CommandWorkState) =>
      projectOwnedWork({
        ...base,
        rootTabStatus: 'ready',
        agents: [{ ...agent, state }],
      }).nodes[0]?.state;
    expect(rootState('running')).toBe('running');
    expect(rootState('starting')).toBe('running');
    expect(rootState('queued')).toBe('idle');
    expect(rootState('completed')).toBe('idle');
    expect(rootState('failed')).toBe('idle');
    expect(
      projectOwnedWork({
        ...base,
        rootQuestionPending: true,
        agents: [{ ...agent, state: 'running' }],
      }).nodes[0]?.state,
    ).toBe('awaiting input');
  });
  it('names agents from display name, then task, then the provider and caps plate text', () => {
    const result = projectOwnedWork({
      ...base,
      agents: [
        {
          agentId: 'named',
          kind: 'cli',
          parentSessionId: 'root',
          state: 'running',
          providerId: 'codex',
          displayName: 'Architecture review',
          task: 'Ignored task',
        },
        {
          agentId: 'task',
          kind: 'sdk',
          parentSessionId: 'root',
          state: 'running',
          providerId: 'anthropic',
          task: 'Review the release plan and update the full checklist',
        },
        {
          agentId: 'fallback',
          kind: 'cli',
          parentSessionId: 'root',
          state: 'running',
          providerId: 'open-code',
        },
      ],
    });
    expect(result.nodes.find((node) => node.id === 'cli:named')?.label).toBe(
      'Architecture review',
    );
    expect(result.nodes.find((node) => node.id === 'cli:named')?.task).toBe(
      'Ignored task',
    );
    const taskLabel = result.nodes.find(
      (node) => node.id === 'sdk:root:task',
    )?.label;
    expect(taskLabel?.length).toBeLessThanOrEqual(WORK_LABEL_MAX_LENGTH);
    expect(taskLabel?.endsWith('…')).toBe(true);
    expect(result.nodes.find((node) => node.id === 'cli:fallback')?.label).toBe(
      'Open Code agent',
    );
  });
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
      'root:tab',
      'child:child-sdk',
      'child:grandchild',
      'cli:a',
    ]);
    expect(
      result.nodes.find((node) => node.id === 'child:child-sdk')?.tabId,
    ).toBe('temporary');
    expect(
      result.nodes.find((node) => node.id === 'child:grandchild')?.tabId,
    ).toBeUndefined();
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

  it('deduplicates a persisted temporary ID by the live SDK session ID', () => {
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
      persistedChildren: [{ sessionId: 'temporary', parentSessionId: 'root' }],
    });
    expect(result.nodes.filter((node) => node.id.startsWith('child:'))).toEqual(
      [expect.objectContaining({ id: 'child:child-sdk', state: 'running' })],
    );
  });

  it('projects child names and provider IDs for the scene label', () => {
    const result = projectOwnedWork({
      ...base,
      rootProviderId: 'codex',
      children: [
        {
          tabId: 'builder-tab',
          sessionId: 'builder',
          parentSessionId: 'root',
          state: 'running',
          name: 'Builder',
          providerId: 'cursor',
        },
        {
          tabId: 'unnamed-tab',
          sessionId: 'unnamed',
          parentSessionId: 'root',
          state: 'running',
        },
      ],
    });
    expect(
      result.nodes.find((node) => node.id === 'root:tab')?.providerId,
    ).toBe('codex');
    expect(result.nodes.find((node) => node.id === 'child:builder')).toEqual(
      expect.objectContaining({ label: 'Builder', providerId: 'cursor' }),
    );
    expect(result.nodes.find((node) => node.id === 'child:unnamed')).toEqual(
      expect.objectContaining({ label: 'Child session', providerId: null }),
    );
    const layout = layoutScene(result, { width: 1200, height: 800 }, () => ({
      width: 80,
      height: 20,
    }));
    expect(
      layout.nodes.find((entry) => entry.node.id === 'child:builder')?.label,
    ).toBe('Codex · Builder');
  });

  it('computes ages only for timestamped projected nodes and includes one in status', () => {
    const result = projectOwnedWork({
      ...base,
      children: [
        {
          tabId: 'child-tab',
          sessionId: 'child',
          parentSessionId: 'root',
          state: 'running',
          updatedAt: 1000,
        },
      ],
    });
    const ages = computeAgesMs(result.nodes, 5000);
    expect([...ages]).toEqual([['child:child', 4000]]);
    expect(buildStatusContext(result.nodes, ages)).toContain(
      'child:child | running | 4s',
    );
  });

  it('projects three bound Council lanes without a duplicate CLI agent and a stage', () => {
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
    expect(result.nodes.some((node) => node.id === 'cli:agent-a')).toBe(false);
    expect(result.edges.some((edge) => edge.toId === 'cli:agent-a')).toBe(
      false,
    );
  });

  it('accepts one clock tick of skew and rejects invalid start epochs', () => {
    const lanes: VendorLane[] = [
      'valid',
      'fresh',
      'future',
      'zero',
      'negative',
      'invalid',
      'missing',
    ].map((laneId) => ({
      laneId,
      family: 'codex',
      displayName: laneId,
      cli: 'codex',
    }));
    const bound = new Map(
      lanes.map((lane) => [
        lane.laneId,
        { task: lane.laneId, status: 'running' as const },
      ]),
    );
    const nodes = projectOwnedWork({
      ...base,
      now: 1_000,
      agents: [
        {
          agentId: 'valid',
          kind: 'cli',
          parentSessionId: 'root',
          state: 'running',
          startedAt: 500,
        },
        {
          agentId: 'fresh',
          kind: 'cli',
          parentSessionId: 'root',
          state: 'running',
          startedAt: 31_000,
        },
        {
          agentId: 'future',
          kind: 'cli',
          parentSessionId: 'root',
          state: 'running',
          startedAt: 31_001,
        },
        {
          agentId: 'zero',
          kind: 'cli',
          parentSessionId: 'root',
          state: 'running',
          startedAt: 0,
        },
        {
          agentId: 'negative',
          kind: 'cli',
          parentSessionId: 'root',
          state: 'running',
          startedAt: -1,
        },
        {
          agentId: 'invalid',
          kind: 'cli',
          parentSessionId: 'root',
          state: 'running',
          startedAt: Number.NaN,
        },
      ],
      runs: [
        {
          runId: 'run',
          rootSessionId: 'root',
          state: 'running',
          updatedAt: 100,
          phase: phase('council', lanes, bound),
          laneStartedAt: new Map([
            ['valid', 500],
            ['fresh', 31_000],
            ['future', 31_001],
            ['zero', 0],
            ['negative', -1],
            ['invalid', Number.POSITIVE_INFINITY],
          ]),
        },
      ],
    }).nodes;
    expect(nodes.find((node) => node.id === 'lane:run:valid')?.startedAt).toBe(
      500,
    );
    expect(nodes.find((node) => node.id === 'cli:valid')?.startedAt).toBe(500);
    expect(nodes.find((node) => node.id === 'lane:run:fresh')?.startedAt).toBe(
      31_000,
    );
    expect(nodes.find((node) => node.id === 'cli:fresh')?.startedAt).toBe(
      31_000,
    );
    for (const id of [
      'lane:run:future',
      'lane:run:zero',
      'lane:run:negative',
      'lane:run:invalid',
      'lane:run:missing',
      'cli:future',
      'cli:zero',
      'cli:negative',
      'cli:invalid',
      'tribunal:run',
    ])
      expect(nodes.find((node) => node.id === id)).not.toHaveProperty(
        'startedAt',
      );
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
