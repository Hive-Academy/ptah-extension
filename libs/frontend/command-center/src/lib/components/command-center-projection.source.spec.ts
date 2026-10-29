import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ChatStore } from '@ptah-extension/chat';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { CommandCenterProjectionSource } from './command-center-projection.source';
import { projectOwnedWork } from '../model/work-projection';

describe('CommandCenterProjectionSource', () => {
  function inputForTab(tab: TabState, agents: MonitoredAgent[] = []) {
    const tabs = Object.assign(Object.create(null) as TabManagerService, {
      tabs: signal([tab]),
      activeWorkspacePath: '/workspace',
    });
    const chat = Object.assign(Object.create(null) as ChatStore, {
      questionRequests: signal([]),
      sessions: signal([]),
    });
    const monitor = Object.assign(Object.create(null) as AgentMonitorStore, {
      agents: signal(agents),
      subagents: signal(new Map()),
    });
    TestBed.configureTestingModule({
      providers: [
        CommandCenterProjectionSource,
        { provide: TabManagerService, useValue: tabs },
        { provide: ChatStore, useValue: chat },
        { provide: AgentMonitorStore, useValue: monitor },
      ],
    });
    return TestBed.inject(CommandCenterProjectionSource).input(
      { tabId: 'root-tab', sessionId: 'root' },
      2,
    );
  }

  function restoredTab(
    modelUsageList: NonNullable<
      NonNullable<TabState['sessionStats']>['modelUsageList']
    >,
  ): TabState {
    return Object.assign({} as TabState, {
      id: 'root-tab',
      claudeSessionId: 'root',
      status: 'sleeping',
      sessionModel: 'claude',
      sessionStats: {
        sessionId: 'root',
        model: 'other',
        totalCost: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        messageCount: 1,
        status: 'ok',
        modelUsageList,
      },
    });
  }

  it('matches the tab model rather than the costliest usage row and resolves CLI marks', () => {
    const tab = restoredTab([
      {
        model: 'other',
        inputTokens: 0,
        outputTokens: 0,
        costUSD: 10,
        contextCapacity: {
          providerId: 'anthropic',
          tokens: 200000,
          source: 'provider-catalog',
          model: 'other',
        },
      },
      {
        model: 'claude',
        inputTokens: 0,
        outputTokens: 0,
        costUSD: 0,
        contextCapacity: {
          providerId: 'openrouter',
          tokens: 200000,
          source: 'provider-catalog',
          model: 'claude',
        },
      },
    ]);
    const input = inputForTab(tab, [
      {
        agentId: 'pi-1',
        cli: 'pi',
        parentSessionId: 'root',
        status: 'running',
        startedAt: 1,
      } as MonitoredAgent,
      {
        agentId: 'ptah-1',
        cli: 'ptah-cli',
        ptahCliId: 'custom-agent-id',
        parentSessionId: 'root',
        status: 'running',
        startedAt: 1,
      } as MonitoredAgent,
    ]);
    expect(input.rootProviderId).toBe('openrouter');
    expect(input.agents[0].providerId).toBe('pi');
    expect(input.agents[1].providerId).toBe('ptah-cli');
  });

  it('returns no provider when the matching usage row has no provider ID', () => {
    const input = inputForTab(
      restoredTab([
        {
          model: 'claude',
          inputTokens: 0,
          outputTokens: 0,
          costUSD: 0,
          contextCapacity: {
            providerId: null,
            tokens: 200000,
            source: 'unknown',
            model: 'claude',
          },
        },
      ]),
    );
    expect(input.rootProviderId).toBeUndefined();
  });

  it('returns no provider for an empty usage list', () => {
    expect(inputForTab(restoredTab([])).rootProviderId).toBeUndefined();
  });
  it('uses persisted provider without a model and keeps live evidence first', () => {
    const tab = {
      ...restoredTab([]),
      sessionModel: undefined,
      overrideModel: undefined,
      providerId: 'openrouter',
    };
    expect(inputForTab(tab).rootProviderId).toBe('openrouter');
  });
  it('keeps live provider evidence ahead of persisted metadata', () => {
    const tab = { ...restoredTab([]), providerId: 'openrouter' };
    expect(
      inputForTab({
        ...tab,
        liveModelStats: {
          model: 'claude',
          contextCapacity: {
            providerId: 'anthropic',
            tokens: 200000,
            source: 'provider-catalog',
            model: 'claude',
          },
        },
      } as TabState).rootProviderId,
    ).toBe('anthropic');
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

});
