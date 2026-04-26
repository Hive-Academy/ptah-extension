/**
 * MessageFinalizationService specs — turns StreamingState into finalized
 * ExecutionChatMessage entries and applies post-finalization mutations
 * (mark-as-interrupted variants).
 *
 * Coverage focuses on:
 *   - deepCopyStreamingState: isolates inner Maps/objects
 *   - extractTextForMessage: merges text_delta accumulators by block index
 *   - finalizeCurrentMessage: no-op when no active tab / messageId missing,
 *     dedup when message already exists, normal happy path adds message +
 *     clears streaming state, and uses pendingStats tokens when present
 *   - markLastAgentAsInterrupted: marks the rightmost agent as 'interrupted',
 *     leaves tree untouched when no agents found
 *   - markAgentsAsInterruptedByToolCallIds: marks every matching agent, leaves
 *     tree untouched on no match
 *
 * The ExecutionTreeBuilderService is mocked to return controlled trees so that
 * tests don't depend on the full builder's internals (that service has its
 * own spec).
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import type {
  ExecutionNode,
  ExecutionChatMessage,
} from '@ptah-extension/shared';
import { MessageFinalizationService } from './message-finalization.service';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import { ExecutionTreeBuilderService } from '../execution-tree-builder.service';
import { BatchedUpdateService } from './batched-update.service';
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
    ...overrides,
  } as ExecutionNode;
}

describe('MessageFinalizationService', () => {
  let service: MessageFinalizationService;
  let tabsSignal: ReturnType<typeof signal<TabState[]>>;
  let activeTabIdSignal: ReturnType<typeof signal<string | null>>;
  let tabManager: {
    tabs: ReturnType<typeof computed<TabState[]>>;
    activeTabId: ReturnType<typeof computed<string | null>>;
    activeTab: ReturnType<typeof computed<TabState | null>>;
    applyFinalizedTurn: jest.Mock;
    applyFinalizedHistory: jest.Mock;
    clearStreamingForLoaded: jest.Mock;
    setMessages: jest.Mock;
  };
  let sessionManager: jest.Mocked<Pick<SessionManager, 'setStatus'>>;
  let treeBuilder: jest.Mocked<Pick<ExecutionTreeBuilderService, 'buildTree'>>;
  let batchedUpdate: jest.Mocked<Pick<BatchedUpdateService, 'flushSync'>>;

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
      applyFinalizedTurn: jest.fn(),
      applyFinalizedHistory: jest.fn(),
      clearStreamingForLoaded: jest.fn(),
      setMessages: jest.fn(),
    };

    sessionManager = {
      setStatus: jest.fn(),
    } as jest.Mocked<Pick<SessionManager, 'setStatus'>>;

    treeBuilder = {
      buildTree: jest.fn(() => []),
    } as unknown as jest.Mocked<Pick<ExecutionTreeBuilderService, 'buildTree'>>;

    batchedUpdate = {
      flushSync: jest.fn(),
    } as jest.Mocked<Pick<BatchedUpdateService, 'flushSync'>>;

    TestBed.configureTestingModule({
      providers: [
        MessageFinalizationService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionManager, useValue: sessionManager },
        { provide: ExecutionTreeBuilderService, useValue: treeBuilder },
        { provide: BatchedUpdateService, useValue: batchedUpdate },
      ],
    });
    service = TestBed.inject(MessageFinalizationService);
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('deepCopyStreamingState', () => {
    it('creates new Map instances for every inner Map', () => {
      const original = makeStreamingState({
        events: new Map([['e1', { id: 'e1' } as never]]),
        toolCallMap: new Map([['tc', ['ev']]]),
        textAccumulators: new Map([['k', 'v']]),
        eventsByMessage: new Map([['m1', [{ id: 'e1' } as never]]]),
      });

      const copy = service.deepCopyStreamingState(original);

      expect(copy.events).not.toBe(original.events);
      expect(copy.toolCallMap).not.toBe(original.toolCallMap);
      expect(copy.textAccumulators).not.toBe(original.textAccumulators);
      expect(copy.eventsByMessage).not.toBe(original.eventsByMessage);

      // Inner array values are copied (not shared).
      expect(copy.toolCallMap.get('tc')).not.toBe(
        original.toolCallMap.get('tc'),
      );
      expect(copy.toolCallMap.get('tc')).toEqual(['ev']);
    });

    it('clones pendingStats and currentTokenUsage when present', () => {
      const original = makeStreamingState({
        pendingStats: {
          tokens: { input: 1, output: 2 },
          cost: 0.1,
          duration: 100,
        },
        currentTokenUsage: { input: 10, output: 20 },
      });
      const copy = service.deepCopyStreamingState(original);
      expect(copy.pendingStats).not.toBe(original.pendingStats);
      expect(copy.pendingStats).toEqual(original.pendingStats);
      expect(copy.currentTokenUsage).not.toBe(original.currentTokenUsage);
      expect(copy.currentTokenUsage).toEqual(original.currentTokenUsage);
    });

    it('preserves null for absent optional fields', () => {
      const original = makeStreamingState({
        pendingStats: null,
        currentTokenUsage: null,
      });
      const copy = service.deepCopyStreamingState(original);
      expect(copy.pendingStats).toBeNull();
      expect(copy.currentTokenUsage).toBeNull();
    });
  });

  describe('extractTextForMessage', () => {
    it('returns empty string when no accumulators match', () => {
      const state = makeStreamingState();
      expect(service.extractTextForMessage(state, 'msg-1')).toBe('');
    });

    it('joins text blocks in block-index order', () => {
      const state = makeStreamingState({
        textAccumulators: new Map([
          ['msg-1-block-1', 'second'],
          ['msg-1-block-0', 'first'],
          ['msg-1-block-2', 'third'],
          ['msg-other-block-0', 'ignored'],
        ]),
      });
      expect(service.extractTextForMessage(state, 'msg-1')).toBe(
        'first\nsecond\nthird',
      );
    });
  });

  describe('finalizeCurrentMessage', () => {
    it('is a no-op when there is no active tab', () => {
      service.finalizeCurrentMessage();
      expect(tabManager.applyFinalizedTurn).not.toHaveBeenCalled();
      expect(tabManager.clearStreamingForLoaded).not.toHaveBeenCalled();
      expect(batchedUpdate.flushSync).toHaveBeenCalled();
    });

    it('is a no-op when the tab has no streaming state', () => {
      tabsSignal.set([makeTab({ id: 'tab-1', streamingState: null })]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();
      expect(tabManager.applyFinalizedTurn).not.toHaveBeenCalled();
      expect(tabManager.clearStreamingForLoaded).not.toHaveBeenCalled();
    });

    it('is a no-op when currentMessageId is missing', () => {
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          streamingState: makeStreamingState({ currentMessageId: null }),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();
      expect(tabManager.applyFinalizedTurn).not.toHaveBeenCalled();
      expect(tabManager.clearStreamingForLoaded).not.toHaveBeenCalled();
    });

    it('builds a final tree and appends a new assistant message to the tab', () => {
      const finalNode = makeNode({ id: 'root', content: 'final' });
      treeBuilder.buildTree.mockReturnValue([finalNode]);

      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          streamingState: makeStreamingState({
            currentMessageId: 'msg-1',
            pendingStats: {
              tokens: { input: 3, output: 5 },
              cost: 0.12,
              duration: 900,
            },
          }),
          claudeSessionId: 'sess-1',
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();

      expect(tabManager.applyFinalizedTurn).toHaveBeenCalledTimes(1);
      const [tabId, msgs] = tabManager.applyFinalizedTurn.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      expect(tabId).toBe('tab-1');

      expect(msgs).toHaveLength(1);
      expect(msgs[0].id).toBe('root');
      expect(msgs[0].role).toBe('assistant');
      expect(msgs[0].tokens).toEqual({ input: 3, output: 5 });
      expect(msgs[0].cost).toBe(0.12);

      expect(sessionManager.setStatus).toHaveBeenCalledWith('loaded');
    });

    it('clears streaming state without duplicating when the message is already finalized', () => {
      const finalNode = makeNode({ id: 'msg-1' });
      treeBuilder.buildTree.mockReturnValue([finalNode]);

      const existing = {
        id: 'msg-1',
        role: 'assistant',
      } as ExecutionChatMessage;

      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          messages: [existing],
          streamingState: makeStreamingState({ currentMessageId: 'msg-1' }),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();

      expect(tabManager.clearStreamingForLoaded).toHaveBeenCalledWith('tab-1');
      expect(tabManager.applyFinalizedTurn).not.toHaveBeenCalled();
    });

    it('marks streaming nodes as interrupted when isAborted=true', () => {
      const streamingChild = makeNode({
        id: 'c',
        type: 'tool',
        status: 'streaming',
      });
      const root = makeNode({
        id: 'root',
        children: [streamingChild],
      });
      treeBuilder.buildTree.mockReturnValue([root]);

      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          streamingState: makeStreamingState({ currentMessageId: 'msg-1' }),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage(undefined, true);

      const [, msgs] = tabManager.applyFinalizedTurn.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      const rootTree = msgs[0].streamingState as ExecutionNode;
      expect(rootTree.children[0].status).toBe('interrupted');
    });
  });

  describe('markLastAgentAsInterrupted', () => {
    it('is a no-op when the tab is missing or has no messages', () => {
      service.markLastAgentAsInterrupted('nope');
      expect(tabManager.setMessages).not.toHaveBeenCalled();
    });

    it('marks the last complete agent as interrupted', () => {
      const agent = makeNode({
        id: 'ag',
        type: 'agent',
        status: 'complete',
      });
      const assistantMsg = {
        id: 'm1',
        role: 'assistant',
        streamingState: makeNode({
          id: 'root',
          children: [agent],
        }),
      } as ExecutionChatMessage;

      tabsSignal.set([makeTab({ id: 'tab-1', messages: [assistantMsg] })]);

      service.markLastAgentAsInterrupted('tab-1');

      const [, msgs] = tabManager.setMessages.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      const tree = msgs[0].streamingState as ExecutionNode;
      expect(tree.children[0].status).toBe('interrupted');
    });

    it('does nothing when there are no agent nodes', () => {
      const assistantMsg = {
        id: 'm1',
        role: 'assistant',
        streamingState: makeNode({ id: 'root', children: [] }),
      } as ExecutionChatMessage;

      tabsSignal.set([makeTab({ id: 'tab-1', messages: [assistantMsg] })]);

      service.markLastAgentAsInterrupted('tab-1');
      expect(tabManager.setMessages).not.toHaveBeenCalled();
    });
  });

  describe('markAgentsAsInterruptedByToolCallIds', () => {
    it('marks every matching agent node as interrupted', () => {
      const agentA = makeNode({
        id: 'a',
        type: 'agent',
        status: 'complete',
        toolCallId: 'tc-A',
      });
      const agentB = makeNode({
        id: 'b',
        type: 'agent',
        status: 'complete',
        toolCallId: 'tc-B',
      });
      const agentC = makeNode({
        id: 'c',
        type: 'agent',
        status: 'complete',
        toolCallId: 'tc-C',
      });
      const assistantMsg = {
        id: 'm1',
        role: 'assistant',
        streamingState: makeNode({
          id: 'root',
          children: [agentA, agentB, agentC],
        }),
      } as ExecutionChatMessage;

      tabsSignal.set([makeTab({ id: 'tab-1', messages: [assistantMsg] })]);

      service.markAgentsAsInterruptedByToolCallIds(
        'tab-1',
        new Set(['tc-A', 'tc-C']),
      );

      const [, msgs] = tabManager.setMessages.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      const tree = msgs[0].streamingState as ExecutionNode;
      expect(tree.children[0].status).toBe('interrupted');
      expect(tree.children[1].status).toBe('complete');
      expect(tree.children[2].status).toBe('interrupted');
    });

    it('is a no-op when no agent toolCallIds match', () => {
      const agent = makeNode({
        id: 'a',
        type: 'agent',
        status: 'complete',
        toolCallId: 'tc-A',
      });
      const assistantMsg = {
        id: 'm1',
        role: 'assistant',
        streamingState: makeNode({
          id: 'root',
          children: [agent],
        }),
      } as ExecutionChatMessage;

      tabsSignal.set([makeTab({ id: 'tab-1', messages: [assistantMsg] })]);

      service.markAgentsAsInterruptedByToolCallIds('tab-1', new Set(['tc-ZZ']));
      expect(tabManager.setMessages).not.toHaveBeenCalled();
    });
  });
});
