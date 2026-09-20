/**
 * `finalizeSessionHistory` — O(E + M) indexing (TASK_2026_437 C16, AC-11).
 *
 * The message loop used to scan every event twice per root message (once for
 * the `message_start`, once for the `message_complete`) and every tree once,
 * so a 2,000-event session finalized in O(M × E) on the renderer main thread.
 * It now indexes both in one pass before the loop.
 *
 * Two properties are pinned here:
 *   1. Equivalence — the output is identical to the pre-change algorithm
 *      (kept below verbatim as {@link legacyHistoryMessages}) on representative
 *      and edge fixtures: duplicated boundary events, duplicated message ids,
 *      duplicated tree ids, missing starts / completes / trees, and tool and
 *      subagent events interleaved between a message's boundaries.
 *   2. Cost — a counting proxy over `events` sees at most 2 × E element visits,
 *      and the same proxy sees far more than that from the legacy algorithm, so
 *      the bound is not vacuous.
 *
 * The tree builder is mocked to return controlled trees, as in the service's
 * main spec; its own output is not what this change touches.
 */

import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import {
  createExecutionChatMessage,
  type ExecutionChatMessage,
  type ExecutionNode,
  type FlatStreamEventUnion,
  type MessageCompleteEvent,
  type MessageStartEvent,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { StreamingState, TabState } from '@ptah-extension/chat-types';
import { MessageFinalizationService } from './message-finalization.service';
import { SessionManager } from './session-manager.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { BatchedUpdateService } from './batched-update.service';

// ---------------------------------------------------------------------------
// Fixture construction
// ---------------------------------------------------------------------------

interface HistoryFixture {
  readonly state: StreamingState;
  readonly trees: ExecutionNode[];
}

/** Builds a history state event by event, in map insertion order. */
class HistoryBuilder {
  private readonly events = new Map<string, FlatStreamEventUnion>();
  private readonly messageEventIds: string[] = [];
  private readonly textAccumulators = new Map<string, string>();
  private readonly trees: ExecutionNode[] = [];
  private clock = 1_000;

  private add(event: Record<string, unknown>): this {
    const full = { timestamp: this.clock++, ...event } as FlatStreamEventUnion;
    this.events.set(full.id, full);
    return this;
  }

  root(messageId: string): this {
    this.messageEventIds.push(messageId);
    return this;
  }

  start(
    id: string,
    messageId: string,
    role: 'user' | 'assistant',
    extra: Partial<MessageStartEvent> = {},
  ): this {
    return this.add({
      id,
      eventType: 'message_start',
      messageId,
      role,
      ...extra,
    });
  }

  complete(
    id: string,
    messageId: string,
    extra: Partial<MessageCompleteEvent> = {},
  ): this {
    return this.add({ id, eventType: 'message_complete', messageId, ...extra });
  }

  textDelta(id: string, messageId: string, blockIndex = 0): this {
    return this.add({
      id,
      eventType: 'text_delta',
      messageId,
      delta: 'x',
      blockIndex,
    });
  }

  tool(id: string, messageId: string, toolCallId: string): this {
    return this.add({
      id: `${id}-start`,
      eventType: 'tool_start',
      messageId,
      toolCallId,
      toolName: 'Read',
      isTaskTool: false,
    }).add({
      id: `${id}-result`,
      eventType: 'tool_result',
      messageId,
      toolCallId,
      output: 'ok',
      isError: false,
    });
  }

  text(messageId: string, text: string, blockIndex = 0): this {
    this.textAccumulators.set(`${messageId}-block-${blockIndex}`, text);
    return this;
  }

  tree(id: string, content = ''): this {
    this.trees.push({
      id,
      type: 'message',
      status: 'complete',
      content,
      children: [],
    } as unknown as ExecutionNode);
    return this;
  }

  build(): HistoryFixture {
    return {
      state: {
        events: new Map(this.events),
        messageEventIds: [...this.messageEventIds],
        toolCallMap: new Map(),
        textAccumulators: new Map(this.textAccumulators),
        toolInputAccumulators: new Map(),
        agentSummaryAccumulators: new Map(),
        agentContentBlocksMap: new Map(),
        currentMessageId: null,
        currentTokenUsage: null,
        eventsByMessage: new Map(),
        pendingStats: null,
      },
      trees: [...this.trees],
    };
  }
}

/** Five user/assistant turns with a tool call and a subagent inside each. */
function representativeFixture(): HistoryFixture {
  const b = new HistoryBuilder();
  for (let t = 0; t < 5; t++) {
    const user = `u${t}`;
    const assistant = `a${t}`;
    const sub = `sub${t}`;
    b.root(user)
      .start(`start-${user}`, user, 'user', t === 2 ? { imageCount: 2 } : {})
      .text(user, `prompt ${t}`)
      .text(user, `second block ${t}`, 1);
    b.root(assistant)
      .start(`start-${assistant}`, assistant, 'assistant')
      .textDelta(`td-${assistant}-0`, assistant)
      .tool(`tool-${assistant}`, assistant, `tc-${t}`);
    // A subagent's message runs between the parent's tool start and result,
    // and is a root message id the loop must skip by `parentToolUseId`.
    b.root(sub)
      .start(`start-${sub}`, sub, 'assistant', { parentToolUseId: `tc-${t}` })
      .textDelta(`td-${sub}`, sub)
      .complete(`complete-${sub}`, sub, {
        tokenUsage: { input: 1, output: 1 },
      })
      .textDelta(`td-${assistant}-1`, assistant, 1)
      .complete(`complete-${assistant}`, assistant, {
        tokenUsage: { input: 10 + t, output: 20 + t },
        cost: 0.01 * (t + 1),
        duration: 100 * (t + 1),
      })
      .tree(`start-${assistant}`, `answer ${t}`);
  }
  return b.build();
}

/** Repeated boundary events, repeated root ids and repeated tree ids. */
function duplicatesFixture(): HistoryFixture {
  return (
    new HistoryBuilder()
      .root('u1')
      .start('start-u1', 'u1', 'user')
      .text('u1', 'hello')
      // A complete recorded BEFORE its start in map order still pairs up.
      .root('a1')
      .complete('complete-a1-first', 'a1', {
        tokenUsage: { input: 1, output: 2 },
        cost: 0.5,
        duration: 7,
      })
      .start('start-a1', 'a1', 'assistant')
      // Second start for the same message, with a different role and tree id:
      // the first must win.
      .start('start-a1-dup', 'a1', 'user')
      .complete('complete-a1-second', 'a1', {
        tokenUsage: { input: 99, output: 99 },
        cost: 9,
        duration: 9,
      })
      // The same root id twice: the assistant tree is used once, the user
      // message is emitted every time.
      .root('a1')
      .root('u1')
      .tree('start-a1', 'first tree wins')
      .tree('start-a1', 'shadowed duplicate')
      .tree('start-a1-dup', 'never reached')
      .build()
  );
}

/** Roots with no start, no tree, no complete, or a complete with no usage. */
function missingIdsFixture(): HistoryFixture {
  return new HistoryBuilder()
    .root('ghost')
    .root('complete-only')
    .complete('complete-complete-only', 'complete-only', {
      tokenUsage: { input: 3, output: 4 },
    })
    .root('a-no-tree')
    .start('start-a-no-tree', 'a-no-tree', 'assistant')
    .complete('complete-a-no-tree', 'a-no-tree', {
      tokenUsage: { input: 5, output: 6 },
    })
    .root('a-no-complete')
    .start('start-a-no-complete', 'a-no-complete', 'assistant')
    .tree('start-a-no-complete')
    .root('a-no-usage')
    .start('start-a-no-usage', 'a-no-usage', 'assistant')
    .complete('complete-a-no-usage', 'a-no-usage', { cost: 1, duration: 2 })
    .tree('start-a-no-usage')
    .root('u-no-text')
    .start('start-u-no-text', 'u-no-text', 'user', {
      inboundPeer: { label: 'peer' },
    })
    .tree('orphan-tree-with-no-root')
    .build();
}

/**
 * A ~2,000-event session with tool events of several messages interleaved,
 * generated from a fixed seed so a failure reproduces.
 */
function largeFixture(targetEvents = 2_000): HistoryFixture {
  let seed = 0x437;
  const rand = (n: number): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % n;
  };

  const b = new HistoryBuilder();
  let events = 0;
  let turn = 0;
  const open: string[] = [];
  while (events < targetEvents) {
    const user = `lu${turn}`;
    const assistant = `la${turn}`;
    b.root(user).start(`start-${user}`, user, 'user').text(user, `p${turn}`);
    b.root(assistant)
      .start(`start-${assistant}`, assistant, 'assistant')
      .tree(`start-${assistant}`);
    events += 2;
    open.push(assistant);

    const bursts = 5 + rand(20);
    for (let i = 0; i < bursts; i++) {
      // Events land on a random still-open message, not only the newest.
      const owner = open[rand(open.length)];
      b.tool(`t-${turn}-${i}`, owner, `tc-${turn}-${i}`);
      events += 2;
    }

    // Close one message at random; occasionally a duplicate start/complete.
    const closing = open.splice(rand(open.length), 1)[0];
    b.complete(`complete-${closing}`, closing, {
      tokenUsage: { input: turn, output: turn * 2 },
      cost: turn,
      duration: turn,
    });
    events += 1;
    if (rand(10) === 0) {
      b.start(`start-${closing}-dup`, closing, 'user').complete(
        `complete-${closing}-dup`,
        closing,
        { tokenUsage: { input: -1, output: -1 } },
      );
      events += 2;
    }
    turn++;
  }
  for (const closing of open) {
    b.complete(`complete-${closing}`, closing);
  }
  return b.build();
}

