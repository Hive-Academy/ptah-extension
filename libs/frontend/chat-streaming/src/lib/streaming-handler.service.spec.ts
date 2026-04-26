/**
 * StreamingHandlerService specs â€” flat-event ingest hot-path coverage for
 * TASK_2026_103 Wave T.
 *
 * What is in scope:
 *   - `agent_start` â†’ SessionManager.registerAgent and event stored in state
 *   - `tool_start` followed by `tool_result` for the same toolCallId update
 *     the same tracked toolCallMap entry, not a duplicate one
 *   - `text_delta` chunks accumulate into the per-block accumulator key
 *   - `agent_started` â†’ `text_delta` â†’ `message_complete` survives the round
 *     trip and the tab's streamingState carries the accumulated text
 *   - The 5000-event FIFO cap (`STREAMING_EVENT_CAP`) â€” synthesise 5001
 *     unique-id text deltas, confirm `state.events.size === 5000` and the
 *     first event id is evicted
 *
 * What is intentionally OUT of scope:
 *   - Tree finalization (delegated to MessageFinalizationService â€” own spec)
 *   - Compaction lifecycle (own spec exists)
 *   - Background-agent forwarding (covered by agent-monitor.store specs)
 *   - The full ChatStore integration (covered by integration tests)
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import {
  STREAMING_EVENT_CAP,
  createEmptyStreamingState,
  type StreamingState,
  type TabState,
} from '@ptah-extension/chat-types';
import type {
  AgentStartEvent,
  FlatStreamEventUnion,
  MessageCompleteEvent,
  MessageStartEvent,
  TextDeltaEvent,
  ToolResultEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import { StreamingHandlerService } from './streaming-handler.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SessionManager } from './session-manager.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { BatchedUpdateService } from './batched-update.service';
import { MessageFinalizationService } from './message-finalization.service';
import { PermissionHandlerService } from './permission-handler.service';
import { BackgroundAgentStore } from './background-agent.store';
import { AgentMonitorStore } from './agent-monitor.store';

// ---------- Helpers --------------------------------------------------------

const TAB_ID = 'tab-1';
const SESSION_ID = 'sess-1';
const MESSAGE_ID = 'msg-1';

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: TAB_ID,
    title: 'Session',
    name: 'Session',
    status: 'streaming',
    messages: [],
    streamingState: createEmptyStreamingState(),
    currentMessageId: null,
    claudeSessionId: SESSION_ID,
    ...overrides,
  } as TabState;
}

function msgStart(
  overrides: Partial<MessageStartEvent> = {},
): MessageStartEvent {
  return {
    id: 'evt-msg-start',
    eventType: 'message_start',
    timestamp: 1,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    role: 'assistant',
    source: 'stream',
    ...overrides,
  } as MessageStartEvent;
}

function textDelta(overrides: Partial<TextDeltaEvent> = {}): TextDeltaEvent {
  return {
    id: 'evt-text-1',
    eventType: 'text_delta',
    timestamp: 2,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    blockIndex: 0,
    delta: 'hello',
    source: 'stream',
    ...overrides,
  } as TextDeltaEvent;
}

function toolStart(overrides: Partial<ToolStartEvent> = {}): ToolStartEvent {
  return {
    id: 'evt-tool-start',
    eventType: 'tool_start',
    timestamp: 3,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    toolCallId: 'tool-1',
    toolName: 'Bash',
    isTaskTool: false,
    source: 'stream',
    ...overrides,
  } as ToolStartEvent;
}

function toolResult(overrides: Partial<ToolResultEvent> = {}): ToolResultEvent {
  return {
    id: 'evt-tool-result',
    eventType: 'tool_result',
    timestamp: 4,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    toolCallId: 'tool-1',
    output: 'ok',
    isError: false,
    source: 'stream',
    ...overrides,
  } as ToolResultEvent;
}

function agentStart(overrides: Partial<AgentStartEvent> = {}): AgentStartEvent {
  return {
    id: 'evt-agent-start',
    eventType: 'agent_start',
    timestamp: 5,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    toolCallId: 'toolu_agent_1',
    agentType: 'general-purpose',
    agentDescription: 'Sub agent A',
    agentId: 'agent-id-1',
    source: 'hook',
    ...overrides,
  } as AgentStartEvent;
}

function messageComplete(
  overrides: Partial<MessageCompleteEvent> = {},
): MessageCompleteEvent {
  return {
    id: 'evt-msg-complete',
    eventType: 'message_complete',
    timestamp: 6,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    stopReason: 'end_turn',
    tokenUsage: { input: 10, output: 20 },
    source: 'stream',
    ...overrides,
  } as MessageCompleteEvent;
}

// ---------- Suite ----------------------------------------------------------

describe('StreamingHandlerService', () => {
  let service: StreamingHandlerService;
  let tabsSignal: ReturnType<typeof signal<TabState[]>>;
  let activeTabIdSignal: ReturnType<typeof signal<string | null>>;
  let tabManager: jest.Mocked<
    Pick<
      TabManagerService,
      | 'tabs'
      | 'activeTab'
      | 'findTabBySessionId'
      | 'adoptStreamingSession'
      | 'attachSession'
      | 'setStreamingState'
      | 'setMessages'
      | 'markTabIdle'
      | 'markTabStreaming'
    >
  > & { tabs: ReturnType<typeof computed<TabState[]>> };
  let sessionManager: jest.Mocked<
    Pick<
      SessionManager,
      'setSessionId' | 'setStatus' | 'registerAgent' | 'clearNodeMaps'
    >
  >;
  let batchedUpdate: jest.Mocked<
    Pick<BatchedUpdateService, 'scheduleUpdate' | 'flushSync'>
  >;
  let finalization: jest.Mocked<
    Pick<
      MessageFinalizationService,
      | 'finalizeCurrentMessage'
      | 'finalizeSessionHistory'
      | 'markLastAgentAsInterrupted'
      | 'markAgentsAsInterruptedByToolCallIds'
    >
  >;
  let permissionHandler: jest.Mocked<
    Pick<PermissionHandlerService, 'consumeHardDenyToolUseIds'>
  >;
  let backgroundAgentStore: jest.Mocked<
    Pick<
      BackgroundAgentStore,
      'onStarted' | 'onProgress' | 'onCompleted' | 'onStopped'
    >
  >;
  let agentMonitorStore: jest.Mocked<
    Pick<AgentMonitorStore, 'markAgentNodesResumed'>
  >;
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    tabsSignal = signal<TabState[]>([makeTab()]);
    activeTabIdSignal = signal<string | null>(TAB_ID);

    tabManager = {
      tabs: computed(() => tabsSignal()),
      activeTab: computed(
        () => tabsSignal().find((t) => t.id === activeTabIdSignal()) ?? null,
      ),
      findTabBySessionId: jest.fn(
        (sid: string) =>
          tabsSignal().find((t) => t.claudeSessionId === sid) ?? null,
      ),
      adoptStreamingSession: jest.fn((tabId: string, sessionId: string) => {
        tabsSignal.update((tabs) =>
          tabs.map((t) =>
            t.id === tabId
              ? ({
                  ...t,
                  claudeSessionId: sessionId,
                  status: 'streaming',
                } as TabState)
              : t,
          ),
        );
      }),
      attachSession: jest.fn((tabId: string, sessionId: string) => {
        tabsSignal.update((tabs) =>
          tabs.map((t) =>
            t.id === tabId
              ? ({ ...t, claudeSessionId: sessionId } as TabState)
              : t,
          ),
        );
      }),
      setStreamingState: jest.fn(
        (tabId: string, state: TabState['streamingState']) => {
          tabsSignal.update((tabs) =>
            tabs.map((t) =>
              t.id === tabId
                ? ({ ...t, streamingState: state } as TabState)
                : t,
            ),
          );
        },
      ),
      setMessages: jest.fn((tabId: string, messages: TabState['messages']) => {
        tabsSignal.update((tabs) =>
          tabs.map((t) =>
            t.id === tabId ? ({ ...t, messages } as TabState) : t,
          ),
        );
      }),
      markTabIdle: jest.fn(),
      markTabStreaming: jest.fn(),
    } as unknown as jest.Mocked<
      Pick<
        TabManagerService,
        | 'tabs'
        | 'activeTab'
        | 'findTabBySessionId'
        | 'adoptStreamingSession'
        | 'attachSession'
        | 'setStreamingState'
        | 'setMessages'
        | 'markTabIdle'
        | 'markTabStreaming'
      >
    > & { tabs: ReturnType<typeof computed<TabState[]>> };

    sessionManager = {
      setSessionId: jest.fn(),
      setStatus: jest.fn(),
      registerAgent: jest.fn(() => [] as string[]),
      clearNodeMaps: jest.fn(),
    } as jest.Mocked<
      Pick<
        SessionManager,
        'setSessionId' | 'setStatus' | 'registerAgent' | 'clearNodeMaps'
      >
    >;

    batchedUpdate = {
      scheduleUpdate: jest.fn(),
      flushSync: jest.fn(),
    } as jest.Mocked<
      Pick<BatchedUpdateService, 'scheduleUpdate' | 'flushSync'>
    >;

    finalization = {
      finalizeCurrentMessage: jest.fn(),
      finalizeSessionHistory: jest.fn(() => []),
      markLastAgentAsInterrupted: jest.fn(),
      markAgentsAsInterruptedByToolCallIds: jest.fn(),
    } as jest.Mocked<
      Pick<
        MessageFinalizationService,
        | 'finalizeCurrentMessage'
        | 'finalizeSessionHistory'
        | 'markLastAgentAsInterrupted'
        | 'markAgentsAsInterruptedByToolCallIds'
      >
    >;

    permissionHandler = {
      consumeHardDenyToolUseIds: jest.fn(() => new Set<string>()),
    } as jest.Mocked<
      Pick<PermissionHandlerService, 'consumeHardDenyToolUseIds'>
    >;

    backgroundAgentStore = {
      onStarted: jest.fn(),
      onProgress: jest.fn(),
      onCompleted: jest.fn(),
      onStopped: jest.fn(),
    } as jest.Mocked<
      Pick<
        BackgroundAgentStore,
        'onStarted' | 'onProgress' | 'onCompleted' | 'onStopped'
      >
    >;

    agentMonitorStore = {
      markAgentNodesResumed: jest.fn(),
    } as jest.Mocked<Pick<AgentMonitorStore, 'markAgentNodesResumed'>>;

    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        StreamingHandlerService,
        // EventDeduplicationService is a pure utility â€” use the real one so
        // the source-priority logic is exercised end-to-end through the
        // streaming handler.
        EventDeduplicationService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionManager, useValue: sessionManager },
        { provide: BatchedUpdateService, useValue: batchedUpdate },
        { provide: MessageFinalizationService, useValue: finalization },
        { provide: PermissionHandlerService, useValue: permissionHandler },
        { provide: BackgroundAgentStore, useValue: backgroundAgentStore },
        { provide: AgentMonitorStore, useValue: agentMonitorStore },
      ],
    });
    service = TestBed.inject(StreamingHandlerService);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();
    TestBed.resetTestingModule();
  });

  // Helper: read the current state of TAB_ID.
  function currentState(): StreamingState {
    const tab = tabsSignal().find((t) => t.id === TAB_ID);
    if (!tab?.streamingState) {
      throw new Error('test setup: tab missing streamingState');
    }
    return tab.streamingState;
  }

  describe('agent_start', () => {
    it('stores the event and registers the agent with SessionManager', () => {
      service.processStreamEvent(agentStart(), TAB_ID);

      const state = currentState();
      // Event is in the events Map keyed by id.
      expect(state.events.has('evt-agent-start')).toBe(true);
      expect(sessionManager.registerAgent).toHaveBeenCalledWith(
        'toolu_agent_1',
        expect.objectContaining({
          type: 'agent',
          status: 'streaming',
          agentType: 'general-purpose',
          toolCallId: 'toolu_agent_1',
        }),
      );
      // Structural events flush immediately so the UI shows the new node.
      expect(batchedUpdate.flushSync).toHaveBeenCalled();
    });

    it('schedules a batched UI update via BatchedUpdateService', () => {
      service.processStreamEvent(agentStart(), TAB_ID);
      expect(batchedUpdate.scheduleUpdate).toHaveBeenCalledWith(
        TAB_ID,
        expect.any(Object),
      );
    });
  });

  describe('tool_start â†’ tool_result for the same toolCallId', () => {
    it('does NOT create a duplicate toolCallMap entry on tool_result', () => {
      service.processStreamEvent(toolStart(), TAB_ID);
      expect(currentState().toolCallMap.size).toBe(1);
      expect(currentState().toolCallMap.has('tool-1')).toBe(true);

      service.processStreamEvent(toolResult(), TAB_ID);

      // Only the same toolCallId tracked â€” no second key created.
      expect(currentState().toolCallMap.size).toBe(1);
      expect(currentState().toolCallMap.has('tool-1')).toBe(true);

      // Both events live in `events` keyed by their distinct event ids.
      expect(currentState().events.has('evt-tool-start')).toBe(true);
      expect(currentState().events.has('evt-tool-result')).toBe(true);
    });
  });

  describe('text_delta accumulation', () => {
    it('appends successive stream-source deltas into the block accumulator', () => {
      service.processStreamEvent(msgStart(), TAB_ID);
      service.processStreamEvent(
        textDelta({ id: 'evt-text-a', delta: 'Hel' }),
        TAB_ID,
      );
      service.processStreamEvent(
        textDelta({ id: 'evt-text-b', delta: 'lo,' }),
        TAB_ID,
      );
      service.processStreamEvent(
        textDelta({ id: 'evt-text-c', delta: ' world' }),
        TAB_ID,
      );

      const state = currentState();
      // Accumulator key = `${messageId}-block-${blockIndex}` per AccumulatorKeys.textBlock.
      const key = `${MESSAGE_ID}-block-0`;
      expect(state.textAccumulators.get(key)).toBe('Hello, world');
    });
  });

  describe('end-to-end: message_start â†’ text_delta â†’ message_complete', () => {
    it('persists the accumulated text and final token usage in streamingState', () => {
      service.processStreamEvent(msgStart(), TAB_ID);
      service.processStreamEvent(
        textDelta({ id: 'evt-t-1', delta: 'Hi ' }),
        TAB_ID,
      );
      service.processStreamEvent(
        textDelta({ id: 'evt-t-2', delta: 'there' }),
        TAB_ID,
      );
      service.processStreamEvent(messageComplete(), TAB_ID);

      const state = currentState();
      expect(state.textAccumulators.get(`${MESSAGE_ID}-block-0`)).toBe(
        'Hi there',
      );
      expect(state.currentTokenUsage).toEqual({ input: 10, output: 20 });
      expect(state.currentMessageId).toBe(MESSAGE_ID);
      expect(state.messageEventIds).toContain(MESSAGE_ID);
    });
  });

  describe('STREAMING_EVENT_CAP FIFO eviction (5000 entries)', () => {
    it('evicts the oldest event when more than the cap arrive', () => {
      // Sanity: cap is what we expect.
      expect(STREAMING_EVENT_CAP).toBe(5000);

      // Prime with message_start so deltas have a current message context.
      service.processStreamEvent(msgStart({ id: 'evt-prime' }), TAB_ID);

      // Synthesise STREAMING_EVENT_CAP + 1 unique text deltas.
      // Note: events.size after `evt-prime` is 1, so we generate 5000 deltas
      // to drive size to 5001 and trigger one eviction. We then check the
      // FIRST inserted event (`evt-prime`) is the one that got evicted.
      for (let i = 0; i < STREAMING_EVENT_CAP; i++) {
        service.processStreamEvent(
          textDelta({
            id: `evt-cap-${i}`,
            delta: 'x',
            // Distinct blockIndex per event so the accumulator key changes
            // and we don't incidentally overflow text into one giant string.
            blockIndex: i,
          }),
          TAB_ID,
        );
      }

      const state = currentState();
      // Cap held: total events count must equal STREAMING_EVENT_CAP.
      expect(state.events.size).toBe(STREAMING_EVENT_CAP);
      // The first-inserted event (msg_start) is the one evicted FIFO.
      expect(state.events.has('evt-prime')).toBe(false);
      // The most recently inserted event survives.
      expect(state.events.has(`evt-cap-${STREAMING_EVENT_CAP - 1}`)).toBe(true);
      // The cap-warning console.warn is fired at least once.
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('reached cap'),
      );
    });
  });

  describe('cleanupSessionDeduplication', () => {
    it('clears warned-no-target tracking so the next missing-tab event re-warns', () => {
      // Simulate: no tab matches an event sessionId.
      tabsSignal.set([]);
      const orphan: FlatStreamEventUnion = textDelta({
        id: 'evt-orphan-1',
        sessionId: 'unknown-session',
      });
      service.processStreamEvent(orphan);
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('No target tab'),
        'unknown-session',
        expect.any(String),
      );

      // Second event with the same sessionId is silenced.
      consoleWarn.mockClear();
      service.processStreamEvent(
        textDelta({ id: 'evt-orphan-2', sessionId: 'unknown-session' }),
      );
      expect(consoleWarn).not.toHaveBeenCalledWith(
        expect.stringContaining('No target tab'),
        expect.anything(),
        expect.anything(),
      );

      // After cleanup, the next event re-warns.
      service.cleanupSessionDeduplication('unknown-session');
      service.processStreamEvent(
        textDelta({ id: 'evt-orphan-3', sessionId: 'unknown-session' }),
      );
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('No target tab'),
        'unknown-session',
        expect.any(String),
      );
    });
  });

  describe('flushUpdatesSync', () => {
    it('delegates to BatchedUpdateService.flushSync', () => {
      service.flushUpdatesSync();
      expect(batchedUpdate.flushSync).toHaveBeenCalled();
    });
  });
});
