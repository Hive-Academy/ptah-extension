/**
 * MessageDispatchService specs — send-vs-queue routing + slash-command guard.
 *
 * Coverage:
 *   - sendOrQueueMessage: slash-command guard blocks /context for non-Anthropic
 *   - sendOrQueueMessage: guard does NOT block /compact or /review (all providers)
 *   - sendOrQueueMessage: guard does NOT block when authState.isLoading()
 *   - sendOrQueueMessage: guard does NOT block for apiKey provider
 *   - sendOrQueueMessage: streaming auto-denies permissions with deny_with_message
 *   - sendOrQueueMessage: not streaming dispatches via MessageSender.send
 *   - sendOrQueueMessage: explicit-tabId override beats activeTab
 *   - sendQueuedMessage: clears queue + queuedOptions before dispatch
 *   - sendQueuedMessage: forwards stored queuedOptions (files + images) to the dedicated queue-flush method
 *   - sendQueuedMessage: on error, restores content to queue
 *   - sendQueuedMessage: calls continueExistingSessionForQueueFlush (not send / continueConversation)
 *   - sendQueuedMessage: warns and re-queues (no new conversation) when the tab has no claudeSessionId
 *   - isTabBusyGenerating: the bounded exit — a tree with no currentMessageId
 *     is debris nothing can finalize, so it is NOT busy
 *   - Integration: the REAL StreamingHandler + MessageFinalization pair driven
 *     through finalize → stray post-turn events → send, with no queueing
 */

import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { AuthStateService } from '@ptah-extension/core';
import { SessionId, type FlatStreamEventUnion } from '@ptah-extension/shared';
import { createEmptyStreamingState } from '@ptah-extension/chat-types';
import {
  MessageDispatchService,
  isTabBusyGenerating,
} from './message-dispatch.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import { MessageSenderService } from '../message-sender.service';
import { ConversationService } from './conversation.service';
import {
  AgentMonitorStore,
  MessageFinalizationService,
  PermissionHandlerService,
  StreamingHandlerService,
  TurnStateApplier,
} from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Tab 1',
    status: 'loaded',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: 'sess-1',
    isCompacting: false,
    queuedContent: null,
    queuedOptions: null,
    ...overrides,
  } as unknown as TabState;
}

