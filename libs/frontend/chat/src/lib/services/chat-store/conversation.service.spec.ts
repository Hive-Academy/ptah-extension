/**
 * ConversationService specs â€” queue/abort for chat conversations.
 *
 * Full integration of abortCurrentMessage (preserving partial messages) and
 * abortWithConfirmation (agent-count dialog) is exercised by the chat flow
 * integration tests. This spec focuses on the pure-ish public API that can be
 * covered by pointed unit tests without wiring in the entire streaming handler
 * + session loader chain:
 *
 *   - queueOrAppendMessage: first write vs append with existing queue, options
 *     stored only on first write, invalid content is warned + skipped
 *   - clearQueuedContent: resets queue fields on active or explicit tab
 *   - clearQueueRestoreSignal: resets queue-restore signal
 *   - abortCurrentMessage: re-entry guard, chat:abort RPC, queue restore signal,
 *     no finalize / markTabIdle on success (TASK_2026_360 review F3)
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ConversationService } from './conversation.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import { MessageValidationService } from '../message-validation.service';
import { ClaudeRpcService } from '@ptah-extension/core';
import { MessageFinalizationService } from '@ptah-extension/chat-streaming';
import { SessionLoaderService } from './session-loader.service';
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
    setLastTerminalReason: jest.Mock;
  };
  let validator: jest.Mocked<
    Pick<MessageValidationService, 'validate' | 'sanitize'>
  >;
  let messageFinalization: {
    finalizeCurrentMessage: jest.Mock;
    markAgentsAsInterruptedByToolCallIds: jest.Mock;
  };
  let rpcCall: jest.Mock;
  let claudeRpcService: { call: jest.Mock };
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
      visibleTabIds: signal(new Set<string>()),
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
      setLastTerminalReason: jest.fn(),
    };

    validator = {
      validate: jest.fn(() => ({ valid: true })),
      sanitize: jest.fn((s: string) => s.trim()),
    } as unknown as jest.Mocked<
      Pick<MessageValidationService, 'validate' | 'sanitize'>
    >;

    rpcCall = jest.fn();
    claudeRpcService = { call: rpcCall };

    messageFinalization = {
      finalizeCurrentMessage: jest.fn(),
      markAgentsAsInterruptedByToolCallIds: jest.fn(),
    };

    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();
    consoleLog = jest.spyOn(console, 'log').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        ConversationService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: MessageValidationService, useValue: validator },
        { provide: ClaudeRpcService, useValue: claudeRpcService },
        { provide: MessageFinalizationService, useValue: messageFinalization },
        {
          provide: SessionLoaderService,
          useValue: { setResumableSubagents: jest.fn() },
        },
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

    // TASK_2026_360 review F3: the backend emits the ordered abort
    // `turn_state` (terminalReason 'aborted_streaming') after the last chunk;
    // finalizing or idling here raced it and cut off the tail of the tree.
    it('does not finalize or idle the tab after the abort RPC succeeds — the ordered turn_state does', async () => {
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          claudeSessionId: 'sess-1' as never,
          status: 'streaming',
          streamingState: { currentMessageId: 'msg-1' } as never,
        }),
      ]);
      rpcCall.mockResolvedValue({ success: true });

      await service.abortCurrentMessage();

      expect(tabManager.setLastTerminalReason).toHaveBeenCalledWith(
        'tab-1',
        'aborted_streaming',
      );
      expect(tabManager.markTabIdle).not.toHaveBeenCalled();
      expect(tabManager.applyStatusErrorReset).not.toHaveBeenCalled();
      expect(tabManager.markLoaded).not.toHaveBeenCalled();
      const tab = tabsSignal()[0];
      expect(tab.status).toBe('streaming');
      expect(tab.streamingState).toEqual({ currentMessageId: 'msg-1' });
      expect(service.isStopping()).toBe(false);
    });

    it('pressing abort twice for the same sessionId issues EXACTLY ONE chat:abort RPC and the second press idles the tab locally; changing currentSessionId() between presses issues a second RPC', async () => {
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          claudeSessionId: 'sess-1' as never,
          status: 'streaming',
          streamingState: { currentMessageId: 'msg-1' } as never,
        }),
      ]);
      rpcCall.mockResolvedValue({ success: true });

      // First abort: issues chat:abort RPC and does not idle tab locally
      await service.abortCurrentMessage();

      expect(rpcCall).toHaveBeenCalledTimes(1);
      expect(rpcCall).toHaveBeenCalledWith('chat:abort', {
        sessionId: 'sess-1',
      });
      expect(tabManager.markTabIdle).not.toHaveBeenCalled();

      // Second abort for the same session: skips RPC and idles tab locally
      await service.abortCurrentMessage();

      expect(rpcCall).toHaveBeenCalledTimes(1);
      expect(tabManager.markTabIdle).toHaveBeenCalledWith('tab-1');
      expect(messageFinalization.finalizeCurrentMessage).toHaveBeenCalledWith(
        'tab-1',
        true,
      );

      // Changing currentSessionId() between presses:
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          claudeSessionId: 'sess-2' as never,
          status: 'streaming',
          streamingState: { currentMessageId: 'msg-2' } as never,
        }),
      ]);
      TestBed.flushEffects();

      // Third abort: issues a second RPC for the new session
      await service.abortCurrentMessage();

      expect(rpcCall).toHaveBeenCalledTimes(2);
      expect(rpcCall).toHaveBeenLastCalledWith('chat:abort', {
        sessionId: 'sess-2',
      });
    });
  });
});
