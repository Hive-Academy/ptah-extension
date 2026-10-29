import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  SessionId,
  createExecutionChatMessage,
  type ExecutionChatMessage,
  type FlatStreamEventUnion,
  type MessageStartEvent,
  type TurnStateEvent,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { StreamingState, TabState } from '@ptah-extension/chat-types';
import { StreamingHandlerService } from './streaming-handler.service';
import { StreamingAccumulatorCore } from './accumulator-core.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { MessageFinalizationService } from './message-finalization.service';
import { HistoryMessageBuilder } from './history-message-builder.service';
import { BackgroundAgentStore } from './background-agent.store';
import { AgentMonitorStore } from './agent-monitor.store';
import { SessionManager } from './session-manager.service';
import { BatchedUpdateService } from './batched-update.service';
import { TurnStateApplier } from './turn-state-applier.service';
import { SubagentExecutionStore } from './subagent-execution.store';
import { QueuedPromptRecord } from './queued-prompt-record.service';

const sid = SessionId.create();
const tabId = 'lane-order-tab';
const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const bubble = (id: string, peer = false): ExecutionChatMessage =>
  createExecutionChatMessage({
    id,
    role: 'user',
    rawContent: id,
    sessionId: sid,
    ...(peer ? { inboundPeer: { label: 'lane' } } : {}),
  });
const answer = (id: string): ExecutionChatMessage =>
  createExecutionChatMessage({ id, role: 'assistant', rawContent: id, sessionId: sid });

class Tabs {
  readonly active = signal<TabState[]>([]);
  readonly background = signal<TabState[]>([]);
  readonly tabs = computed(() => this.active());
  readonly activeTab = computed(() => this.active()[0] ?? null);
  readonly activeTabId = computed(() => this.active()[0]?.id ?? null);
  readonly acknowledgeUserPrompt = jest.fn((id: string, clientId: string, nativeId: string) => {
    const tab = this.find(id);
    if (tab) this.setMessages(id, tab.messages.map((m) =>
      m.id === clientId && m.role === 'user' && !m.inboundPeer && !m.nativeUuid
        ? { ...m, nativeUuid: nativeId } : m));
  });
  readonly reconcileUserMessageNativeUuid = jest.fn((id: string, nativeId: string, exclude: ReadonlySet<string>) => {
    const tab = this.find(id);
    if (!tab) return;
    const index = tab.messages.findIndex((m) =>
      m.role === 'user' && !m.inboundPeer && !m.nativeUuid && !exclude.has(m.id));
    if (index >= 0) this.setMessages(id, tab.messages.map((m, i) =>
      i === index ? { ...m, nativeUuid: nativeId } : m));
  });
  find(id: string): TabState | undefined {
    return [...this.active(), ...this.background()].find((tab) => tab.id === id);
  }
  write(id: string, patch: Partial<TabState>): boolean {
    const update = (tabs: TabState[]): TabState[] => tabs.map((tab) =>
      tab.id === id ? { ...tab, ...patch } : tab);
    if (this.active().some((tab) => tab.id === id)) this.active.update(update);
    else this.background.update(update);
    return true;
  }
  findTabByIdAcrossWorkspaces = (id: string) => {
    const tab = this.find(id);
    return tab ? { tab, workspacePath: 'D:/repo' } : null;
  };
  findTabBySessionIdAcrossWorkspaces = (session: string) => {
    const tab = this.background().find((t) => t.claudeSessionId === session);
    return tab ? { tab, workspacePath: 'D:/other' } : null;
  };
  findTabsBySessionId = (session: string): TabState[] =>
    this.active().filter((tab) => tab.claudeSessionId === session);
  attachSession = (id: string, session: string): void => { this.write(id, { claudeSessionId: session }); };
  setStreamingState = (id: string, state: StreamingState | null): void => { this.write(id, { streamingState: state }); };
  setMessages = (id: string, messages: ExecutionChatMessage[]): void => { this.write(id, { messages }); };
  updateBackgroundTab = (id: string, patch: Partial<TabState>): boolean => this.write(id, patch);
  applyFinalizedTurn = (id: string, messages: ExecutionChatMessage[]): void => {
    this.write(id, { messages, streamingState: null, currentMessageId: null });
  };
  clearStreamingForLoaded = (id: string): void => { this.write(id, { streamingState: null }); };
}

function makeTab(messages: ExecutionChatMessage[] = []): TabState {
  return {
    id: tabId, title: 'Lane', name: 'Lane', status: 'loaded', messages,
    streamingState: null, currentMessageId: null, claudeSessionId: sid,
  } as TabState;
}