// ---------------------------------------------------------------------------
// Oracle — the pre-C16 loop, verbatim apart from its inputs being parameters.
// ---------------------------------------------------------------------------

function legacyHistoryMessages(
  stateCopy: StreamingState,
  allTrees: ExecutionNode[],
  sessionId: string | undefined,
  extractText: (state: StreamingState, messageId: string) => string,
): ExecutionChatMessage[] {
  const messages: ExecutionChatMessage[] = [];
  const usedTreeNodeIds = new Set<string>();
  for (const messageId of stateCopy.messageEventIds) {
    const messageStartEvent = [...stateCopy.events.values()].find(
      (e) => e.eventType === 'message_start' && e.messageId === messageId,
    ) as MessageStartEvent | undefined;

    if (!messageStartEvent) {
      continue;
    }
    if (messageStartEvent.parentToolUseId) {
      continue;
    }

    const role = messageStartEvent.role;
    const treeNode = allTrees.find((node) => node.id === messageStartEvent.id);
    const completeEvent = [...stateCopy.events.values()].find(
      (e) => e.eventType === 'message_complete' && e.messageId === messageId,
    ) as MessageCompleteEvent | undefined;
    let tokens: { input: number; output: number } | undefined;
    let cost: number | null | undefined;
    let duration: number | undefined;

    if (completeEvent?.tokenUsage) {
      tokens = {
        input: completeEvent.tokenUsage.input,
        output: completeEvent.tokenUsage.output,
      };
      cost = completeEvent.cost;
      duration = completeEvent.duration;
    }

    if (role === 'user') {
      messages.push(
        createExecutionChatMessage({
          id: messageId,
          role: 'user',
          rawContent: extractText(stateCopy, messageId),
          sessionId,
          timestamp: messageStartEvent.timestamp,
          ...(messageStartEvent.imageCount
            ? { imageCount: messageStartEvent.imageCount }
            : {}),
          ...(messageStartEvent.inboundPeer
            ? { inboundPeer: messageStartEvent.inboundPeer }
            : {}),
        }),
      );
    } else {
      if (!treeNode) {
        continue;
      }
      if (usedTreeNodeIds.has(treeNode.id)) {
        continue;
      }
      usedTreeNodeIds.add(treeNode.id);
      messages.push(
        createExecutionChatMessage({
          id: treeNode.id,
          role: 'assistant',
          streamingState: treeNode,
          sessionId,
          tokens,
          cost,
          duration,
          timestamp: messageStartEvent.timestamp,
        }),
      );
    }
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Counting proxy over the events map
// ---------------------------------------------------------------------------

/**
 * A copy of `source` whose every iteration path counts the elements it yields.
 * `get`/`has` are not counted: they are O(1) and not an element visit.
 */
function countingEvents(source: Map<string, FlatStreamEventUnion>): {
  events: Map<string, FlatStreamEventUnion>;
  visits: () => number;
} {
  const map = new Map(source);
  let visits = 0;
  const counted = <T>(make: () => Iterator<T>) =>
    function* (): Generator<T> {
      const it = make();
      for (let r = it.next(); !r.done; r = it.next()) {
        visits++;
        yield r.value;
      }
    };
  const proto = Map.prototype;
  const define = (key: PropertyKey, value: unknown): void => {
    Object.defineProperty(map, key, { value, configurable: true });
  };
  define(
    'values',
    counted(() => proto.values.call(map)),
  );
  define(
    'keys',
    counted(() => proto.keys.call(map)),
  );
  define(
    'entries',
    counted(() => proto.entries.call(map)),
  );
  define(
    Symbol.iterator,
    counted(() => proto.entries.call(map)),
  );
  define(
    'forEach',
    (
      cb: (v: FlatStreamEventUnion, k: string, m: Map<string, unknown>) => void,
    ) =>
      proto.forEach.call(map, (v: FlatStreamEventUnion, k: string) => {
        visits++;
        cb(v, k, map);
      }),
  );
  return { events: map, visits: () => visits };
}

// ---------------------------------------------------------------------------

describe('MessageFinalizationService.finalizeSessionHistory — O(E + M) indexing', () => {
  let service: MessageFinalizationService;
  let tabsSignal: ReturnType<typeof signal<TabState[]>>;
  let treeBuilder: { buildTree: jest.Mock; clearForTab: jest.Mock };
  let applyFinalizedHistory: jest.Mock;

  beforeEach(() => {
    tabsSignal = signal<TabState[]>([]);
    applyFinalizedHistory = jest.fn();
    treeBuilder = { buildTree: jest.fn(() => []), clearForTab: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        MessageFinalizationService,
        {
          provide: TabManagerService,
          useValue: {
            tabs: computed(() => tabsSignal()),
            activeTabId: computed(() => null),
            applyFinalizedHistory,
          },
        },
        { provide: SessionManager, useValue: { setStatus: jest.fn() } },
        { provide: ExecutionTreeBuilderService, useValue: treeBuilder },
        { provide: BatchedUpdateService, useValue: { flushSync: jest.fn() } },
      ],
    });
    service = TestBed.inject(MessageFinalizationService);
  });

  afterEach(() => TestBed.resetTestingModule());

  function load(fixture: HistoryFixture): void {
    treeBuilder.buildTree.mockReturnValue(fixture.trees);
    tabsSignal.set([
      {
        id: 'tab-1',
        title: 'Session',
        name: 'Session',
        status: 'loaded',
        messages: [],
        streamingState: fixture.state,
        currentMessageId: null,
        claudeSessionId: 'sess-1',
      } as unknown as TabState,
    ]);
  }

  function oracle(fixture: HistoryFixture): ExecutionChatMessage[] {
    return legacyHistoryMessages(
      service.deepCopyStreamingState(fixture.state),
      fixture.trees,
      'sess-1',
      (state, messageId) => service.extractTextForMessage(state, messageId),
    );
  }

  describe('equivalence with the pre-change algorithm', () => {
    const cases: ReadonlyArray<[string, () => HistoryFixture]> = [
      [
        'representative turns with interleaved tool + subagent events',
        representativeFixture,
      ],
      ['duplicated boundary events, root ids and tree ids', duplicatesFixture],
      ['missing starts, trees, completes and usage', missingIdsFixture],
      ['a seeded ~2,000-event interleaved session', () => largeFixture()],
    ];

    it.each(cases)('%s', (_name, make) => {
      const fixture = make();
      const expected = oracle(fixture);
      // A fixture that finalizes to nothing would make equality vacuous.
      expect(expected.length).toBeGreaterThan(0);

      load(fixture);
      const actual = service.finalizeSessionHistory('tab-1');

      expect(actual).toEqual(expected);
      expect(applyFinalizedHistory).toHaveBeenCalledWith('tab-1', actual);
    });

    it('keeps the FIRST start, complete and tree for a repeated id', () => {
      load(duplicatesFixture());

      const messages = service.finalizeSessionHistory('tab-1');

      expect(messages.map((m) => [m.id, m.role])).toEqual([
        ['u1', 'user'],
        ['start-a1', 'assistant'],
        ['u1', 'user'],
      ]);
      const assistant = messages[1];
      expect(assistant.tokens).toEqual({ input: 1, output: 2 });
      expect(assistant.cost).toBe(0.5);
      expect(assistant.duration).toBe(7);
      expect(assistant.streamingState?.content).toBe('first tree wins');
    });

    it('drops roots with no start or no tree and leaves stats unset without usage', () => {
      load(missingIdsFixture());

      const messages = service.finalizeSessionHistory('tab-1');

      expect(messages.map((m) => m.id)).toEqual([
        'start-a-no-complete',
        'start-a-no-usage',
        'u-no-text',
      ]);
      expect(messages[0].tokens).toBeUndefined();
      expect(messages[1].tokens).toBeUndefined();
      expect(messages[1].cost).toBeUndefined();
      expect(messages[2].inboundPeer).toEqual({ label: 'peer' });
      expect(messages[2].rawContent).toBe('');
    });
  });

  describe('event visit budget (AC-11 CI part)', () => {
    /** Finalize `fixture` with a counting proxy standing in for the copy's events. */
    function visitsDuringFinalize(fixture: HistoryFixture): number {
      const proxy = countingEvents(fixture.state.events);
      const realCopy =
        MessageFinalizationService.prototype.deepCopyStreamingState;
      jest
        .spyOn(service, 'deepCopyStreamingState')
        .mockImplementation((state) => ({
          ...realCopy.call(service, state),
          events: proxy.events,
        }));
      load(fixture);
      service.finalizeSessionHistory('tab-1');
      return proxy.visits();
    }

    it('visits at most 2 × E events on a ~2,000-event session', () => {
      const fixture = largeFixture();
      const eventCount = fixture.state.events.size;
      expect(eventCount).toBeGreaterThanOrEqual(2_000);

      expect(visitsDuringFinalize(fixture)).toBeLessThanOrEqual(2 * eventCount);
    });

    it('stays within 2 × E as the root count grows (no per-message scan)', () => {
      for (const target of [200, 800, 3_200]) {
        const fixture = largeFixture(target);
        const eventCount = fixture.state.events.size;
        expect(visitsDuringFinalize(fixture)).toBeLessThanOrEqual(
          2 * eventCount,
        );
        jest.restoreAllMocks();
        applyFinalizedHistory.mockClear();
      }
    });

    it('the proxy is sensitive: the legacy algorithm blows the same budget', () => {
      const fixture = largeFixture();
      const eventCount = fixture.state.events.size;
      const proxy = countingEvents(fixture.state.events);

      legacyHistoryMessages(
        { ...fixture.state, events: proxy.events },
        fixture.trees,
        'sess-1',
        () => '',
      );

      expect(proxy.visits()).toBeGreaterThan(10 * eventCount);
    });
  });
});
