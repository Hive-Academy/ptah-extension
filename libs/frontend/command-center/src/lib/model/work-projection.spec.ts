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
} as const;

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





});
