import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import {
  SessionId,
  TabId,
  type ExecutionChatMessage,
  type SessionStatsEntry,
} from '@ptah-extension/shared';
import { SessionAgentRosterService } from '../session-agents/session-agent-roster.service';
import { SessionInspectorStore } from './session-inspector.store';

function stats(overrides: Partial<SessionStatsEntry> = {}): SessionStatsEntry {
  return {
    sessionId: 'session',
    model: 'model',
    totalCost: 1,
    tokens: { input: 10, output: 20, cacheRead: 30, cacheCreation: 40 },
    messageCount: 2,
    status: 'ok',
    ...overrides,
  };
}

function message(role: ExecutionChatMessage['role'], id: string): ExecutionChatMessage {
  return { id, role, timestamp: 1, streamingState: null };
}

function tab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: TabId.create(),
    claudeSessionId: SessionId.create(),
    name: 'Session',
    title: 'Session',
    order: 0,
    status: 'idle',
    isDirty: false,
    lastActivityAt: 1,
    messages: [],
    streamingState: null,
    ...overrides,
  };
}

describe('SessionInspectorStore', () => {
  const revision = signal(0);
  const tabs = new Map<string, TabState>();
  let store: SessionInspectorStore;

  beforeEach(() => {
    tabs.clear();
    revision.set(0);
    TestBed.configureTestingModule({
      providers: [
        SessionInspectorStore,
        {
          provide: TabManagerService,
          useValue: {
            backgroundTabsRevision: revision,
            findTabByIdAcrossWorkspaces: (id: string) => {
              const current = tabs.get(id);
              return current ? { tab: current, workspacePath: 'workspace' } : null;
            },
            onTabClosed: () => () => undefined,
          },
        },
        {
          provide: SessionAgentRosterService,
          useValue: {
            roster: () => [],
            requestsForTab: () => ({ permissions: [], questions: [] }),
          },
        },
        {
          provide: AgentMonitorStore,
          useValue: { agentsById: signal(new Map()) },
        },
      ],
    });
    store = TestBed.inject(SessionInspectorStore);
  });

  function put(current: TabState): void {
    tabs.set(current.id, current);
    revision.update((value) => value + 1);
  }

  it('reports unavailable tokens when the host omits tokenCount', () => {
    const current = tab({ sessionStats: stats() });
    put(current);
    expect(store.modelFor(current.id)().orchestrator.tokens).toBeNull();
  });

  it('uses the host tokenCount without summing the token classes', () => {
    const current = tab({ sessionStats: stats({ tokenCount: 123 }) });
    put(current);
    expect(store.modelFor(current.id)().orchestrator.tokens).toBe(123);
  });

  it('derives F2 as 65% from a trusted same-model window', () => {
    const current = tab({
      liveModelStats: {
        model: 'model', contextKnown: true, contextUsed: 130_000,
        contextWindow: 200_000, contextPercent: 0,
        contextCapacity: {
          tokens: 200_000, source: 'sdk-native', providerId: null, model: 'model',
        },
      },
    });
    put(current);
    expect(store.modelFor(current.id)().orchestrator).toMatchObject({
      contextPercent: 65, contextWindow: 200_000,
    });
  });

  it.each([
    { contextKnown: false, contextUsed: 0 },
    { contextKnown: true, contextUsed: 130_000 },
  ])('reports F6 as unknown for $contextKnown', ({ contextKnown, contextUsed }) => {
    const current = tab({
      liveModelStats: {
        model: 'model', contextKnown, contextUsed,
        contextWindow: 0, contextPercent: 0,
        contextCapacity: {
          tokens: null, source: 'unknown', providerId: null, model: 'model',
        },
      },
    });
    put(current);
    expect(store.modelFor(current.id)().orchestrator).toMatchObject({
      contextPercent: null, contextWindow: null,
    });
  });

  it.each([
    { hostTurns: 7, cursor: 'older', expected: 7 },
    { hostTurns: undefined, cursor: null, expected: 2 },
    { hostTurns: undefined, cursor: 'older', expected: null },
    { hostTurns: 0, cursor: 'older', expected: 0 },
  ])('resolves turns with host $hostTurns and cursor $cursor', ({ hostTurns, cursor, expected }) => {
    const current = tab({
      sessionStats: stats({ turnCount: hostTurns }),
      olderHistoryCursor: cursor,
      messages: [message('user', 'u1'), message('assistant', 'a1'), message('user', 'u2')],
    });
    put(current);
    expect(store.modelFor(current.id)().orchestrator.turns).toBe(expected);
  });

  it('re-evaluates a background tab update and clears stats after workspace removal', () => {
    const current = tab({ sessionStats: stats({ tokenCount: 20 }) });
    put(current);
    const model = store.modelFor(current.id);
    expect(model().orchestrator.tokens).toBe(20);

    put({ ...current, sessionStats: stats({ tokenCount: 30, turnCount: 7 }) });
    expect(model().orchestrator).toMatchObject({ tokens: 30, turns: 7 });

    tabs.delete(current.id);
    revision.update((value) => value + 1);
    expect(model().orchestrator).toMatchObject({
      tokens: null, cost: null, turns: null, contextPercent: null,
    });
  });
});
