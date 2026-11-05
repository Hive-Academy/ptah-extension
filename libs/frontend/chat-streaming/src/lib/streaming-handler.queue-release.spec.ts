import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SessionId, type FlatStreamEventUnion, type TurnStateEvent } from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import fixture from './__fixtures__/lane-order/live-assistant-text-block-complete-no-stopReason.json';
import { StreamingHandlerService } from './streaming-handler.service';
import { StreamingAccumulatorCore } from './accumulator-core.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { BatchedUpdateService } from './batched-update.service';
import { MessageFinalizationService } from './message-finalization.service';
import { BackgroundAgentStore } from './background-agent.store';
import { AgentMonitorStore } from './agent-monitor.store';
import { SessionManager } from './session-manager.service';
import { TurnStateApplier } from './turn-state-applier.service';
import { SubagentExecutionStore } from './subagent-execution.store';

const sid = SessionId.create();
const id = 'tab-release';
function setup() {
  TestBed.resetTestingModule();
  const initial = {
    id, title: 'Release', name: 'Release', status: 'streaming',
    messages: [], streamingState: { events: new Map() }, currentMessageId: null,
    claudeSessionId: sid, lastTurnStateRevision: 0,
  } as TabState;
  const tabs = signal<TabState[]>([initial]);
  const tabManager = {
    tabs: computed(() => tabs()), activeTab: computed(() => tabs()[0] ?? null),
    isTabStreaming: jest.fn(() => false),
    findTabsBySessionId: (session: string) => tabs().filter((tab) => tab.claudeSessionId === session),
    findTabByIdAcrossWorkspaces: (tabId: string) => {
      const tab = tabs().find((item) => item.id === tabId);
      return tab ? { tab, workspacePath: 'D:/repo' } : null;
    },
  };
  const applier = {
    apply: jest.fn((event: TurnStateEvent) => {
      tabs.update((current) => current.map((tab) => ({
        ...tab, status: 'loaded', lastTurnStateRevision: event.revision,
      })));
    }),
  };
  TestBed.configureTestingModule({ providers: [
    StreamingHandlerService,
    { provide: TabManagerService, useValue: tabManager },
    { provide: TurnStateApplier, useValue: applier },
    { provide: SubagentExecutionStore, useValue: { claim: () => false } },
    { provide: StreamingAccumulatorCore, useValue: {
      process: (_state: object, event: FlatStreamEventUnion) => ({
        eventType: event.eventType, stateMutated: false,
      }),
    } },
    { provide: EventDeduplicationService, useValue: {} },
    { provide: BatchedUpdateService, useValue: { scheduleUpdate: jest.fn() } },
    { provide: MessageFinalizationService, useValue: {} },
    { provide: BackgroundAgentStore, useValue: {} },
    { provide: AgentMonitorStore, useValue: {} },
    { provide: SessionManager, useValue: {} },
  ] });
  return { service: TestBed.inject(StreamingHandlerService), tabs, applier, tabManager };
}
function terminal(revision: number): TurnStateEvent {
  return {
    id: `terminal-${revision}`, eventType: 'turn_state', timestamp: revision + 100,
    sessionId: sid, messageId: `turn-${revision}`, source: 'stream',
    phase: 'idle', revision, terminalReason: 'completed', backgroundTasks: [], sessionCrons: [],
  };
}
function fixtureEvents(): FlatStreamEventUnion[] {
  return fixture.flatMap((row, index): FlatStreamEventUnion[] => {
    const base = {
      id: `fixture-${index}`, timestamp: Date.parse(row.t), sessionId: sid,
      source: row.source === 'stream' ? 'stream' as const : 'complete' as const,
      messageId: row.messageId ?? 'assistant',
    };
    if (row.eventType === 'message_start') {
      return [{ ...base, eventType: 'message_start',
        role: 'role' in row && row.role === 'user' ? 'user' : 'assistant' }];
    }
    if (row.eventType === 'text_delta') {
      return [{ ...base, eventType: 'text_delta',
        delta: 'delta' in row && typeof row.delta === 'string' ? row.delta : '',
        blockIndex: 0 }];
    }
    if (row.eventType === 'message_complete') {
      return [{ ...base, eventType: 'message_complete' }];
    }
    return [];
  });
}

/**
 * TASK_2026_884: follow-ups are owned by the backend queue. A terminal
 * `turn_state` or a stats push only updates the tab; it never hands a queued
 * prompt back to ChatStore to send, so a hidden tab can no longer hold one.
 */
describe('StreamingHandlerService releases no queued prompt', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('replays the live assistant completes and the terminal turn_state with no queue result', () => {
    const h = setup();
    const capturedEvents = fixtureEvents();
    expect(capturedEvents.filter((event) => event.eventType === 'message_complete')).toHaveLength(3);
    for (const event of capturedEvents) {
      expect(h.service.processStreamEvent(event, id)).toBeNull();
    }
    expect(h.service.processStreamEvent(terminal(1), id)).toBeNull();
    expect(h.applier.apply).toHaveBeenCalledTimes(1);
    expect(h.tabs()[0].status).toBe('loaded');
  });

  it('returns nothing for a repeated terminal either', () => {
    const h = setup();
    expect(h.service.processStreamEvent(terminal(1), id)).toBeNull();
    expect(h.service.processStreamEvent(terminal(1), id)).toBeNull();
    expect(h.service.processStreamEvent(terminal(2), id)).toBeNull();
  });

  it('a stats push merges footer data and releases nothing', () => {
    const h = setup();
    h.tabs.update((tabs) => tabs.map((tab) => ({
      ...tab, streamingState: null, status: 'loaded',
    })));
    expect(h.service.handleSessionStats({
      sessionId: sid, turnCost: 0.1, tokens: { input: 1, output: 1 }, duration: 10,
    })).toBeUndefined();
  });
});
