import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { ChatStore } from '@ptah-extension/chat';
import {
  CommandCenterRecordsService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  type MonitoredAgent,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import {
  CommandCenterProjectionSource,
  runState,
} from './command-center-projection.source';
import { projectOwnedWork } from '../model/work-projection';

describe('CommandCenterProjectionSource', () => {
  it('shows a manifest without agents as starting only during its launch window', () => {
    const now = 1_000_000;
    expect(runState([], now - 119_999, now)).toBe('starting');
    expect(runState([], now - 120_000, now)).toBe('unknown');
    expect(runState([], now + 120_001, now)).toBe('unknown');
  });
  it('projects provider, live and persisted children, owned agents and a root run', () => {
    const root = {
      id: 'root-tab',
      claudeSessionId: 'root-session',
      status: 'streaming',
      liveModelStats: {
        model: 'claude',
        contextCapacity: {
          providerId: 'anthropic',
          tokens: 200000,
          source: 'provider-catalog',
          model: 'claude',
        },
      },
    } as TabState;
    const child = {
      id: 'child-tab',
      claudeSessionId: 'child-session',
      agentOrigin: { parentTabId: 'root-tab' },
      name: 'Builder',
      status: 'sleeping',
      lastActivityAt: 140,
      liveModelStats: {
        model: 'codex',
        contextCapacity: {
          providerId: 'openai-codex',
          tokens: 100000,
          source: 'provider-catalog',
          model: 'codex',
        },
      },
    } as TabState;
    const tabs = Object.assign(Object.create(null) as TabManagerService, {
      tabs: signal([root, child]),
      activeWorkspacePath: '/workspace',
    });
    const questions = signal<readonly { tabId: string; sessionId?: string }[]>(
      [],
    );
    const chat = Object.assign(Object.create(null) as ChatStore, {
      questionRequests: questions,
      sessions: signal([
        {
          id: 'persisted-session',
          lastActivityAt: 120,
          organization: { parentSessionId: 'root-session' },
        },
      ]),
    });
    const cli = {
      agentId: 'cli-1',
      cli: 'codex',
      parentSessionId: 'root-session',
      status: 'running',
      startedAt: 100,
      displayName: 'Architecture 1',
      task: 'Design the architecture',
    } as MonitoredAgent;
    const taskOnly = {
      agentId: 'cli-2',
      cli: 'codex',
      parentSessionId: 'root-session',
      status: 'running',
      startedAt: 101,
      task: 'Review release plan',
    } as MonitoredAgent;
    const unrelated = {
      agentId: 'other',
      cli: 'cursor',
      parentSessionId: 'other-session',
      status: 'running',
      startedAt: 100,
    } as MonitoredAgent;
    const sdk = {
      parentToolUseId: 'tool-1',
      agentId: 'sdk-1',
      parentSessionId: 'child-session',
      status: 'completed',
      lastEventAt: 150,
    } as SubagentRecord;
    const monitor = Object.assign(Object.create(null) as AgentMonitorStore, {
      agents: signal([cli, taskOnly, unrelated]),
      subagents: signal(new Map([['tool-1', sdk]])),
    });
    const readRunManifests = jest.fn().mockReturnValue([
      {
        runId: '11111111-1111-4111-8111-111111111111',
        rootTabId: 'root-tab',
        rootSdkId: 'root-session',
        move: 'council',
        specTaskId: 'TASK_1',
        lanes: [],
        rounds: 1,
        startedAt: 110,
      },
    ]);
    const records = Object.assign(
      Object.create(null) as CommandCenterRecordsService,
      { readRunManifests },
    );
    TestBed.configureTestingModule({
      providers: [
        CommandCenterProjectionSource,
        { provide: TabManagerService, useValue: tabs },
        { provide: ChatStore, useValue: chat },
        { provide: AgentMonitorStore, useValue: monitor },
        { provide: CommandCenterRecordsService, useValue: records },
      ],
    });
    const input = TestBed.inject(CommandCenterProjectionSource).input(
      { tabId: 'root-tab', sessionId: 'root-session' },
      Date.now(),
    );
    expect(input.rootTabStatus).toBe('streaming');
    expect(projectOwnedWork(input).nodes[0]?.state).toBe('running');
    questions.set([{ tabId: 'root-tab', sessionId: 'root-session' }]);
    const pendingInput = TestBed.inject(CommandCenterProjectionSource).input(
      { tabId: 'root-tab', sessionId: 'root-session' },
      Date.now(),
    );
    expect(pendingInput.rootQuestionPending).toBe(true);
    expect(projectOwnedWork(pendingInput).nodes[0]?.state).toBe(
      'awaiting input',
    );
    expect(input.rootProviderId).toBe('anthropic');
    expect(input.children).toEqual([
      expect.objectContaining({
        name: 'Builder',
        providerId: 'openai-codex',
        state: 'unknown',
      }),
    ]);
    expect(input.persistedChildren).toEqual([
      expect.objectContaining({ sessionId: 'persisted-session' }),
    ]);
    expect(input.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: 'cli-1',
          kind: 'cli',
          state: 'running',
        }),
        expect.objectContaining({
          agentId: 'sdk-1',
          kind: 'sdk',
          state: 'completed',
        }),
      ]),
    );
    expect(
      input.agents.find((agent) => agent.agentId === 'other'),
    ).toBeUndefined();
    const projected = projectOwnedWork(input).nodes;
    expect(projected.find((node) => node.id === 'cli:cli-1')?.label).toBe(
      'Architecture 1',
    );
    expect(projected.find((node) => node.id === 'cli:cli-2')?.label).toBe(
      'Review release plan',
    );
    expect(input.runs).toEqual([
      expect.objectContaining({
        runId: '11111111-1111-4111-8111-111111111111',
        rootSessionId: 'root-session',
      }),
    ]);
    expect(readRunManifests).toHaveBeenCalledWith('/workspace', 'root-tab');
  });

  it('includes live and persisted descendants and their agents without following unrelated sessions or cycling', () => {
    const tabs = Object.assign(Object.create(null) as TabManagerService, {
      tabs: signal(
        [
          { id: 'root-tab', claudeSessionId: 'root', status: 'running' },
          {
            id: 'child-tab',
            claudeSessionId: 'child',
            agentOrigin: { parentTabId: 'root-tab' },
            status: 'running',
          },
          {
            id: 'grandchild-tab',
            claudeSessionId: 'grandchild',
            agentOrigin: { parentTabId: 'child-tab' },
            status: 'running',
          },
          {
            id: 'other-tab',
            claudeSessionId: 'other',
            agentOrigin: { parentTabId: 'absent' },
            status: 'running',
          },
        ].map((tab) => Object.assign({} as TabState, tab)),
      ),
      activeWorkspacePath: '/workspace',
    });
    const chat = Object.assign(Object.create(null) as ChatStore, {
      questionRequests: signal([]),
      sessions: signal([
        { id: 'child', organization: { parentSessionId: 'root' } },
        { id: 'grandchild', organization: { parentSessionId: 'child' } },
        { id: 'other', organization: { parentSessionId: 'absent' } },
        { id: 'other-child', organization: { parentSessionId: 'other' } },
        { id: 'cycle-a', organization: { parentSessionId: 'cycle-b' } },
        { id: 'cycle-b', organization: { parentSessionId: 'cycle-a' } },
      ]),
    });
    const monitor = Object.assign(Object.create(null) as AgentMonitorStore, {
      agents: signal([
        {
          agentId: 'owned',
          cli: 'codex',
          parentSessionId: 'grandchild',
          status: 'running',
          startedAt: 1,
        },
        {
          agentId: 'excluded',
          cli: 'codex',
          parentSessionId: 'other-child',
          status: 'running',
          startedAt: 1,
        },
      ] as MonitoredAgent[]),
      subagents: signal(new Map()),
    });
    TestBed.configureTestingModule({
      providers: [
        CommandCenterProjectionSource,
        { provide: TabManagerService, useValue: tabs },
        { provide: ChatStore, useValue: chat },
        { provide: AgentMonitorStore, useValue: monitor },
        {
          provide: CommandCenterRecordsService,
          useValue: { readRunManifests: () => [] },
        },
      ],
    });
    const input = TestBed.inject(CommandCenterProjectionSource).input(
      { tabId: 'root-tab', sessionId: 'root' },
      Date.now(),
    );
    expect(
      input.children.find((child) => child.sessionId === 'grandchild')
        ?.parentSessionId,
    ).toBe('child');
    expect(
      input.persistedChildren.find((child) => child.sessionId === 'grandchild')
        ?.parentSessionId,
    ).toBe('child');
    expect(input.agents.map((agent) => agent.agentId)).toEqual(['owned']);
    expect(
      input.persistedChildren.map((child) => child.sessionId),
    ).not.toContain('cycle-a');
    const nodes = projectOwnedWork(input).nodes;
    expect(nodes.find((node) => node.id === 'child:grandchild')?.parentId).toBe(
      'child:child',
    );
    expect(
      nodes.some(
        (node) => node.id === 'child:other-child' || node.id === 'cli:excluded',
      ),
    ).toBe(false);
  });

  it('binds UUID agents to manifest lanes and advances the lane and run through terminal states', () => {
    const startedAt = Date.now();
    const tabs = Object.assign(Object.create(null) as TabManagerService, {
      tabs: signal(
        [{ id: 'root-tab', claudeSessionId: 'root', status: 'running' }].map(
          (tab) => Object.assign({} as TabState, tab),
        ),
      ),
      activeWorkspacePath: '/workspace',
    });
    const chat = Object.assign(Object.create(null) as ChatStore, {
      questionRequests: signal([]),
      sessions: signal([]),
    });
    const agents = signal([
      {
        agentId: 'uuid-1',
        cli: 'codex',
        parentSessionId: 'root',
        workflowRunId: '11111111-1111-4111-8111-111111111111',
        status: 'running',
        startedAt: 1,
      },
      {
        agentId: 'uuid-2',
        cli: 'cursor',
        parentSessionId: 'root',
        workflowRunId: '11111111-1111-4111-8111-111111111111',
        status: 'running',
        startedAt: 1,
      },
    ] as MonitoredAgent[]);
    const monitor = Object.assign(Object.create(null) as AgentMonitorStore, {
      agents,
      subagents: signal(new Map()),
    });
    const records = {
      readRunManifests: () => [
        {
          runId: '11111111-1111-4111-8111-111111111111',
          rootTabId: 'root-tab',
          rootSdkId: 'root',
          move: 'council',
          specTaskId: 'TASK_1',
          lanes: [{ laneId: 'codex#1' }, { laneId: 'cursor#1' }],
          rounds: 1,
          startedAt,
        },
      ],
    };
    TestBed.configureTestingModule({
      providers: [
        CommandCenterProjectionSource,
        { provide: TabManagerService, useValue: tabs },
        { provide: ChatStore, useValue: chat },
        { provide: AgentMonitorStore, useValue: monitor },
        { provide: CommandCenterRecordsService, useValue: records },
      ],
    });
    const source = TestBed.inject(CommandCenterProjectionSource);
    const now = signal(startedAt);
    const project = computed(
      () =>
        projectOwnedWork(
          source.input({ tabId: 'root-tab', sessionId: 'root' }, now()),
        ).nodes,
    );
    expect(
      project().find(
        (node) =>
          node.id === 'lane:11111111-1111-4111-8111-111111111111:codex#1',
      )?.state,
    ).toBe('running');
    expect(project().some((node) => node.id === 'cli:uuid-1')).toBe(false);
    agents.set(agents().map((agent) => ({ ...agent, status: 'completed' })));
    expect(
      project().find(
        (node) =>
          node.id === 'lane:11111111-1111-4111-8111-111111111111:codex#1',
      )?.state,
    ).toBe('completed');
    expect(
      project().find(
        (node) => node.id === 'tribunal:11111111-1111-4111-8111-111111111111',
      )?.state,
    ).toBe('completed');
    agents.set(
      agents().map((agent) =>
        agent.agentId === 'uuid-2' ? { ...agent, status: 'failed' } : agent,
      ),
    );
    expect(
      project().find(
        (node) => node.id === 'tribunal:11111111-1111-4111-8111-111111111111',
      )?.state,
    ).toBe('failed');
    agents.set([]);
    expect(
      project().find(
        (node) => node.id === 'tribunal:11111111-1111-4111-8111-111111111111',
      )?.state,
    ).toBe('starting');
    now.set(startedAt + 120_000);
    expect(
      project().find(
        (node) => node.id === 'tribunal:11111111-1111-4111-8111-111111111111',
      )?.state,
    ).toBe('unknown');
  });
});
