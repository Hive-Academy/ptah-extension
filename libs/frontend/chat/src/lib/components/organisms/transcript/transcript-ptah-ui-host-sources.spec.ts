import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LiveModelStatsPayload } from '@ptah-extension/chat-state';
import { SubagentExecutionStore } from '@ptah-extension/chat-streaming';
import {
  createExecutionChatMessage,
  createExecutionNode,
  type ContextCapacity,
  type ExecutionChatMessage,
  type ExecutionNode,
} from '@ptah-extension/shared';
import { collectDisplayCandidates } from './transcript-display-candidates';
import {
  createTranscriptPtahUiHostSources,
  type TranscriptHostSourceSlot,
} from './transcript-ptah-ui-host-sources';

function user(id: string, timestamp: number): ExecutionChatMessage {
  return createExecutionChatMessage({ id, role: 'user', timestamp });
}

function assistant(
  id: string,
  timestamp: number,
  text = 'plain',
  agentIds: readonly string[] = [],
): ExecutionChatMessage {
  return createExecutionChatMessage({
    id,
    role: 'assistant',
    timestamp,
    streamingState: createExecutionNode({
      id: `${id}-root`,
      type: 'message',
      status: 'complete',
      children: [
        createExecutionNode({
          id: `${id}-text`,
          type: 'text',
          status: 'complete',
          content: text,
        }),
        ...agentIds.map((agentId) =>
          createExecutionNode({
            id: agentId,
            type: 'agent',
            status: 'complete',
            toolCallId: `call-${agentId}`,
          }),
        ),
      ],
    }),
  });
}

const CAPACITY: ContextCapacity = {
  tokens: 200_000,
  source: 'sdk-native',
  providerId: null,
  model: 'claude-test',
};

function stats(contextCapacity?: ContextCapacity): LiveModelStatsPayload {
  return {
    model: 'claude-test',
    contextUsed: 10,
    contextWindow: 200_000,
    contextPercent: 0,
    ...(contextCapacity !== undefined && { contextCapacity }),
  };
}

/** Slots whose records are signals, like the stream presentation store's. */
function setup(messages: readonly ExecutionChatMessage[]) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: SubagentExecutionStore,
        useValue: {
          entries: signal(new Map()),
          revisionFor: () => 0,
          treeFor: () => [],
        },
      },
    ],
  });
  const records = messages.map((message) => signal(message));
  const slots = signal<readonly TranscriptHostSourceSlot[]>(
    records.map((record) => ({ record })),
  );
  const liveModelStats = signal<LiveModelStatsPayload | null>(null);
  const activeTrees = signal<readonly ExecutionNode[]>([]);
  const sources = TestBed.runInInjectionContext(() =>
    createTranscriptPtahUiHostSources({
      tabId: signal('tab-1'),
      sessionId: signal<string | null>('session-1'),
      slots,
      activeTrees,
      liveModelStats,
    }),
  );
  return { sources, records, slots, activeTrees, liveModelStats };
}

const PREAMBLE = assistant('a0', 500);
const MESSAGES = [
  PREAMBLE,
  user('u1', 1_000),
  assistant('a1', 1_100, 'first', ['n1']),
  user('u2', 2_000),
  assistant('a2', 2_100, 'second', ['n2']),
];

