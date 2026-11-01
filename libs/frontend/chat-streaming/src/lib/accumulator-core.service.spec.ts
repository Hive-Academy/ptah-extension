import { signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import bgSequence from './__fixtures__/lane-order/bg-agent-events-sequence.json';
/**
 * StreamingAccumulatorCore specs.
 *
 * What is in scope:
 *   - Every event-type case the original `processEventForTab` switch handled,
 *     parametrized so a single test asserts on a fresh `StreamingState`.
 *   - Dedup-source-replay scenarios (duplicate `message_start`, duplicate
 *     `tool_start` from `complete`/`history` source) — these are the exact
 *     cases wizard/harness rely on.
 *   - `agent_start` raises `agentStartFlushNeeded`.
 *   - `compaction_complete` returns a `replacementState` and does NOT mutate
 *     the input state in place.
 *   - `compaction_start` is a pure signal (`compactionStart: true`, no state
 *     mutation).
 *   - Background-agent events forward to BackgroundAgentStore.
 *   - `onAgentStart` and `onStateChanged` hooks fire when supplied.
 *
 * What is intentionally OUT of scope:
 *   - Tab fan-out / queued-content / batched-update scheduling — those live
 *     in the chat wrapper and are covered by `streaming-handler.service.spec.ts`.
 *   - Surface routing — covered by `stream-router.service.spec.ts`.
 *   - Tree finalization — covered by `message-finalization.service.spec.ts`.
 */

import { TestBed } from '@angular/core/testing';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import type {
  AgentStartEvent,
  BackgroundAgentCompletedEvent,
  BackgroundAgentStartedEvent,
  BackgroundAgentStoppedEvent,
  BackgroundTasksSnapshotEvent,
  CompactionCompleteEvent,
  CompactionStartEvent,
  FlatStreamEventUnion,
  MessageCompleteEvent,
  MessageDeltaEvent,
  MessageStartEvent,
  SignatureDeltaEvent,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ThinkingStartEvent,
  ToolDeltaEvent,
  ToolResultEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';

import {
  StreamingAccumulatorCore,
  type AccumulatorContext,
} from './accumulator-core.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { BatchedUpdateService } from './batched-update.service';
import { BackgroundAgentStore } from './background-agent.store';
import { BackgroundTaskStore } from './background-task.store';
import { AgentMonitorStore } from './agent-monitor.store';
import { SessionManager } from './session-manager.service';

// ---------- Helpers --------------------------------------------------------

const SESSION_ID = 'sess-1';
const MESSAGE_ID = 'msg-1';

function msgStart(o: Partial<MessageStartEvent> = {}): MessageStartEvent {
  return {
    id: 'evt-msg-start',
    eventType: 'message_start',
    timestamp: 1,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    role: 'assistant',
    source: 'stream',
    ...o,
  } as MessageStartEvent;
}

function textDelta(o: Partial<TextDeltaEvent> = {}): TextDeltaEvent {
  return {
    id: 'evt-text-1',
    eventType: 'text_delta',
    timestamp: 2,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    blockIndex: 0,
    delta: 'hello',
    source: 'stream',
    ...o,
  } as TextDeltaEvent;
}

function thinkingStart(
  o: Partial<ThinkingStartEvent> = {},
): ThinkingStartEvent {
  return {
    id: 'evt-think-start',
    eventType: 'thinking_start',
    timestamp: 1,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    blockIndex: 0,
    source: 'stream',
    ...o,
  } as ThinkingStartEvent;
}

function thinkingDelta(
  o: Partial<ThinkingDeltaEvent> = {},
): ThinkingDeltaEvent {
  return {
    id: 'evt-think-delta',
    eventType: 'thinking_delta',
    timestamp: 2,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    blockIndex: 0,
    delta: 'thinking...',
    source: 'stream',
    ...o,
  } as ThinkingDeltaEvent;
}

function toolStart(o: Partial<ToolStartEvent> = {}): ToolStartEvent {
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
    ...o,
  } as ToolStartEvent;
}

function toolDelta(o: Partial<ToolDeltaEvent> = {}): ToolDeltaEvent {
  return {
    id: 'evt-tool-delta',
    eventType: 'tool_delta',
    timestamp: 4,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    toolCallId: 'tool-1',
    delta: '{"cmd":',
    source: 'stream',
    ...o,
  } as ToolDeltaEvent;
}

function toolResult(o: Partial<ToolResultEvent> = {}): ToolResultEvent {
  return {
    id: 'evt-tool-result',
    eventType: 'tool_result',
    timestamp: 5,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    toolCallId: 'tool-1',
    output: 'ok',
    isError: false,
    source: 'stream',
    ...o,
  } as ToolResultEvent;
}

function agentStart(o: Partial<AgentStartEvent> = {}): AgentStartEvent {
  return {
    id: 'evt-agent-start',
    eventType: 'agent_start',
    timestamp: 6,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    toolCallId: 'toolu_agent_1',
    agentType: 'general-purpose',
    agentDescription: 'Sub agent A',
    agentId: 'agent-id-1',
    source: 'hook',
    ...o,
  } as AgentStartEvent;
}

function messageComplete(
  o: Partial<MessageCompleteEvent> = {},
): MessageCompleteEvent {
  return {
    id: 'evt-msg-complete',
    eventType: 'message_complete',
    timestamp: 7,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    stopReason: 'end_turn',
    tokenUsage: { input: 10, output: 20 },
    source: 'stream',
    ...o,
  } as MessageCompleteEvent;
}

function messageDelta(o: Partial<MessageDeltaEvent> = {}): MessageDeltaEvent {
  return {
    id: 'evt-msg-delta',
    eventType: 'message_delta',
    timestamp: 7,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    tokenUsage: { input: 1, output: 2 },
    source: 'stream',
    ...o,
  } as MessageDeltaEvent;
}

function signatureDelta(
  o: Partial<SignatureDeltaEvent> = {},
): SignatureDeltaEvent {
  return {
    id: 'evt-sig-delta',
    eventType: 'signature_delta',
    timestamp: 8,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    blockIndex: 0,
    signature: 'sig',
    source: 'stream',
    ...o,
  } as SignatureDeltaEvent;
}

function compactionStart(
  o: Partial<CompactionStartEvent> = {},
): CompactionStartEvent {
  return {
    id: 'evt-compact-start',
    eventType: 'compaction_start',
    timestamp: 9,
    sessionId: SESSION_ID,
    trigger: 'auto',
    ...o,
  } as CompactionStartEvent;
}

function compactionComplete(
  o: Partial<CompactionCompleteEvent> = {},
): CompactionCompleteEvent {
  return {
    id: 'evt-compact-complete',
    eventType: 'compaction_complete',
    timestamp: 10,
    sessionId: SESSION_ID,
    trigger: 'auto',
    ...o,
  } as CompactionCompleteEvent;
}

function bgAgentStarted(
  o: Partial<BackgroundAgentStartedEvent> = {},
): BackgroundAgentStartedEvent {
  return {
    id: 'evt-bg-started',
    eventType: 'background_agent_started',
    timestamp: 11,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    toolCallId: 'toolu_bg_1',
    agentType: 'Explore',
    agentId: 'bg-agent-1',
    source: 'hook',
    ...o,
  } as BackgroundAgentStartedEvent;
}

function bgAgentCompleted(
  o: Partial<BackgroundAgentCompletedEvent> = {},
): BackgroundAgentCompletedEvent {
  return {
    id: 'evt-bg-completed',
    eventType: 'background_agent_completed',
    timestamp: 13,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    toolCallId: 'toolu_bg_1',
    agentId: 'bg-agent-1',
    result: 'done',
    source: 'hook',
    ...o,
  } as BackgroundAgentCompletedEvent;
}

function bgAgentStopped(
  o: Partial<BackgroundAgentStoppedEvent> = {},
): BackgroundAgentStoppedEvent {
  return {
    id: 'evt-bg-stopped',
    eventType: 'background_agent_stopped',
    timestamp: 14,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    toolCallId: 'toolu_bg_1',
    agentId: 'bg-agent-1',
    source: 'hook',
    ...o,
  } as BackgroundAgentStoppedEvent;
}

// ---------- Suite ----------------------------------------------------------

describe('StreamingAccumulatorCore (TASK_2026_107 Phase 2)', () => {
  let core: StreamingAccumulatorCore;
  let sessionManager: jest.Mocked<
    Pick<SessionManager, 'registerAgent' | 'setSessionId' | 'setStatus'>
  >;
  let batchedUpdate: jest.Mocked<
    Pick<BatchedUpdateService, 'scheduleUpdate' | 'flushSync'>
  >;
  let backgroundAgentStore: jest.Mocked<
    Pick<
      BackgroundAgentStore,
      | 'onStarted'
      | 'onCompleted'
      | 'onStopped'
      | 'onAgentCompleted'
      | 'isBackgroundAgent'
    >
  >;
  let agentMonitorStore: jest.Mocked<
    Pick<
      AgentMonitorStore,
      | 'markAgentNodesResumed'
      | 'clearSessionAgents'
      | 'onAgentStart'
      | 'onAgentProgress'
      | 'onAgentStatus'
      | 'onAgentCompleted'
      | 'getSubagent'
      | 'onTaskToolResult'
      | 'onSubagentMessageComplete'
      | 'onBackgroundAgentStarted'
      | 'onBackgroundAgentCompleted'
      | 'onBackgroundAgentStopped'
    >
  >;
  let state: StreamingState;

  function makeCtx(
    overrides: Partial<AccumulatorContext> = {},
  ): AccumulatorContext {
    return {
      sessionManager: sessionManager as unknown as SessionManager,
      deduplication: TestBed.inject(EventDeduplicationService),
      batchedUpdate: batchedUpdate as unknown as BatchedUpdateService,
      backgroundAgentStore:
        backgroundAgentStore as unknown as BackgroundAgentStore,
      agentMonitorStore: agentMonitorStore as unknown as AgentMonitorStore,
      ...overrides,
    };
  }

  beforeEach(() => {
    sessionManager = {
      registerAgent: jest.fn(() => [] as string[]),
      setSessionId: jest.fn(),
      setStatus: jest.fn(),
    } as jest.Mocked<
      Pick<SessionManager, 'registerAgent' | 'setSessionId' | 'setStatus'>
    >;
    batchedUpdate = {
      scheduleUpdate: jest.fn(),
      flushSync: jest.fn(),
    } as jest.Mocked<
      Pick<BatchedUpdateService, 'scheduleUpdate' | 'flushSync'>
    >;
    backgroundAgentStore = {
      onStarted: jest.fn(),
      onCompleted: jest.fn(),
      onStopped: jest.fn(),
      onAgentCompleted: jest.fn(),
      isBackgroundAgent: jest.fn().mockReturnValue(false),
    } as jest.Mocked<
      Pick<
        BackgroundAgentStore,
        | 'onStarted'
        | 'onProgress'
        | 'onCompleted'
        | 'onStopped'
        | 'onAgentCompleted'
        | 'isBackgroundAgent'
      >
    >;
    agentMonitorStore = {
      markAgentNodesResumed: jest.fn(),
      clearSessionAgents: jest.fn(),
      onAgentStart: jest.fn(),
      onAgentProgress: jest.fn(),
      onAgentStatus: jest.fn(),
      onAgentCompleted: jest.fn(),
      getSubagent: jest.fn().mockReturnValue(undefined),
      onTaskToolResult: jest.fn(),
      onSubagentMessageComplete: jest.fn(),
      onBackgroundAgentStarted: jest.fn(),
      onBackgroundAgentCompleted: jest.fn(),
      onBackgroundAgentStopped: jest.fn(),
    } as jest.Mocked<
      Pick<
        AgentMonitorStore,
        | 'markAgentNodesResumed'
        | 'clearSessionAgents'
        | 'onAgentStart'
        | 'onAgentProgress'
        | 'onAgentStatus'
        | 'onAgentCompleted'
        | 'getSubagent'
        | 'onTaskToolResult'
        | 'onSubagentMessageComplete'
        | 'onBackgroundAgentStarted'
        | 'onBackgroundAgentCompleted'
        | 'onBackgroundAgentStopped'
      >
    >;

    TestBed.configureTestingModule({
      providers: [
        StreamingAccumulatorCore,
        {
          provide: TabManagerService,
          useValue: { tabs: signal([]), activeTabSessionId: signal(null) },
        },
        EventDeduplicationService, // real — exercises source-priority logic
        { provide: SessionManager, useValue: sessionManager },
        { provide: BatchedUpdateService, useValue: batchedUpdate },
        { provide: BackgroundAgentStore, useValue: backgroundAgentStore },
        { provide: AgentMonitorStore, useValue: agentMonitorStore },
      ],
    });
    core = TestBed.inject(StreamingAccumulatorCore);
    state = createEmptyStreamingState();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('replaces task rows without writing a tree node and respects skipStoreEffects', () => {
    const store = TestBed.inject(BackgroundTaskStore);
    const snapshot: BackgroundTasksSnapshotEvent = {
      id: 'snapshot-1',
      eventType: 'background_tasks_snapshot',
      timestamp: 1,
      sessionId: SESSION_ID,
      messageId: 'background-tasks-' + SESSION_ID,
      tasks: [{ taskId: 'bash-1', taskType: 'local_bash', description: 'Compile', status: 'running' }],
    };
    const result = core.process(state, snapshot, makeCtx());
    expect(result.stateMutated).toBe(false);
    expect(state.events.size).toBe(0);
    expect(store.tasksForSession(SESSION_ID)).toEqual(snapshot.tasks);

    core.process(state, { ...snapshot, id: 'snapshot-2', tasks: [] }, makeCtx({ skipStoreEffects: true }));
    expect(store.tasksForSession(SESSION_ID)).toEqual(snapshot.tasks);
    core.process(state, { ...snapshot, id: 'snapshot-3', tasks: [] }, makeCtx());
    expect(store.tasksForSession(SESSION_ID)).toEqual([]);
  });

  // ---- Event-type matrix (parametrized over a bare list of events) -------

  describe('event-type matrix', () => {
    type Case = {
      name: string;
      event: FlatStreamEventUnion;
      assert: (s: StreamingState) => void;
    };

    const cases: Case[] = [
      {
        name: 'message_start stores the event and sets currentMessageId',
        event: msgStart(),
        assert: (s) => {
          expect(s.events.has('evt-msg-start')).toBe(true);
          expect(s.currentMessageId).toBe(MESSAGE_ID);
          expect(s.messageEventIds).toContain(MESSAGE_ID);
        },
      },
      {
        name: 'text_delta accumulates into the per-block key',
        event: textDelta({ delta: 'hello' }),
        assert: (s) => {
          expect(s.textAccumulators.get(`${MESSAGE_ID}-block-0`)).toBe('hello');
        },
      },
      {
        name: 'thinking_start stores the event',
        event: thinkingStart(),
        assert: (s) => {
          expect(s.events.has('evt-think-start')).toBe(true);
        },
      },
      {
        name: 'thinking_delta accumulates into the per-block thinking key',
        event: thinkingDelta({ delta: 'reasoning' }),
        assert: (s) => {
          expect(s.textAccumulators.get(`${MESSAGE_ID}-thinking-0`)).toBe(
            'reasoning',
          );
        },
      },
      {
        name: 'tool_start stores event AND tracks toolCallMap entry',
        event: toolStart(),
        assert: (s) => {
          expect(s.events.has('evt-tool-start')).toBe(true);
          expect(s.toolCallMap.get('tool-1')).toEqual(['evt-tool-start']);
        },
      },
      {
        name: 'tool_delta accumulates into the toolInput key',
        event: toolDelta({ delta: '{"cmd":"ls"}' }),
        assert: (s) => {
          expect(s.toolInputAccumulators.get('tool-1-input')).toBe(
            '{"cmd":"ls"}',
          );
        },
      },
      {
        name: 'tool_result stores the event',
        event: toolResult(),
        assert: (s) => {
          expect(s.events.has('evt-tool-result')).toBe(true);
        },
      },
      {
        name: 'message_complete stores the event AND captures token usage',
        event: messageComplete(),
        assert: (s) => {
          expect(s.events.has('evt-msg-complete')).toBe(true);
          expect(s.currentTokenUsage).toEqual({ input: 10, output: 20 });
        },
      },
      {
        name: 'message_delta updates currentTokenUsage',
        event: messageDelta(),
        assert: (s) => {
          expect(s.currentTokenUsage).toEqual({ input: 1, output: 2 });
        },
      },
      {
        name: 'signature_delta stores the event',
        event: signatureDelta(),
        assert: (s) => {
          expect(s.events.has('evt-sig-delta')).toBe(true);
        },
      },
    ];

    cases.forEach(({ name, event, assert }) => {
      it(name, () => {
        const result = core.process(state, event, makeCtx());
        expect(result.stateMutated).toBe(true);
        expect(result.replacementState).toBeNull();
        assert(state);
      });
    });
  });

  // ---- agent_start: dedup + flush + session manager registration ----------

  describe('agent_start', () => {
    it('registers the agent with SessionManager and raises agentStartFlushNeeded', () => {
      const result = core.process(state, agentStart(), makeCtx());

      expect(result.stateMutated).toBe(true);
      expect(result.agentStartFlushNeeded).toBe(true);
      expect(state.events.has('evt-agent-start')).toBe(true);
      expect(sessionManager.registerAgent).toHaveBeenCalledWith(
        'toolu_agent_1',
        expect.objectContaining({
          type: 'agent',
          status: 'streaming',
          agentType: 'general-purpose',
          toolCallId: 'toolu_agent_1',
        }),
        // TASK_2026_154 Wave 2: the owning session id is now tagged so a scoped
        // clearNodeMaps can target it without cross-workspace wipes.
        SESSION_ID,
      );
    });

    it('invokes onAgentStart hook AFTER dedup passes', () => {
      const onAgentStart = jest.fn();
      core.process(state, agentStart(), makeCtx({ onAgentStart }));
      expect(onAgentStart).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'agent_start',
          agentType: 'general-purpose',
        }),
      );
    });

    it('skips onAgentStart and registerAgent on dedup-by-agentId', () => {
      core.process(state, agentStart(), makeCtx());
      sessionManager.registerAgent.mockClear();
      const onAgentStart = jest.fn();

      // Same agentId, lower-priority source → should be deduped (skip).
      const result = core.process(
        state,
        agentStart({
          id: 'evt-agent-start-2',
          source: 'stream',
        }),
        makeCtx({ onAgentStart }),
      );

      expect(result.stateMutated).toBe(false);
      expect(result.agentStartFlushNeeded).toBe(false);
      expect(sessionManager.registerAgent).not.toHaveBeenCalled();
      expect(onAgentStart).not.toHaveBeenCalled();
    });

    // TASK_2026_327: a same-id write replaced the object in `events` only, so
    // the two maps disagreed about the same event id. Every builder reads the
    // per-message bucket, which meant the backfilled `toolu_*` id — the whole
    // point of the backfill — never reached the tool→agent match.
    it('backfill repoints the eventsByMessage bucket at the same object as events', () => {
      // A hook-sourced agent_start carries the SDK's UUID, not the toolu_* id.
      core.process(
        state,
        agentStart({ toolCallId: 'uuid-from-hook', source: 'hook' }),
        makeCtx(),
      );

      const beforeBackfill = state.events.get('evt-agent-start');
      expect(beforeBackfill).toBeDefined();
      expect(state.eventsByMessage.get(MESSAGE_ID)).toContain(beforeBackfill);

      // The subagent's first message_start is what carries the real toolu_* id.
      core.process(
        state,
        msgStart({
          id: 'evt-sub-msg-start',
          messageId: 'msg-sub',
          parentToolUseId: 'toolu_real_id',
        }),
        makeCtx(),
      );

      const afterBackfill = state.events.get(
        'evt-agent-start',
      ) as AgentStartEvent;
      expect(afterBackfill.toolCallId).toBe('toolu_real_id');
      expect(afterBackfill).not.toBe(beforeBackfill);

      const indexed = state.eventsByMessage
        .get(MESSAGE_ID)
        ?.find((event) => event.id === 'evt-agent-start');
      expect(indexed).toBe(afterBackfill);
      // …and the stale copy is gone from the bucket entirely.
      expect(state.eventsByMessage.get(MESSAGE_ID)).not.toContain(
        beforeBackfill,
      );
    });

    // TASK_2026_327 finding 6: a same-id replacement that changes `messageId`
    // left the stale object in the OLD bucket. The old bucket kept pointing at
    // a pre-replacement event the reader was never told had moved.
    it('removes the stale entry from the old bucket when a same-id write re-parents the message', () => {
      // A message_start arrives under msg-a.
      core.process(
        state,
        msgStart({ id: 'evt-msg-shared', messageId: 'msg-a' }),
        makeCtx(),
      );

      const before = state.events.get('evt-msg-shared');
      expect(before).toBeDefined();
      expect(state.eventsByMessage.get('msg-a')).toContain(before);

      // The same event id is re-processed under a different message — a
      // re-parent that the accumulator replays through setStreamingEventCapped.
      core.process(
        state,
        msgStart({ id: 'evt-msg-shared', messageId: 'msg-b' }),
        makeCtx(),
      );

      const after = state.events.get('evt-msg-shared');
      expect(after).toBeDefined();

      // The old bucket no longer holds the stale object. It may have been
      // deleted entirely when the last entry was removed — that is correct.
      const oldBucket = state.eventsByMessage.get('msg-a');
      expect(oldBucket ?? []).not.toContain(before);
      // The new bucket holds the current object.
      const newBucket = state.eventsByMessage.get('msg-b');
      expect(newBucket).toContain(after);
    });
  });

  // ---- Inbound peer label survives the write path (TASK_2026_402) --------

  describe('inbound peer label on message_start', () => {
    it('keeps the label on the stored event', () => {
      core.process(
        state,
        msgStart({ role: 'user', inboundPeer: { label: 'reviewer' } }),
        makeCtx(),
      );

      const stored = state.events.get('evt-msg-start') as
        MessageStartEvent | undefined;
      expect(stored?.inboundPeer).toEqual({ label: 'reviewer' });
    });

    it('keeps the label on the event in the eventsByMessage bucket', () => {
      core.process(
        state,
        msgStart({ role: 'user', inboundPeer: { label: 'planner' } }),
        makeCtx(),
      );

      const bucket = state.eventsByMessage.get(MESSAGE_ID) ?? [];
      const indexed = bucket.find(
        (e) => e.eventType === 'message_start',
      ) as MessageStartEvent;
      expect(indexed.inboundPeer).toEqual({ label: 'planner' });
    });

    it('leaves the field absent on an ordinary user turn', () => {
      core.process(state, msgStart({ role: 'user' }), makeCtx());

      const stored = state.events.get('evt-msg-start') as MessageStartEvent;
      expect(stored).not.toHaveProperty('inboundPeer');
    });
  });

  // ---- Dedup-source-replay: the wizard/harness regression cases ----------

  describe('captured background sequence', () => {
    it.each(['sdk', 'background', 'late-status'])(
      'settles completion through %s after the early placeholder',
      (variant) => {
        // The live capture is an event envelope projection: restore omitted required
        // payload fields while retaining its actual order, timestamps and identity.
        const monitor = TestBed.runInInjectionContext(
          () => new AgentMonitorStore(),
        );
        const ctx = makeCtx({ agentMonitorStore: monitor });
        const key = bgSequence[0].toolCallId;
        if (!key) throw new Error('capture has no tool key');
        for (const [index, row] of bgSequence.entries()) {
          if (row.toolCallId !== key && row.parentToolUseId !== key) continue;
          if (
            variant === 'background' &&
            (row.eventType === 'agent_completed' ||
              row.eventType === 'agent_status')
          )
            continue;
          const event = {
            ...row,
            id: `capture-${index}`,
            timestamp: Date.parse(row.t),
            source: 'complete',
            output:
              'Agent running in the background. agentId: a6942d6496519ada4',
            isError: false,
            toolName: 'Task',
            agentType: 'general-purpose',
            summary: 'done',
            outputFile: '',
          } as FlatStreamEventUnion;
          core.process(state, event, ctx);
          if (row.eventType === 'tool_result')
            expect(monitor.getSubagent(key)?.status).toBe('running');
        }
        if (variant === 'background')
          core.process(state, { ...bgAgentCompleted(), toolCallId: key }, ctx);
        if (variant === 'late-status')
          core.process(
            state,
            {
              id: 'late',
              eventType: 'agent_status',
              timestamp: Date.now(),
              sessionId: SESSION_ID,
              messageId: MESSAGE_ID,
              parentToolUseId: key,
              taskId: monitor.getSubagent(key)?.taskId ?? 'task',
              status: 'running',
            },
            ctx,
          );
        expect(monitor.getSubagent(key)?.status).toBe('completed');
      },
    );
  });

  describe('dedup-source-replay (wizard/harness regression coverage)', () => {
    it('duplicate message_start with `complete` source REPLACES the prior stream message_start (no duplicate messageEventIds)', () => {
      const first = core.process(
        state,
        msgStart({ source: 'stream' }),
        makeCtx(),
      );
      expect(first.stateMutated).toBe(true);
      const eventCountBefore = state.events.size;

      // SDK replays the same messageId from `complete` source. Dedup deletes
      // the old event (lower priority `stream`) and lets the new event in
      // WITHOUT a second push to messageEventIds. Net events.size delta = 0.
      const messageEventIdsBefore = [...state.messageEventIds];
      const second = core.process(
        state,
        msgStart({ id: 'evt-msg-start-2', source: 'complete' }),
        makeCtx(),
      );

      expect(second.stateMutated).toBe(true);
      // Same messageId — should not be duplicated in messageEventIds.
      const finalIds = state.messageEventIds.filter((id) => id === MESSAGE_ID);
      expect(finalIds).toHaveLength(messageEventIdsBefore.length);
      // Replace semantics: old deleted, new added → net change 0.
      expect(state.events.size).toBe(eventCountBefore);
    });

    it('duplicate message_start with EQUAL-priority replay (`stream` over `stream`) is replaced (>= comparator) and stateMutated=true', () => {
      // The `>=` comparator in shouldReplaceEvent means an equal-priority
      // replay still REPLACES. This documents the actual semantics: dedup
      // never returns `skip:true` for `stream→stream` on message_start;
      // only `existingHigher → newLower` can return skip.
      core.process(state, msgStart({ source: 'stream' }), makeCtx());
      const sizeBefore = state.events.size;

      const result = core.process(
        state,
        msgStart({ id: 'evt-msg-start-replay', source: 'stream' }),
        makeCtx(),
      );

      expect(result.stateMutated).toBe(true);
      expect(state.events.size).toBe(sizeBefore);
    });

    it('lower-priority duplicate tool_start (e.g. `stream` after `complete`) is SKIPPED with stateMutated=false', () => {
      // Ingest the high-priority `complete` event first.
      core.process(state, toolStart({ source: 'complete' }), makeCtx());
      const sizeBefore = state.events.size;

      // SDK replays the same toolCallId from a lower-priority `stream`
      // source. shouldReplaceEvent returns false → dedup returns the
      // existing event → core returns `skip(...)`.
      const result = core.process(
        state,
        toolStart({ id: 'evt-tool-start-replay', source: 'stream' }),
        makeCtx(),
      );

      expect(result.stateMutated).toBe(false);
      // No new event written.
      expect(state.events.size).toBe(sizeBefore);
    });

    it('text_delta from `complete` source after a stream message_start clears prior text accumulators for that messageId', () => {
      // Stream-source message_start + delta — accumulates "Hi"
      core.process(state, msgStart({ source: 'stream' }), makeCtx());
      core.process(
        state,
        textDelta({ id: 'evt-text-stream', delta: 'Hi', source: 'stream' }),
        makeCtx(),
      );
      expect(state.textAccumulators.get(`${MESSAGE_ID}-block-0`)).toBe('Hi');

      // Complete-source replacement message_start marks the messageId for
      // deferred clearing; the next complete-source text_delta wipes the
      // text accumulator and writes the complete delta verbatim.
      core.process(
        state,
        msgStart({ id: 'evt-msg-start-c', source: 'complete' }),
        makeCtx(),
      );
      core.process(
        state,
        textDelta({ id: 'evt-text-c', delta: 'Hello', source: 'complete' }),
        makeCtx(),
      );

      // The complete-source delta WIPED the prior accumulator and wrote
      // the canonical value — no doubling.
      expect(state.textAccumulators.get(`${MESSAGE_ID}-block-0`)).toBe('Hello');
    });

    it('thinking_delta clearing is type-split — does not wipe text accumulator', () => {
      // Prime: stream text + thinking
      core.process(state, msgStart({ source: 'stream' }), makeCtx());
      core.process(
        state,
        textDelta({ id: 'evt-text', delta: 'Hi', source: 'stream' }),
        makeCtx(),
      );
      core.process(
        state,
        thinkingDelta({
          id: 'evt-think',
          delta: 'reasoning',
          source: 'stream',
        }),
        makeCtx(),
      );
      expect(state.textAccumulators.get(`${MESSAGE_ID}-block-0`)).toBe('Hi');
      expect(state.textAccumulators.get(`${MESSAGE_ID}-thinking-0`)).toBe(
        'reasoning',
      );

      // Complete-source message_start marks BOTH text+thinking for deferred
      // clearing. The next complete-source thinking_delta clears ONLY the
      // thinking key — text remains untouched.
      core.process(
        state,
        msgStart({ id: 'evt-msg-c', source: 'complete' }),
        makeCtx(),
      );
      core.process(
        state,
        thinkingDelta({
          id: 'evt-think-c',
          delta: 'final thinking',
          source: 'complete',
        }),
        makeCtx(),
      );

      // Thinking REPLACED, text PRESERVED.
      expect(state.textAccumulators.get(`${MESSAGE_ID}-thinking-0`)).toBe(
        'final thinking',
      );
      expect(state.textAccumulators.get(`${MESSAGE_ID}-block-0`)).toBe('Hi');
    });

    it('text_delta after message finalization (messageId in processedMessageIds but NOT in messageEventIds) is dropped', () => {
      const dedup = TestBed.inject(EventDeduplicationService);
      // Simulate a fully finalized message: dedup remembers the messageId
      // but the message_start has been pruned from the streaming state
      // (chat finalizes by clearing messageEventIds).
      dedup.getProcessedMessageIds(SESSION_ID).add(MESSAGE_ID);
      // Note: state.messageEventIds is intentionally empty.

      const result = core.process(
        state,
        textDelta({ id: 'evt-text-orphan' }),
        makeCtx(),
      );

      expect(result.stateMutated).toBe(false);
      expect(state.textAccumulators.size).toBe(0);
    });
  });

  // ---- Compaction lifecycle ---------------------------------------------

  it('forwards the compact-boundary measurement unchanged', () => {
    const measurement = {
      source: 'sdk-compact-metadata' as const,
      boundaryId: 'A',
      preTokens: 1000,
      postTokens: 600,
    };
    const result = core.process(
      state,
      compactionComplete({ boundaryId: 'A', measurement }),
      makeCtx(),
    );
    expect(result.measurement).toBe(measurement);
    expect(result.boundaryId).toBe('A');
  });

  describe('compaction lifecycle', () => {
    it('passes the idle notice only from a matching completion event', () => {
      const notice = { preTokens: 12345 };
      const result = core.process(
        state,
        compactionComplete({ idleCompaction: notice }),
        makeCtx(),
      );
      expect(result.idleCompaction).toEqual(notice);
      expect(
        core.process(state, compactionComplete(), makeCtx()).idleCompaction,
      ).toBeUndefined();
    });
    it('compaction_start does NOT mutate state but returns compactionStart=true', () => {
      // Prime with a few events so we can verify state is untouched.
      core.process(state, msgStart(), makeCtx());
      const eventsBefore = state.events.size;

      const result = core.process(state, compactionStart(), makeCtx());

      expect(result.compactionStart).toBe(true);
      expect(result.stateMutated).toBe(false);
      expect(result.replacementState).toBeNull();
      expect(state.events.size).toBe(eventsBefore);
    });

    it('compaction_complete returns a fresh replacementState and does NOT mutate the input state', () => {
      core.process(state, msgStart(), makeCtx());
      const inputStateRef = state;
      const eventsBefore = state.events.size;

      const result = core.process(state, compactionComplete(), makeCtx());

      expect(result.compactionComplete).toBe(true);
      expect(result.replacementState).not.toBeNull();
      expect(result.replacementState).not.toBe(inputStateRef);
      // Input state ref UNCHANGED.
      expect(state).toBe(inputStateRef);
      expect(state.events.size).toBe(eventsBefore);
      // Replacement is empty.
      expect(result.replacementState?.events.size).toBe(0);
      expect(result.replacementState?.messageEventIds).toHaveLength(0);
    });

    it('retains the live TodoWrite marker across compaction', () => {
      state.latestTodoWrite = { toolCallId: 'todo-live', timestamp: 5 };
      const result = core.process(state, compactionComplete(), makeCtx());
      expect(result.replacementState?.latestTodoWrite).toEqual({
        toolCallId: 'todo-live',
        timestamp: 5,
      });
      expect(result.replacementState?.events.size).toBe(0);
      expect(state.latestTodoWrite?.toolCallId).toBe('todo-live');
    });

    it('compaction_complete clears dedup state for the session', () => {
      // Ingest a stream message_start so dedup tracks the messageId.
      core.process(state, msgStart({ source: 'stream' }), makeCtx());
      const dedup = TestBed.inject(EventDeduplicationService);
      expect(dedup.getProcessedMessageIds(SESSION_ID).has(MESSAGE_ID)).toBe(
        true,
      );

      core.process(state, compactionComplete(), makeCtx());

      expect(dedup.getProcessedMessageIds(SESSION_ID).has(MESSAGE_ID)).toBe(
        false,
      );
    });
  });

  // ---- Background agents -------------------------------------------------

  describe('background_agent_* events forward to BackgroundAgentStore', () => {
    it('background_agent_started → onStarted', () => {
      core.process(state, bgAgentStarted(), makeCtx());
      expect(backgroundAgentStore.onStarted).toHaveBeenCalled();
    });
    it('background_agent_started also merges identity into the monitor record', () => {
      const event = bgAgentStarted();
      core.process(state, event, makeCtx());
      expect(agentMonitorStore.onBackgroundAgentStarted).toHaveBeenCalledWith(
        event,
      );
    });
    it('background_agent_completed → onCompleted', () => {
      core.process(state, bgAgentCompleted(), makeCtx());
      expect(backgroundAgentStore.onCompleted).toHaveBeenCalled();
    });
    it('background_agent_stopped → onStopped', () => {
      core.process(state, bgAgentStopped(), makeCtx());
      expect(backgroundAgentStore.onStopped).toHaveBeenCalled();
    });
    it('agent_completed also settles the background store entry', () => {
      // Most background spawns get no background_agent_completed, so the
      // tray entry stayed running while the monitor record finished.
      const event: FlatStreamEventUnion = {
        id: 'completed-bg',
        eventType: 'agent_completed',
        timestamp: 17,
        sessionId: SESSION_ID,
        messageId: MESSAGE_ID,
        parentToolUseId: 'toolu_agent_1',
        taskId: 'task-1',
        status: 'completed',
        summary: 'Done',
        outputFile: '',
      };
      core.process(state, event, makeCtx());
      expect(agentMonitorStore.onAgentCompleted).toHaveBeenCalledWith(event);
      expect(backgroundAgentStore.onAgentCompleted).toHaveBeenCalledWith(event);
    });
  });

  // ---- Subagent usage via message_complete (TASK_2026_597 N6) -------------

  describe('message_complete feeds subagent usage', () => {
    it('forwards a subagent message to onSubagentMessageComplete', () => {
      const event = messageComplete({ parentToolUseId: 'tool-1' });
      core.process(state, event, makeCtx());
      expect(agentMonitorStore.onSubagentMessageComplete).toHaveBeenCalledWith(
        event,
      );
    });

    it('does not forward a main-session message', () => {
      core.process(state, messageComplete(), makeCtx());
      expect(
        agentMonitorStore.onSubagentMessageComplete,
      ).not.toHaveBeenCalled();
    });
  });

  describe('skipStoreEffects', () => {
    it('retains agent events without registering or notifying the agent monitor or hook', () => {
      const onAgentStart = jest.fn();
      const onStateChanged = jest.fn();
      const result = core.process(
        state,
        agentStart(),
        makeCtx({ skipStoreEffects: true, onAgentStart, onStateChanged }),
      );

      expect(result.stateMutated).toBe(true);
      expect(state.events.has('evt-agent-start')).toBe(true);
      expect(sessionManager.registerAgent).not.toHaveBeenCalled();
      expect(onStateChanged).toHaveBeenCalledWith(state);
      expect(onAgentStart).not.toHaveBeenCalled();
      expect(agentMonitorStore.onAgentStart).not.toHaveBeenCalled();
    });

    it('does not drain live pending deltas during a replay', () => {
      sessionManager.registerAgent.mockReturnValueOnce(['live pending delta']);
      core.process(state, agentStart(), makeCtx({ skipStoreEffects: true }));
      expect(sessionManager.registerAgent).not.toHaveBeenCalled();
    });

    it('leaves background and agent lifecycle stores untouched during replay', () => {
      const ctx = makeCtx({ skipStoreEffects: true });
      const lifecycleEvents: FlatStreamEventUnion[] = [
        bgAgentStarted(),
        bgAgentCompleted(),
        bgAgentStopped(),
        {
          id: 'progress',
          eventType: 'agent_progress',
          timestamp: 15,
          sessionId: SESSION_ID,
          messageId: MESSAGE_ID,
          parentToolUseId: 'toolu_agent_1',
          taskId: 'task-1',
          description: 'Working',
          totalTokens: 10,
          toolUses: 1,
          durationMs: 100,
        },
        {
          id: 'status',
          eventType: 'agent_status',
          timestamp: 16,
          sessionId: SESSION_ID,
          messageId: MESSAGE_ID,
          parentToolUseId: 'toolu_agent_1',
          taskId: 'task-1',
          status: 'running',
        },
        {
          id: 'completed',
          eventType: 'agent_completed',
          timestamp: 17,
          sessionId: SESSION_ID,
          messageId: MESSAGE_ID,
          parentToolUseId: 'toolu_agent_1',
          taskId: 'task-1',
          status: 'completed',
          summary: 'Done',
          outputFile: '',
        },
      ];
      for (const event of lifecycleEvents) core.process(state, event, ctx);
      expect(backgroundAgentStore.onStarted).not.toHaveBeenCalled();
      expect(backgroundAgentStore.onCompleted).not.toHaveBeenCalled();
      expect(
        agentMonitorStore.onBackgroundAgentCompleted,
      ).not.toHaveBeenCalled();
      expect(agentMonitorStore.onBackgroundAgentStopped).not.toHaveBeenCalled();
      expect(backgroundAgentStore.onStopped).not.toHaveBeenCalled();
      expect(agentMonitorStore.onBackgroundAgentStarted).not.toHaveBeenCalled();
      expect(agentMonitorStore.onAgentProgress).not.toHaveBeenCalled();
      expect(agentMonitorStore.onAgentStatus).not.toHaveBeenCalled();
      expect(agentMonitorStore.onAgentCompleted).not.toHaveBeenCalled();
      expect(backgroundAgentStore.onAgentCompleted).not.toHaveBeenCalled();
      expect(sessionManager.registerAgent).not.toHaveBeenCalled();
    });

    it('does not read or update the agent monitor for a Task result or subagent completion', () => {
      const ctx = makeCtx({ skipStoreEffects: true });
      core.process(state, toolResult(), ctx);
      core.process(state, messageComplete({ parentToolUseId: 'tool-1' }), ctx);

      expect(state.events.has('evt-tool-result')).toBe(true);
      expect(state.events.has('evt-msg-complete')).toBe(true);
      expect(agentMonitorStore.getSubagent).not.toHaveBeenCalled();
      expect(agentMonitorStore.onTaskToolResult).not.toHaveBeenCalled();
      expect(
        agentMonitorStore.onSubagentMessageComplete,
      ).not.toHaveBeenCalled();
    });
  });

  // ---- Foreground completion via Task tool_result ------------------------

  describe('tool_result drives foreground subagent completion', () => {
    const RUNNING_RECORD = {
      parentToolUseId: 'tool-1',
      status: 'running',
    } as unknown as ReturnType<AgentMonitorStore['getSubagent']>;

    it('forwards a Task tool_result to onTaskToolResult with the error flag', () => {
      agentMonitorStore.getSubagent.mockReturnValue(RUNNING_RECORD);
      core.process(state, toolResult({ isError: false }), makeCtx());
      expect(agentMonitorStore.onTaskToolResult).toHaveBeenCalledWith(
        'tool-1',
        false,
        5,
      );
    });

    it('propagates an error tool_result', () => {
      agentMonitorStore.getSubagent.mockReturnValue(RUNNING_RECORD);
      core.process(state, toolResult({ isError: true }), makeCtx());
      expect(agentMonitorStore.onTaskToolResult).toHaveBeenCalledWith(
        'tool-1',
        true,
        5,
      );
    });

    it('does NOT forward for an ordinary tool_result (no subagent record)', () => {
      agentMonitorStore.getSubagent.mockReturnValue(undefined);
      core.process(state, toolResult(), makeCtx());
      expect(agentMonitorStore.onTaskToolResult).not.toHaveBeenCalled();
    });

    it('skips a task already registered as a background agent', () => {
      agentMonitorStore.getSubagent.mockReturnValue(RUNNING_RECORD);
      backgroundAgentStore.isBackgroundAgent.mockReturnValue(true);
      core.process(state, toolResult(), makeCtx());
      expect(agentMonitorStore.onTaskToolResult).not.toHaveBeenCalled();
    });

    it('skips the SDK "running in the background" placeholder tool_result', () => {
      agentMonitorStore.getSubagent.mockReturnValue(RUNNING_RECORD);
      core.process(
        state,
        toolResult({ output: 'Task is now running in the background.' }),
        makeCtx(),
      );
      expect(agentMonitorStore.onTaskToolResult).not.toHaveBeenCalled();
    });

    it('skips the Claude Code 2.1.259 "working in the background" placeholder (default background spawn)', () => {
      agentMonitorStore.getSubagent.mockReturnValue(RUNNING_RECORD);
      backgroundAgentStore.isBackgroundAgent.mockReturnValue(false);
      core.process(
        state,
        toolResult({
          output: [
            {
              type: 'text',
              text:
                'Async agent launched successfully. (This tool result is internal metadata)\n' +
                'agentId: a26543235eb9de974 (internal ID)\n' +
                'The agent is working in the background. You will be notified automatically when it completes.',
            },
          ],
        }),
        makeCtx(),
      );
      expect(agentMonitorStore.onTaskToolResult).not.toHaveBeenCalled();
    });

    it('forwards on the mutating occurrence but NOT behind a dedup skip', () => {
      agentMonitorStore.getSubagent.mockReturnValue(RUNNING_RECORD);
      // 'complete' is the definitive (mutating) occurrence — forwards.
      core.process(state, toolResult({ source: 'complete' }), makeCtx());
      // A lower-priority 'stream' duplicate is a dedup skip (returns early
      // before the forward), so it must NOT re-fire. (Equal/higher-priority
      // replacements would re-fire, but AgentMonitorStore.onTaskToolResult is
      // idempotent — it no-ops once the record is terminal.)
      core.process(state, toolResult({ source: 'stream' }), makeCtx());
      expect(agentMonitorStore.onTaskToolResult).toHaveBeenCalledTimes(1);
    });
  });

  // ---- onStateChanged hook ----------------------------------------------

  describe('onStateChanged hook', () => {
    it('fires once per mutating event with the (possibly mutated) state', () => {
      const onStateChanged = jest.fn();
      core.process(state, msgStart(), makeCtx({ onStateChanged }));
      core.process(
        state,
        textDelta({ id: 'evt-t-1', delta: 'a' }),
        makeCtx({ onStateChanged }),
      );
      core.process(state, messageComplete(), makeCtx({ onStateChanged }));

      // 3 mutating events, 3 hook fires (compaction_start would be 0).
      expect(onStateChanged).toHaveBeenCalledTimes(3);
    });

    it('on compaction_complete, fires with the FRESH replacement state (not the input)', () => {
      const onStateChanged = jest.fn();
      core.process(state, msgStart(), makeCtx({ onStateChanged }));
      onStateChanged.mockClear();

      const result = core.process(
        state,
        compactionComplete(),
        makeCtx({ onStateChanged }),
      );

      expect(onStateChanged).toHaveBeenCalledWith(result.replacementState);
      // The argument MUST be the fresh state, not the original.
      expect(onStateChanged.mock.calls[0][0]).not.toBe(state);
    });

    it('does NOT fire on a dedup-skip (lower-priority duplicate after high-priority)', () => {
      const onStateChanged = jest.fn();
      // High-priority `complete` first.
      core.process(state, toolStart({ source: 'complete' }), makeCtx());
      onStateChanged.mockClear();

      // Lower-priority `stream` replay — dedup returns existingEvent →
      // core returns skip → onStateChanged is NOT invoked.
      core.process(
        state,
        toolStart({ id: 'evt-tool-2', source: 'stream' }),
        makeCtx({ onStateChanged }),
      );

      expect(onStateChanged).not.toHaveBeenCalled();
    });
  });

  // ---- Idempotency under multi-surface fan-out ----------------------

  describe('multi-surface fan-out idempotency (TASK_2026_106 Phase 4b parity)', () => {
    it('processing the same event twice against TWO independent state slots dedups conversation-level state once', () => {
      const stateA = createEmptyStreamingState();
      const stateB = createEmptyStreamingState();
      const dedup = TestBed.inject(EventDeduplicationService);

      const evt = msgStart({ source: 'stream' });
      core.process(stateA, evt, makeCtx());
      core.process(stateB, evt, makeCtx());

      // Per-state mutation: BOTH slots received the event.
      expect(stateA.events.has('evt-msg-start')).toBe(true);
      expect(stateB.events.has('evt-msg-start')).toBe(true);
      // Conversation-level dedup: messageId tracked exactly ONCE per session.
      const tracked = dedup.getProcessedMessageIds(SESSION_ID);
      expect([...tracked].filter((id) => id === MESSAGE_ID)).toHaveLength(1);
    });
  });

  // ---- clearPendingClears -----------------------------------------------

  it('clearPendingClears wipes the deferred-clear sets without disturbing dedup', () => {
    core.process(state, msgStart({ source: 'stream' }), makeCtx());
    // Mark a pending clear.
    core.process(
      state,
      msgStart({ id: 'evt-msg-c', source: 'complete' }),
      makeCtx(),
    );
    // (We can't directly observe pendingTextClear, but verifying no throw
    // and dedup-state preservation is the contract this method offers.)
    expect(() => core.clearPendingClears()).not.toThrow();
    const dedup = TestBed.inject(EventDeduplicationService);
    expect(dedup.getProcessedMessageIds(SESSION_ID).has(MESSAGE_ID)).toBe(true);
  });
});
