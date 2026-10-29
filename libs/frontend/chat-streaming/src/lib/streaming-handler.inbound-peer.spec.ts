/**
 * Inbound peer turns (lane reports and lane completions) in the live path.
 *
 * A lane pushes `<agent-report>` / `<agent-lane-completed>` into its parent
 * session; the backend starts a new SDK turn with a peer user message
 * (`message_start` role `user` with `inboundPeer`). These specs run the real
 * ingest → accumulate → finalize stack (only the tab store, batching and
 * monitor collaborators are faked) and pin:
 *   - live vs replay parity of the resulting transcript;
 *   - a queued prompt stays held through the peer echo and reply;
 *   - a peer echo never stamps its uuid on the user's own bubble;
 *   - a prompt queued behind the peer turn lands after the peer's reply;
 *   - a backgrounded tab receives the peer message too.
 */

import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import {
  SessionId,
  createExecutionChatMessage,
  type EventSource,
  type ExecutionChatMessage,
  type FlatStreamEventUnion,
  type MessageCompleteEvent,
  type MessageStartEvent,
  type TextDeltaEvent,
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
import { QueuedPromptRecord } from './queued-prompt-record.service';
import { SubagentExecutionStore } from './subagent-execution.store';

const TAB_ID = 'tab-peer';
const SESSION_ID = SessionId.create();
const LINE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

/** One SDK turn: its user input (a prompt or a peer envelope) and a reply. */
interface TurnSpec {
  readonly userId: string;
  readonly userText: string;
  readonly peerLabel?: string;
  readonly replyId: string;
  readonly replyText: string;
}

const report = (agentId: string, agent: string, body: string): string =>
  `<agent-report agent-id="${agentId}" agent="${agent}" cli="codex">\n${body}\n</agent-report>`;

const completion = (agentId: string, agent: string, verdict: string): string =>
  `<agent-lane-completed agent-id="${agentId}" agent="${agent}" cli="codex" status="completed" verdict="${verdict}">\nLane finished.\n</agent-lane-completed>`;

const PROMPT: TurnSpec = {
  userId: uuid(1),
  userText: 'Run two lanes',
  replyId: 'msg_a1',
  replyText: 'Spawned both lanes.',
};

const PEER_TURNS: readonly TurnSpec[] = [
  {
    userId: uuid(2),
    userText: report('lane-a', 'reviewer', 'Found one issue.\nDetails below.'),
    peerLabel: 'codex · reviewer',
    replyId: 'msg_a2',
    replyText: 'Noted the review.',
  },
  {
    userId: uuid(3),
    userText: report('lane-b', 'tester', 'All tests pass.'),
    peerLabel: 'codex · tester',
    replyId: 'msg_a3',
    replyText: 'Noted the tests.',
  },
  {
    userId: uuid(4),
    userText: completion('lane-a', 'reviewer', 'PASS'),
    peerLabel: 'codex · reviewer',
    replyId: 'msg_a4',
    replyText: 'Reviewer is done.',
  },
  {
    userId: uuid(5),
    userText: completion('lane-b', 'tester', 'PASS'),
    peerLabel: 'codex · tester',
    replyId: 'msg_a5',
    replyText: 'Tester is done.',
  },
];

/**
 * The events of one turn, in wire order. Live turns use the sources the
 * backend sends (`complete` for the user echo, `stream` for the reply);
 * replayed turns use `history`. Ids and timestamps are the same in both.
 */
function turnEvents(
  turn: TurnSpec,
  mode: 'live' | 'replay',
  clock: number,
): FlatStreamEventUnion[] {
  const userSource: EventSource = mode === 'live' ? 'complete' : 'history';
  const replySource: EventSource = mode === 'live' ? 'stream' : 'history';
  const userStart: MessageStartEvent = {
    id: `${turn.userId}-start`,
    eventType: 'message_start',
    timestamp: clock,
    sessionId: SESSION_ID,
    source: userSource,
    messageId: turn.userId,
    role: 'user',
    ...(turn.peerLabel ? { inboundPeer: { label: turn.peerLabel } } : {}),
  };
  const userText: TextDeltaEvent = {
    id: `${turn.userId}-text`,
    eventType: 'text_delta',
    timestamp: clock + 1,
    sessionId: SESSION_ID,
    source: userSource,
    messageId: turn.userId,
    delta: turn.userText,
    blockIndex: 0,
  };
  const userComplete: MessageCompleteEvent = {
    id: `${turn.userId}-complete`,
    eventType: 'message_complete',
    timestamp: clock + 2,
    sessionId: SESSION_ID,
    source: userSource,
    messageId: turn.userId,
  };
  const replyStart: MessageStartEvent = {
    id: `${turn.replyId}-start`,
    eventType: 'message_start',
    timestamp: clock + 3,
    sessionId: SESSION_ID,
    source: replySource,
    messageId: turn.replyId,
    role: 'assistant',
  };
  const replyText: TextDeltaEvent = {
    id: `${turn.replyId}-text`,
    eventType: 'text_delta',
    timestamp: clock + 4,
    sessionId: SESSION_ID,
    source: replySource,
    messageId: turn.replyId,
    delta: turn.replyText,
    blockIndex: 0,
  };
  const replyComplete: MessageCompleteEvent = {
    id: `${turn.replyId}-complete`,
    eventType: 'message_complete',
    timestamp: clock + 5,
    sessionId: SESSION_ID,
    source: replySource,
    messageId: turn.replyId,
    stopReason: 'end_turn',
    tokenUsage: { input: 1, output: 1 },
  };
  return [
    userStart,
    userText,
    userComplete,
    replyStart,
    replyText,
    replyComplete,
  ];
}

/** A turn's user-echo events and its reply events. */
function splitTurn(events: FlatStreamEventUnion[]): {
  readonly user: FlatStreamEventUnion[];
  readonly reply: FlatStreamEventUnion[];
} {
  return { user: events.slice(0, 3), reply: events.slice(3) };
}

/**
 * The tab store the stack writes through. Active and background tabs live in
 * separate lists so the workspace-aware paths can be told apart.
 */
class FakeTabStore {
  readonly active = signal<TabState[]>([]);
  readonly background = signal<TabState[]>([]);
  readonly tabs = computed(() => this.active());
  readonly activeTabId = computed(() => this.active()[0]?.id ?? null);
  readonly activeTab = computed(() => this.active()[0] ?? null);
  readonly reconcileUserMessageNativeUuid = jest.fn(
    (tabId: string, nativeUuid: string, excludeIds: ReadonlySet<string> = new Set()): void => {
      const tab = this.find(tabId);
      if (!tab) return;
      const index = tab.messages.findIndex(
        (m) => m.role === 'user' && !m.nativeUuid && !LINE_UUID.test(m.id) && !excludeIds.has(m.id),
      );
      if (index === -1) return;
      this.write(tabId, {
        messages: tab.messages.map((m, i) =>
          i === index ? { ...m, nativeUuid } : m,
        ),
      });
    },
  );
  readonly acknowledgeUserPrompt = jest.fn(
    (tabId: string, clientMessageId: string, nativeUuid: string): void => {
      const tab = this.find(tabId);
      if (!tab) return;
      this.write(tabId, {
        messages: tab.messages.map((m) =>
          m.id === clientMessageId ? { ...m, nativeUuid } : m,
        ),
      });
    },
  );

  find(tabId: string): TabState | undefined {
    return [...this.active(), ...this.background()].find((t) => t.id === tabId);
  }

  write(tabId: string, updates: Partial<TabState>): boolean {
    const apply = (tabs: TabState[]): TabState[] =>
      tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t));
    const inActive = this.active().some((t) => t.id === tabId);
    if (inActive) this.active.update(apply);
    else this.background.update(apply);
    return true;
  }

  findTabsBySessionId = (sid: string): TabState[] =>
    this.active().filter((t) => t.claudeSessionId === sid);
  findTabByIdAcrossWorkspaces = (
    tabId: string,
  ): { tab: TabState; workspacePath: string } | null => {
    const tab = this.find(tabId);
    return tab ? { tab, workspacePath: 'D:/repo' } : null;
  };
  findTabBySessionIdAcrossWorkspaces = (
    sid: string,
  ): { tab: TabState; workspacePath: string } | null => {
    const tab = this.background().find((t) => t.claudeSessionId === sid);
    return tab ? { tab, workspacePath: 'D:/other' } : null;
  };
  attachSession = (tabId: string, sid: string): void => {
    this.write(tabId, { claudeSessionId: sid });
  };
  setStreamingState = (tabId: string, state: StreamingState | null): void => {
    this.write(tabId, { streamingState: state });
  };
  setMessages = (tabId: string, messages: ExecutionChatMessage[]): void => {
    this.write(tabId, { messages });
  };
  updateBackgroundTab = (tabId: string, updates: Partial<TabState>): boolean =>
    this.write(tabId, updates);
  applyFinalizedTurn = (
    tabId: string,
    messages: ExecutionChatMessage[],
  ): void => {
    this.write(tabId, {
      messages,
      currentMessageId: null,
      streamingState: null,
    });
  };
  applyFinalizedHistory = (
    tabId: string,
    messages: ExecutionChatMessage[],
  ): void => {
    this.write(tabId, { messages, streamingState: null, status: 'loaded' });
  };
  clearStreamingForLoaded = (tabId: string): void => {
    this.write(tabId, { streamingState: null, currentMessageId: null });
  };
}

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: TAB_ID,
    title: 'Session',
    name: 'Session',
    status: 'streaming',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: SESSION_ID,
    ...overrides,
  } as TabState;
}