describe('createTranscriptPtahUiHostSources', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reacts to nested store agents and keeps them in the parent turn', () => {
    const entries = signal<ReadonlyMap<string, unknown>>(new Map());
    const trees = new Map<string, ExecutionNode[]>();
    const treeFor = jest.fn((key: string) => trees.get(key) ?? []);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SubagentExecutionStore,
          useValue: { entries, revisionFor: () => entries(), treeFor },
        },
      ],
    });
    const records = [
      signal(user('u1', 1_000)),
      signal(assistant('a1', 1_100, 'first', ['parent'])),
      signal(user('u2', 2_000)),
      signal(assistant('a2', 2_100, 'second', ['other'])),
    ];
    const sources = TestBed.runInInjectionContext(() =>
      createTranscriptPtahUiHostSources({
        tabId: signal('tab-1'),
        sessionId: signal<string | null>('session-1'),
        slots: signal(records.map((record) => ({ record }))),
        activeTrees: signal<readonly ExecutionNode[]>([]),
        liveModelStats: signal<LiveModelStatsPayload | null>(null),
      }),
    );
    expect(
      sources.turnFacts().map((turn) => turn.nodes.map((node) => node.id)),
    ).toEqual([['parent'], ['other']]);

    trees.set('call-parent', [
      createExecutionNode({
        id: 'nested',
        type: 'agent',
        status: 'streaming',
        toolCallId: 'call-nested',
      }),
    ]);
    entries.set(new Map([['call-parent', {}]]));
    expect(
      sources.turnFacts().map((turn) => turn.nodes.map((node) => node.id)),
    ).toEqual([['parent', 'nested'], ['other']]);
    expect(treeFor).toHaveBeenCalledWith('call-parent');
  });
  it('includes a live tree absent from the assistant record', () => {
    const { sources, activeTrees } = setup([user('u1', 1_000)]);
    activeTrees.set([
      createExecutionNode({
        id: 'live-a1',
        type: 'message',
        children: [
          createExecutionNode({
            id: 'live-agent',
            type: 'agent',
            status: 'streaming',
            toolCallId: 'live-call',
          }),
        ],
      }),
    ]);

    expect(sources.turnFacts()[0].nodes.map((node) => node.id)).toEqual([
      'live-agent',
    ]);
  });

  it('passes the tab and session through', () => {
    const { sources } = setup(MESSAGES);
    expect(sources.tabId()).toBe('tab-1');
    expect(sources.sessionId()).toBe('session-1');
  });

  describe('turnIndexOf (same turn rule as collectTurnAgentFacts and turnKey)', () => {
    it('returns null for a message before the first user message', () => {
      const { sources } = setup(MESSAGES);
      expect(sources.turnIndexOf('a0')).toBeNull();
    });

    it('returns 1 for a message in the second turn, addressing turnFacts()[1]', () => {
      const { sources } = setup(MESSAGES);
      expect(sources.turnIndexOf('u2')).toBe(1);
      expect(sources.turnIndexOf('a2')).toBe(1);
      expect(sources.turnIndexOf('a1')).toBe(0);
      expect(sources.turnFacts()[1].startedAt).toBe(2_000);
      expect(sources.turnFacts()[1].nodes.map((node) => node.id)).toEqual([
        'n2',
      ]);
    });

    it('returns null for a message the transcript does not hold', () => {
      const { sources } = setup(MESSAGES);
      expect(sources.turnIndexOf('missing')).toBeNull();
    });

    it("agrees with the display candidates' turnKey", () => {
      const messages = [
        PREAMBLE,
        user('u1', 1_000),
        assistant('a1', 1_100, '```ptah-ui display stats\n'),
        user('u2', 2_000),
        assistant('a2', 2_100, '```ptah-ui display tests\n'),
      ];
      const { sources } = setup(messages);
      const userIds = messages
        .filter((message) => message.role === 'user')
        .map((message) => message.id);
      const candidates = collectDisplayCandidates(messages, messages.length);
      expect(candidates.length).toBe(2);
      for (const candidate of candidates) {
        expect(userIds[sources.turnIndexOf(candidate.messageId) ?? -1]).toBe(
          candidate.turnKey,
        );
      }
    });
  });

  describe('current records (decision #94)', () => {
    it('reflects a content-only write to a slot record without a slot-list change', () => {
      const { sources, records } = setup(MESSAGES);
      const facts = computed(() =>
        sources.turnFacts()[1].nodes.map((node) => node.id),
      );
      expect(facts()).toEqual(['n2']);

      records[4].set(assistant('a2', 2_100, 'second', ['n2', 'n3']));
      expect(facts()).toEqual(['n2', 'n3']);
    });

    it('re-runs a reactive turnIndexOf read when the slots change', () => {
      const { sources, slots } = setup(MESSAGES);
      const index = computed(() => sources.turnIndexOf('a3'));
      expect(index()).toBeNull();

      slots.update((current) => [
        ...current,
        { record: () => user('u3', 3_000) },
        { record: () => assistant('a3', 3_100) },
      ]);
      expect(index()).toBe(2);
    });
  });

  describe('capacities (decision #54)', () => {
    it('is [] when the tab has no live model stats or no context capacity', () => {
      const { sources, liveModelStats } = setup(MESSAGES);
      expect(sources.capacities()).toEqual([]);
      liveModelStats.set(stats());
      expect(sources.capacities()).toEqual([]);
    });

    it('is [liveModelStats.contextCapacity] when the tab has one', () => {
      const { sources, liveModelStats } = setup(MESSAGES);
      liveModelStats.set(stats(CAPACITY));
      expect(sources.capacities()).toEqual([CAPACITY]);
    });
  });
});
