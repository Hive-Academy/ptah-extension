/**
 * StreamingHandlerService specs — flat-event ingest hot-path coverage.
 *
 * What is in scope:
 *   - `agent_start` → SessionManager.registerAgent and event stored in state
 *   - `tool_start` followed by `tool_result` for the same toolCallId update
 *     the same tracked toolCallMap entry, not a duplicate one
 *   - `text_delta` chunks accumulate into the per-block accumulator key
 *   - `agent_started` → `text_delta` → `message_complete` survives the round
 *     trip and the tab's streamingState carries the accumulated text
 *   - The 5000-event FIFO cap (`STREAMING_EVENT_CAP`) — synthesise 5001
 *     unique-id text deltas, confirm `state.events.size === 5000` and the
 *     first event id is evicted
 *
 * What is intentionally OUT of scope:
 *   - Tree finalization (delegated to MessageFinalizationService — own spec)
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
  AgentProgressEvent,
  AgentStartEvent,
  FlatStreamEventUnion,
  MessageCompleteEvent,
  MessageStartEvent,
  TextDeltaEvent,
  ToolResultEvent,
  ToolStartEvent,
  TurnStateEvent,
} from '@ptah-extension/shared';
import { SessionId } from '@ptah-extension/shared';
import { StreamingHandlerService } from './streaming-handler.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SessionManager } from './session-manager.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { BatchedUpdateService } from './batched-update.service';
import { MessageFinalizationService } from './message-finalization.service';
import { TurnStateApplier } from './turn-state-applier.service';
import { BackgroundAgentStore } from './background-agent.store';
import { AgentMonitorStore } from './agent-monitor.store';

// ---------- Helpers --------------------------------------------------------

const TAB_ID = 'tab-1';
// Production code validates sessionId via `SessionId.from()` which requires a
// real UUID v4. Mint a stable id per spec run.
const SESSION_ID = SessionId.create();
const ORPHAN_SESSION_ID = SessionId.create();
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
      | 'findTabsBySessionId'
      | 'attachSession'
      | 'markStreaming'
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
  let turnStateApplier: jest.Mocked<Pick<TurnStateApplier, 'apply'>>;
  let backgroundAgentStore: jest.Mocked<
    Pick<
      BackgroundAgentStore,
      'onStarted' | 'onProgress' | 'onCompleted' | 'onStopped'
    >
  >;
  let agentMonitorStore: jest.Mocked<
    Pick<
      AgentMonitorStore,
      | 'markAgentNodesResumed'
      | 'onAgentStart'
      | 'onAgentProgress'
      | 'onAgentStatus'
      | 'onAgentCompleted'
    >
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
      // Fan-out lookup. Test default returns all tabs whose
      // claudeSessionId matches; specific tests can override via
      // mockImplementation to simulate canvas-grid scenarios.
      findTabsBySessionId: jest.fn((sid: string) =>
        tabsSignal().filter((t) => t.claudeSessionId === sid),
      ),
      // `adoptStreamingSession` retired. The streaming handler now calls
      // `attachSession` + `markStreaming` explicitly. The mocks below
      // preserve the same observable effect (claudeSessionId set, status
      // flipped to 'streaming').
      attachSession: jest.fn((tabId: string, sessionId: string) => {
        tabsSignal.update((tabs) =>
          tabs.map((t) =>
            t.id === tabId
              ? ({ ...t, claudeSessionId: sessionId } as TabState)
              : t,
          ),
        );
      }),
      markStreaming: jest.fn((tabId: string) => {
        tabsSignal.update((tabs) =>
          tabs.map((t) =>
            t.id === tabId ? ({ ...t, status: 'streaming' } as TabState) : t,
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
      isTabStreaming: jest.fn().mockReturnValue(false),
      findTabBySessionIdAcrossWorkspaces: jest.fn(() => null),
      updateBackgroundTab: jest.fn(() => false),
    } as unknown as jest.Mocked<
      Pick<
        TabManagerService,
        | 'tabs'
        | 'activeTab'
        | 'findTabBySessionId'
        | 'attachSession'
        | 'markStreaming'
        | 'setStreamingState'
        | 'setMessages'
        | 'markTabIdle'
        | 'markTabStreaming'
        | 'isTabStreaming'
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

    turnStateApplier = { apply: jest.fn() };

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
      onAgentStart: jest.fn(),
      onAgentProgress: jest.fn(),
      onAgentStatus: jest.fn(),
      onAgentCompleted: jest.fn(),
    } as jest.Mocked<
      Pick<
        AgentMonitorStore,
        | 'markAgentNodesResumed'
        | 'onAgentStart'
        | 'onAgentProgress'
        | 'onAgentStatus'
        | 'onAgentCompleted'
      >
    >;

    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        StreamingHandlerService,
        // EventDeduplicationService is a pure utility — use the real one so
        // the source-priority logic is exercised end-to-end through the
        // streaming handler.
        EventDeduplicationService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionManager, useValue: sessionManager },
        { provide: BatchedUpdateService, useValue: batchedUpdate },
        { provide: MessageFinalizationService, useValue: finalization },
        { provide: TurnStateApplier, useValue: turnStateApplier },
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
        // TASK_2026_154 Wave 2: session id is now tagged for scoped node-map clears.
        SESSION_ID,
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

  describe('tool_start → tool_result for the same toolCallId', () => {
    it('does NOT create a duplicate toolCallMap entry on tool_result', () => {
      service.processStreamEvent(toolStart(), TAB_ID);
      expect(currentState().toolCallMap.size).toBe(1);
      expect(currentState().toolCallMap.has('tool-1')).toBe(true);

      service.processStreamEvent(toolResult(), TAB_ID);

      // Only the same toolCallId tracked — no second key created.
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

  describe('end-to-end: message_start → text_delta → message_complete', () => {
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

  describe('queued-content flush gating on message_complete', () => {
    beforeEach(() => {
      tabsSignal.set([makeTab({ queuedContent: 'follow up question' })]);
    });

    it('does NOT flush queued content on an intermediate tool_use message_complete', () => {
      service.processStreamEvent(msgStart(), TAB_ID);
      const result = service.processStreamEvent(
        messageComplete({ stopReason: 'tool_use' }),
        TAB_ID,
      );

      expect(result).toBeNull();
    });

    it('flushes queued content on a terminal end_turn message_complete', () => {
      service.processStreamEvent(msgStart(), TAB_ID);
      const result = service.processStreamEvent(
        messageComplete({ stopReason: 'end_turn' }),
        TAB_ID,
      );

      expect(result).toEqual({
        tabId: TAB_ID,
        queuedContent: 'follow up question',
      });
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
        sessionId: ORPHAN_SESSION_ID,
      });
      service.processStreamEvent(orphan);
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('No target tab'),
        ORPHAN_SESSION_ID,
        expect.any(String),
      );

      // Second event with the same sessionId is silenced.
      consoleWarn.mockClear();
      service.processStreamEvent(
        textDelta({ id: 'evt-orphan-2', sessionId: ORPHAN_SESSION_ID }),
      );
      expect(consoleWarn).not.toHaveBeenCalledWith(
        expect.stringContaining('No target tab'),
        expect.anything(),
        expect.anything(),
      );

      // After cleanup, the next event re-warns.
      service.cleanupSessionDeduplication(ORPHAN_SESSION_ID);
      service.processStreamEvent(
        textDelta({ id: 'evt-orphan-3', sessionId: ORPHAN_SESSION_ID }),
      );
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('No target tab'),
        ORPHAN_SESSION_ID,
        expect.any(String),
      );
    });
  });

  // `flushUpdatesSync()` is deliberately absent (TASK_2026_327). It forwarded
  // to `BatchedUpdateService.flushSync()` with no `originTabId` — the
  // full-drain contract, which is correct ONLY at turn-end finalization and is
  // reached there directly by `MessageFinalizationService`. Nothing in the app
  // ever called the delegate, and re-exposing the un-scoped drain on the
  // per-event handler is how a hidden tab's flush ends up draining every other
  // session's deferred tree. Do not reintroduce it; if a caller needs a sync
  // flush from here, it must pass its own tab id.
  it('does not expose an unscoped flushUpdatesSync delegate', () => {
    expect(
      (service as unknown as { flushUpdatesSync?: unknown }).flushUpdatesSync,
    ).toBeUndefined();
  });

  // TASK_2026_360 Defect 1: the visual streaming flag used to be re-asserted
  // from ANY mutating event after a turn ended, so every post-turn background
  // event (`agent_progress`, `background_agent_*`) re-lit the stop button with
  // nothing left to clear it. Content never touches status or the flag now —
  // the backend `generating` turn_state is the one signal that a turn runs.
  describe('no status re-assertion from content (TASK_2026_360)', () => {
    function agentProgress(): AgentProgressEvent {
      return {
        id: 'evt-progress-1',
        eventType: 'agent_progress',
        timestamp: 7,
        sessionId: SESSION_ID,
        messageId: MESSAGE_ID,
        parentToolUseId: 'toolu_agent_1',
        taskId: 'task-1',
        description: 'working',
        totalTokens: 1,
        toolUses: 1,
        durationMs: 1,
        source: 'stream',
      } as AgentProgressEvent;
    }

    it('does NOT re-mark a post-terminal (awaiting-background) tab on agent_progress', () => {
      tabManager.isTabStreaming.mockReturnValue(false);
      tabsSignal.set([
        makeTab({
          status: 'awaiting-background',
          lastTerminalReason: 'completed',
        }),
      ]);

      service.processStreamEvent(agentProgress(), TAB_ID);

      expect(agentMonitorStore.onAgentProgress).toHaveBeenCalled();
      expect(tabManager.markTabStreaming).not.toHaveBeenCalled();
      expect(tabManager.markStreaming).not.toHaveBeenCalled();
    });

    it('does NOT re-mark a loaded tab on a text_delta either', () => {
      tabManager.isTabStreaming.mockReturnValue(false);
      tabsSignal.set([
        makeTab({ status: 'loaded', lastTerminalReason: 'completed' }),
      ]);

      service.processStreamEvent(textDelta(), TAB_ID);

      expect(batchedUpdate.scheduleUpdate).toHaveBeenCalled();
      expect(tabManager.markTabStreaming).not.toHaveBeenCalled();
      expect(tabManager.markStreaming).not.toHaveBeenCalled();
    });

    it('binds the session on the fresh-tab hijack without writing status', () => {
      const freshTab = makeTab({
        claudeSessionId: undefined,
        status: 'fresh',
      } as Partial<TabState>);
      tabsSignal.set([freshTab]);

      service.processStreamEvent(msgStart(), undefined, SESSION_ID);

      expect(tabManager.attachSession).toHaveBeenCalledWith(TAB_ID, SESSION_ID);
      expect(sessionManager.setSessionId).toHaveBeenCalledWith(SESSION_ID);
      expect(tabManager.markStreaming).not.toHaveBeenCalled();
      expect(sessionManager.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('turn_state interception (TASK_2026_360)', () => {
    function turnState(): TurnStateEvent {
      return {
        id: 'evt-turn-state',
        eventType: 'turn_state',
        timestamp: 8,
        sessionId: SESSION_ID,
        messageId: `turn-state-${SESSION_ID}`,
        phase: 'idle',
        revision: 2,
        backgroundTasks: [],
        sessionCrons: [],
        terminalReason: 'completed',
        source: 'stream',
      };
    }

    it('hands the event to TurnStateApplier with the routed tab id and returns null', () => {
      const event = turnState();

      const result = service.processStreamEvent(event, TAB_ID);

      expect(result).toBeNull();
      expect(turnStateApplier.apply).toHaveBeenCalledWith(event, TAB_ID);
    });

    it('never stores the event in StreamingState nor schedules a UI update', () => {
      service.processStreamEvent(turnState(), TAB_ID);

      expect(currentState().events.size).toBe(0);
      expect(batchedUpdate.scheduleUpdate).not.toHaveBeenCalled();
    });

    it('intercepts before tab resolution — no lookups, no missing-tab warning', () => {
      tabsSignal.set([]);

      service.processStreamEvent(turnState());

      expect(turnStateApplier.apply).toHaveBeenCalledTimes(1);
      expect(tabManager.findTabsBySessionId).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    });
  });

  // Multi-tab fan-out. When two tabs share a claudeSessionId (canvas-grid
  // scenario), processStreamEvent must write streamingState to BOTH tabs'
  // state, not just the primary.
  describe('multi-tab fan-out (TASK_2026_106 Phase 4b)', () => {
    it('processStreamEvent writes streaming state to every bound tab', () => {
      // Set up two tabs both bound to the same SDK session.
      const tabA = makeTab({
        id: 'tab-a',
        claudeSessionId: SESSION_ID,
        streamingState: createEmptyStreamingState(),
      });
      const tabB = makeTab({
        id: 'tab-b',
        claudeSessionId: SESSION_ID,
        streamingState: createEmptyStreamingState(),
      });
      tabsSignal.set([tabA, tabB]);
      activeTabIdSignal.set('tab-a');

      // Override the fan-out lookup so both tabs are returned.
      tabManager.findTabsBySessionId.mockReturnValue([tabA, tabB]);

      // Process a single text_delta with explicit tabId for the primary.
      service.processStreamEvent(textDelta(), 'tab-a');

      // Both tabs' streamingState should now contain the event.
      const stateA = tabsSignal().find((t) => t.id === 'tab-a')?.streamingState;
      const stateB = tabsSignal().find((t) => t.id === 'tab-b')?.streamingState;
      expect(stateA?.events.size).toBeGreaterThan(0);
      expect(stateB?.events.size).toBeGreaterThan(0);
      // Both states scheduled a UI update.
      expect(batchedUpdate.scheduleUpdate).toHaveBeenCalledWith(
        'tab-a',
        expect.anything(),
      );
      expect(batchedUpdate.scheduleUpdate).toHaveBeenCalledWith(
        'tab-b',
        expect.anything(),
      );
    });

    it('handleSessionStats stashes pendingStats on every bound streaming tab and does not finalize', () => {
      const tabA = makeTab({
        id: 'tab-a',
        claudeSessionId: SESSION_ID,
        streamingState: createEmptyStreamingState(),
        status: 'streaming',
      });
      const tabB = makeTab({
        id: 'tab-b',
        claudeSessionId: SESSION_ID,
        streamingState: createEmptyStreamingState(),
        status: 'streaming',
      });
      tabsSignal.set([tabA, tabB]);
      tabManager.findTabsBySessionId.mockReturnValue([tabA, tabB]);

      const result = service.handleSessionStats({
        sessionId: SESSION_ID,
        cost: 0.1,
        tokens: { input: 5, output: 5 },
        duration: 100,
      });

      expect(result).toBeNull();
      const expectedStats = {
        cost: 0.1,
        tokens: { input: 5, output: 5 },
        duration: 100,
      };
      expect(tabA.streamingState?.pendingStats).toEqual(expectedStats);
      expect(tabB.streamingState?.pendingStats).toEqual(expectedStats);
      expect(batchedUpdate.scheduleUpdate).toHaveBeenCalledWith(
        'tab-a',
        tabA.streamingState,
      );
      expect(batchedUpdate.scheduleUpdate).toHaveBeenCalledWith(
        'tab-b',
        tabB.streamingState,
      );
      // The turn boundary is the backend turn_state, never the stats push.
      expect(finalization.finalizeCurrentMessage).not.toHaveBeenCalled();
      expect(tabManager.markTabIdle).not.toHaveBeenCalled();
    });
  });

  // TASK_2026_360: SESSION_STATS is not a turn boundary. The backend
  // `turn_state` event finalizes; stats either wait for it as `pendingStats`
  // (tab still streaming) or patch the finalized last assistant message.
  describe('stats routing (TASK_2026_360)', () => {
    const assistantMsg = {
      id: 'asst-msg-1',
      role: 'assistant' as const,
      content: 'response text',
      tokens: { input: 0, output: 0 },
      cost: 0,
      duration: 0,
    };

    it('stashes pendingStats while the tab still streams — regardless of the terminal-reason tristate', () => {
      const tab = makeTab({
        id: TAB_ID,
        claudeSessionId: SESSION_ID,
        streamingState: createEmptyStreamingState(),
        status: 'streaming',
        lastTerminalReason: undefined,
        messages: [assistantMsg],
        queuedContent: 'next please',
      } as Partial<TabState>);
      tabsSignal.set([tab]);
      tabManager.findTabsBySessionId.mockReturnValue([tab]);

      const result = service.handleSessionStats({
        sessionId: SESSION_ID,
        cost: 0.25,
        tokens: { input: 5, output: 5 },
        duration: 200,
      });

      expect(result).toBeNull();
      expect(tab.streamingState?.pendingStats).toEqual({
        cost: 0.25,
        tokens: { input: 5, output: 5 },
        duration: 200,
      });
      expect(batchedUpdate.scheduleUpdate).toHaveBeenCalledWith(
        TAB_ID,
        tab.streamingState,
      );
      expect(finalization.finalizeCurrentMessage).not.toHaveBeenCalled();
      expect(finalization.markLastAgentAsInterrupted).not.toHaveBeenCalled();
      expect(tabManager.markTabIdle).not.toHaveBeenCalled();
      expect(tabManager.setMessages).not.toHaveBeenCalled();
    });

    it('patches the last assistant message once the tab is finalized (streamingState null)', () => {
      const tab = makeTab({
        id: TAB_ID,
        claudeSessionId: SESSION_ID,
        streamingState: null,
        status: 'loaded',
        lastTerminalReason: 'completed',
        messages: [assistantMsg],
      } as Partial<TabState>);
      tabsSignal.set([tab]);
      tabManager.findTabsBySessionId.mockReturnValue([tab]);

      service.handleSessionStats({
        sessionId: SESSION_ID,
        cost: 0.5,
        tokens: { input: 11, output: 13 },
        duration: 250,
      });

      expect(finalization.finalizeCurrentMessage).not.toHaveBeenCalled();
      expect(tabManager.markTabIdle).not.toHaveBeenCalled();
      expect(tabManager.setMessages).toHaveBeenCalledWith(
        TAB_ID,
        expect.arrayContaining([
          expect.objectContaining({
            id: 'asst-msg-1',
            role: 'assistant',
            tokens: { input: 11, output: 13 },
            cost: 0.5,
            duration: 250,
          }),
        ]),
      );
    });

    it('patches even when no Stop was ever observed (lastTerminalReason undefined)', () => {
      const tab = makeTab({
        id: TAB_ID,
        claudeSessionId: SESSION_ID,
        streamingState: null,
        status: 'loaded',
        lastTerminalReason: undefined,
        messages: [assistantMsg],
      } as Partial<TabState>);
      tabsSignal.set([tab]);
      tabManager.findTabsBySessionId.mockReturnValue([tab]);

      service.handleSessionStats({
        sessionId: SESSION_ID,
        cost: 0.75,
        tokens: { input: 42, output: 17 },
        duration: 333,
      });

      expect(tabManager.setMessages).toHaveBeenCalledWith(
        TAB_ID,
        expect.arrayContaining([
          expect.objectContaining({
            id: 'asst-msg-1',
            tokens: { input: 42, output: 17 },
            cost: 0.75,
            duration: 333,
          }),
        ]),
      );
    });

    it('reports the queued follow-up only when the tab is already finalized', () => {
      const tab = makeTab({
        id: TAB_ID,
        claudeSessionId: SESSION_ID,
        streamingState: null,
        status: 'loaded',
        messages: [assistantMsg],
        queuedContent: 'next please',
      } as Partial<TabState>);
      tabsSignal.set([tab]);
      tabManager.findTabsBySessionId.mockReturnValue([tab]);

      const result = service.handleSessionStats({
        sessionId: SESSION_ID,
        cost: 0.1,
        tokens: { input: 1, output: 1 },
        duration: 10,
      });

      expect(result).toEqual({ tabId: TAB_ID, queuedContent: 'next please' });
    });

    it('stashes onto a background-partition tab while it streams, patches once finalized', () => {
      tabsSignal.set([]);
      const bgState = createEmptyStreamingState();
      const bgTab = makeTab({
        id: 'bg-tab',
        claudeSessionId: SESSION_ID,
        streamingState: bgState,
        messages: [assistantMsg],
      } as Partial<TabState>);
      tabManager.findTabsBySessionId.mockReturnValue([]);
      (
        tabManager as unknown as {
          findTabBySessionIdAcrossWorkspaces: jest.Mock;
        }
      ).findTabBySessionIdAcrossWorkspaces.mockReturnValue({
        tab: bgTab,
        workspacePath: '/ws/bg',
      });
      const updateBackgroundTab = (
        tabManager as unknown as { updateBackgroundTab: jest.Mock }
      ).updateBackgroundTab;

      service.handleSessionStats({
        sessionId: SESSION_ID,
        cost: 0.2,
        tokens: { input: 2, output: 2 },
        duration: 20,
      });

      expect(bgState.pendingStats).toEqual({
        cost: 0.2,
        tokens: { input: 2, output: 2 },
        duration: 20,
      });
      expect(updateBackgroundTab).toHaveBeenCalledWith('bg-tab', {
        streamingState: expect.objectContaining({
          pendingStats: bgState.pendingStats,
        }),
      });
      expect(finalization.finalizeCurrentMessage).not.toHaveBeenCalled();
      expect(tabManager.markTabIdle).not.toHaveBeenCalled();

      // Finalized: streamingState gone → the numbers land on the message.
      (
        tabManager as unknown as {
          findTabBySessionIdAcrossWorkspaces: jest.Mock;
        }
      ).findTabBySessionIdAcrossWorkspaces.mockReturnValue({
        tab: { ...bgTab, streamingState: null },
        workspacePath: '/ws/bg',
      });
      service.handleSessionStats({
        sessionId: SESSION_ID,
        cost: 0.3,
        tokens: { input: 3, output: 3 },
        duration: 30,
      });
      expect(tabManager.setMessages).toHaveBeenCalledWith(
        'bg-tab',
        expect.arrayContaining([
          expect.objectContaining({ id: 'asst-msg-1', cost: 0.3 }),
        ]),
      );
    });
  });

  /**
   * TASK_2026_295 — the backend can emit `sessionId: ''` before the SDK session
   * resolves. `SessionId.from('')` THROWS, and the fan-out lookup that used it
   * ran unconditionally AFTER the event had already been applied to the tab, so
   * the throw was swallowed by the outer catch and the method returned `null` —
   * losing the compaction / queued-content dispatch that `ChatStore` reads.
   */
  describe('empty sessionId on the event', () => {
    it('applies a tabId-routed event without logging a swallowed throw', () => {
      service.processStreamEvent(
        msgStart({ sessionId: '' as unknown as SessionId }),
        TAB_ID,
      );

      expect(currentState().events.has('evt-msg-start')).toBe(true);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('reports compaction_complete instead of swallowing it', () => {
      const result = service.processStreamEvent(
        {
          id: 'evt-compaction-complete',
          eventType: 'compaction_complete',
          timestamp: 9,
          sessionId: '',
          preTokens: 100,
          postTokens: 10,
          durationMs: 5,
          source: 'stream',
        } as unknown as FlatStreamEventUnion,
        TAB_ID,
      );

      expect(result?.compactionComplete).toBe(true);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('never looks a tab up by an unparseable session id', () => {
      service.processStreamEvent(
        msgStart({ sessionId: '' as unknown as SessionId }),
        TAB_ID,
      );

      expect(tabManager.findTabsBySessionId).not.toHaveBeenCalled();
    });

    it('does not hijack the active tab with an empty session id', () => {
      const freshTab = makeTab({
        claudeSessionId: undefined,
        status: 'fresh',
      } as Partial<TabState>);
      tabsSignal.set([freshTab]);

      const result = service.processStreamEvent(
        msgStart({ sessionId: '' as unknown as SessionId }),
      );

      // `attachSession` runs `SessionId.from` internally and would have thrown.
      expect(tabManager.attachSession).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('handleSessionStats does not throw on an empty session id', () => {
      expect(() =>
        service.handleSessionStats({
          sessionId: '',
          cost: 1,
          tokens: { input: 1, output: 1 },
          duration: 1,
        }),
      ).not.toThrow();
    });
  });
});