function optimisticPrompt(id: string, text: string): ExecutionChatMessage {
  return createExecutionChatMessage({
    id,
    role: 'user',
    rawContent: text,
    sessionId: SESSION_ID,
  });
}

function setup(): {
  readonly store: FakeTabStore;
  readonly service: StreamingHandlerService;
} {
  TestBed.resetTestingModule();
  const store = new FakeTabStore();
  TestBed.configureTestingModule({
    providers: [
      StreamingHandlerService,
      StreamingAccumulatorCore,
      EventDeduplicationService,
      ExecutionTreeBuilderService,
      MessageFinalizationService,
      HistoryMessageBuilder,
      BackgroundAgentStore,
      { provide: TabManagerService, useValue: store },
      {
        provide: SessionManager,
        useValue: {
          setSessionId: jest.fn(),
          setStatus: jest.fn(),
          registerAgent: jest.fn(() => []),
          clearNodeMaps: jest.fn(),
        },
      },
      {
        provide: BatchedUpdateService,
        // State is mutated in place and the tab holds the same object, so
        // there is nothing to publish; finalize reads the tab directly.
        useValue: {
          scheduleUpdate: jest.fn(),
          flushSync: jest.fn(),
          clearPendingUpdates: jest.fn(),
          queuedState: jest.fn(() => undefined),
        },
      },
      {
        provide: AgentMonitorStore,
        useValue: {
          markAgentNodesResumed: jest.fn(),
          onAgentStart: jest.fn(),
          onAgentProgress: jest.fn(),
          onAgentStatus: jest.fn(),
          onAgentCompleted: jest.fn(),
          onSubagentMessageComplete: jest.fn(),
          getSubagent: jest.fn(() => undefined),
          onTaskToolResult: jest.fn(),
          onBackgroundAgentStarted: jest.fn(),
          onBackgroundAgentCompleted: jest.fn(),
          onBackgroundAgentStopped: jest.fn(),
          registerHistoryCandidates: jest.fn(),
        },
      },
      { provide: TurnStateApplier, useValue: { apply: jest.fn() } },
      { provide: SubagentExecutionStore, useValue: { claim: () => false } },
    ],
  });
  return { store, service: TestBed.inject(StreamingHandlerService) };
}