function setup(messages: ExecutionChatMessage[] = []) {
  TestBed.resetTestingModule();
  const tabs = new Tabs();
  tabs.active.set([makeTab(messages)]);
  const queued = new QueuedPromptRecord();
  const applier = { apply: jest.fn((event: TurnStateEvent, id?: string) => {
    if (event.consumedClientMessageId) queued.remove(id ?? tabId, event.consumedClientMessageId);
    tabs.write(id ?? tabId, { lastTurnStateRevision: event.revision, status: 'loaded' });
  }) };
  TestBed.configureTestingModule({ providers: [
    StreamingHandlerService, StreamingAccumulatorCore, EventDeduplicationService,
    ExecutionTreeBuilderService, MessageFinalizationService, HistoryMessageBuilder,
    BackgroundAgentStore,
    { provide: TabManagerService, useValue: tabs },
    { provide: QueuedPromptRecord, useValue: queued },
    { provide: TurnStateApplier, useValue: applier },
    { provide: SubagentExecutionStore, useValue: { claim: () => false } },
    { provide: SessionManager, useValue: {
      setSessionId: jest.fn(), setStatus: jest.fn(), registerAgent: jest.fn(() => []), clearNodeMaps: jest.fn(),
    } },
    { provide: BatchedUpdateService, useValue: {
      scheduleUpdate: jest.fn(), flushSync: jest.fn(), clearPendingUpdates: jest.fn(), queuedState: jest.fn(() => undefined),
    } },
    { provide: AgentMonitorStore, useValue: {
      markAgentNodesResumed: jest.fn(), onAgentStart: jest.fn(), onAgentProgress: jest.fn(),
      onAgentStatus: jest.fn(), onAgentCompleted: jest.fn(), onSubagentMessageComplete: jest.fn(),
      getSubagent: jest.fn(() => undefined), onTaskToolResult: jest.fn(),
      onBackgroundAgentStarted: jest.fn(), onBackgroundAgentCompleted: jest.fn(),
      onBackgroundAgentStopped: jest.fn(), registerHistoryCandidates: jest.fn(),
    } },
  ] });
  return { tabs, queued, service: TestBed.inject(StreamingHandlerService) };
}

let serial = 0;
function events(id: string, role: 'user' | 'assistant', extra: Partial<MessageStartEvent> = {}): FlatStreamEventUnion[] {
  const sequence = ++serial;
  return [
    { id: `${sequence}-start`, eventType: 'message_start', timestamp: sequence * 10,
      sessionId: sid, source: 'complete', messageId: id, role, ...extra },
    { id: `${sequence}-text`, eventType: 'text_delta', timestamp: sequence * 10 + 1,
      sessionId: sid, source: 'complete', messageId: id, delta: id, blockIndex: 0 },
    { id: `${sequence}-end`, eventType: 'message_complete', timestamp: sequence * 10 + 2,
      sessionId: sid, source: 'complete', messageId: id },
  ];
}
function ingest(service: StreamingHandlerService, list: FlatStreamEventUnion[], background = false): void {
  for (const event of list) service.processStreamEvent(event, background ? undefined : tabId);
}
function peer(h: ReturnType<typeof setup>, id: string, before?: string, background = false): void {
  ingest(h.service, events(id, 'user', { inboundPeer: { label: 'lane', ...(before ? { beforeClientMessageId: before } : {}) } }), background);
}
function reply(h: ReturnType<typeof setup>, id: string): string {
  const stream = events(id, 'assistant');
  ingest(h.service, stream);
  h.service.finalizeCurrentMessage(tabId);
  return stream[0].id;
}
function pending(h: ReturnType<typeof setup>, id: string): void {
  const tab = h.tabs.find(tabId);
  if (!tab) throw new Error('missing tab');
  const message = bubble(id);
  h.tabs.setMessages(tabId, [...tab.messages, message]);
  h.service.recordUserPromptBoundary(tabId, message);
}
function echo(h: ReturnType<typeof setup>, id: string, clientId?: string, background = false): void {
  ingest(h.service, [events(id, 'user', clientId ? { clientMessageId: clientId } : {})[0]], background);
}
function terminal(h: ReturnType<typeof setup>, id?: string, revision = 1, reason: TurnStateEvent['terminalReason'] = 'completed'): void {
  h.service.processStreamEvent({
    id: `terminal-${++serial}`, eventType: 'turn_state', timestamp: serial * 10,
    sessionId: sid, messageId: `turn-${serial}`, source: 'stream', phase: 'idle',
    revision, terminalReason: reason, backgroundTasks: [], sessionCrons: [],
    ...(id ? { consumedClientMessageId: id } : {}),
  }, tabId);
}
function ids(h: ReturnType<typeof setup>): string[] {
  return h.tabs.find(tabId)?.messages.map((message) => message.id) ?? [];
}
function reload(h: ReturnType<typeof setup>): ReturnType<typeof setup> {
  // The next TestBed has a fresh prompt record; transcript ids survive.
  return setup(h.tabs.find(tabId)?.messages ?? []);
}

