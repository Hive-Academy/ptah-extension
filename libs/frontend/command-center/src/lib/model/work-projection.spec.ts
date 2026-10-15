import { projectOwnedWork } from './work-projection';

const base = {
  rootTabId: 'tab',
  rootSessionId: 'root',
  children: [],
  persistedChildren: [],
  agents: [],
  runs: [],
} as const;
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
  });
  it('keeps terminal agents and two independent Tribunal runs', () => {
    const phase = {
      move: 'council' as const,
      specTaskId: null,
      laneBindings: { lanes: [], bound: new Map() },
      agents: [],
      artifacts: null,
    };
    const result = projectOwnedWork({
      ...base,
      agents: [
        { agentId: 'a', kind: 'sdk', parentSessionId: 'root', state: 'failed' },
      ],
      runs: [
        { runId: 'one', rootSessionId: 'root', state: 'running', phase },
        { runId: 'two', rootSessionId: 'root', state: 'completed', phase },
      ],
    });
    expect(result.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['sdk:root:a', 'tribunal:one', 'tribunal:two']),
    );
  });
});