describe('MessageDispatchService', () => {
  let service: MessageDispatchService;
  let tabs: TabState[];
  /** Tabs in a NON-active workspace — invisible to `tabs()` by design. */
  let backgroundTabs: TabState[];
  let setMessagesMock: jest.Mock;
  let setQueuedContentMock: jest.Mock;
  let clearQueuedContentAndOptionsMock: jest.Mock;
  let activeTabStatus: ReturnType<typeof signal<string | null>>;
  let activeTabId: ReturnType<typeof signal<string | null>>;
  let persistedAuthMethod: ReturnType<typeof signal<string | null>>;
  let isLoadingAuth: ReturnType<typeof signal<boolean>>;
  let permissionRequests: ReturnType<typeof signal<unknown[]>>;
  let sendMock: jest.Mock;
  let queueOrAppendMock: jest.Mock;
  let continueConversationMock: jest.Mock;
  let continueExistingSessionForQueueFlushMock: jest.Mock;
  let handlePermissionResponseMock: jest.Mock;
  let isTabStreamingMock: jest.Mock;

  beforeEach(() => {
    tabs = [makeTab()];
    backgroundTabs = [];
    setMessagesMock = jest.fn((id: string, messages: TabState['messages']) => {
      tabs = tabs.map((t) => (t.id === id ? { ...t, messages } : t));
    });
    setQueuedContentMock = jest.fn((id: string, content: string | null) => {
      tabs = tabs.map((t) =>
        t.id === id ? { ...t, queuedContent: content } : t,
      );
    });
    clearQueuedContentAndOptionsMock = jest.fn((id: string) => {
      tabs = tabs.map((t) =>
        t.id === id ? { ...t, queuedContent: null, queuedOptions: null } : t,
      );
    });
    activeTabStatus = signal<string | null>('loaded');
    activeTabId = signal<string | null>('tab-1');
    persistedAuthMethod = signal<string | null>('apiKey');
    isLoadingAuth = signal<boolean>(false);
    permissionRequests = signal<unknown[]>([]);
    sendMock = jest.fn().mockResolvedValue(undefined);
    queueOrAppendMock = jest.fn();
    continueConversationMock = jest.fn().mockResolvedValue(undefined);
    continueExistingSessionForQueueFlushMock = jest
      .fn()
      .mockResolvedValue(undefined);
    handlePermissionResponseMock = jest.fn();
    isTabStreamingMock = jest.fn(() => false);

    const tabManagerMock = {
      tabs: () => tabs,
      setMessages: setMessagesMock,
      setQueuedContent: setQueuedContentMock,
      clearQueuedContentAndOptions: clearQueuedContentAndOptionsMock,
      activeTabStatus: () => activeTabStatus(),
      activeTabId: () => activeTabId(),
      activeTab: () => tabs.find((t) => t.id === activeTabId()) ?? null,
      isTabStreaming: isTabStreamingMock,
      // Mirrors production: the ACTIVE workspace plus every background
      // partition, unlike `tabs()`.
      findTabByIdAcrossWorkspaces: (tabId: string) => {
        const tab =
          tabs.find((t) => t.id === tabId) ??
          backgroundTabs.find((t) => t.id === tabId);
        return tab ? { tab, workspacePath: '/ws' } : null;
      },
    } as unknown as TabManagerService;

    const authStateMock = {
      persistedAuthMethod: () => persistedAuthMethod(),
      isLoading: () => isLoadingAuth(),
    } as unknown as AuthStateService;

    const messageSenderMock = {
      send: sendMock,
      continueExistingSessionForQueueFlush:
        continueExistingSessionForQueueFlushMock,
    } as unknown as MessageSenderService;
    const conversationMock = {
      queueOrAppendMessage: queueOrAppendMock,
      continueConversation: continueConversationMock,
    } as unknown as ConversationService;
    const permissionHandlerMock = {
      permissionRequests: () => permissionRequests(),
      handlePermissionResponse: handlePermissionResponseMock,
    } as unknown as PermissionHandlerService;

    TestBed.configureTestingModule({
      providers: [
        MessageDispatchService,
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: AuthStateService, useValue: authStateMock },
        { provide: MessageSenderService, useValue: messageSenderMock },
        { provide: ConversationService, useValue: conversationMock },
        { provide: PermissionHandlerService, useValue: permissionHandlerMock },
      ],
    });
    service = TestBed.inject(MessageDispatchService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('sendOrQueueMessage', () => {
    it('blocks /context slash command for non-Anthropic providers', async () => {
      persistedAuthMethod.set('copilot');
      await service.sendOrQueueMessage('/context');
      expect(sendMock).not.toHaveBeenCalled();
      expect(queueOrAppendMock).not.toHaveBeenCalled();
      // Warning message added via setMessages
      expect(setMessagesMock).toHaveBeenCalled();
    });

    it('does NOT block /compact or /review for non-Anthropic providers', async () => {
      persistedAuthMethod.set('copilot');
      await service.sendOrQueueMessage('/compact');
      expect(sendMock).toHaveBeenCalledWith('/compact', undefined);
      sendMock.mockClear();
      await service.sendOrQueueMessage('/review');
      expect(sendMock).toHaveBeenCalledWith('/review', undefined);
    });

    it('does NOT block when authState.isLoading() is true', async () => {
      persistedAuthMethod.set('copilot');
      isLoadingAuth.set(true);
      await service.sendOrQueueMessage('/context');
      expect(sendMock).toHaveBeenCalledWith('/context', undefined);
    });

    it('does NOT block for apiKey provider', async () => {
      persistedAuthMethod.set('apiKey');
      await service.sendOrQueueMessage('/context');
      expect(sendMock).toHaveBeenCalledWith('/context', undefined);
    });

    it('does NOT block for claudeCli provider', async () => {
      persistedAuthMethod.set('claudeCli');
      await service.sendOrQueueMessage('/context');
      expect(sendMock).toHaveBeenCalledWith('/context', undefined);
    });

    it('when streaming, auto-denies active permissions with deny_with_message', async () => {
      activeTabStatus.set('streaming');
      permissionRequests.set([{ id: 'perm-1' }]);
      await service.sendOrQueueMessage('hello');
      expect(handlePermissionResponseMock).toHaveBeenCalledWith({
        id: 'perm-1',
        decision: 'deny_with_message',
        reason: 'hello',
      });
      expect(queueOrAppendMock).toHaveBeenCalledWith('hello', undefined);
    });

    it('when not streaming, dispatches via MessageSender.send', async () => {
      activeTabStatus.set('loaded');
      await service.sendOrQueueMessage('hello');
      expect(sendMock).toHaveBeenCalledWith('hello', undefined);
    });

    it('queues (never sends/aborts) when the self-heal flag is set despite a non-streaming status', async () => {
      // Self-heal case: SDK paused/resumed → status reverted to loaded while
      // isTabStreaming stays true. A follow-up must queue, not send-and-abort.
      activeTabStatus.set('loaded');
      isTabStreamingMock.mockReturnValue(true);

      await service.sendOrQueueMessage('follow up');

      expect(sendMock).not.toHaveBeenCalled();
      expect(queueOrAppendMock).toHaveBeenCalledWith('follow up', undefined);
    });

    it('checks the explicit target tab id for the self-heal streaming flag', async () => {
      activeTabStatus.set('loaded');
      tabs = [makeTab({ id: 'tile-7', status: 'awaiting-background' })];
      isTabStreamingMock.mockImplementation((id: string) => id === 'tile-7');

      await service.sendOrQueueMessage('follow up', { tabId: 'tile-7' });

      expect(isTabStreamingMock).toHaveBeenCalledWith('tile-7');
      expect(sendMock).not.toHaveBeenCalled();
      expect(queueOrAppendMock).toHaveBeenCalledWith('follow up', {
        tabId: 'tile-7',
      });
    });

    it('explicit-tabId override beats activeTab status', async () => {
      activeTabStatus.set('streaming');
      tabs = [makeTab({ id: 'tab-2', status: 'loaded' })];
      await service.sendOrQueueMessage('hello', { tabId: 'tab-2' });
      expect(sendMock).toHaveBeenCalled();
    });

    it('queues while a streaming TREE is live, even though status is loaded and the spinner is clear (TASK_2026_382 R2)', async () => {
      // The window the user hit: the root-turn phase says idle, but the
      // transcript is still rendering a bubble built from `streamingState`.
      activeTabStatus.set('loaded');
      isTabStreamingMock.mockReturnValue(false);
      tabs = [
        makeTab({
          id: 'tab-1',
          status: 'loaded',
          streamingState: {
            currentMessageId: 'msg-live',
          } as unknown as TabState['streamingState'],
        }),
      ];

      await service.sendOrQueueMessage('follow up');

      expect(sendMock).not.toHaveBeenCalled();
      expect(queueOrAppendMock).toHaveBeenCalledWith('follow up', undefined);
    });

    it('lets the user send again once the error path has settled the tree (R1 + R2 anti-trap)', async () => {
      // Step 1 — a live tree while `status` reads `loaded`: busy, so queue.
      activeTabStatus.set('loaded');
      isTabStreamingMock.mockReturnValue(false);
      tabs = [
        makeTab({
          id: 'tab-1',
          status: 'loaded',
          streamingState: {
            currentMessageId: 'msg-live',
          } as unknown as TabState['streamingState'],
        }),
      ];
      await service.sendOrQueueMessage('during the error window');
      expect(sendMock).not.toHaveBeenCalled();

      // Step 2 — what R1 leaves behind: `handleChatError` finalized the partial
      // output into `messages` and `streamingState` is null. Without R1 this
      // field would still be set and R2 would lock the user out for good.
      tabs = [
        makeTab({
          id: 'tab-1',
          status: 'loaded',
          streamingState: null,
          messages: [
            { id: 'msg-live', role: 'assistant' },
          ] as unknown as TabState['messages'],
        }),
      ];
      await service.sendOrQueueMessage('after the error');

      expect(sendMock).toHaveBeenCalledWith('after the error', undefined);
    });

    it.each(['awaiting-background', 'sleeping'] as const)(
      'SENDS in %s even with a live streamingState — queuing there strands the message forever (TASK_2026_382 R2 exclusion)',
      async (status) => {
        // `chat-types.ts:443-448`: in both states the agent itself is idle and
        // user input is DELIBERATELY enabled; a subagent's `message_start`
        // builds a fresh `streamingState`, so the field is non-null while
        // sending is correct.
        //
        // Queuing here would never drain. The root-turn flush
        // (`streaming-handler.service.ts:305-317`) needs a `message_complete`
        // with no `parentToolUseId` — the root turn already ended — and
        // `handleSessionStats` (`:475-493`) returns null whenever
        // `streamingState` is present. Do NOT drop this exclusion.
        activeTabStatus.set(status);
        isTabStreamingMock.mockReturnValue(false);
        tabs = [
          makeTab({
            id: 'tab-1',
            status,
            queuedContent: null,
            streamingState: {
              currentMessageId: 'subagent-msg',
            } as unknown as TabState['streamingState'],
          }),
        ];

        await service.sendOrQueueMessage('follow up');

        expect(queueOrAppendMock).not.toHaveBeenCalled();
        expect(sendMock).toHaveBeenCalledWith('follow up', undefined);
      },
    );

    it('reads the status of a BACKGROUND-workspace tab instead of falling back to the active one (TASK_2026_382 W4)', async () => {
      // `tabs()` holds only the active workspace; the target lives elsewhere.
      activeTabStatus.set('loaded');
      isTabStreamingMock.mockReturnValue(false);
      tabs = [makeTab({ id: 'tab-1', status: 'loaded' })];
      backgroundTabs = [makeTab({ id: 'tab-bg', status: 'streaming' })];

      await service.sendOrQueueMessage('to the background tab', {
        tabId: 'tab-bg',
      });

      // Before the fix `tabs().find` missed and `status` silently became the
      // ACTIVE tab's `loaded`, so this was sent mid-turn into the wrong tab.
      expect(sendMock).not.toHaveBeenCalled();
      expect(queueOrAppendMock).toHaveBeenCalledWith('to the background tab', {
        tabId: 'tab-bg',
      });
    });

    it('SENDS when the tree left behind has no currentMessageId — that state is debris no finalize can clear (TASK_2026_382 review B5)', async () => {
      // `StreamingHandlerService` mints an empty `StreamingState` for any event
      // routed to a tab that has none, and only `message_start` ever sets
      // `currentMessageId`. A late post-turn `agent_progress` /
      // `agent_completed` / `message_complete` therefore leaves exactly this
      // shape behind. `finalizeCurrentMessage` early-returns on a null
      // `currentMessageId`, and nothing else nulls `streamingState`, so an
      // unbounded `streamingState != null` check latched the tab into
      // queue-only mode for good: status is `loaded` (input enabled), the tab
      // is absent from `_streamingTabIds` (Stop hidden), and no drain can fire.
      activeTabStatus.set('loaded');
      isTabStreamingMock.mockReturnValue(false);
      tabs = [
        makeTab({
          id: 'tab-1',
          status: 'loaded',
          streamingState: {
            currentMessageId: null,
          } as unknown as TabState['streamingState'],
        }),
      ];

      await service.sendOrQueueMessage('after the stray event');

      expect(queueOrAppendMock).not.toHaveBeenCalled();
      expect(sendMock).toHaveBeenCalledWith('after the stray event', undefined);
    });
  });

  describe('isTabBusyGenerating (the one predicate the Stop button shares)', () => {
    const tree = {
      currentMessageId: 'msg-live',
    } as unknown as NonNullable<TabState['streamingState']>;
    const debris = {
      currentMessageId: null,
    } as unknown as NonNullable<TabState['streamingState']>;

    it('is busy while a tree with a currentMessageId is live under an idle status', () => {
      expect(
        isTabBusyGenerating({
          status: 'loaded',
          streamingState: tree,
          isStreamingTab: false,
        }),
      ).toBe(true);
    });

    it('is NOT busy for a tree with no currentMessageId — the bounded exit', () => {
      expect(
        isTabBusyGenerating({
          status: 'loaded',
          streamingState: debris,
          isStreamingTab: false,
        }),
      ).toBe(false);
    });

    it.each(['awaiting-background', 'sleeping'] as const)(
      'is NOT busy in %s even with a live tree — queuing there strands the message',
      (status) => {
        expect(
          isTabBusyGenerating({
            status,
            streamingState: tree,
            isStreamingTab: false,
          }),
        ).toBe(false);
      },
    );

    it.each(['streaming', 'resuming'] as const)(
      'is busy in %s with no tree at all',
      (status) => {
        expect(
          isTabBusyGenerating({
            status,
            streamingState: null,
            isStreamingTab: false,
          }),
        ).toBe(true);
      },
    );

    it('is busy on the spinner set alone (the SDK pause/resume self-heal)', () => {
      expect(
        isTabBusyGenerating({
          status: 'loaded',
          streamingState: null,
          isStreamingTab: true,
        }),
      ).toBe(true);
    });

    it('is NOT busy for a settled tab', () => {
      expect(
        isTabBusyGenerating({
          status: 'loaded',
          streamingState: null,
          isStreamingTab: false,
        }),
      ).toBe(false);
    });
  });

  describe('sendQueuedMessage', () => {
    beforeEach(() => {
      tabs = [
        makeTab({
          queuedContent: 'queued',
          queuedOptions: {
            files: ['a.ts'],
            images: [{ data: 'base64', mediaType: 'image/png' }],
          } as unknown as TabState['queuedOptions'],
        }),
      ];
    });

    it('clears queue + queuedOptions before dispatch', async () => {
      await service.sendQueuedMessage('tab-1', 'queued');
      expect(clearQueuedContentAndOptionsMock).toHaveBeenCalledWith('tab-1');
    });

    it('forwards stored queuedOptions (files + images) to the dedicated queue-flush method', async () => {
      await service.sendQueuedMessage('tab-1', 'queued');
      expect(continueExistingSessionForQueueFlushMock).toHaveBeenCalledWith(
        'queued',
        'sess-1',
        {
          files: ['a.ts'],
          images: [{ data: 'base64', mediaType: 'image/png' }],
          tabId: 'tab-1',
        },
      );
    });

    it('calls the dedicated queue-flush method, NOT messageSender.send or conversation.continueConversation', async () => {
      await service.sendQueuedMessage('tab-1', 'queued');
      expect(continueExistingSessionForQueueFlushMock).toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
      expect(continueConversationMock).not.toHaveBeenCalled();
    });

    it('warns and re-queues (does not start a new conversation) when the tab has no claudeSessionId', async () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          claudeSessionId: null,
          queuedContent: 'queued',
          queuedOptions: {
            files: ['a.ts'],
          } as unknown as TabState['queuedOptions'],
        }),
      ];
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      await service.sendQueuedMessage('tab-1', 'queued');
      expect(sendMock).not.toHaveBeenCalled();
      expect(continueExistingSessionForQueueFlushMock).not.toHaveBeenCalled();
      expect(setQueuedContentMock).toHaveBeenCalledWith('tab-1', 'queued');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('on error, restores content to queue', async () => {
      const err = new Error('boom');
      continueExistingSessionForQueueFlushMock.mockRejectedValueOnce(err);
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      await service.sendQueuedMessage('tab-1', 'queued');
      expect(setQueuedContentMock).toHaveBeenCalledWith('tab-1', 'queued');
      expect(errorSpy).toHaveBeenCalledWith(
        '[ChatStore] sendQueuedMessage failed:',
        err,
      );
      errorSpy.mockRestore();
    });
  });
});

