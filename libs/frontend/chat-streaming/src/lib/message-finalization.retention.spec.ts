/**
 * MessageFinalizationService — the retention pass at the two points a finalized
 * tree is minted, and the builder-memo release that stops the PRE-cap tree from
 * outliving it.
 *
 * Separated from `message-finalization.service.spec.ts` so the existing
 * finalization assertions stay readable; the wiring is the same shape.
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import type {
  ExecutionNode,
  ExecutionChatMessage,
} from '@ptah-extension/shared';
import { MessageFinalizationService } from './message-finalization.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SessionManager } from './session-manager.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { BatchedUpdateService } from './batched-update.service';
import { MAX_RETAINED_TOOL_OUTPUT_CHARS } from './execution-tree-retention';
import type { StreamingState, TabState } from '@ptah-extension/chat-types';

function makeStreamingState(
  overrides: Partial<StreamingState> = {},
): StreamingState {
  return {
    events: new Map(),
    messageEventIds: [],
    toolCallMap: new Map(),
    textAccumulators: new Map(),
    toolInputAccumulators: new Map(),
    agentSummaryAccumulators: new Map(),
    agentContentBlocksMap: new Map(),
    currentMessageId: null,
    currentTokenUsage: null,
    eventsByMessage: new Map(),
    pendingStats: null,
    ...overrides,
  };
}

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Session',
    name: 'Session',
    status: 'streaming',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: 'sess-1',
    ...overrides,
  } as TabState;
}

function makeNode(overrides: Partial<ExecutionNode> = {}): ExecutionNode {
  return {
    id: 'n1',
    type: 'text',
    status: 'complete',
    content: '',
    children: [],
    isCollapsed: false,
    ...overrides,
  } as ExecutionNode;
}

const OVERSIZED_OUTPUT = 'O'.repeat(MAX_RETAINED_TOOL_OUTPUT_CHARS * 3);

describe('MessageFinalizationService — payload retention', () => {
  let service: MessageFinalizationService;
  let tabsSignal: ReturnType<typeof signal<TabState[]>>;
  let activeTabIdSignal: ReturnType<typeof signal<string | null>>;
  let tabManager: {
    tabs: ReturnType<typeof computed<TabState[]>>;
    activeTabId: ReturnType<typeof computed<string | null>>;
    activeTab: ReturnType<typeof computed<TabState | null>>;
    findTabByIdAcrossWorkspaces: jest.Mock;
    applyFinalizedTurn: jest.Mock;
    applyFinalizedHistory: jest.Mock;
    clearStreamingForLoaded: jest.Mock;
    setMessages: jest.Mock;
  };
  let treeBuilder: { buildTree: jest.Mock; clearForTab: jest.Mock };

  beforeEach(() => {
    tabsSignal = signal<TabState[]>([]);
    activeTabIdSignal = signal<string | null>(null);

    tabManager = {
      tabs: computed(() => tabsSignal()),
      activeTabId: computed(() => activeTabIdSignal()),
      activeTab: computed(() => {
        const id = activeTabIdSignal();
        return tabsSignal().find((t) => t.id === id) ?? null;
      }),
      findTabByIdAcrossWorkspaces: jest.fn((id: string) => {
        const tab = tabsSignal().find((t) => t.id === id);
        return tab ? { tab } : undefined;
      }),
      applyFinalizedTurn: jest.fn(),
      applyFinalizedHistory: jest.fn(),
      clearStreamingForLoaded: jest.fn(),
      setMessages: jest.fn(),
    };

    treeBuilder = { buildTree: jest.fn(() => []), clearForTab: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        MessageFinalizationService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionManager, useValue: { setStatus: jest.fn() } },
        { provide: ExecutionTreeBuilderService, useValue: treeBuilder },
        { provide: BatchedUpdateService, useValue: { flushSync: jest.fn() } },
      ],
    });
    service = TestBed.inject(MessageFinalizationService);
  });

  afterEach(() => TestBed.resetTestingModule());

  function finalizedTreeFor(root: ExecutionNode): ExecutionNode {
    treeBuilder.buildTree.mockReturnValue([root]);
    tabsSignal.set([
      makeTab({
        id: 'tab-1',
        streamingState: makeStreamingState({ currentMessageId: 'msg-1' }),
      }),
    ]);
    activeTabIdSignal.set('tab-1');

    service.finalizeCurrentMessage();

    const [, msgs] = tabManager.applyFinalizedTurn.mock.calls[0] as [
      string,
      ExecutionChatMessage[],
    ];
    return msgs[0].streamingState as ExecutionNode;
  }

  describe('finalizeCurrentMessage', () => {
    it('finalizes an oversized tool output as a capped, MARKED tree', () => {
      const tree = finalizedTreeFor(
        makeNode({
          id: 'root',
          type: 'message',
          children: [
            makeNode({
              id: 'tool-1',
              type: 'tool',
              toolName: 'Read',
              toolOutput: OVERSIZED_OUTPUT,
            }),
          ],
        }),
      );

      const tool = tree.children[0];
      expect((tool.toolOutput as string).length).toBeLessThan(
        OVERSIZED_OUTPUT.length,
      );
      expect(tool.retention?.capped).toEqual(['toolOutput']);
      expect(tool.retention?.droppedChars).toBeGreaterThan(0);
      expect(tool.toolOutput as string).toContain('reopen the session');
    });

    it('keeps the finalized message under a stated serialized ceiling', () => {
      const tree = finalizedTreeFor(
        makeNode({
          id: 'root',
          type: 'message',
          children: Array.from({ length: 5 }, (_, i) =>
            makeNode({
              id: `tool-${i}`,
              type: 'tool',
              toolOutput: OVERSIZED_OUTPUT,
            }),
          ),
        }),
      );

      // Five nodes × 72 KB uncapped = ~360 KB. Capped, the whole tree must
      // serialize inside the per-node budget times the node count, with room
      // for the markers.
      expect(JSON.stringify(tree).length).toBeLessThan(
        5 * (MAX_RETAINED_TOOL_OUTPUT_CHARS + 512),
      );
    });

    it('leaves an under-budget tree byte-identical to what the builder produced', () => {
      const built = makeNode({
        id: 'root',
        type: 'message',
        children: [makeNode({ id: 't', type: 'tool', toolOutput: 'ok' })],
      });

      const tree = finalizedTreeFor(built);

      expect(tree).toBe(built);
    });

    it('does not cap `content` on a text node, whatever its size', () => {
      const prose = 'P'.repeat(MAX_RETAINED_TOOL_OUTPUT_CHARS * 4);
      const tree = finalizedTreeFor(
        makeNode({
          id: 'root',
          type: 'message',
          children: [makeNode({ id: 'text-1', type: 'text', content: prose })],
        }),
      );

      expect(tree.children[0].content).toBe(prose);
      expect(tree.children[0].retention).toBeUndefined();
    });

    it('releases the builder memo for the finalized tab exactly once', () => {
      finalizedTreeFor(makeNode({ id: 'root', type: 'message' }));

      expect(treeBuilder.clearForTab).toHaveBeenCalledTimes(1);
      expect(treeBuilder.clearForTab).toHaveBeenCalledWith('tab-1');
    });
  });

  describe('post-finalization interrupt marking must not un-cap the tree', () => {
    function tabWithCappedMessage(): ExecutionNode {
      const capped = finalizedTreeFor(
        makeNode({
          id: 'root',
          type: 'message',
          children: [
            makeNode({
              id: 'agent-1',
              type: 'agent',
              status: 'complete',
              toolCallId: 'tc-A',
              toolOutput: OVERSIZED_OUTPUT,
            }),
          ],
        }),
      );

      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          messages: [
            {
              id: 'm1',
              role: 'assistant',
              streamingState: capped,
            } as ExecutionChatMessage,
          ],
        }),
      ]);
      return capped;
    }

    it('markLastAgentAsInterrupted preserves retention and the capped payload', () => {
      const capped = tabWithCappedMessage();
      const cappedPayload = capped.children[0].toolOutput;

      service.markLastAgentAsInterrupted('tab-1');

      const [, msgs] = tabManager.setMessages.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      const agent = (msgs[0].streamingState as ExecutionNode).children[0];
      expect(agent.status).toBe('interrupted');
      expect(agent.retention?.capped).toEqual(['toolOutput']);
      expect(agent.toolOutput).toBe(cappedPayload);
    });

    it('markAgentsAsInterruptedByToolCallIds preserves retention and the capped payload', () => {
      const capped = tabWithCappedMessage();
      const cappedPayload = capped.children[0].toolOutput;

      service.markAgentsAsInterruptedByToolCallIds('tab-1', new Set(['tc-A']));

      const [, msgs] = tabManager.setMessages.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      const agent = (msgs[0].streamingState as ExecutionNode).children[0];
      expect(agent.status).toBe('interrupted');
      expect(agent.retention?.droppedChars).toBeGreaterThan(0);
      expect(agent.toolOutput).toBe(cappedPayload);
    });
  });

  describe('finalizeSessionHistory', () => {
    function historyTabWith(root: ExecutionNode): ExecutionChatMessage[] {
      treeBuilder.buildTree.mockReturnValue([root]);
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          streamingState: makeStreamingState({
            messageEventIds: ['root'],
            events: new Map([
              [
                'evt-start',
                {
                  eventType: 'message_start',
                  id: 'root',
                  messageId: 'root',
                  role: 'assistant',
                  timestamp: 1,
                } as never,
              ],
            ]),
          }),
        }),
      ]);
      return service.finalizeSessionHistory('tab-1');
    }

    it('caps a replayed history tree and marks it', () => {
      const msgs = historyTabWith(
        makeNode({
          id: 'root',
          type: 'message',
          children: [
            makeNode({
              id: 'tool-1',
              type: 'tool',
              toolOutput: OVERSIZED_OUTPUT,
            }),
          ],
        }),
      );

      const tool = (msgs[0].streamingState as ExecutionNode).children[0];
      expect(tool.retention?.capped).toEqual(['toolOutput']);
      expect((tool.toolOutput as string).length).toBeLessThan(
        OVERSIZED_OUTPUT.length,
      );
    });

    it('does not re-truncate a restored tree that was already capped', () => {
      const alreadyCapped = makeNode({
        id: 'root',
        type: 'message',
        children: [
          makeNode({
            id: 'tool-1',
            type: 'tool',
            toolOutput: 'H'.repeat(MAX_RETAINED_TOOL_OUTPUT_CHARS + 400),
            retention: {
              droppedChars: 99_999,
              capped: ['toolOutput'],
              foldFailed: false,
            },
          }),
        ],
      });

      const msgs = historyTabWith(alreadyCapped);
      const tool = (msgs[0].streamingState as ExecutionNode).children[0];

      expect(tool.toolOutput).toBe(alreadyCapped.children[0].toolOutput);
      expect(tool.retention?.droppedChars).toBe(99_999);
    });
  });
});
