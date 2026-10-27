/**
 * Turn grouping over a LIVE transcript with inbound peer turns.
 *
 * A lane report or lane completion starts its own SDK turn in the parent
 * session. The live path now adds that peer user message to `tab.messages`,
 * so `groupTurns` and `buildTurnContexts` start a new turn at it and each
 * reply ends its own turn — its answer is no longer folded into the previous
 * reply's "Worked" log (`splitTurnMessage` shows the answer of the LAST
 * assistant only).
 *
 * The transcript is produced by the real chat-streaming stack: ingest,
 * accumulate and finalize. Only the tab store, batching and monitor
 * collaborators are faked.
 */

import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import {
  SessionId,
  createExecutionChatMessage,
  type ExecutionChatMessage,
  type FlatStreamEventUnion,
  type MessageCompleteEvent,
  type MessageStartEvent,
  type TextDeltaEvent,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { StreamingState, TabState } from '@ptah-extension/chat-types';
import {
  AgentMonitorStore,
  BatchedUpdateService,
  SessionManager,
  StreamingHandlerService,
  SubagentExecutionStore,
  TurnStateApplier,
} from '@ptah-extension/chat-streaming';
import { buildTurnContexts } from '../../../utils/turn-facts.utils';
import { groupTurns } from './transcript-turns';

const TAB_ID = 'tab-peer';
const SESSION_ID = SessionId.create();

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

interface TurnSpec {
  readonly userId: string;
  readonly userText: string;
  readonly peerLabel?: string;
  readonly replyId: string;
}

const PROMPT: TurnSpec = {
  userId: uuid(1),
  userText: 'Run two lanes',
  replyId: 'msg_a1',
};

const PEER_TURNS: readonly TurnSpec[] = [
  ['lane-a', 'reviewer', 'agent-report', ''],
  ['lane-b', 'tester', 'agent-report', ''],
  ['lane-a', 'reviewer', 'agent-lane-completed', ' verdict="PASS"'],
  ['lane-b', 'tester', 'agent-lane-completed', ' verdict="PASS"'],
].map(([agentId, agent, tag, extra], i) => ({
  userId: uuid(i + 2),
  userText: `<${tag} agent-id="${agentId}" agent="${agent}" cli="codex"${extra}>\nBody ${i}\n</${tag}>`,
  peerLabel: `codex · ${agent}`,
  replyId: `msg_a${i + 2}`,
}));

/** One live turn in wire order: user echo, then the assistant reply. */
function liveTurnEvents(turn: TurnSpec, clock: number): FlatStreamEventUnion[] {
  const userStart: MessageStartEvent = {
    id: `${turn.userId}-start`,
    eventType: 'message_start',
    timestamp: clock,
    sessionId: SESSION_ID,
    source: 'complete',
    messageId: turn.userId,
    role: 'user',
    ...(turn.peerLabel ? { inboundPeer: { label: turn.peerLabel } } : {}),
  };
  const userText: TextDeltaEvent = {
    id: `${turn.userId}-text`,
    eventType: 'text_delta',
    timestamp: clock + 1,
    sessionId: SESSION_ID,
    source: 'complete',
    messageId: turn.userId,
    delta: turn.userText,
    blockIndex: 0,
  };
  const userComplete: MessageCompleteEvent = {
    id: `${turn.userId}-complete`,
    eventType: 'message_complete',
    timestamp: clock + 2,
    sessionId: SESSION_ID,
    source: 'complete',
    messageId: turn.userId,
  };
  const replyStart: MessageStartEvent = {
    id: `${turn.replyId}-start`,
    eventType: 'message_start',
    timestamp: clock + 3,
    sessionId: SESSION_ID,
    source: 'stream',
    messageId: turn.replyId,
    role: 'assistant',
  };
  const replyText: TextDeltaEvent = {
    id: `${turn.replyId}-text`,
    eventType: 'text_delta',
    timestamp: clock + 4,
    sessionId: SESSION_ID,
    source: 'stream',
    messageId: turn.replyId,
    delta: `Reply to ${turn.userId}`,
    blockIndex: 0,
  };
  const replyComplete: MessageCompleteEvent = {
    id: `${turn.replyId}-complete`,
    eventType: 'message_complete',
    timestamp: clock + 5,
    sessionId: SESSION_ID,
    source: 'stream',
    messageId: turn.replyId,
    stopReason: 'end_turn',
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

/** The tab store the streaming stack writes through (active workspace). */
function createTabStore(initial: TabState) {
  const tabs = signal<TabState[]>([initial]);
  const find = (tabId: string): TabState | undefined =>
    tabs().find((t) => t.id === tabId);
  const write = (tabId: string, updates: Partial<TabState>): void =>
    tabs.update((all) =>
      all.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
    );
  return {
    find,
    tabs: computed(() => tabs()),
    activeTabId: computed(() => tabs()[0]?.id ?? null),
    activeTab: computed(() => tabs()[0] ?? null),
    findTabsBySessionId: (sid: string) =>
      tabs().filter((t) => t.claudeSessionId === sid),
    findTabByIdAcrossWorkspaces: (tabId: string) => {
      const tab = find(tabId);
      return tab ? { tab, workspacePath: 'D:/repo' } : null;
    },
    findTabBySessionIdAcrossWorkspaces: () => null,
    attachSession: (tabId: string, sid: string) =>
      write(tabId, { claudeSessionId: sid }),
    setStreamingState: (tabId: string, state: StreamingState | null) =>
      write(tabId, { streamingState: state }),
    setMessages: (tabId: string, messages: ExecutionChatMessage[]) =>
      write(tabId, { messages }),
    reconcileUserMessageNativeUuid: jest.fn(),
    applyFinalizedTurn: (tabId: string, messages: ExecutionChatMessage[]) =>
      write(tabId, { messages, currentMessageId: null, streamingState: null }),
    clearStreamingForLoaded: (tabId: string) =>
      write(tabId, { streamingState: null, currentMessageId: null }),
  };
}

function liveTranscript(): ExecutionChatMessage[] {
  const store = createTabStore({
    id: TAB_ID,
    title: 'Session',
    name: 'Session',
    status: 'streaming',
    messages: [
      createExecutionChatMessage({
        id: PROMPT.userId,
        role: 'user',
        rawContent: PROMPT.userText,
      }),
    ],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: SESSION_ID,
  } as TabState);
  TestBed.configureTestingModule({
    providers: [
      { provide: TabManagerService, useValue: store },
      {
        provide: SessionManager,
        useValue: {
          setSessionId: jest.fn(),
          setStatus: jest.fn(),
          registerAgent: jest.fn(() => []),
        },
      },
      {
        provide: BatchedUpdateService,
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
          onAgentStart: jest.fn(),
          onSubagentMessageComplete: jest.fn(),
          getSubagent: jest.fn(() => undefined),
        },
      },
      { provide: TurnStateApplier, useValue: { apply: jest.fn() } },
      { provide: SubagentExecutionStore, useValue: { claim: () => false } },
    ],
  });
  const service = TestBed.inject(StreamingHandlerService);
  [PROMPT, ...PEER_TURNS].forEach((turn, i) => {
    for (const event of liveTurnEvents(turn, 1_000 + i * 10)) {
      service.processStreamEvent(event, TAB_ID);
    }
    // A terminal `turn_state` settles the turn through the same call.
    service.finalizeCurrentMessage(TAB_ID);
  });
  return store.find(TAB_ID)?.messages ?? [];
}

describe('transcript turns — live inbound peer turns', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts one turn per peer message and ends it at that reply', () => {
    const messages = liveTranscript();

    const turns = groupTurns(messages, messages.length);

    expect(turns.map((t) => t.endMessageId)).toEqual(
      [PROMPT, ...PEER_TURNS].map((t) => `${t.replyId}-start`),
    );
    expect(turns.every((t) => t.assistants.length === 1)).toBe(true);
  });

  it('makes every reply the last assistant of its own turn', () => {
    const messages = liveTranscript();

    const contexts = buildTurnContexts(messages);

    for (const turn of [PROMPT, ...PEER_TURNS]) {
      const ctx = contexts.get(`${turn.replyId}-start`);
      expect(ctx).toMatchObject({
        turnId: turn.userId,
        count: 1,
        isFirstAssistant: true,
        isLastAssistant: true,
      });
    }
  });
});
