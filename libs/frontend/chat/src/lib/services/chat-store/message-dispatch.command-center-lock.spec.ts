import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  CommandCenterSendLockService,
  QueuedFollowUpStore,
  TabManagerService,
} from '@ptah-extension/chat-state';
import {
  AuthStateService,
  ClaudeRpcService,
  LoggingService,
} from '@ptah-extension/core';
import {
  PermissionHandlerService,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { ActionBannerService } from '../action-banner.service';
import { MessageSenderService } from '../message-sender.service';
import { StreamViewportController } from '../stream-viewport-controller.service';
import { MessageDispatchService } from './message-dispatch.service';

const SDK_1 = '11111111-1111-4111-8111-111111111111';
const SDK_2 = '22222222-2222-4222-8222-222222222222';

/**
 * The Command Center send lock holds every non-owner send of its root tab as
 * a renderer-held follow-up (TASK_2026_884). Release hands the held items to
 * the backend queue of the captured session, once, in order.
 */
describe('Command Center dispatch lock', () => {
  let tabs: ReturnType<typeof signal<TabState[]>>;
  let send: jest.Mock;
  let submit: jest.Mock;
  let lock: CommandCenterSendLockService;
  let dispatch: MessageDispatchService;
  let store: QueuedFollowUpStore;

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
    TestBed.tick();
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };

  beforeEach(() => {
    tabs = signal<TabState[]>([
      {
        id: 'root',
        status: 'loaded',
        claudeSessionId: SDK_1,
        streamingState: null,
        messages: [],
      } as unknown as TabState,
      {
        id: 'other',
        status: 'loaded',
        claudeSessionId: SDK_2,
        streamingState: null,
        messages: [],
      } as unknown as TabState,
    ]);
    send = jest.fn().mockResolvedValue({ success: true });
    submit = jest.fn().mockResolvedValue({
      success: true,
      data: { success: true, queueState: 'queued' },
    });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TabManagerService,
          useValue: {
            tabs,
            backgroundTabsRevision: signal(0),
            streamingTabIds: signal(new Set()),
            removedWorkspace$: signal(null),
            activeTabId: () => 'root',
            activeTab: () => tabs()[0],
            activeTabStatus: () => tabs()[0].status,
            isTabStreaming: () => false,
            onTabClosed: () => () => undefined,
            findTabByIdAcrossWorkspaces: (id: string) => {
              const tab = tabs().find((t) => t.id === id);
              return tab ? { tab, workspacePath: '/ws' } : null;
            },
            setMessages: jest.fn(),
            markStreaming: jest.fn(),
          },
        },
        {
          provide: AuthStateService,
          useValue: {
            persistedAuthMethod: () => 'apiKey',
            isLoading: () => false,
            activeProviderId: () => 'anthropic',
          },
        },
        {
          provide: MessageSenderService,
          useValue: { send, submitQueuedFollowUp: submit },
        },
        {
          provide: PermissionHandlerService,
          useValue: { permissionRequests: () => [] },
        },
        { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
        {
          provide: StreamingHandlerService,
          useValue: { recordUserPromptBoundary: jest.fn() },
        },
        {
          provide: StreamViewportController,
          useValue: { tierFor: () => 'focused' },
        },
        { provide: ActionBannerService, useValue: { showError: jest.fn() } },
        {
          provide: LoggingService,
          useValue: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
        },
      ],
    });
    lock = TestBed.inject(CommandCenterSendLockService);
    dispatch = TestBed.inject(MessageDispatchService);
    store = TestBed.inject(QueuedFollowUpStore);
    lock.engage('root', SDK_1, 'owner');
    TestBed.tick();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('holds regular and slash sends of the root while the lock is held', async () => {
    await dispatch.sendOrQueueMessage('next', { tabId: 'root' });
    await dispatch.sendOrQueueMessage('/review', { tabId: 'root' });
    await flush();

    expect(send).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(store.forTab('root').map((e) => [e.content, e.phase])).toEqual([
      ['next', 'held'],
      ['/review', 'held'],
    ]);
  });

  it('passes owner sends and leaves other tabs available after a rekey', async () => {
    lock.rekey('root', 'sdk-new');
    await dispatch.sendOrQueueMessage('owner text', {
      tabId: 'root',
      ownerToken: 'owner',
    });
    await dispatch.sendOrQueueMessage('other text', { tabId: 'other' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(store.entries()).toEqual([]);
  });

  it('hands a held prompt to the captured session once the lock is released', async () => {
    await dispatch.sendOrQueueMessage('saved', { tabId: 'root' });
    lock.release('owner');
    await flush();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'saved',
        sessionId: SDK_1,
        tabId: 'root',
      }),
    );
    expect(store.forTab('root')[0].phase).toBe('queued');
  });

  it('keeps a held slash command until the root is idle after release', async () => {
    tabs.update((list) =>
      list.map((t) => (t.id === 'root' ? { ...t, status: 'streaming' } : t)),
    );
    await dispatch.sendOrQueueMessage('/review', { tabId: 'root' });
    lock.release('owner');
    await flush();
    expect(send).not.toHaveBeenCalled();

    tabs.update((list) =>
      list.map((t) => (t.id === 'root' ? { ...t, status: 'loaded' } : t)),
    );
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('/review', { tabId: 'root' });
  });

  it('sends nothing when the released root is re-engaged in the same tick', async () => {
    await dispatch.sendOrQueueMessage('saved', { tabId: 'root' });
    lock.release('owner');
    lock.engage('root', SDK_1, 'new-owner');
    await flush();

    expect(submit).not.toHaveBeenCalled();
  });
});
