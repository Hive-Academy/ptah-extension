import { TestBed } from '@angular/core/testing';
import { CommandCenterSendLockService, TabManagerService } from '@ptah-extension/chat-state';
import { AuthStateService } from '@ptah-extension/core';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import { ConversationService } from './conversation.service';
import { MessageSenderService } from '../message-sender.service';
import { MessageDispatchService } from './message-dispatch.service';

describe('Command Center dispatch lock', () => {
  const root = { id: 'root', status: 'loaded', claudeSessionId: 'sdk-1', streamingState: null, queuedContent: 'saved', queuedOptions: null, messages: [] };
  const other = { ...root, id: 'other', claudeSessionId: 'sdk-2', queuedContent: null };
  const tabs = [root, other];
  const send = jest.fn().mockResolvedValue({ success: true });
  const flush = jest.fn().mockResolvedValue({ success: true });
  const queue = jest.fn();
  const clear = jest.fn();
  let lock: CommandCenterSendLockService;
  let dispatch: MessageDispatchService;

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({ providers: [
      MessageDispatchService,
      CommandCenterSendLockService,
      { provide: TabManagerService, useValue: {
        tabs: () => tabs, activeTabId: () => 'root', activeTab: () => root,
        activeTabStatus: () => 'loaded', isTabStreaming: () => false,
        findTabByIdAcrossWorkspaces: (id: string) => ({ tab: tabs.find(t => t.id === id) }),
        clearQueuedContentAndOptions: clear,
      } },
      { provide: AuthStateService, useValue: { persistedAuthMethod: () => 'apiKey', isLoading: () => false } },
      { provide: MessageSenderService, useValue: { send, continueExistingSessionForQueueFlush: flush } },
      { provide: ConversationService, useValue: { queueOrAppendMessage: queue, releaseHeldCommand: jest.fn() } },
      { provide: PermissionHandlerService, useValue: { permissionRequests: () => [] } },
    ] });
    lock = TestBed.inject(CommandCenterSendLockService);
    dispatch = TestBed.inject(MessageDispatchService);
    lock.engage('root', 'sdk-1', 'owner');
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
    await dispatch.sendOrQueueMessage('owner text', { tabId: 'root', ownerToken: 'owner' });
    await dispatch.sendOrQueueMessage('other text', { tabId: 'other' });
    expect(send).toHaveBeenCalledTimes(2);
    await dispatch.sendQueuedMessage('root', 'saved');
    expect(flush).not.toHaveBeenCalled();
  });
});
