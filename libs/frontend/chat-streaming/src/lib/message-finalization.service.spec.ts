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
import { TabManagerService } from '@ptah-extension/chat-state';
import { SessionManager } from './session-manager.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
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

/** A root `message_start`; `id` is the tree node id a root message builds. */
type RootStart = { id: string; messageId: string; role: 'user' | 'assistant' };

/** An SDK assistant message; its tree node id is `start-${messageId}`. */
const assistantRoot = (messageId: string): RootStart => ({
  id: `start-${messageId}`,
  messageId,
  role: 'assistant',
});

/** `recordUserPromptBoundary`'s shape: event id = messageId = bubble id. */
const promptBoundary = (bubbleId: string): RootStart => ({
  id: bubbleId,
  messageId: bubbleId,
  role: 'user',
});

/** The SDK's replay of the prompt, under the SDK's own uuid. */
const sdkUserEcho = (uuid: string): RootStart => ({
  id: `start-${uuid}`,
  messageId: uuid,
  role: 'user',
});

/** A state whose root messages are `roots`, in order. */
function makeRootsState(
  roots: readonly RootStart[],
  overrides: Partial<StreamingState> = {},
): StreamingState {
  const eventsByMessage = new Map(
    roots.map((root, index) => [
      root.messageId,
      [{ ...root, eventType: 'message_start', timestamp: index } as never],
    ]),
  );
  return makeStreamingState({
    eventsByMessage,
    messageEventIds: roots.map((root) => root.messageId),
    ...overrides,
  });
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
  let treeBuilder: jest.Mocked<
    Pick<ExecutionTreeBuilderService, 'buildTree' | 'clearForTab'>
  >;
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

    // `clearForTab` is part of the double because finalizing a turn now
    // releases the builder's memo for that tab — the memo would otherwise keep
    // the PRE-cap nodes alive past the cap that just bounded them.
    treeBuilder = {
      buildTree: jest.fn(() => []),
      clearForTab: jest.fn(),
    } as unknown as jest.Mocked<
      Pick<ExecutionTreeBuilderService, 'buildTree' | 'clearForTab'>
    >;

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

    /**
     * Finalized ids for the turn — the anchors only exist in the state's root
     * messages, since user roots are not tree output.
     */
    const finalizedIds = (): string[] => {
      const [, msgs] = tabManager.applyFinalizedTurn.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      return msgs.map((m) => m.id);
    };

    it('keeps the part of a turn that ran before a mid-turn prompt above it', () => {
      const prompt = {
        id: 'user-mid-turn',
        role: 'user',
        rawContent: 'follow-up',
      } as ExecutionChatMessage;
      treeBuilder.buildTree.mockReturnValue([
        makeNode({ id: 'start-msg-before', type: 'message' }),
        makeNode({ id: 'start-msg-after', type: 'message' }),
      ]);
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          messages: [prompt],
          streamingState: makeRootsState(
            [
              assistantRoot('msg-before'),
              promptBoundary('user-mid-turn'),
              assistantRoot('msg-after'),
            ],
            {
              currentMessageId: 'msg-after',
              pendingStats: {
                tokens: { input: 1, output: 2 },
                cost: 0.01,
                duration: 10,
              },
            },
          ),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();

      const [, msgs] = tabManager.applyFinalizedTurn.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      expect(msgs.map((m) => m.id)).toEqual([
        'start-msg-before',
        'user-mid-turn',
        'start-msg-after',
      ]);
      expect(msgs[1]).toBe(prompt);
      expect(msgs[0].tokens).toBeUndefined();
      expect(msgs[2].tokens).toEqual({ input: 1, output: 2 });
    });

    it('places the turn once around a prompt the boundary AND the SDK echo both mark', () => {
      // The boundary anchors by the bubble's id. The echo root carries the
      // SDK's own uuid — stamped onto the bubble as `nativeUuid` — and is
      // skipped: it is neither an anchor nor a second copy of the prompt.
      const prompt = {
        id: 'user-bubble',
        role: 'user',
        nativeUuid: 'sdk-user-uuid',
      } as ExecutionChatMessage;
      treeBuilder.buildTree.mockReturnValue([
        makeNode({ id: 'start-msg-before', type: 'message' }),
        makeNode({ id: 'start-msg-after', type: 'message' }),
      ]);
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          messages: [prompt],
          streamingState: makeRootsState(
            [
              assistantRoot('msg-before'),
              promptBoundary('user-bubble'),
              sdkUserEcho('sdk-user-uuid'),
              assistantRoot('msg-after'),
            ],
            { currentMessageId: 'msg-after' },
          ),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();

      expect(finalizedIds()).toEqual([
        'start-msg-before',
        'user-bubble',
        'start-msg-after',
      ]);
    });

    it('never anchors on the SDK echo through a stamped nativeUuid', () => {
      // No boundary: the echo root matches the bubble only by `nativeUuid`,
      // which is not an anchor, so the turn is the plain append.
      const earlier = {
        id: 'earlier',
        role: 'assistant',
      } as ExecutionChatMessage;
      const prompt = {
        id: 'user-bubble',
        role: 'user',
        nativeUuid: 'sdk-user-uuid',
      } as ExecutionChatMessage;
      treeBuilder.buildTree.mockReturnValue([
        makeNode({ id: 'start-msg-before', type: 'message' }),
        makeNode({ id: 'start-msg-after', type: 'message' }),
      ]);
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          messages: [earlier, prompt],
          streamingState: makeRootsState(
            [
              assistantRoot('msg-before'),
              sdkUserEcho('sdk-user-uuid'),
              assistantRoot('msg-after'),
            ],
            { currentMessageId: 'msg-after' },
          ),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();

      expect(finalizedIds()).toEqual([
        'earlier',
        'user-bubble',
        'start-msg-before',
        'start-msg-after',
      ]);
    });

    it('appends the reply after its own prompt when the echo uuid was stamped on an older failed bubble (R1)', () => {
      // A failed direct send keeps its bubble and appends a failure notice.
      // The retry's SDK echo is then stamped onto the OLDEST unstamped bubble —
      // the failed one — by `reconcileUserMessageNativeUuid`.
      const earlier = {
        id: 'earlier',
        role: 'assistant',
      } as ExecutionChatMessage;
      const failedPrompt = {
        id: 'msg_1_failed',
        role: 'user',
        nativeUuid: 'sdk-user-uuid',
      } as ExecutionChatMessage;
      const failureNotice = {
        id: 'notice',
        role: 'assistant',
      } as ExecutionChatMessage;
      const retryPrompt = {
        id: 'msg_2_retry',
        role: 'user',
      } as ExecutionChatMessage;
      treeBuilder.buildTree.mockReturnValue([
        makeNode({ id: 'start-msg-reply', type: 'message' }),
      ]);
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          messages: [earlier, failedPrompt, failureNotice, retryPrompt],
          streamingState: makeRootsState(
            [sdkUserEcho('sdk-user-uuid'), assistantRoot('msg-reply')],
            {
              currentMessageId: 'msg-reply',
              pendingStats: {
                tokens: { input: 5, output: 8 },
                cost: 0.04,
                duration: 40,
              },
            },
          ),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();

      const [, msgs] = tabManager.applyFinalizedTurn.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      expect(msgs.map((m) => m.id)).toEqual([
        'earlier',
        'msg_1_failed',
        'notice',
        'msg_2_retry',
        'start-msg-reply',
      ]);
      expect(msgs[4].tokens).toEqual({ input: 5, output: 8 });
    });

    it('splits one turn around two prompts sent mid-turn, in root order', () => {
      const msg0 = { id: 'msg0', role: 'assistant' } as ExecutionChatMessage;
      const promptA = { id: 'prompt-a', role: 'user' } as ExecutionChatMessage;
      const promptB = { id: 'prompt-b', role: 'user' } as ExecutionChatMessage;
      treeBuilder.buildTree.mockReturnValue([
        makeNode({ id: 'start-msg-before', type: 'message' }),
        makeNode({ id: 'start-msg-mid', type: 'message' }),
        makeNode({ id: 'start-msg-after', type: 'message' }),
      ]);
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          messages: [msg0, promptA, promptB],
          streamingState: makeRootsState(
            [
              assistantRoot('msg-before'),
              promptBoundary('prompt-a'),
              assistantRoot('msg-mid'),
              promptBoundary('prompt-b'),
              assistantRoot('msg-after'),
            ],
            {
              currentMessageId: 'msg-after',
              pendingStats: {
                tokens: { input: 6, output: 9 },
                cost: 0.05,
                duration: 50,
              },
            },
          ),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();

      const [, msgs] = tabManager.applyFinalizedTurn.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      expect(msgs.map((m) => m.id)).toEqual([
        'msg0',
        'start-msg-before',
        'prompt-a',
        'start-msg-mid',
        'prompt-b',
        'start-msg-after',
      ]);
      expect(msgs[1].tokens).toBeUndefined();
      expect(msgs[3].tokens).toBeUndefined();
      expect(msgs[5].tokens).toEqual({ input: 6, output: 9 });
    });

    it('gives a message merged into an earlier node no slot of its own', () => {
      const prompt = {
        id: 'user-bubble',
        role: 'user',
      } as ExecutionChatMessage;
      // `msg-a2` merged into `msg-a1`'s node, so the tree has no node for it.
      treeBuilder.buildTree.mockReturnValue([
        makeNode({ id: 'start-msg-a1', type: 'message' }),
        makeNode({ id: 'start-msg-a3', type: 'message' }),
      ]);
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          messages: [prompt],
          streamingState: makeRootsState(
            [
              assistantRoot('msg-a1'),
              assistantRoot('msg-a2'),
              promptBoundary('user-bubble'),
              assistantRoot('msg-a3'),
            ],
            { currentMessageId: 'msg-a3' },
          ),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();

      expect(finalizedIds()).toEqual([
        'start-msg-a1',
        'user-bubble',
        'start-msg-a3',
      ]);
    });

    it('puts the stats on the last new message when the turn ends on the prompt', () => {
      const prompt = { id: 'user-last', role: 'user' } as ExecutionChatMessage;
      treeBuilder.buildTree.mockReturnValue([
        makeNode({ id: 'start-msg-answer', type: 'message' }),
      ]);
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          messages: [prompt],
          streamingState: makeRootsState(
            [assistantRoot('msg-answer'), promptBoundary('user-last')],
            {
              currentMessageId: 'msg-answer',
              pendingStats: {
                tokens: { input: 4, output: 6 },
                cost: 0.02,
                duration: 20,
              },
            },
          ),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();

      const [, msgs] = tabManager.applyFinalizedTurn.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      expect(msgs.map((m) => m.id)).toEqual(['start-msg-answer', 'user-last']);
      expect(msgs[0].tokens).toEqual({ input: 4, output: 6 });
    });

    it('settles a tree holding only a prompt boundary like an empty tree', () => {
      // The prompt is the last message, so the empty-tree stats fold (last
      // message must be an assistant) never applied here either: no message
      // is minted and the streaming state is cleared.
      const answer = {
        id: 'answer',
        role: 'assistant',
      } as ExecutionChatMessage;
      const prompt = { id: 'user-bg', role: 'user' } as ExecutionChatMessage;
      // A user root is not tree output, so a boundary-only state builds [].
      treeBuilder.buildTree.mockReturnValue([]);
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          messages: [answer, prompt],
          streamingState: makeRootsState([promptBoundary('user-bg')], {
            currentMessageId: 'msg-subagent',
            pendingStats: {
              tokens: { input: 7, output: 9 },
              cost: 0.03,
              duration: 30,
            },
          }),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();

      expect(tabManager.applyFinalizedTurn).not.toHaveBeenCalled();
      expect(tabManager.clearStreamingForLoaded).toHaveBeenCalledWith('tab-1');
    });

    it('does not mint an empty assistant message when the tree has no root', () => {
      // An orphaned subagent message (its owning tool_start was finalized with
      // the previous turn) leaves `currentMessageId` set and the tree empty.
      treeBuilder.buildTree.mockReturnValue([]);
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          streamingState: makeStreamingState({
            currentMessageId: 'msg-orphan',
          }),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();

      expect(tabManager.applyFinalizedTurn).not.toHaveBeenCalled();
      expect(tabManager.clearStreamingForLoaded).toHaveBeenCalledWith('tab-1');
    });

    it('folds pending stats onto the last assistant message when the tree has no root', () => {
      treeBuilder.buildTree.mockReturnValue([]);
      const previous = {
        id: 'prev',
        role: 'assistant',
        cost: 0.01,
      } as ExecutionChatMessage;
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          messages: [previous],
          streamingState: makeStreamingState({
            currentMessageId: 'msg-orphan',
            pendingStats: {
              tokens: { input: 2, output: 3 },
              cost: 0.5,
              duration: 42,
            },
          }),
        }),
      ]);
      activeTabIdSignal.set('tab-1');

      service.finalizeCurrentMessage();

      expect(tabManager.applyFinalizedTurn).toHaveBeenCalledTimes(1);
      const [, msgs] = tabManager.applyFinalizedTurn.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].id).toBe('prev');
      expect(msgs[0].tokens).toEqual({ input: 2, output: 3 });
      expect(msgs[0].cost).toBe(0.5);
      expect(msgs[0].duration).toBe(42);
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

  describe('finalizeSessionHistory historical-replay safety net', () => {
    it('preserves complete subagent nodes finalized via SubagentStop signal', () => {
      const completedSubagent = makeNode({
        id: 'sa1',
        type: 'agent',
        status: 'complete',
        toolCallId: 'tc-sa1',
      });
      const root = makeNode({
        id: 'root-msg',
        type: 'text',
        status: 'complete',
        children: [completedSubagent],
      });
      treeBuilder.buildTree.mockReturnValue([root]);

      const state = makeStreamingState({
        messageEventIds: ['root-msg'],
        events: new Map([
          [
            'evt-start',
            {
              eventType: 'message_start',
              id: 'root-msg',
              messageId: 'root-msg',
              role: 'assistant',
              timestamp: 1,
            } as never,
          ],
        ]),
      });

      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          streamingState: state,
        }),
      ]);

      service.finalizeSessionHistory('tab-1');

      expect(tabManager.applyFinalizedHistory).toHaveBeenCalledTimes(1);
      const [, msgs] = tabManager.applyFinalizedHistory.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      expect(msgs).toHaveLength(1);
      const tree = msgs[0].streamingState as ExecutionNode;
      expect(tree.children[0].status).toBe('complete');
    });

    it('marks orphaned streaming agent nodes as interrupted on JSONL history replay', () => {
      const streamingSubagent = makeNode({
        id: 'sa2',
        type: 'agent',
        status: 'streaming',
        toolCallId: 'tc-sa2',
      });
      const root = makeNode({
        id: 'root-msg-2',
        type: 'text',
        status: 'complete',
        children: [streamingSubagent],
      });
      treeBuilder.buildTree.mockReturnValue([root]);

      const state = makeStreamingState({
        messageEventIds: ['root-msg-2'],
        events: new Map([
          [
            'evt-start',
            {
              eventType: 'message_start',
              id: 'root-msg-2',
              messageId: 'root-msg-2',
              role: 'assistant',
              timestamp: 1,
            } as never,
          ],
        ]),
      });

      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          streamingState: state,
        }),
      ]);

      service.finalizeSessionHistory('tab-1');

      const [, msgs] = tabManager.applyFinalizedHistory.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      const tree = msgs[0].streamingState as ExecutionNode;
      expect(tree.children[0].status).toBe('interrupted');
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