/**
 * End-to-end over the REAL streaming pair — no mock stands between the events
 * and the predicate. `StreamingHandlerService` and `MessageFinalizationService`
 * are the production classes (with their real accumulator, deduplication,
 * batched-update and tree-builder collaborators); only the tab store, the
 * sender and the conversation queue are test doubles, and the tab store
 * reproduces the two-write `applyFinalizedTurn` that production performs.
 *
 * This is the loop the review found: finish a turn, let the routine late
 * post-turn events land, then send again. Before the fix the send was queued
 * with no drain and no Stop button — recoverable only by reload or /clear.
 */
describe('MessageDispatchService with the real StreamingHandler + MessageFinalization pair (TASK_2026_382 review B5)', () => {
  const TAB_ID = 'tab-1';
  const SESSION_ID = SessionId.create();
  const MESSAGE_ID = 'msg-1';

  let tabsSignal: ReturnType<typeof signal<TabState[]>>;
  let activeTabIdSignal: ReturnType<typeof signal<string | null>>;
  let visibleTabIdsSignal: ReturnType<typeof signal<Set<string>>>;
  let streamingTabIdsSignal: ReturnType<typeof signal<Set<string>>>;
  let dispatch: MessageDispatchService;
  let streaming: StreamingHandlerService;
  let finalization: MessageFinalizationService;
  let sendMock: jest.Mock;
  let queueOrAppendMock: jest.Mock;

  function patchTab(id: string, changes: Partial<TabState>): void {
    tabsSignal.update((all) =>
      all.map((t) => (t.id === id ? ({ ...t, ...changes } as TabState) : t)),
    );
  }

  function currentTab(): TabState {
    const tab = tabsSignal().find((t) => t.id === TAB_ID);
    if (!tab) throw new Error('tab vanished');
    return tab;
  }

  /** Let `applyFinalizedTurn`'s second write (a microtask) land. */
  const settle = (): Promise<void> =>
    new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    tabsSignal = signal<TabState[]>([
      {
        id: TAB_ID,
        title: 'Session',
        name: 'Session',
        status: 'streaming',
        messages: [],
        streamingState: createEmptyStreamingState(),
        currentMessageId: null,
        claudeSessionId: SESSION_ID,
        queuedContent: null,
        queuedOptions: null,
      } as unknown as TabState,
    ]);
    activeTabIdSignal = signal<string | null>(TAB_ID);
    visibleTabIdsSignal = signal<Set<string>>(new Set());
    streamingTabIdsSignal = signal<Set<string>>(new Set());

    const tabManagerFake = {
      tabs: computed(() => tabsSignal()),
      activeTabId: computed(() => activeTabIdSignal()),
      activeTab: computed(
        () => tabsSignal().find((t) => t.id === activeTabIdSignal()) ?? null,
      ),
      activeTabStatus: computed(
        () =>
          tabsSignal().find((t) => t.id === activeTabIdSignal())?.status ??
          null,
      ),
      visibleTabIds: computed(() => visibleTabIdsSignal()),
      isTabStreaming: (id: string) => streamingTabIdsSignal().has(id),
      findTabByIdAcrossWorkspaces: (id: string) => {
        const tab = tabsSignal().find((t) => t.id === id);
        return tab ? { tab, workspacePath: '/ws' } : null;
      },
      findTabsBySessionId: (sid: string) =>
        tabsSignal().filter((t) => t.claudeSessionId === sid),
      findTabBySessionIdAcrossWorkspaces: () => null,
      updateBackgroundTab: () => false,
      attachSession: (id: string, sid: string) =>
        patchTab(id, { claudeSessionId: sid } as Partial<TabState>),
      setStreamingState: (id: string, state: TabState['streamingState']) =>
        patchTab(id, { streamingState: state }),
      setMessages: (id: string, messages: TabState['messages']) =>
        patchTab(id, { messages }),
      reconcileUserMessageNativeUuid: jest.fn(),
      setQueuedContent: jest.fn(),
      clearQueuedContentAndOptions: jest.fn(),
      markTabIdle: jest.fn(),
      markTabStreaming: jest.fn(),
      markStreaming: jest.fn(),
      applyFinalizedHistory: jest.fn(),
      // Mirrors production: messages first, then a microtask that drops the
      // streaming state and flips to `loaded`.
      applyFinalizedTurn: (id: string, messages: TabState['messages']) => {
        patchTab(id, { messages, currentMessageId: null });
        queueMicrotask(() =>
          patchTab(id, { streamingState: null, status: 'loaded' }),
        );
      },
      clearStreamingForLoaded: (id: string) =>
        patchTab(id, {
          streamingState: null,
          status: 'loaded',
          currentMessageId: null,
        }),
    } as unknown as TabManagerService;

    sendMock = jest.fn().mockResolvedValue(undefined);
    queueOrAppendMock = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        MessageDispatchService,
        { provide: TabManagerService, useValue: tabManagerFake },
        // `turn_state` is never fed here; the applier would drag in the
        // liveness registry for no coverage.
        { provide: TurnStateApplier, useValue: { apply: jest.fn() } },
        // The real store reaches for VSCodeService + the RPC client.
        {
          provide: AgentMonitorStore,
          useValue: {
            onAgentStart: jest.fn(),
            onAgentProgress: jest.fn(),
            onAgentStatus: jest.fn(),
            onAgentCompleted: jest.fn(),
            markAgentNodesResumed: jest.fn(),
          },
        },
        {
          provide: MessageSenderService,
          useValue: { send: sendMock, continueExistingSessionForQueueFlush: jest.fn() },
        },
        {
          provide: ConversationService,
          useValue: { queueOrAppendMessage: queueOrAppendMock },
        },
        {
          provide: AuthStateService,
          useValue: {
            persistedAuthMethod: () => 'apiKey',
            isLoading: () => false,
          },
        },
        {
          provide: PermissionHandlerService,
          useValue: {
            permissionRequests: () => [],
            handlePermissionResponse: jest.fn(),
          },
        },
      ],
    });

    dispatch = TestBed.inject(MessageDispatchService);
    streaming = TestBed.inject(StreamingHandlerService);
    finalization = TestBed.inject(MessageFinalizationService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function feed(event: FlatStreamEventUnion): void {
    streaming.processStreamEvent(event, TAB_ID, SESSION_ID);
  }

  it('accepts the next send after a finished turn is followed by the routine late post-turn events', async () => {
    // ----- A complete turn -------------------------------------------------
    feed({
      id: 'evt-start',
      eventType: 'message_start',
      timestamp: 1,
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      role: 'assistant',
      source: 'stream',
    } as unknown as FlatStreamEventUnion);
    feed({
      id: 'evt-delta',
      eventType: 'text_delta',
      timestamp: 2,
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      blockIndex: 0,
      delta: 'done',
      source: 'stream',
    } as unknown as FlatStreamEventUnion);
    feed({
      id: 'evt-complete',
      eventType: 'message_complete',
      timestamp: 3,
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      stopReason: 'end_turn',
      tokenUsage: { input: 10, output: 20 },
      source: 'stream',
    } as unknown as FlatStreamEventUnion);

    finalization.finalizeCurrentMessage(TAB_ID);
    await settle();

    expect(currentTab().streamingState).toBeNull();
    expect(currentTab().status).toBe('loaded');

    // ----- The late post-turn events TASK_2026_360 documents as routine ----
    feed({
      id: 'evt-progress',
      eventType: 'agent_progress',
      timestamp: 4,
      sessionId: SESSION_ID,
      parentToolUseId: 'toolu_1',
      taskId: 'task-1',
      description: 'still tidying up',
      totalTokens: 12,
      toolUses: 1,
      durationMs: 400,
      source: 'hook',
    } as unknown as FlatStreamEventUnion);

    // A store-only event must not RESURRECT a streaming state on a settled tab.
    expect(currentTab().streamingState).toBeNull();

    feed({
      id: 'evt-late-complete',
      eventType: 'message_complete',
      timestamp: 5,
      sessionId: SESSION_ID,
      messageId: 'msg-late',
      stopReason: 'end_turn',
      source: 'stream',
    } as unknown as FlatStreamEventUnion);

    // This one legitimately writes into a state, so a state now exists — but it
    // carries no `currentMessageId`, so no finalize can ever clear it. The
    // predicate must read it as debris, not as a turn in flight.
    expect(currentTab().streamingState?.currentMessageId ?? null).toBeNull();

    // ----- The user sends again -------------------------------------------
    await dispatch.sendOrQueueMessage('and now this');

    expect(queueOrAppendMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith('and now this', undefined);
  });
});
