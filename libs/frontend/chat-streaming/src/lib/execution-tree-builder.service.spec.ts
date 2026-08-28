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

/**
 * Mirrors `NODE_MAP_PRUNE_GROWTH` in the service: how far past the live node
 * count the identity maps are allowed to run before a prune sweeps them.
 */
const NODE_MAP_PRUNE_GROWTH = 2;

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

  /**
   * The service's private memo slot for `cacheKey`. Reached directly because
   * the retention bound it enforces has no public surface — the maps are an
   * implementation detail whose SIZE is the contract (TASK_2026_327).
   */
  const cacheEntry = (
    cacheKey: string,
  ): {
    nodesById: Map<string, ExecutionNode>;
    fingerprintsById: Map<string, number>;
  } => {
    const cache = (
      builder as unknown as {
        treeCache: Map<
          string,
          {
            nodesById: Map<string, ExecutionNode>;
            fingerprintsById: Map<string, number>;
          }
        >;
      }
    ).treeCache;
    const entry = cache.get(cacheKey);
    if (!entry) throw new Error(`no tree-cache entry for "${cacheKey}"`);
    return entry;
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

  it('keeps nodesById / fingerprintsById bounded when the event cap evicts repeatedly', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      // Three events per message (start + tool + result) → each message
      // contributes a message node and a tool node to the tree.
      const EVENTS_PER_MESSAGE = 3;
      const MESSAGES = Math.ceil(
        (STREAMING_EVENT_CAP * 3) / EVENTS_PER_MESSAGE,
      );
      const REBUILD_EVERY = 100;

      let everBuiltNodeIds = 0;
      for (let i = 0; i < MESSAGES; i++) {
        const messageId = `msg-${i}`;
        feed(messageStart(messageId, 'assistant'));
        feed(toolStart(messageId, `toolu_${i}`));
        feed(toolResult(messageId, `toolu_${i}`));
        everBuiltNodeIds += 2;
        if (i % REBUILD_EVERY === 0) builder.buildTree(state, 'k');
      }
      const tree = builder.buildTree(state, 'k');

      // The cap did bite: the transcript is far longer than what survives.
      expect(state.events.size).toBeLessThanOrEqual(STREAMING_EVENT_CAP);
      expect(everBuiltNodeIds).toBeGreaterThan(STREAMING_EVENT_CAP);

      const entry = cacheEntry('k');
      const liveIds = new Set<string>();
      collectIds(tree, liveIds);

      // The tree really did shrink — most of what was rendered is gone.
      expect(liveIds.size).toBeLessThan(everBuiltNodeIds / 2);

      // …and the maps shrank with it. The bound is the prune's own growth
      // factor: a sweep leaves the maps at exactly the live count, and the next
      // one fires before they have doubled. Measured here: ~1.4× live, against
      // ~3× live when nothing prunes — because nothing ever removed the entry
      // (or the retained `ExecutionNode`, with its tool payloads) for a node the
      // event cap had already evicted.
      expect(entry.nodesById.size).toBeLessThan(
        liveIds.size * NODE_MAP_PRUNE_GROWTH,
      );
      expect(entry.fingerprintsById.size).toBeLessThan(
        liveIds.size * NODE_MAP_PRUNE_GROWTH,
      );

      // The maps still cover the whole live tree, so pruning has not quietly
      // disabled the identity reuse they exist for.
      for (const id of liveIds) {
        expect(entry.nodesById.has(id)).toBe(true);
        expect(entry.fingerprintsById.has(id)).toBe(true);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('still reuses node identity across rebuilds after a prune has run', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      // Enough messages to push the maps past the prune floor.
      for (let i = 0; i < 400; i++) {
        const messageId = `msg-${i}`;
        feed(messageStart(messageId, 'user'));
        feed(textDelta(messageId, 0, `q${i}`));
      }
      builder.buildTree(state, 'k');
      const pruned = builder.buildTree(state, 'k');
      expect(cacheEntry('k').nodesById.size).toBeGreaterThan(0);

      // A brand-new message must not disturb the identity of the old ones.
      feed(messageStart('msg-new', 'assistant'));
      feed(textDelta('msg-new', 0, 'answer'));
      const after = builder.buildTree(state, 'k');

      expect(after).toHaveLength(pruned.length + 1);
      expect(after[0]).toBe(pruned[0]);
      expect(after[pruned.length - 1]).toBe(pruned[pruned.length - 1]);
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

  /**
   * THE ORACLE (TASK_2026_333).
   *
   * Every test above compares two snapshots taken from the SAME cache key, so
   * none of them has an independent baseline: a stale reuse is invisible when
   * the only thing you compare it against is the previous stale reuse. The
   * full-rebuild path that could have served as that baseline was deleted in
   * TASK_2026_323, which is why a cache that folded the background-agent set
   * by SIZE shipped — a size-preserving membership swap moved no digest and
   * every card kept the previous frame's `isBackground`.
   *
   * These tests reconstruct the baseline: replay a sequence through the
   * incremental build, then build the SAME state on a cache key the service
   * has never seen (nothing to reuse — that is a full rebuild by
   * construction), and require the two to be structurally identical.
   */
  describe('equivalence oracle — incremental build vs full rebuild', () => {
    /** The key the incremental build accumulates on for a whole test. */
    const INCREMENTAL_KEY = 'oracle-incremental';

    /**
     * Mirrors `MAX_COMPLETED_AGENTS` in `background-agent.store.ts`: the point
     * at which one more finished agent evicts the oldest one — the store's
     * only membership change that is driven purely by `background_agent_*`
     * events and leaves the set's cardinality untouched.
     */
    const MAX_COMPLETED_AGENTS = 50;

    let freshBuilds: number;
    let nowSpy: jest.SpyInstance<number, []>;

    beforeEach(() => {
      freshBuilds = 0;
      // `buildMessageNode` falls back to `Date.now()` for a text block with no
      // surviving anchor delta. Pin it so the two builds can never disagree
      // for a reason that has nothing to do with caching.
      nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    });

    afterEach(() => {
      nowSpy.mockRestore();
    });

    /**
     * The production reuse key for a whole tree: `fingerprintNode` folded over
     * every node, computed POST-ORDER so each parent reads its children's
     * numbers exactly the way `reuseUnchangedSubtree` feeds them to it.
     *
     * Reached through the private method on purpose — this is the drift guard.
     * {@link shapeOf} compares every own field a node carries, so it already
     * covers everything the fingerprint folds today; going through the real
     * method means a field added to `fingerprintNode` tomorrow is picked up by
     * the oracle without anyone remembering to update this spec, and a rename
     * or signature change fails loudly here instead of silently comparing
     * less. A fingerprint is lossy by design (bounded string sampling, a depth
     * budget on tool payloads), so it can only ever miss a difference, never
     * invent one — which is why it is the second opinion and `shapeOf` is the
     * verdict.
     */
    const fingerprintTree = (nodes: readonly ExecutionNode[]): number[] => {
      const service = builder as unknown as {
        fingerprintNode?: (
          node: ExecutionNode,
          fingerprintsById: ReadonlyMap<string, number>,
        ) => number;
      };
      if (typeof service.fingerprintNode !== 'function') {
        throw new Error(
          'ExecutionTreeBuilderService.fingerprintNode is gone — the oracle has ' +
            'lost its coupling to the production reuse key and must be rewired.',
        );
      }
      const fingerprintNode = service.fingerprintNode.bind(builder);
      const fingerprints = new Map<string, number>();
      const walk = (node: ExecutionNode): number => {
        for (const child of node.children) {
          fingerprints.set(child.id, walk(child));
        }
        return fingerprintNode(node, fingerprints);
      };
      return nodes.map(walk);
    };

    /**
     * Build `state` twice — once incrementally on the key this test has been
     * feeding all along, once on a never-before-seen key — and require both
     * structural equality and equality of the production reuse key. Returns
     * the incremental tree so callers can assert on it directly.
     *
     * The throwaway key is dropped again so a long replay cannot push the LRU
     * past `MAX_CACHE_SIZE` and evict the incremental entry it is testing.
     */
    const expectEquivalent = (): ExecutionNode[] => {
      const incremental = builder.buildTree(state, INCREMENTAL_KEY);
      const freshKey = `oracle-fresh-${++freshBuilds}`;
      const fresh = builder.buildTree(state, freshKey);
      builder.clearCache(freshKey);
      expect(shapeOf(incremental)).toEqual(shapeOf(fresh));
      expect(fingerprintTree(incremental)).toEqual(fingerprintTree(fresh));
      return incremental;
    };

    const agentStart = (
      messageId: string,
      toolCallId: string,
      agentId: string,
    ): FlatStreamEventUnion =>
      ({
        id: `evt-agent-${toolCallId}`,
        eventType: 'agent_start',
        timestamp: nextTimestamp(),
        sessionId: SESSION_ID,
        source: 'stream',
        messageId,
        parentToolUseId: toolCallId,
        toolCallId,
        agentType: 'general-purpose',
        agentDescription: `work on ${toolCallId}`,
        agentId,
      }) as FlatStreamEventUnion;

    const messageComplete = (messageId: string): FlatStreamEventUnion =>
      ({
        id: `evt-complete-${messageId}`,
        eventType: 'message_complete',
        timestamp: nextTimestamp(),
        sessionId: SESSION_ID,
        source: 'stream',
        messageId,
      }) as FlatStreamEventUnion;

    const backgroundStarted = (
      toolCallId: string,
      agentId: string,
    ): FlatStreamEventUnion =>
      ({
        id: `evt-bg-start-${agentId}`,
        eventType: 'background_agent_started',
        timestamp: nextTimestamp(),
        sessionId: SESSION_ID,
        source: 'stream',
        toolCallId,
        agentId,
        agentType: 'general-purpose',
      }) as FlatStreamEventUnion;

    const backgroundCompleted = (
      toolCallId: string,
      agentId: string,
    ): FlatStreamEventUnion =>
      ({
        id: `evt-bg-done-${agentId}`,
        eventType: 'background_agent_completed',
        timestamp: nextTimestamp(),
        sessionId: SESSION_ID,
        source: 'stream',
        toolCallId,
        agentId,
        agentType: 'general-purpose',
      }) as FlatStreamEventUnion;

    /** Two assistant roots, one agent each, separated by a user turn. */
    const seedTwoAgents = (): void => {
      feed(messageStart('msg-a', 'assistant'));
      feed(toolStart('msg-a', 'toolu_a'));
      feed(agentStart('msg-a', 'toolu_a', 'agent-a'));
      feed(messageStart('msg-u', 'user'));
      feed(textDelta('msg-u', 0, 'carry on'));
      feed(messageStart('msg-b', 'assistant'));
      feed(toolStart('msg-b', 'toolu_b'));
      feed(agentStart('msg-b', 'toolu_b', 'agent-b'));
    };

    it('agrees with a full rebuild when one agent joins the background set as another is evicted from it', () => {
      seedTwoAgents();

      // Fill the finished set to exactly the eviction threshold, oldest first
      // being the agent rendered on the FIRST root.
      feed(backgroundCompleted('toolu_a', 'bg-a'));
      for (let i = 1; i < MAX_COMPLETED_AGENTS; i++) {
        feed(backgroundCompleted(`toolu_filler_${i}`, `bg-filler-${i}`));
      }
      const store = ctx.backgroundAgentStore;
      expect(store.backgroundToolCallIds().size).toBe(MAX_COMPLETED_AGENTS);

      const before = expectEquivalent();
      expect(agentNodeFor(before, 'toolu_a')?.isBackground).toBe(true);
      expect(agentNodeFor(before, 'toolu_b')?.isBackground).toBeUndefined();

      // ONE `BatchedUpdateService` frame: the agent on the second root
      // finishes, which is the (MAX + 1)-th finished agent and evicts the
      // oldest — the one on the first root. The set loses `toolu_a` and gains
      // `toolu_b`; its SIZE never moves, and neither event writes a streaming
      // event, so no per-message digest moves either. Folding the size left
      // both cards showing the opposite of the truth.
      feed(backgroundCompleted('toolu_b', 'bg-b'));
      expect(store.backgroundToolCallIds().size).toBe(MAX_COMPLETED_AGENTS);
      expect(store.isBackgroundAgent('toolu_a')).toBe(false);
      expect(store.isBackgroundAgent('toolu_b')).toBe(true);

      const after = expectEquivalent();
      expect(agentNodeFor(after, 'toolu_a')?.isBackground).toBeUndefined();
      expect(agentNodeFor(after, 'toolu_b')?.isBackground).toBe(true);
    });

    it('agrees with a full rebuild when one agent is backgrounded as a finished one is cleared', () => {
      seedTwoAgents();

      feed(backgroundStarted('toolu_b', 'bg-b'));
      const before = expectEquivalent();
      expect(agentNodeFor(before, 'toolu_a')?.isBackground).toBeUndefined();
      expect(agentNodeFor(before, 'toolu_b')?.isBackground).toBe(true);

      // ONE frame: the backgrounded agent finishes and the tray is cleared
      // while the user backgrounds the other one. `{toolu_b}` → `{toolu_a}`,
      // size 1 on both sides of the swap.
      const store = ctx.backgroundAgentStore;
      feed(backgroundCompleted('toolu_b', 'bg-b'));
      store.clearCompleted();
      feed(backgroundStarted('toolu_a', 'bg-a'));
      expect(store.backgroundToolCallIds().size).toBe(1);

      const after = expectEquivalent();
      expect(agentNodeFor(after, 'toolu_a')?.isBackground).toBe(true);
      expect(agentNodeFor(after, 'toolu_b')?.isBackground).toBeUndefined();
    });

    it('agrees with a full rebuild when a child message_start precedes its owning tool_start', () => {
      feed(messageStart('msg-root', 'assistant'));
      // The subagent's own message lands BEFORE the tool_use that owns it, so
      // for one build it belongs to no root at all.
      feed({
        ...messageStart('msg-nested', 'assistant'),
        parentToolUseId: 'toolu_task',
      } as MessageStartEvent);
      feed(textDelta('msg-nested', 0, 'sub'));
      const orphaned = expectEquivalent();
      expect(orphaned).toHaveLength(1);
      expect(findByType(orphaned, 'agent')).toBeUndefined();

      // The owning tool (and its agent) arrive late; the already-buffered
      // child events must now be attributed to the root.
      feed(toolStart('msg-root', 'toolu_task'));
      feed(agentStart('msg-root', 'toolu_task', 'agent-late'));
      const adopted = expectEquivalent();
      expect(findByType(adopted, 'agent')?.toolCallId).toBe('toolu_task');
      expect(findByType(adopted, 'text')?.content).toBe('sub');

      feed(textDelta('msg-nested', 1, 'more'));
      const grown = expectEquivalent();
      expect(findByType(grown, 'text')?.content).toBe('submore');
    });

    it('agrees with a full rebuild when a node is updated after its message was finalized', () => {
      feed(messageStart('msg-a', 'assistant'));
      feed(toolStart('msg-a', 'toolu_1'));
      feed(
        toolDelta('msg-a', 'toolu_1', JSON.stringify({ file_path: '/a.txt' })),
      );
      feed(messageComplete('msg-a'));

      const finalized = expectEquivalent();
      expect(findByType(finalized, 'tool')?.status).toBe('streaming');

      // The result lands AFTER the message was finalized — the node has to
      // move from streaming to complete on an already-settled root.
      feed(toolResult('msg-a', 'toolu_1'));
      const updated = expectEquivalent();
      expect(findByType(updated, 'tool')?.status).toBe('complete');
      expect(findByType(updated, 'tool')?.toolInput).toEqual({
        file_path: '/a.txt',
      });
    });

    it('agrees with a full rebuild when a duplicate event id is replayed', () => {
      // Held rather than re-minted: a genuine duplicate is the SAME event
      // re-sent (a second surface bound to the session, a reconnect that
      // replays the tail), so it carries the same id AND the same timestamp.
      // Minting a fresh timestamp under an existing id is a REPLACEMENT, not a
      // duplicate — a different path, with its own contract (see below).
      const start = messageStart('msg-a', 'assistant');
      const tool = toolStart('msg-a', 'toolu_1');
      const result = toolResult('msg-a', 'toolu_1');
      feed(start);
      feed(tool);
      feed(result);

      const before = expectEquivalent();
      expect(countByType(before, 'tool')).toBe(1);

      feed(start);
      feed(tool);
      feed(result);

      const after = expectEquivalent();
      expect(countByType(after, 'tool')).toBe(1);
      expect(after).toHaveLength(1);
    });

    it('agrees with a full rebuild while a resumed session replays persisted history', () => {
      // A resumed session arrives as `history`-source events against a cold
      // cache — no prior build, no prior state object.
      const persisted: FlatStreamEventUnion[] = [
        { ...messageStart('msg-h1', 'user'), source: 'history' },
        { ...textDelta('msg-h1', 0, 'what changed?'), source: 'history' },
        { ...messageStart('msg-h2', 'assistant'), source: 'history' },
        { ...toolStart('msg-h2', 'toolu_h'), source: 'history' },
        {
          ...toolDelta('msg-h2', 'toolu_h', JSON.stringify({ pattern: 'x' })),
          source: 'history',
        },
        { ...toolResult('msg-h2', 'toolu_h'), source: 'history' },
        { ...textDelta('msg-h2', 0, 'here is the diff'), source: 'history' },
        messageComplete('msg-h2'),
      ] as FlatStreamEventUnion[];

      for (const event of persisted) {
        feed(event);
        expectEquivalent();
      }

      // Live streaming resumes on top of the replayed transcript.
      feed(messageStart('msg-live', 'assistant'));
      feed(textDelta('msg-live', 0, 'and now'));
      const resumed = expectEquivalent();

      // Two roots, not three: the live assistant message merges into the
      // replayed assistant turn, which is the same merge the live path does.
      expect(resumed).toHaveLength(2);
      expect(countByType(resumed, 'tool')).toBe(1);
      expect(findByType(resumed, 'tool')?.status).toBe('complete');
      expect(resumed[1].children.map((c) => c.content)).toContain('and now');
    });
  });
});

/**
 * A tree reduced to everything that is NOT object identity: every own field
 * each node carries, with `children` recursed into.
 *
 * Deliberately NOT a hand-listed set of fields. The cache's reuse decision is
 * made by `fingerprintNode`, which folds `cost`, `duration`, `model`,
 * `tokenUsage`, `agentDescription`, `error` and the rest alongside `status`
 * and `content`. A hand-listed shape drifts from that the moment anyone adds
 * a field — and a field the CACHE keys on but the ORACLE does not compare is
 * precisely a stale-render bug this suite would pass in silence, which is the
 * failure mode TASK_2026_333 exists to close. Enumerating the node instead
 * means the comparison widens automatically with `ExecutionNode`, and
 * `fingerprintTree` pins the coupling from the other direction.
 *
 * `undefined` values are dropped so "absent" and "present but undefined"
 * compare equal — they render the same. `isBackground` is then normalised to
 * a boolean so the flag at the centre of this task prints as `false` vs
 * `true` in a diff rather than as a missing key.
 */
function shapeOf(
  nodes: readonly ExecutionNode[],
): Array<Record<string, unknown>> {
  return nodes.map((node) => {
    const shape: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      if (key === 'children') continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (value !== undefined) shape[key] = value;
    }
    shape.isBackground = node.isBackground === true;
    shape.children = shapeOf(node.children);
    return shape;
  });
}

/** The agent node spawned by `toolCallId`, anywhere in the tree. */
function agentNodeFor(
  nodes: readonly ExecutionNode[],
  toolCallId: string,
): ExecutionNode | undefined {
  for (const node of nodes) {
    if (node.type === 'agent' && node.toolCallId === toolCallId) return node;
    const nested = agentNodeFor(node.children, toolCallId);
    if (nested) return nested;
  }
  return undefined;
}

/** How many nodes of `type` the tree holds, at any depth. */
function countByType(
  nodes: readonly ExecutionNode[],
  type: ExecutionNode['type'],
): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === type) count++;
    count += countByType(node.children, type);
  }
  return count;
}

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

/** Every node id in `nodes` and their descendants. */
function collectIds(nodes: readonly ExecutionNode[], into: Set<string>): void {
  for (const node of nodes) {
    into.add(node.id);
    collectIds(node.children, into);
  }
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