describe('StreamingHandlerService lane order matrix', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('M1 report and completion without a pending prompt', () => {
    const h = setup([bubble('U0'), answer('A0')]);
    peer(h, uuid(1)); const ar = reply(h, 'A_R');
    peer(h, uuid(2)); const ac = reply(h, 'A_C');
    expect(ids(h)).toEqual(['U0', 'A0', uuid(1), ar, uuid(2), ac]);
  });
  it.each(['M2 prompt before report', 'M3 prompt after report'])(
    '%s waits behind both peer turns', (scenario) => {
      const h = setup([bubble('U0'), answer('A0')]);
      if (scenario.startsWith('M2')) pending(h, 'P');
      peer(h, uuid(3)); const ar = reply(h, 'A_R');
      if (scenario.startsWith('M3')) pending(h, 'P');
      peer(h, uuid(4)); const ac = reply(h, 'A_C');
      expect(ids(h)).toEqual(['U0', 'A0', uuid(3), ar, uuid(4), ac, 'P']);
    },
  );
  it('M4 idle prompt is still pending before its echo', () => {
    const h = setup(); pending(h, 'P'); echo(h, uuid(5), 'P');
    const ap = reply(h, 'A_P'); peer(h, uuid(6)); const ar = reply(h, 'A_R');
    expect(ids(h)).toEqual(['P', ap, uuid(6), ar]);
    expect(h.tabs.find(tabId)?.messages[0].nativeUuid).toBe(uuid(5));
  });
  it('M5 several reports and completion precede a queued prompt', () => {
    const h = setup(); pending(h, 'P');
    peer(h, uuid(7)); const a1 = reply(h, 'A1');
    peer(h, uuid(8)); const a2 = reply(h, 'A2');
    peer(h, uuid(9)); const a3 = reply(h, 'A3');
    expect(ids(h)).toEqual([uuid(7), a1, uuid(8), a2, uuid(9), a3, 'P']);
  });
  it('M6 idle peer arrival appends', () => {
    const h = setup([bubble('U0')]); peer(h, uuid(10)); const ar = reply(h, 'A_R');
    expect(ids(h)).toEqual(['U0', uuid(10), ar]);
  });
  it('M7 errored prompt is retired by its echo before a report', () => {
    const h = setup(); pending(h, 'P'); echo(h, uuid(11), 'P'); peer(h, uuid(12));
    expect(ids(h)).toEqual(['P', uuid(12)]);
    expect(h.queued.queuedAtTail(tabId, h.tabs.find(tabId)?.messages ?? [])).not.toContain('P');
  });
  it('M8a reload before two peer echoes uses their persisted before hint', () => {
    const first = setup([bubble('U0'), answer('A0')]); pending(first, 'P');
    const h = reload(first); peer(h, uuid(13), 'P'); const ar = reply(h, 'A_R');
    peer(h, uuid(14), 'P'); const ac = reply(h, 'A_C');
    expect(ids(h)).toEqual(['U0', 'A0', uuid(13), ar, uuid(14), ac, 'P']);
  });
  it('M8b reload with two held peers and two prompts retains FIFO', () => {
    const first = setup(); pending(first, 'P1'); pending(first, 'P2');
    const h = reload(first); peer(h, uuid(15), 'P1'); const ar1 = reply(h, 'A_R1');
    peer(h, uuid(16), 'P1'); const ar2 = reply(h, 'A_R2');
    expect(ids(h)).toEqual([uuid(15), ar1, uuid(16), ar2, 'P1', 'P2']);
  });
  it('M8c prompt consumed during reload gap leaves no hint', () => {
    const first = setup(); pending(first, 'P');
    const h = reload(first); peer(h, uuid(17));
    expect(ids(h)).toEqual(['P', uuid(17)]);
  });
  it('M8d finished transcript round trip keeps order', () => {
    const first = setup([bubble('U0')]); peer(first, uuid(18));
    expect(ids(reload(first))).toEqual(ids(first));
  });
  it('M10 failed send does not own a later echo', () => {
    const h = setup([bubble('F')]); pending(h, 'P');
    echo(h, uuid(19), 'P'); terminal(h, 'P'); peer(h, uuid(20));
    expect(ids(h)).toEqual(['F', 'P', uuid(20)]);
    expect(h.tabs.find(tabId)?.messages[0].nativeUuid).toBeUndefined();
  });
  it('M11 only the named prompt is acknowledged', () => {
    const h = setup(); pending(h, 'P1'); pending(h, 'P2');
    echo(h, uuid(21), 'P1'); peer(h, uuid(22), 'P2');
    expect(ids(h)).toEqual(['P1', uuid(22), 'P2']);
    expect(h.tabs.find(tabId)?.messages[0].nativeUuid).toBe(uuid(21));
  });
  it('M12 background workspace routes peer and exact human echo', () => {
    const h = setup(); pending(h, 'P');
    const tab = h.tabs.active()[0]; h.tabs.active.set([]); h.tabs.background.set([tab]);
    peer(h, uuid(23), 'P', true); echo(h, uuid(24), 'P', true);
    expect(ids(h)).toEqual([uuid(23), 'P']);
    expect(h.tabs.find(tabId)?.messages.find((m) => m.id === 'P')?.nativeUuid).toBe(uuid(24));
  });
  it('M13 unkeyed echo skips a pending prompt', () => {
    const h = setup(); pending(h, 'P'); echo(h, uuid(25));
    expect(h.tabs.find(tabId)?.messages[0].nativeUuid).toBeUndefined();
  });
  it.each(['M14 no echo', 'M15 suppressed echo'])(
    '%s retires at consuming terminal', () => {
      const h = setup(); pending(h, 'P'); terminal(h, 'P'); peer(h, uuid(26));
      expect(ids(h)).toEqual(['P', uuid(26)]);
    },
  );
  it('M16 router handled prompt retires without enqueued turn', () => {
    const h = setup(); pending(h, 'P'); h.service.retirePendingPrompt(tabId, 'P'); peer(h, uuid(27));
    expect(ids(h)).toEqual(['P', uuid(27)]);
  });
  it.each(['M17 no echo', 'M17 suppressed echo', 'M17 router handled'])(
    '%s remains ordered after renderer recreation', (scenario) => {
      const first = setup(); pending(first, 'P');
      if (scenario.includes('router')) first.service.retirePendingPrompt(tabId, 'P');
      else terminal(first, 'P');
      const h = reload(first); peer(h, uuid(28));
      expect(ids(h)).toEqual(['P', uuid(28)]);
    },
  );
  it('M18 terminal retires only its named id', () => {
    const h = setup(); pending(h, 'P0'); pending(h, 'P1'); pending(h, 'P2');
    terminal(h, 'P0', 1); terminal(h, 'P1', 2); peer(h, uuid(29), 'P2');
    expect(ids(h)).toEqual(['P0', 'P1', uuid(29), 'P2']);
    expect([...h.queued.queuedAtTail(tabId, h.tabs.find(tabId)?.messages ?? [])]).toEqual(['P2']);
  });
  it('M19 delayed terminal for P cannot retire echoed Q', () => {
    const h = setup(); pending(h, 'P'); pending(h, 'Q');
    echo(h, uuid(30), 'Q'); terminal(h, 'P'); peer(h, uuid(31));
    expect(ids(h)).toEqual(['P', 'Q', uuid(31)]);
    expect(h.tabs.find(tabId)?.messages[1].nativeUuid).toBe(uuid(30));
  });
  it('M20 interrupt terminal retires P without clearing later prompts', () => {
    const h = setup(); pending(h, 'P'); pending(h, 'F'); pending(h, 'L');
    terminal(h, 'P', 1, 'aborted_streaming'); echo(h, uuid(32), 'F');
    peer(h, uuid(33), 'L');
    expect(ids(h)).toEqual(['P', 'F', uuid(33), 'L']);
    expect([...h.queued.queuedAtTail(tabId, h.tabs.find(tabId)?.messages ?? [])]).toEqual(['L']);
  });
  it.each(['M21 delayed terminal', 'M21 interrupt'])(
    '%s stays ordered across renderer recreation', (scenario) => {
      const first = setup(); pending(first, 'P'); pending(first, 'Q');
      if (scenario.includes('delayed')) {
        echo(first, uuid(35), 'Q');
        terminal(first, 'P');
      } else {
        terminal(first, 'P', 1, 'aborted_streaming');
        echo(first, uuid(36), 'Q');
      }
      const h = reload(first); peer(h, uuid(34));
      expect(ids(h)).toEqual(['P', 'Q', uuid(34)]);
      expect(h.tabs.find(tabId)?.messages[1].nativeUuid).toBe(
        scenario.includes('delayed') ? uuid(35) : uuid(36),
      );
    },
  );
});
