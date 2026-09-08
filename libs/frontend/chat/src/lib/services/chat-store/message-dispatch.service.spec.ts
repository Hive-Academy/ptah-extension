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
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthStateService } from '@ptah-extension/core';
import { MessageDispatchService } from './message-dispatch.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import { MessageSenderService } from '../message-sender.service';
import { ConversationService } from './conversation.service';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
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