/** Feed one live turn and settle it the way a terminal `turn_state` does. */
function runLiveTurn(
  service: StreamingHandlerService,
  events: readonly FlatStreamEventUnion[],
): void {
  for (const event of events) service.processStreamEvent(event, TAB_ID);
  service.finalizeCurrentMessage(TAB_ID);
}

/** The transcript as parity compares it: the prompt keyed by its SDK uuid. */
function comparable(messages: readonly ExecutionChatMessage[]) {
  return messages.map((m) => ({
    id: m.nativeUuid ?? m.id,
    role: m.role,
    inboundPeer: m.inboundPeer,
    rawContent: m.rawContent,
  }));
}

describe('StreamingHandlerService — inbound peer turns', () => {
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    TestBed.resetTestingModule();
  });

  it('builds the same transcript live as a history replay of the same turns', () => {
    const turns = [PROMPT, ...PEER_TURNS];

    // Live: the prompt starts as an optimistic bubble; every turn settles.
    const live = setup();
    live.store.active.set([
      makeTab({ messages: [optimisticPrompt('opt-1', PROMPT.userText)] }),
    ]);
    turns.forEach((turn, i) =>
      runLiveTurn(live.service, turnEvents(turn, 'live', 1_000 + i * 10)),
    );
    const liveMessages = live.store.find(TAB_ID)?.messages ?? [];

    // Replay: the same turns from history into a fresh tab.
    const replay = setup();
    replay.store.active.set([makeTab({ status: 'loaded' })]);
    turns.forEach((turn, i) => {
      for (const event of turnEvents(turn, 'replay', 1_000 + i * 10)) {
        replay.service.processStreamEvent(event, TAB_ID, SESSION_ID, {
          isReplay: true,
          fanOut: false,
        });
      }
    });
    const replayMessages = replay.service.finalizeSessionHistory(TAB_ID);

    expect(comparable(liveMessages)).toEqual(comparable(replayMessages));
    expect(liveMessages.map((m) => m.nativeUuid ?? m.id)).toEqual([
      PROMPT.userId,
      `${PROMPT.replyId}-start`,
      ...PEER_TURNS.flatMap((t) => [t.userId, `${t.replyId}-start`]),
    ]);
    const peers = liveMessages.filter((m) => m.inboundPeer);
    expect(peers.map((m) => m.rawContent)).toEqual(
      PEER_TURNS.map((t) => t.userText),
    );
    expect(peers.map((m) => m.inboundPeer?.label)).toEqual(
      PEER_TURNS.map((t) => t.peerLabel),
    );
  });

  it('adds a peer message once even when its events are delivered twice', () => {
    const { store, service } = setup();
    store.active.set([makeTab()]);
    const { user } = splitTurn(turnEvents(PEER_TURNS[0], 'live', 10));

    for (const event of [...user, ...user]) {
      service.processStreamEvent(event, TAB_ID);
    }

    expect(store.find(TAB_ID)?.messages.map((m) => m.id)).toEqual([
      PEER_TURNS[0].userId,
    ]);
  });

  it('holds a queued prompt through both the peer echo and reply', () => {
    const { store, service } = setup();
    store.active.set([makeTab({ queuedContent: 'next please' })]);
    const { user, reply } = splitTurn(turnEvents(PEER_TURNS[0], 'live', 10));

    const echoResults = user.map((e) => service.processStreamEvent(e, TAB_ID));
    expect(echoResults.every((r) => r === null)).toBe(true);

    const replyResults = reply.map((e) =>
      service.processStreamEvent(e, TAB_ID),
    );
    expect(replyResults.every((r) => r === null)).toBe(true);
  });

  it('never stamps a peer uuid or an unkeyed echo on a pending user bubble', () => {
    const { store, service } = setup();
    store.active.set([
      makeTab({ messages: [optimisticPrompt('opt-queued', 'later')] }),
    ]);
    service.recordUserPromptBoundary(TAB_ID, store.find(TAB_ID)?.messages[0] as ExecutionChatMessage);
    const peer = splitTurn(turnEvents(PEER_TURNS[0], 'live', 10));

    service.processStreamEvent(peer.user[0], TAB_ID);

    expect(store.reconcileUserMessageNativeUuid).not.toHaveBeenCalled();
    expect(store.find(TAB_ID)?.messages[0].nativeUuid).toBeUndefined();

    const prompt = splitTurn(
      turnEvents({ ...PROMPT, userId: uuid(9) }, 'live', 50),
    );
    service.processStreamEvent(prompt.user[0], TAB_ID);

    expect(store.reconcileUserMessageNativeUuid).toHaveBeenCalledWith(
      TAB_ID,
      uuid(9),
      expect.any(Set),
    );
    const bubble = store
      .find(TAB_ID)
      ?.messages.find((m) => m.id === 'opt-queued');
    expect(bubble?.nativeUuid).toBeUndefined();
  });

  /**
   * Run the first prompt's turn and send `opt-queued` while it is still in
   * flight, the way `MessageSender` does: append the bubble, then record its
   * boundary. Returns the bubble.
   */
  function sendMidTurn(
    store: FakeTabStore,
    service: StreamingHandlerService,
  ): ExecutionChatMessage {
    const { user, reply } = splitTurn(turnEvents(PROMPT, 'live', 10));
    for (const event of [...user, ...reply.slice(0, 2)]) {
      service.processStreamEvent(event, TAB_ID);
    }
    const bubble = optimisticPrompt('opt-queued', 'and then this');
    store.write(TAB_ID, {
      messages: [...(store.find(TAB_ID)?.messages ?? []), bubble],
    });
    service.recordUserPromptBoundary(TAB_ID, bubble);
    service.processStreamEvent(reply[2], TAB_ID);
    service.finalizeCurrentMessage(TAB_ID);
    return bubble;
  }

  it('places a prompt queued behind the peer turn after the peer reply', () => {
    const { store, service } = setup();
    // The first prompt is already echoed (its id is its transcript uuid).
    store.active.set([
      makeTab({ messages: [optimisticPrompt(PROMPT.userId, PROMPT.userText)] }),
    ]);
    sendMidTurn(store, service);

    runLiveTurn(service, turnEvents(PEER_TURNS[0], 'live', 30));

    expect(store.find(TAB_ID)?.messages.map((m) => m.id)).toEqual([
      PROMPT.userId,
      `${PROMPT.replyId}-start`,
      PEER_TURNS[0].userId,
      `${PEER_TURNS[0].replyId}-start`,
      'opt-queued',
    ]);

    // The queued prompt's own turn then follows it.
    const queuedTurn: TurnSpec = {
      userId: uuid(8),
      userText: 'and then this',
      replyId: 'msg_q',
      replyText: 'Done.',
    };
    runLiveTurn(service, turnEvents(queuedTurn, 'live', 50).map((event) =>
      event.eventType === 'message_start' && event.role === 'user'
        ? { ...event, clientMessageId: 'opt-queued' }
        : event,
    ));

    const messages = store.find(TAB_ID)?.messages ?? [];
    expect(messages.map((m) => m.id)).toEqual([
      PROMPT.userId,
      `${PROMPT.replyId}-start`,
      PEER_TURNS[0].userId,
      `${PEER_TURNS[0].replyId}-start`,
      'opt-queued',
      'msg_q-start',
    ]);
    expect(messages[4].nativeUuid).toBe(uuid(8));
  });

  it('keeps an earlier prompt from an interrupted, empty turn above a later peer', () => {
    const { store, service } = setup();
    // Sent while idle (no boundary); its turn was stopped before any
    // renderable reply, and its echo was never stamped.
    store.active.set([
      makeTab({
        status: 'loaded',
        messages: [optimisticPrompt('opt-stopped', 'try this')],
      }),
    ]);

    runLiveTurn(service, turnEvents(PEER_TURNS[0], 'live', 30));

    expect(store.find(TAB_ID)?.messages.map((m) => m.id)).toEqual([
      'opt-stopped',
      PEER_TURNS[0].userId,
      `${PEER_TURNS[0].replyId}-start`,
    ]);
  });

  it('does not treat a prompt whose send failed as queued', () => {
    const { store, service } = setup();
    store.active.set([
      makeTab({ messages: [optimisticPrompt(PROMPT.userId, PROMPT.userText)] }),
    ]);
    const bubble = sendMidTurn(store, service);
    service.removeUserPromptBoundary(TAB_ID, bubble.id);

    runLiveTurn(service, turnEvents(PEER_TURNS[0], 'live', 30));

    expect(store.find(TAB_ID)?.messages.map((m) => m.id)).toEqual([
      PROMPT.userId,
      `${PROMPT.replyId}-start`,
      'opt-queued',
      PEER_TURNS[0].userId,
      `${PEER_TURNS[0].replyId}-start`,
    ]);
  });

  it('does not treat a prompt from a confirmed aborted session as queued', () => {
    const { store, service } = setup();
    store.active.set([
      makeTab({ messages: [optimisticPrompt(PROMPT.userId, PROMPT.userText)] }),
    ]);
    const { user, reply } = splitTurn(turnEvents(PROMPT, 'live', 10));
    for (const event of [...user, ...reply.slice(0, 2)]) {
      service.processStreamEvent(event, TAB_ID);
    }
    const bubble = optimisticPrompt('opt-queued', 'and then this');
    store.write(TAB_ID, {
      messages: [...(store.find(TAB_ID)?.messages ?? []), bubble],
    });
    service.recordUserPromptBoundary(TAB_ID, bubble);
    // The person stops the turn.
    service.finalizeCurrentMessage(TAB_ID, true);
    TestBed.inject(QueuedPromptRecord).clear(TAB_ID);

    runLiveTurn(service, turnEvents(PEER_TURNS[0], 'live', 30));

    expect(store.find(TAB_ID)?.messages.map((m) => m.id)).toEqual([
      PROMPT.userId,
      `${PROMPT.replyId}-start`,
      'opt-queued',
      PEER_TURNS[0].userId,
      `${PEER_TURNS[0].replyId}-start`,
    ]);
  });

  it('adds the peer message to a tab in a background workspace', () => {
    const { store, service } = setup();
    store.background.set([makeTab({ status: 'loaded' })]);
    const { user } = splitTurn(turnEvents(PEER_TURNS[1], 'live', 10));

    for (const event of user) service.processStreamEvent(event);

    const messages = store.find(TAB_ID)?.messages ?? [];
    expect(messages.map((m) => m.id)).toEqual([PEER_TURNS[1].userId]);
    expect(messages[0].inboundPeer).toEqual({ label: 'codex · tester' });
    expect(messages[0].rawContent).toBe(PEER_TURNS[1].userText);
  });

  it('adds nothing for a replayed peer turn (history builds it)', () => {
    const { store, service } = setup();
    store.active.set([makeTab({ status: 'loaded' })]);
    const { user } = splitTurn(turnEvents(PEER_TURNS[0], 'replay', 10));

    for (const event of user) {
      service.processStreamEvent(event, TAB_ID, SESSION_ID, { isReplay: true });
    }

    expect(store.find(TAB_ID)?.messages).toEqual([]);
  });
});
