import { TestBed } from '@angular/core/testing';
import {
  CommandCenterSendLockService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { AuthStateService } from '@ptah-extension/core';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import { ConversationService } from './conversation.service';
import { MessageSenderService } from '../message-sender.service';
import { MessageDispatchService } from './message-dispatch.service';

describe('Command Center dispatch lock', () => {
  const root = {
    id: 'root',
    status: 'loaded',
    claudeSessionId: 'sdk-1',
    streamingState: null,
    queuedContent: 'saved',
    queuedOptions: null,
    messages: [],
  };
  const other = {
    ...root,
    id: 'other',
    claudeSessionId: 'sdk-2',
    queuedContent: null,
  };
  const tabs = [root, other];
  const send = jest.fn().mockResolvedValue({ success: true });
  const flush = jest.fn().mockResolvedValue({ success: true });
  const queue = jest.fn();
  const clear = jest.fn();
  let lock: CommandCenterSendLockService;
  let dispatch: MessageDispatchService;

  beforeEach(() => {
    jest.clearAllMocks();
    root.status = 'loaded';
    Object.assign(root, { queuedContent: 'saved' });
    TestBed.configureTestingModule({
      providers: [
        MessageDispatchService,
        CommandCenterSendLockService,
        {
          provide: TabManagerService,
          useValue: {
            tabs: () => tabs,
            activeTabId: () => 'root',
            activeTab: () => root,
            activeTabStatus: () => 'loaded',
            isTabStreaming: () => false,
            findTabByIdAcrossWorkspaces: (id: string) => ({
              tab: tabs.find((t) => t.id === id),
            }),
            clearQueuedContentAndOptions: clear,
          },
        },
        {
          provide: AuthStateService,
          useValue: {
            persistedAuthMethod: () => 'apiKey',
            isLoading: () => false,
          },
        },
        {
          provide: MessageSenderService,
          useValue: { send, continueExistingSessionForQueueFlush: flush },
        },
        {
          provide: ConversationService,
          useValue: {
            queueOrAppendMessage: queue,
            releaseHeldCommand: jest.fn(),
          },
        },
        {
          provide: PermissionHandlerService,
          useValue: { permissionRequests: () => [] },
        },
      ],
    });
    lock = TestBed.inject(CommandCenterSendLockService);
    dispatch = TestBed.inject(MessageDispatchService);
    lock.engage('root', 'sdk-1', 'owner');
    TestBed.tick();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('queues regular and slash sends, preserving an existing queued prompt', async () => {
    await dispatch.sendOrQueueMessage('next', { tabId: 'root' });
    await dispatch.sendOrQueueMessage('/review', { tabId: 'root' });
    expect(queue).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
    await dispatch.sendQueuedMessage('root', 'saved');
    expect(clear).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it('passes owner sends and leaves other tabs available after a rekey', async () => {
    lock.rekey('root', 'sdk-new');
    await dispatch.sendOrQueueMessage('owner text', {
      tabId: 'root',
      ownerToken: 'owner',
    });
    await dispatch.sendOrQueueMessage('other text', { tabId: 'other' });
    expect(send).toHaveBeenCalledTimes(2);
    await dispatch.sendQueuedMessage('root', 'saved');
    expect(flush).not.toHaveBeenCalled();
  });

  it('flushes a queued prompt when the lock is released while the root is idle', async () => {
    lock.release('owner');
    await Promise.resolve();

    expect(clear).toHaveBeenCalledWith('root');
    expect(flush).toHaveBeenCalledWith('saved', 'sdk-1', {
      tabId: 'root',
      ownerToken: undefined,
    });
  });

  it('leaves the queued prompt for turn-end when the root is still streaming', async () => {
    root.status = 'streaming';
    lock.release('owner');
    await Promise.resolve();

    expect(clear).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it('flushes exactly once after a same-tick queue and release', async () => {
    const queued = dispatch.sendOrQueueMessage('saved', { tabId: 'root' });
    lock.release('owner');

    expect(flush).not.toHaveBeenCalled();
    await Promise.resolve();
    await queued;

    expect(queue).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('does not flush when the released root is re-engaged in the same tick', async () => {
    lock.release('owner');
    lock.engage('root', 'sdk-1', 'new-owner');

    await Promise.resolve();

    expect(clear).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it.each(['release first', 'turn end first'])(
    'flushes once when release and turn end interleave: %s',
    async (order) => {
      clear.mockImplementation(() =>
        Object.assign(root, { queuedContent: null }),
      );
      const turnEnd = () => dispatch.sendQueuedMessage('root', 'saved');
      if (order === 'release first') {
        lock.release('owner');
        await turnEnd();
      } else {
        await turnEnd();
        lock.release('owner');
      }
      await Promise.resolve();

      expect(clear).toHaveBeenCalledTimes(1);
      expect(flush).toHaveBeenCalledTimes(1);
    },
  );
});
