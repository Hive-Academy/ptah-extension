import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
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
import { CommandCenterProjectionSource } from './command-center-projection.source';

describe('CommandCenterProjectionSource', () => {
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
    const chat = Object.assign(Object.create(null) as ChatStore, {
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
      agents: signal([cli, unrelated]),
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
    const input = TestBed.inject(CommandCenterProjectionSource).input({
      tabId: 'root-tab',
      sessionId: 'root-session',
    });
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
    expect(input.runs).toEqual([
      expect.objectContaining({
        runId: '11111111-1111-4111-8111-111111111111',
        rootSessionId: 'root-session',
      }),
    ]);
    expect(readRunManifests).toHaveBeenCalledWith('/workspace', 'root-tab');
  });
});
