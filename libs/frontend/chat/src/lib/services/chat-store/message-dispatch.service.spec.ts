/**
 * MessageDispatchService specs â€” send-vs-queue routing + slash-command guard.
 *
 * Coverage:
 *   - sendOrQueueMessage: slash-command guard blocks /compact for non-Anthropic
 *   - sendOrQueueMessage: guard does NOT block when authState.isLoading()
 *   - sendOrQueueMessage: guard does NOT block for apiKey provider
 *   - sendOrQueueMessage: streaming auto-denies permissions with deny_with_message
 *   - sendOrQueueMessage: not streaming dispatches via MessageSender.send
 *   - sendOrQueueMessage: explicit-tabId override beats activeTab
 *   - sendQueuedMessage: clears queue + queuedOptions before dispatch
 *   - sendQueuedMessage: passes files from stored options
 *   - sendQueuedMessage: on error, restores content to queue
 *   - sendQueuedMessage: calls conversation.continueConversation directly
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
  let handlePermissionResponseMock: jest.Mock;

  beforeEach(() => {
    tabs = [makeTab()];
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
    handlePermissionResponseMock = jest.fn();

    const tabManagerMock = {
      tabs: () => tabs,
      setMessages: setMessagesMock,
      setQueuedContent: setQueuedContentMock,
      clearQueuedContentAndOptions: clearQueuedContentAndOptionsMock,
      activeTabStatus: () => activeTabStatus(),
      activeTabId: () => activeTabId(),
    } as unknown as TabManagerService;

    const authStateMock = {
      persistedAuthMethod: () => persistedAuthMethod(),
      isLoading: () => isLoadingAuth(),
    } as unknown as AuthStateService;

    const messageSenderMock = {
      send: sendMock,
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
    it('blocks /compact slash command for non-Anthropic providers', async () => {
      persistedAuthMethod.set('copilot');
      await service.sendOrQueueMessage('/compact');
      expect(sendMock).not.toHaveBeenCalled();
      expect(queueOrAppendMock).not.toHaveBeenCalled();
      // Warning message added via setMessages
      expect(setMessagesMock).toHaveBeenCalled();
    });

    it('does NOT block when authState.isLoading() is true', async () => {
      persistedAuthMethod.set('copilot');
      isLoadingAuth.set(true);
      await service.sendOrQueueMessage('/compact');
      expect(sendMock).toHaveBeenCalledWith('/compact', undefined);
    });

    it('does NOT block for apiKey provider', async () => {
      persistedAuthMethod.set('apiKey');
      await service.sendOrQueueMessage('/compact');
      expect(sendMock).toHaveBeenCalledWith('/compact', undefined);
    });

    it('does NOT block for claudeCli provider', async () => {
      persistedAuthMethod.set('claudeCli');
      await service.sendOrQueueMessage('/compact');
      expect(sendMock).toHaveBeenCalledWith('/compact', undefined);
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

    it('explicit-tabId override beats activeTab status', async () => {
      activeTabStatus.set('streaming');
      tabs = [makeTab({ id: 'tab-2', status: 'loaded' })];
      await service.sendOrQueueMessage('hello', { tabId: 'tab-2' });
      expect(sendMock).toHaveBeenCalled();
    });
  });

  describe('sendQueuedMessage', () => {
    beforeEach(() => {
      tabs = [
        makeTab({
          queuedContent: 'queued',
          queuedOptions: {
            files: ['a.ts'],
          } as unknown as TabState['queuedOptions'],
        }),
      ];
    });

    it('clears queue + queuedOptions before dispatch', async () => {
      await service.sendQueuedMessage('tab-1', 'queued');
      expect(clearQueuedContentAndOptionsMock).toHaveBeenCalledWith('tab-1');
    });

    it('passes files from stored options to continueConversation', async () => {
      await service.sendQueuedMessage('tab-1', 'queued');
      expect(continueConversationMock).toHaveBeenCalledWith(
        'queued',
        ['a.ts'],
        'tab-1',
      );
    });

    it('calls conversation.continueConversation NOT messageSender.send', async () => {
      await service.sendQueuedMessage('tab-1', 'queued');
      expect(continueConversationMock).toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('on error, restores content to queue', async () => {
      const err = new Error('boom');
      continueConversationMock.mockRejectedValueOnce(err);
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
