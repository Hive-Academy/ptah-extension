/**
 * ExecutionTreeBuilderService — incremental-rebuild contract (TASK_2026_323).
 *
 * The tree used to be rebuilt from scratch for the WHOLE conversation on every
 * streamed chunk, because the memo fingerprint included `events.size` and each
 * `text_delta` inserts a new event. These tests pin the replacement:
 *
 * - an unchanged conversation returns the previous array by reference;
 * - a message that receives deltas is the ONLY message handed to the builder;
 * - object identity survives a rebuild for the parts that did not change;
 * - the cost stays flat enough that thousands of deltas across dozens of tool
 *   calls build in well under a second.
 *
 * Events are pushed through the real {@link StreamingAccumulatorCore} rather
 * than hand-written into the state maps, so the revision counters and the
 * timestamp-ordered `eventsByMessage` buckets are exercised on the same path
 * production uses.
 */

import { TestBed } from '@angular/core/testing';
import type {
  ExecutionNode,
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
  ToolDeltaEvent,
  ToolResultEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import {
  createEmptyStreamingState,
  setStreamingEventCapped,
  STREAMING_EVENT_CAP,
  type StreamingState,
} from '@ptah-extension/chat-types';
import {
  buildStreamingIndexes,
  type BuilderDeps,
} from '@ptah-extension/chat-execution-tree';

import {
  StreamingAccumulatorCore,
  type AccumulatorContext,
} from './accumulator-core.service';
import { AgentMonitorStore } from './agent-monitor.store';
import { BackgroundAgentStore } from './background-agent.store';
import { BatchedUpdateService } from './batched-update.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { SessionManager } from './session-manager.service';

const SESSION_ID = 'session-323';

describe('ExecutionTreeBuilderService — incremental rebuild', () => {
  let builder: ExecutionTreeBuilderService;
  let accumulator: StreamingAccumulatorCore;
  let ctx: AccumulatorContext;
  let state: StreamingState;
  let clock: number;

  /** Monotonic timestamps so `eventsByMessage` stays append-ordered. */
  const nextTimestamp = (): number => (clock += 1);

  const feed = (event: FlatStreamEventUnion): void => {
    accumulator.process(state, event, ctx);
  };

  const messageStart = (
    messageId: string,
    role: 'user' | 'assistant',
  ): MessageStartEvent =>
    ({
      id: `evt-start-${messageId}`,
      eventType: 'message_start',
      timestamp: nextTimestamp(),
      sessionId: SESSION_ID,
      source: 'stream',
      messageId,
      role,
    }) as MessageStartEvent;

  const textDelta = (
    messageId: string,
    seq: number,
    delta = 'x',
  ): TextDeltaEvent =>
    ({
      id: `evt-text-${messageId}-${seq}`,
      eventType: 'text_delta',
      timestamp: nextTimestamp(),
      sessionId: SESSION_ID,
      source: 'stream',
      messageId,
      delta,
      blockIndex: 0,
    }) as TextDeltaEvent;

  const toolStart = (messageId: string, toolCallId: string): ToolStartEvent =>
    ({
      id: `evt-tool-${toolCallId}`,
      eventType: 'tool_start',
      timestamp: nextTimestamp(),
      sessionId: SESSION_ID,
      source: 'stream',
      messageId,
      toolCallId,
      toolName: 'Read',
      isTaskTool: false,
    }) as ToolStartEvent;

  const toolDelta = (
    messageId: string,
    toolCallId: string,
    delta: string,
  ): ToolDeltaEvent =>
    ({
      id: `evt-tooldelta-${toolCallId}`,
      eventType: 'tool_delta',
      timestamp: nextTimestamp(),
      sessionId: SESSION_ID,
      source: 'stream',
      messageId,
      toolCallId,
      delta,
    }) as ToolDeltaEvent;

  const toolResult = (messageId: string, toolCallId: string): ToolResultEvent =>
    ({
      id: `evt-result-${toolCallId}`,
      eventType: 'tool_result',
      timestamp: nextTimestamp(),
      sessionId: SESSION_ID,
      source: 'stream',
      messageId,
      toolCallId,
      output: 'ok',
      isError: false,
    }) as ToolResultEvent;

  /**
   * Replace `deps.buildMessageNode` with a counting wrapper. Recursion inside
   * the builders also goes through this property, so nested subagent messages
   * are counted too.
   */
  const spyOnMessageBuilds = (): jest.Mock => {
    const deps = (builder as unknown as { deps: BuilderDeps }).deps;
    const original = deps.buildMessageNode;
    const spy = jest.fn(original);
    (
      deps as { buildMessageNode: BuilderDeps['buildMessageNode'] }
    ).buildMessageNode = spy;
    return spy;
  };

  beforeEach(() => {
    // Same stubbing shape as `accumulator-core.service.spec.ts`: the real
    // dedup + background stores participate (the builder reads both), while
    // the tab/monitor collaborators are stubbed so the DI graph stops here
    // instead of reaching into chat-state.
    const sessionManager = {
      registerAgent: jest.fn().mockReturnValue([]),
    } as unknown as SessionManager;
    const batchedUpdate = {
      scheduleUpdate: jest.fn(),
      flushSync: jest.fn(),
    } as unknown as BatchedUpdateService;
    const agentMonitorStore = {
      onAgentStart: jest.fn(),
      onAgentProgress: jest.fn(),
      onAgentStatus: jest.fn(),
      onAgentCompleted: jest.fn(),
      getSubagent: jest.fn().mockReturnValue(undefined),
      onTaskToolResult: jest.fn(),
    } as unknown as AgentMonitorStore;

    TestBed.configureTestingModule({
      providers: [
        StreamingAccumulatorCore,
        ExecutionTreeBuilderService,
        EventDeduplicationService,
        BackgroundAgentStore,
        { provide: SessionManager, useValue: sessionManager },
        { provide: BatchedUpdateService, useValue: batchedUpdate },
        { provide: AgentMonitorStore, useValue: agentMonitorStore },
      ],
    });

    builder = TestBed.inject(ExecutionTreeBuilderService);
    accumulator = TestBed.inject(StreamingAccumulatorCore);
    ctx = {
      sessionManager,
      deduplication: TestBed.inject(EventDeduplicationService),
      batchedUpdate,
      backgroundAgentStore: TestBed.inject(BackgroundAgentStore),
      agentMonitorStore,
    };
    state = createEmptyStreamingState();
    clock = 1_000;
  });

  afterEach(() => {
    builder.clearCache();
  });

  it('returns the previous array by reference when nothing changed', () => {
    feed(messageStart('msg-a', 'assistant'));
    feed(textDelta('msg-a', 0, 'hello'));

    const first = builder.buildTree(state, 'k');
    const second = builder.buildTree(state, 'k');

    expect(second).toBe(first);
    expect(first).toHaveLength(1);
    expect(first[0].children.map((c) => c.content)).toEqual(['hello']);
  });

  it('rebuilds ONLY the message that received deltas — 1 000 of them', () => {
    feed(messageStart('msg-user', 'user'));
    feed(textDelta('msg-user', 0, 'question'));
    feed(messageStart('msg-assistant', 'assistant'));
    feed(textDelta('msg-assistant', 0, 'a'));

    const before = builder.buildTree(state, 'k');
    expect(before).toHaveLength(2);

    const spy = spyOnMessageBuilds();
    for (let i = 1; i <= 1000; i++) {
      feed(textDelta('msg-assistant', i, 'a'));
    }
    const after = builder.buildTree(state, 'k');

    expect(spy.mock.calls.map((call) => call[0])).toEqual(['msg-assistant']);
    // The untouched user message keeps its exact node object, so OnPush skips it.
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1].children[0].content).toHaveLength(1001);
  });

  it('keeps completed tool nodes identical while sibling text streams', () => {
    feed(messageStart('msg-a', 'assistant'));
    feed(toolStart('msg-a', 'toolu_1'));
    feed(
      toolDelta('msg-a', 'toolu_1', JSON.stringify({ file_path: '/a.txt' })),
    );
    feed(toolResult('msg-a', 'toolu_1'));
    feed(textDelta('msg-a', 0, 'thinking out loud'));

    const before = builder.buildTree(state, 'k');
    const beforeTool = findByType(before, 'tool');
    expect(beforeTool?.toolInput).toEqual({ file_path: '/a.txt' });
    expect(beforeTool?.status).toBe('complete');

    feed(textDelta('msg-a', 1, ' and some more'));
    const after = builder.buildTree(state, 'k');

    expect(after[0]).not.toBe(before[0]);
    expect(findByType(after, 'tool')).toBe(beforeTool);
  });

  it('rebuilds the owning root when a NESTED subagent message streams', () => {
    feed(messageStart('msg-root', 'assistant'));
    feed(toolStart('msg-root', 'toolu_task'));
    feed({
      id: 'evt-agent-start',
      eventType: 'agent_start',
      timestamp: nextTimestamp(),
      sessionId: SESSION_ID,
      source: 'stream',
      messageId: 'msg-root',
      parentToolUseId: 'toolu_task',
      toolCallId: 'toolu_task',
      agentType: 'general-purpose',
      agentDescription: 'Dig around',
      agentId: 'agent-1',
    } as FlatStreamEventUnion);
    feed({
      ...messageStart('msg-nested', 'assistant'),
      parentToolUseId: 'toolu_task',
    } as MessageStartEvent);
    feed(textDelta('msg-nested', 0, 'sub'));

    const before = builder.buildTree(state, 'k');
    expect(before).toHaveLength(1);

    // A delta on the SUBAGENT's message carries the subagent's messageId, not
    // the root's. Without parent-chain attribution the root would look clean.
    feed(textDelta('msg-nested', 1, 'more'));
    const after = builder.buildTree(state, 'k');

    expect(after[0]).not.toBe(before[0]);
    const agent = findByType(after, 'agent');
    expect(agent?.agentType).toBe('general-purpose');
    expect(findByType(after, 'text')?.content).toBe('submore');
  });

  it('drops an evicted message from messageEventIds when the cap bites', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const victim = messageStart('msg-victim', 'assistant');
      setStreamingEventCapped(state, victim);
      state.eventsByMessage.set('msg-victim', [victim]);
      state.messageEventIds.push('msg-victim');

      for (let i = 1; i <= STREAMING_EVENT_CAP; i++) {
        const filler = textDelta(`msg-filler-${i}`, i);
        setStreamingEventCapped(state, filler);
        state.eventsByMessage.set(`msg-filler-${i}`, [filler]);
      }

      expect(state.events.has(victim.id)).toBe(false);
      expect(state.eventsByMessage.has('msg-victim')).toBe(false);
      expect(state.messageEventIds).not.toContain('msg-victim');
      expect(state.messageRevisions?.has('msg-victim')).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('builds ~5 000 deltas across 50 tool calls well under a second', () => {
    const TOOL_COUNT = 50;
    const DELTA_COUNT = 4_800;
    const REBUILD_EVERY = 48;

    feed(messageStart('msg-a', 'assistant'));
    for (let i = 0; i < TOOL_COUNT; i++) {
      const toolCallId = `toolu_${i}`;
      feed(toolStart('msg-a', toolCallId));
      feed(toolDelta('msg-a', toolCallId, JSON.stringify({ index: i })));
      feed(toolResult('msg-a', toolCallId));
    }

    const startedAt = performance.now();
    let lastTree: ExecutionNode[] = [];
    let rebuilds = 0;
    let rebuildMs = 0;
    const rebuild = (): void => {
      const at = performance.now();
      lastTree = builder.buildTree(state, 'k');
      rebuildMs += performance.now() - at;
      rebuilds++;
    };

    for (let i = 0; i < DELTA_COUNT; i++) {
      feed(textDelta('msg-a', i, 'x'));
      if (i % REBUILD_EVERY === 0) rebuild();
    }
    rebuild();
    const elapsedMs = performance.now() - startedAt;

    // Structure carries the weight.
    expect(state.events.size).toBeLessThanOrEqual(STREAMING_EVENT_CAP);
    expect(lastTree).toHaveLength(1);
    const children = lastTree[0].children;
    expect(children.filter((c) => c.type === 'tool')).toHaveLength(TOOL_COUNT);
    expect(children.filter((c) => c.type === 'text')).toHaveLength(1);
    expect(children.find((c) => c.type === 'text')?.content).toHaveLength(
      DELTA_COUNT,
    );

    // Absolute budget: ~0.2 s on an idle machine. The ceiling is generous
    // because Jest runs suites in parallel and wall-clock here swings by an
    // order of magnitude under load — but the shape it rules out (the old
    // O(chunks × events²) rebuild) took tens of seconds for this exact input
    // even unloaded.
    expect(elapsedMs).toBeLessThan(8_000);

    // Load-independent budget, and the property that actually matters: a whole
    // rebuild must cost a small constant number of full O(events) sweeps. The
    // old builder spread that same events Map once PER NODE — 50+ sweeps per
    // rebuild for this input, before the JSON.stringify fingerprint pass on
    // top. Measured here: ~1 sweep per rebuild.
    const sweepMs = medianSweepMs(state);
    expect(rebuildMs).toBeLessThan(sweepMs * rebuilds * 4);
  });
});

/**
 * Median cost of ONE full pass over `state.events` — the unit the old builder
 * paid per node, and the unit this one must stay under per whole rebuild.
 * Measured in-process so it absorbs whatever else the machine is doing.
 */
function medianSweepMs(state: StreamingState): number {
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const at = performance.now();
    buildStreamingIndexes(state);
    samples.push(performance.now() - at);
  }
  samples.sort((a, b) => a - b);
  return samples[2];
}

/** Depth-first search for the first node of `type`. */
function findByType(
  nodes: readonly ExecutionNode[],
  type: ExecutionNode['type'],
): ExecutionNode | undefined {
  for (const node of nodes) {
    if (node.type === type) return node;
    const nested = findByType(node.children, type);
    if (nested) return nested;
  }
  return undefined;
}
