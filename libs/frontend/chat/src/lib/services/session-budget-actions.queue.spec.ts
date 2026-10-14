/**
 * "Wrap up & hand off" against the REAL queue (TASK_2026_655 review finding 2).
 *
 * Real SessionBudgetActionsService, MessageDispatchService, ConversationService
 * and MessageValidationService. ChatStore forwards to the real dispatch, as
 * production's ChatStore.sendOrQueueMessage does. Only the tab store, the
 * sender (the `chat:continue` boundary) and the RPC are fakes. A turn end is
 * the streaming handler's flush: `sendQueuedMessage(tabId, queuedContent)`.
 */

import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AuthStateService,
  ClaudeRpcService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  TabManagerService,
  type ClosedTabEvent,
  type WorkspaceRemovalEvent,
} from '@ptah-extension/chat-state';
import {
  MessageFinalizationService,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import type { SendMessageOptions, TabState } from '@ptah-extension/chat-types';
import type { SessionBudgetState } from '@ptah-extension/shared';
import { ActionBannerService } from './action-banner.service';
import { ChatStore } from './chat.store';
import { ConversationService } from './chat-store/conversation.service';
import { MessageDispatchService } from './chat-store/message-dispatch.service';
import { SessionLoaderService } from './chat-store/session-loader.service';
import { MessageSenderService } from './message-sender.service';
import {
  SESSION_HANDOFF_COMMAND,
  SessionBudgetActionsService,
} from './session-budget-actions.service';

const TAB = 'tab-1';
const SESSION = '11111111-1111-4111-8111-111111111111';
const BUDGET: SessionBudgetState = {
  sessionId: SESSION,
  stage: 'handoff',
  unit: 'tokens',
  measure: 'tokens',
  used: 41_200_000,
  limit: 50_000_000,
  percent: 82.4,
  lowerBound: false,
  revision: 9,
  compactions: 0,
};
/** The backend router's test (`SlashCommandInterceptor.isSlashCommand`). */
const ROUTED_AS_SLASH_COMMAND = /^\/[a-zA-Z]/;

/** Let the banner's skill probe and the dispatch awaits settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('SessionBudgetActionsService with the real queue', () => {
  let tabs: TabState[];
  let flushed: string[];
  let showError: jest.Mock;
  let service: SessionBudgetActionsService;
  let dispatch: MessageDispatchService;
  let conversation: ConversationService;
  let closedTabListeners: Set<(event: ClosedTabEvent) => void>;
  let removedWorkspace: WritableSignal<WorkspaceRemovalEvent | null>;

  const tab = () => tabs.find((t) => t.id === TAB) as TabState;
  const emitTabClosed = (event: ClosedTabEvent) => {
    for (const listener of Array.from(closedTabListeners)) listener(event);
  };
  /**
   * TabManagerService.resetTabToFresh, run by ChatMessageHandlerService on
   * the `chat:complete` (`command: 'clear'`) the backend broadcasts.
   */
  const resetTab = () => {
    patch(TAB, {
      status: 'fresh',
      claudeSessionId: null,
      queuedContent: null,
      queuedOptions: null,
    });
    emitTabClosed({ tabId: TAB, sessionId: SESSION, kind: 'reset' });
  };
  const expectWrapUpNotSent = () => {
    expect(service.wrapUpSent()).toBe(false);
    expect(showError).toHaveBeenCalledWith(
      expect.stringContaining('wrap-up request was not sent'),
      TAB,
    );
  };
  const patch = (id: string, update: Partial<TabState>) => {
    tabs = tabs.map((t) => (t.id === id ? { ...t, ...update } : t));
  };
  /** The running turn ends: the streaming handler flushes the queue. */
  const endTurn = async () => {
    const content = tab().queuedContent?.trim();
    if (content) await dispatch.sendQueuedMessage(TAB, content);
    await settle();
  };

  beforeEach(() => {
    tabs = [
      {
        id: TAB,
        title: 'Session',
        status: 'streaming',
        messages: [],
        streamingState: null,
        currentMessageId: null,
        claudeSessionId: SESSION,
        queuedContent: null,
        queuedOptions: null,
      } as unknown as TabState,
    ];
    flushed = [];
    showError = jest.fn();
    removedWorkspace = signal<WorkspaceRemovalEvent | null>(null);
    // Stop logs its RPC steps; the assertions below cover the outcome.
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const tabManager = {
      tabs: () => tabs,
      activeTabId: () => TAB,
      activeTab: () => tab(),
      activeTabStatus: () => tab().status,
      isTabStreaming: () => tab().status === 'streaming',
      findTabByIdAcrossWorkspaces: (id: string) => {
        const found = tabs.find((t) => t.id === id);
        return found ? { tab: found, workspacePath: '/ws' } : null;
      },
      setQueuedContent: (id: string, content: string | null) =>
        patch(id, { queuedContent: content }),
      setQueuedContentAndOptions: (
        id: string,
        content: string,
        options: SendMessageOptions,
      ) => patch(id, { queuedContent: content, queuedOptions: options }),
      clearQueuedContentAndOptions: (id: string) =>
        patch(id, { queuedContent: null, queuedOptions: null }),
      resetQueuedContentAndOptions: (id: string) =>
        patch(id, { queuedContent: '', queuedOptions: null }),
      setMessages: (id: string, messages: TabState['messages']) =>
        patch(id, { messages }),
      setLastTerminalReason: jest.fn(),
      onTabClosed: (listener: (event: ClosedTabEvent) => void) => {
        closedTabListeners.add(listener);
        return () => closedTabListeners.delete(listener);
      },
      removedWorkspace$: removedWorkspace.asReadonly(),
    };
    closedTabListeners = new Set();

    const rpcCall = jest.fn((method: string) =>
      Promise.resolve(
        method === 'autocomplete:commands'
          ? {
              success: true,
              data: {
                commands: [
                  {
                    name: SESSION_HANDOFF_COMMAND.slice(1),
                    description: '',
                    scope: 'project',
                  },
                ],
              },
            }
          : { success: true },
      ),
    );

    TestBed.configureTestingModule({
      providers: [
        SessionBudgetActionsService,
        MessageDispatchService,
        ConversationService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: '/ws' }) },
        },
        { provide: ActionBannerService, useValue: { showError } },
        {
          provide: AuthStateService,
          useValue: {
            isLoading: () => false,
            persistedAuthMethod: () => 'apiKey',
          },
        },
        {
          provide: PermissionHandlerService,
          useValue: {
            permissionRequests: () => [],
            handlePermissionResponse: jest.fn(),
            targetTabsFor: () => [],
          },
        },
        {
          provide: MessageSenderService,
          useValue: {
            send: jest.fn().mockResolvedValue({ success: true }),
            // `chat:continue`: the turn it starts streams on the same tab.
            continueExistingSessionForQueueFlush: jest.fn((content: string) => {
              flushed.push(content);
              patch(TAB, { status: 'streaming' });
              return Promise.resolve({ success: true });
            }),
          },
        },
        { provide: SessionLoaderService, useValue: {} },
        { provide: MessageFinalizationService, useValue: {} },
        {
          provide: ChatStore,
          useFactory: (d: MessageDispatchService) => ({
            sendOrQueueMessage: (
              content: string,
              options?: SendMessageOptions,
            ) => d.sendOrQueueMessage(content, options),
          }),
          deps: [MessageDispatchService],
        },
      ],
    });

    service = TestBed.inject(SessionBudgetActionsService);
    dispatch = TestBed.inject(MessageDispatchService);
    conversation = TestBed.inject(ConversationService);
    service.connect({
      activeTab: signal({
        sessionBudget: BUDGET,
        status: 'streaming' as const,
      }),
      tabId: signal<string | null>(TAB),
      sessionId: signal<string | null>(SESSION),
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('sends the queued text first, then /session-handoff as its own routed turn', async () => {
    await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });

    const wrapUp = service.sendWrapUp();
    await settle();

    // Not appended to the queued text, and the button waits.
    expect(tab().queuedContent).toBe('Please check tests');
    expect(service.wrapUpSent()).toBe(true);

    await endTurn();
    expect(flushed).toEqual(['Please check tests']);
    // Queued as the next turn, on its own.
    expect(tab().queuedContent).toMatch(/^\/session-handoff /);
    await wrapUp;
    expect(service.wrapUpSent()).toBe(true);
    expect(showError).not.toHaveBeenCalled();

    await endTurn();
    expect(flushed).toEqual([
      'Please check tests',
      '/session-handoff This session has used 41.2M tokens.',
    ]);
    expect(flushed[1]).toMatch(ROUTED_AS_SLASH_COMMAND);
    expect(flushed[0]).not.toContain(SESSION_HANDOFF_COMMAND);
  });

  it('keeps text queued after the click in front of the command', async () => {
    await dispatch.sendOrQueueMessage('first', { tabId: TAB });
    const wrapUp = service.sendWrapUp();
    await settle();
    await dispatch.sendOrQueueMessage('second', { tabId: TAB });
    expect(tab().queuedContent).toBe('first\nsecond');

    await endTurn();
    await wrapUp;
    await endTurn();

    expect(flushed).toEqual([
      'first\nsecond',
      '/session-handoff This session has used 41.2M tokens.',
    ]);
  });

  it('queues a lone command directly, as before', async () => {
    await service.sendWrapUp();

    expect(tab().queuedContent).toBe(
      '/session-handoff This session has used 41.2M tokens.',
    );
    await endTurn();
    expect(flushed[0]).toMatch(ROUTED_AS_SLASH_COMMAND);
  });

  it('re-enables the button with a notice when Stop drops the held command', async () => {
    await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });
    const wrapUp = service.sendWrapUp();
    await settle();

    await conversation.abortCurrentMessage();
    await wrapUp;

    expect(service.wrapUpSent()).toBe(false);
    expect(showError).toHaveBeenCalledWith(
      expect.stringContaining('wrap-up request was not sent'),
      TAB,
    );
    // Stop never sends what was queued, the command included.
    await endTurn();
    expect(flushed).toEqual([]);
  });

  it.each(['close', 'forceClose'] as const)(
    'settles the wrap-up as not sent when the tab is removed by %s',
    async (kind) => {
      await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });
      const wrapUp = service.sendWrapUp();
      await settle();

      // TabManagerService.closeTab / forceCloseTab: the tab is removed, then
      // the close event is emitted. No flush can release the command now.
      tabs = [];
      emitTabClosed({ tabId: TAB, sessionId: SESSION, kind });
      await wrapUp;

      expectWrapUpNotSent();
      expect(flushed).toEqual([]);
    },
  );

  it('settles the wrap-up as not sent when its workspace is removed', async () => {
    await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });
    const wrapUp = service.sendWrapUp();
    await settle();

    // TabManagerService.removeWorkspaceState: the workspace's tabs, active
    // and parked, are dropped with no close event.
    tabs = [];
    removedWorkspace.set({ path: '/ws', seq: 1 });
    TestBed.tick();
    await wrapUp;

    expectWrapUpNotSent();
    expect(flushed).toEqual([]);
  });

  it('settles the wrap-up as not sent when /clear discards the queue it waits behind', async () => {
    await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });
    const wrapUp = service.sendWrapUp();
    await settle();

    resetTab();
    await wrapUp;

    expectWrapUpNotSent();
    await endTurn();
    expect(flushed).toEqual([]);
    expect(tab().queuedContent).toBeNull();
  });

  it('a wrap-up held behind a queued /clear settles as not sent when the clear runs', async () => {
    const sender = TestBed.inject(MessageSenderService) as unknown as {
      continueExistingSessionForQueueFlush: jest.Mock;
    };
    // `chat:continue` with `/clear`: the backend broadcasts `chat:complete`
    // (clear) and only then replies (ChatSlashCommandRouterService).
    sender.continueExistingSessionForQueueFlush.mockImplementation(
      (content: string) => {
        flushed.push(content);
        if (content === '/clear') resetTab();
        else patch(TAB, { status: 'streaming' });
        return Promise.resolve({ success: true });
      },
    );
    await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });
    await dispatch.sendOrQueueMessage('/clear', { tabId: TAB });
    const wrapUp = service.sendWrapUp();
    await settle();

    // The text is sent; `/clear` is next, the wrap-up still waits behind it.
    await endTurn();
    expect(tab().queuedContent).toBe('/clear');
    expect(showError).not.toHaveBeenCalled();

    // The clear's reset leaves a session-less tab no turn end flushes.
    await endTurn();
    await wrapUp;

    expectWrapUpNotSent();
    expect(tab().queuedContent).toBeNull();
    await endTurn();
    expect(flushed).toEqual(['Please check tests', '/clear']);
  });

  it('drops the command when the queue was reset and unrelated text is sent', async () => {
    await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });
    const wrapUp = service.sendWrapUp();
    await settle();

    // A reset path outside the queue (for example a failed resume) clears it.
    patch(TAB, { queuedContent: null });
    await dispatch.sendOrQueueMessage('something else', { tabId: TAB });
    await endTurn();
    await wrapUp;

    expect(flushed).toEqual(['something else']);
    expect(tab().queuedContent).toBeNull();
    expect(service.wrapUpSent()).toBe(false);
  });

  it('queues the command when the user removes the text in front of it', async () => {
    await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });
    const wrapUp = service.sendWrapUp();
    await settle();

    // ChatStore.clearQueuedContent (the queue's cancel and edit actions).
    patch(TAB, { queuedContent: null });
    conversation.releaseHeldCommand(TAB);
    await wrapUp;

    expect(tab().queuedContent).toMatch(/^\/session-handoff /);
    expect(service.wrapUpSent()).toBe(true);
  });

  it('a failed text flush keeps the command waiting behind the restored text', async () => {
    await dispatch.sendOrQueueMessage('Please check tests', { tabId: TAB });
    const wrapUp = service.sendWrapUp();
    await settle();
    const sender = TestBed.inject(MessageSenderService) as unknown as {
      continueExistingSessionForQueueFlush: jest.Mock;
    };
    sender.continueExistingSessionForQueueFlush.mockResolvedValueOnce({
      success: false,
      error: 'offline',
    });

    await endTurn();
    expect(tab().queuedContent).toBe('Please check tests');

    await endTurn();
    await wrapUp;
    await endTurn();
    expect(flushed).toEqual([
      'Please check tests',
      '/session-handoff This session has used 41.2M tokens.',
    ]);
  });
});
