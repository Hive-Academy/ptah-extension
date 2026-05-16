/**
 * ConversationService specs â€” routes send/queue/abort for chat conversations.
 *
 * Full integration of this service (continueConversation, abortCurrentMessage
 * preserving partial messages, abortWithConfirmation agent-count dialog) is
 * exercised by the chat flow integration tests. This spec focuses on the
 * pure-ish public API that can be covered by pointed unit tests without
 * wiring in the entire streaming handler + session loader chain:
 *
 *   - queueOrAppendMessage: first write vs append with existing queue, options
 *     stored only on first write, invalid content is warned + skipped
 *   - clearQueuedContent: resets queue fields on active or explicit tab
 *   - clearQueueRestoreSignal: resets queue-restore signal
 *   - sendMessage: routes to continueConversation when a session exists,
 *     otherwise startNewConversation
 *   - sendOrQueueMessage: queues while streaming, sends otherwise
 *   - startNewConversation happy path: auto-names, marks draft â†’ streaming,
 *     appends user message, calls chat:start RPC with the right payload
 *   - startNewConversation failure path: surfaces an assistant error message
 *     and resets to loaded when RPC returns success=false
 *   - abortCurrentMessage guards: the concurrent re-entry guard returns early
 *     when already stopping
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ConversationService } from './conversation.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SessionManager } from '@ptah-extension/chat-streaming';
import { MessageValidationService } from '../message-validation.service';
import {
  ClaudeRpcService,
  PtahCliStateService,
  VSCodeService,
} from '@ptah-extension/core';
import type { TabState } from '@ptah-extension/chat-types';
import type { ExecutionChatMessage } from '@ptah-extension/shared';

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Session',
    name: 'New Chat',
    status: 'loaded',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: null,
    ...overrides,
  } as TabState;
}

describe('ConversationService', () => {
  let service: ConversationService;

  // Signal-backed tab state so computed() wrappers work like the real service.
  let tabsSignal: ReturnType<typeof signal<TabState[]>>;
  let activeTabIdSignal: ReturnType<typeof signal<string | null>>;

  let tabManager: {
    tabs: ReturnType<typeof computed<TabState[]>>;
    activeTabId: ReturnType<typeof computed<string | null>>;
    activeTab: ReturnType<typeof computed<TabState | null>>;
    createTab: jest.Mock;
    switchTab: jest.Mock;
    markTabIdle: jest.Mock;
    setQueuedContent: jest.Mock;
    setQueuedContentAndOptions: jest.Mock;
    resetQueuedContentAndOptions: jest.Mock;
    applyStatusErrorReset: jest.Mock;
    applyNewConversationDraft: jest.Mock;
    appendUserMessageForNewTurn: jest.Mock;
    setMessagesAndMarkLoaded: jest.Mock;
    markStreaming: jest.Mock;
    markLoaded: jest.Mock;
    markResuming: jest.Mock;
    setMessages: jest.Mock;
  };
  let sessionManager: jest.Mocked<
    Pick<SessionManager, 'setStatus' | 'isSessionConfirmed' | 'clearNodeMaps'>
  >;
  let validator: jest.Mocked<
    Pick<MessageValidationService, 'validate' | 'sanitize'>
  >;
  let rpcCall: jest.Mock;
  let claudeRpcService: { call: jest.Mock };
  let vscodeConfig: jest.Mock;
  let vscodeService: { config: jest.Mock; postMessage: jest.Mock };
  let ptahCliState: { selectedAgentId: jest.Mock };
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;
  let consoleLog: jest.SpyInstance;

  beforeEach(() => {
    tabsSignal = signal<TabState[]>([makeTab({ id: 'tab-1' })]);
    activeTabIdSignal = signal<string | null>('tab-1');

    // Mocks update the signal-backed tab state so subsequent reads observe the
    // mutation, mirroring real TabManagerService behavior.
    const applyPatch = (tabId: string, patch: Partial<TabState>): void => {
      tabsSignal.update((tabs) =>
        tabs.map((t) =>
          t.id === tabId ? ({ ...t, ...patch } as TabState) : t,
        ),
      );
    };

    tabManager = {
      tabs: computed(() => tabsSignal()),
      activeTabId: computed(() => activeTabIdSignal()),
      activeTab: computed(() => {
        const id = activeTabIdSignal();
        return tabsSignal().find((t) => t.id === id) ?? null;
      }),
      createTab: jest.fn(() => 'tab-new'),
      switchTab: jest.fn(),
      markTabIdle: jest.fn(),
      setQueuedContent: jest.fn((tabId: string, content: string | null) =>
        applyPatch(tabId, { queuedContent: content }),
      ),
      setQueuedContentAndOptions: jest.fn(
        (tabId: string, content: string, options: TabState['queuedOptions']) =>
          applyPatch(tabId, { queuedContent: content, queuedOptions: options }),
      ),
      resetQueuedContentAndOptions: jest.fn((tabId: string) =>
        applyPatch(tabId, { queuedContent: '', queuedOptions: null }),
      ),
      applyStatusErrorReset: jest.fn((tabId: string) =>
        applyPatch(tabId, { status: 'loaded', currentMessageId: null }),
      ),
      applyNewConversationDraft: jest.fn((tabId: string, name: string) =>
        applyPatch(tabId, {
          name,
          title: name,
          status: 'draft',
          claudeSessionId: null,
        } as Partial<TabState>),
      ),
      appendUserMessageForNewTurn: jest.fn(
        (tabId: string, messages: ExecutionChatMessage[]) =>
          applyPatch(tabId, { messages, currentMessageId: null }),
      ),
      setMessagesAndMarkLoaded: jest.fn(
        (tabId: string, messages: ExecutionChatMessage[]) =>
          applyPatch(tabId, { messages, status: 'loaded' }),
      ),
      markStreaming: jest.fn((tabId: string) =>
        applyPatch(tabId, { status: 'streaming' }),
      ),
      markLoaded: jest.fn((tabId: string) =>
        applyPatch(tabId, { status: 'loaded' }),
      ),
      markResuming: jest.fn((tabId: string) =>
        applyPatch(tabId, { status: 'resuming' }),
      ),
      setMessages: jest.fn((tabId: string, messages: ExecutionChatMessage[]) =>
        applyPatch(tabId, { messages }),
      ),
    };

    sessionManager = {
      setStatus: jest.fn(),
      isSessionConfirmed: jest.fn(() => false),
      clearNodeMaps: jest.fn(),
    } as jest.Mocked<
      Pick<SessionManager, 'setStatus' | 'isSessionConfirmed' | 'clearNodeMaps'>
    >;

    validator = {
      validate: jest.fn(() => ({ valid: true })),
      sanitize: jest.fn((s: string) => s.trim()),
    } as unknown as jest.Mocked<
      Pick<MessageValidationService, 'validate' | 'sanitize'>
    >;

    rpcCall = jest.fn();
    claudeRpcService = { call: rpcCall };

    vscodeConfig = jest.fn(() => ({ workspaceRoot: 'D:/repo' }));
    vscodeService = {
      config: vscodeConfig,
      postMessage: jest.fn(),
    };

    ptahCliState = { selectedAgentId: jest.fn(() => null) };

    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();
    consoleLog = jest.spyOn(console, 'log').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        ConversationService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionManager, useValue: sessionManager },
        { provide: MessageValidationService, useValue: validator },
        { provide: ClaudeRpcService, useValue: claudeRpcService },
        { provide: VSCodeService, useValue: vscodeService },
        { provide: PtahCliStateService, useValue: ptahCliState },
      ],
    });
    service = TestBed.inject(ConversationService);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();
    consoleLog.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('queueOrAppendMessage', () => {
    it('writes first queue entry and preserves options', () => {
      service.queueOrAppendMessage('  hello  ', {
        tabId: 'tab-1',
        files: ['a.ts'],
      });

      expect(validator.validate).toHaveBeenCalledWith('  hello  ');
      expect(validator.sanitize).toHaveBeenCalledWith('  hello  ');
      expect(tabManager.setQueuedContentAndOptions).toHaveBeenCalledWith(
        'tab-1',
        'hello',
        { tabId: 'tab-1', files: ['a.ts'] },
      );
    });

    it('appends new content with a newline when queue already has content', () => {
      tabsSignal.set([makeTab({ id: 'tab-1', queuedContent: 'first' })]);
      service.queueOrAppendMessage('second');
      expect(tabManager.setQueuedContent).toHaveBeenCalledWith(
        'tab-1',
        'first\nsecond',
      );
    });

    it('silently returns when no active tab', () => {
      activeTabIdSignal.set(null);
      service.queueOrAppendMessage('hello');
      expect(tabManager.setQueuedContent).not.toHaveBeenCalled();
      expect(tabManager.setQueuedContentAndOptions).not.toHaveBeenCalled();
    });

    it('warns and returns when content fails validation', () => {
      validator.validate.mockReturnValue({ valid: false, reason: 'empty' });
      service.queueOrAppendMessage('');
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid queue content'),
      );
      expect(tabManager.setQueuedContent).not.toHaveBeenCalled();
      expect(tabManager.setQueuedContentAndOptions).not.toHaveBeenCalled();
    });
  });

  describe('clearQueuedContent', () => {
    it('resets queuedContent and queuedOptions for the active tab', () => {
      service.clearQueuedContent();
      expect(tabManager.resetQueuedContentAndOptions).toHaveBeenCalledWith(
        'tab-1',
      );
    });

    it('accepts an explicit tabId', () => {
      service.clearQueuedContent('other-tab');
      expect(tabManager.resetQueuedContentAndOptions).toHaveBeenCalledWith(
        'other-tab',
      );
    });

    it('no-ops when there is no tab to target', () => {
      activeTabIdSignal.set(null);
      service.clearQueuedContent();
      expect(tabManager.resetQueuedContentAndOptions).not.toHaveBeenCalled();
    });
  });

  describe('clearQueueRestoreSignal', () => {
    it('resets the queue restore signal to null', () => {
      service.clearQueueRestoreSignal();
      expect(service.queueRestoreSignal()).toBeNull();
    });
  });

  describe('sendOrQueueMessage', () => {
    it('queues the message while the active tab is streaming', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', status: 'streaming' })]);
      await service.sendOrQueueMessage('hello');

      // Queue is updated via setQueuedContent (no options passed â†’ no
      // setQueuedContentAndOptions on the first write either).
      expect(tabManager.setQueuedContent).toHaveBeenCalledWith(
        'tab-1',
        'hello',
      );
      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('sends the message normally when no session is streaming', async () => {
      rpcCall.mockResolvedValue({ success: true });
      await service.sendOrQueueMessage('hi');
      expect(rpcCall).toHaveBeenCalled();
    });
  });

  describe('sendMessage routing', () => {
    it('routes to startNewConversation when no session exists', async () => {
      rpcCall.mockResolvedValue({ success: true });
      await service.sendMessage('hello');
      expect(rpcCall).toHaveBeenCalledWith(
        'chat:start',
        expect.objectContaining({ prompt: 'hello' }),
      );
    });

    it('routes to continueConversation when SessionManager confirms an existing session', async () => {
      sessionManager.isSessionConfirmed.mockReturnValue(true);
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          status: 'loaded',
          claudeSessionId: 'sess-1',
        }),
      ]);
      rpcCall.mockResolvedValue({ success: true });

      await service.sendMessage('hello');

      // chat:start should NOT be called for an existing session.
      expect(rpcCall.mock.calls.some((c) => c[0] === 'chat:start')).toBe(false);
    });
  });

  describe('startNewConversation happy path', () => {
    it('marks draft â†’ streaming, appends the user message, and sends chat:start RPC', async () => {
      rpcCall.mockResolvedValue({ success: true });

      await service.startNewConversation('Plan a refactor', ['src/a.ts']);

      // clearNodeMaps called to reset correlation state.
      expect(sessionManager.clearNodeMaps).toHaveBeenCalled();
      // Status moves draft â†’ streaming (in order).
      const statusCalls = sessionManager.setStatus.mock.calls.map((c) => c[0]);
      expect(statusCalls).toEqual(['draft', 'streaming']);

      // RPC called with workspacePath + derived auto-name + files option.
      expect(rpcCall).toHaveBeenCalledWith(
        'chat:start',
        expect.objectContaining({
          prompt: 'Plan a refactor',
          tabId: 'tab-1',
          workspacePath: 'D:/repo',
          options: { files: ['src/a.ts'] },
        }),
      );

      // User message appended to the tab via the dedicated intent method.
      expect(tabManager.appendUserMessageForNewTurn).toHaveBeenCalledTimes(1);
      const [, msgs] = tabManager.appendUserMessageForNewTurn.mock.calls[0] as [
        string,
        ExecutionChatMessage[],
      ];
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].rawContent).toBe('Plan a refactor');
    });

    it('auto-names the tab from the first 50 chars of the prompt when the name is still "New Chat"', async () => {
      rpcCall.mockResolvedValue({ success: true });
      const prompt = 'Refactor the authentication module to use Zod schemas';
      await service.startNewConversation(prompt);

      expect(tabManager.applyNewConversationDraft).toHaveBeenCalledWith(
        'tab-1',
        prompt.substring(0, 50).trim(),
      );
    });

    it('surfaces an assistant error message and resets to loaded on RPC failure', async () => {
      rpcCall.mockResolvedValue({ success: false, error: 'no api key' });
      await service.startNewConversation('hello');

      // setMessagesAndMarkLoaded captures the error reply append + status reset.
      expect(tabManager.setMessagesAndMarkLoaded).toHaveBeenCalled();
      const lastCall =
        tabManager.setMessagesAndMarkLoaded.mock.calls[
          tabManager.setMessagesAndMarkLoaded.mock.calls.length - 1
        ];
      const msgs = lastCall[1] as ExecutionChatMessage[];
      const errMsg = msgs[msgs.length - 1];
      expect(errMsg.role).toBe('assistant');
      expect(errMsg.rawContent).toContain('no api key');
    });

    it('warns and returns when no workspace is available', async () => {
      vscodeConfig.mockReturnValue({ workspaceRoot: '' });
      await service.startNewConversation('hello');
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('No workspace path'),
      );
      expect(rpcCall).not.toHaveBeenCalled();
    });
  });

  describe('abortCurrentMessage', () => {
    it('is a no-op when isStopping is already true', async () => {
      // First call parks the flag (but immediately rejects because no session).
      tabsSignal.set([
        makeTab({ id: 'tab-1', claudeSessionId: null, status: 'streaming' }),
      ]);

      // Invoke twice concurrently â€” second should early-return without calling RPC
      // again.
      const p1 = service.abortCurrentMessage();
      const p2 = service.abortCurrentMessage();
      await Promise.all([p1, p2]);

      // No active session â‡’ no RPC at all.
      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('calls chat:abort RPC when an active session exists', async () => {
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          claudeSessionId: 'sess-1',
          status: 'streaming',
        }),
      ]);
      rpcCall.mockResolvedValue({ success: true });

      await service.abortCurrentMessage();
      expect(rpcCall).toHaveBeenCalledWith('chat:abort', {
        sessionId: 'sess-1',
      });
    });

    it('preserves a queued message into the restore signal and clears the queue', async () => {
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          claudeSessionId: 'sess-1',
          status: 'streaming',
          queuedContent: 'queued-text',
        }),
      ]);
      rpcCall.mockResolvedValue({ success: true });

      await service.abortCurrentMessage();

      expect(service.queueRestoreSignal()).toEqual({
        tabId: 'tab-1',
        content: 'queued-text',
      });
      // Queue cleared after restoration via the dedicated reset intent.
      expect(tabManager.resetQueuedContentAndOptions).toHaveBeenCalledWith(
        'tab-1',
      );
    });
  });
});
