/**
 * ConversationService specs — routes send/queue/abort for chat conversations.
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
 *   - startNewConversation happy path: auto-names, marks draft → streaming,
 *     appends user message, calls chat:start RPC with the right payload
 *   - startNewConversation failure path: surfaces an assistant error message
 *     and resets to loaded when RPC returns success=false
 *   - abortCurrentMessage guards: the concurrent re-entry guard returns early
 *     when already stopping
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ConversationService } from './conversation.service';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
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
    updateTab: jest.Mock;
    createTab: jest.Mock;
    switchTab: jest.Mock;
    markTabIdle: jest.Mock;
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

    tabManager = {
      tabs: computed(() => tabsSignal()),
      activeTabId: computed(() => activeTabIdSignal()),
      activeTab: computed(() => {
        const id = activeTabIdSignal();
        return tabsSignal().find((t) => t.id === id) ?? null;
      }),
      updateTab: jest.fn((tabId: string, patch: Partial<TabState>) => {
        tabsSignal.update((tabs) =>
          tabs.map((t) =>
            t.id === tabId ? ({ ...t, ...patch } as TabState) : t,
          ),
        );
      }),
      createTab: jest.fn(() => 'tab-new'),
      switchTab: jest.fn(),
      markTabIdle: jest.fn(),
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
      expect(tabManager.updateTab).toHaveBeenCalledWith('tab-1', {
        queuedContent: 'hello',
        queuedOptions: { tabId: 'tab-1', files: ['a.ts'] },
      });
    });

    it('appends new content with a newline when queue already has content', () => {
      tabsSignal.set([makeTab({ id: 'tab-1', queuedContent: 'first' })]);
      service.queueOrAppendMessage('second');
      expect(tabManager.updateTab).toHaveBeenCalledWith('tab-1', {
        queuedContent: 'first\nsecond',
      });
    });

    it('silently returns when no active tab', () => {
      activeTabIdSignal.set(null);
      service.queueOrAppendMessage('hello');
      expect(tabManager.updateTab).not.toHaveBeenCalled();
    });

    it('warns and returns when content fails validation', () => {
      validator.validate.mockReturnValue({ valid: false, reason: 'empty' });
      service.queueOrAppendMessage('');
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid queue content'),
      );
      expect(tabManager.updateTab).not.toHaveBeenCalled();
    });
  });

  describe('clearQueuedContent', () => {
    it('resets queuedContent and queuedOptions for the active tab', () => {
      service.clearQueuedContent();
      expect(tabManager.updateTab).toHaveBeenCalledWith('tab-1', {
        queuedContent: '',
        queuedOptions: null,
      });
    });

    it('accepts an explicit tabId', () => {
      service.clearQueuedContent('other-tab');
      expect(tabManager.updateTab).toHaveBeenCalledWith('other-tab', {
        queuedContent: '',
        queuedOptions: null,
      });
    });

    it('no-ops when there is no tab to target', () => {
      activeTabIdSignal.set(null);
      service.clearQueuedContent();
      expect(tabManager.updateTab).not.toHaveBeenCalled();
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

      // Queue is updated; no RPC call placed.
      expect(tabManager.updateTab).toHaveBeenCalledWith(
        'tab-1',
        expect.objectContaining({ queuedContent: 'hello' }),
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
    it('marks draft → streaming, appends the user message, and sends chat:start RPC', async () => {
      rpcCall.mockResolvedValue({ success: true });

      await service.startNewConversation('Plan a refactor', ['src/a.ts']);

      // clearNodeMaps called to reset correlation state.
      expect(sessionManager.clearNodeMaps).toHaveBeenCalled();
      // Status moves draft → streaming (in order).
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

      // User message appended to the tab.
      const patches = tabManager.updateTab.mock.calls.map((c) => c[1]);
      const userAppend = patches.find((p) =>
        Array.isArray((p as { messages?: unknown }).messages),
      ) as { messages: ExecutionChatMessage[] };
      expect(userAppend).toBeDefined();
      expect(userAppend.messages[0].role).toBe('user');
      expect(userAppend.messages[0].rawContent).toBe('Plan a refactor');
    });

    it('auto-names the tab from the first 50 chars of the prompt when the name is still "New Chat"', async () => {
      rpcCall.mockResolvedValue({ success: true });
      const prompt = 'Refactor the authentication module to use Zod schemas';
      await service.startNewConversation(prompt);

      const namingPatches = tabManager.updateTab.mock.calls
        .map((c) => c[1])
        .filter(
          (p): p is { name: string; title: string } =>
            typeof (p as { name?: unknown }).name === 'string',
        );
      expect(namingPatches[0].name).toBe(prompt.substring(0, 50).trim());
    });

    it('surfaces an assistant error message and resets to loaded on RPC failure', async () => {
      rpcCall.mockResolvedValue({ success: false, error: 'no api key' });
      await service.startNewConversation('hello');

      // The last updateTab should add an assistant message and set status: loaded.
      const lastPatch = tabManager.updateTab.mock.calls
        .slice()
        .reverse()
        .find(
          (c) =>
            typeof (c[1] as { status?: unknown }).status === 'string' &&
            Array.isArray((c[1] as { messages?: unknown }).messages),
        );
      expect(lastPatch).toBeDefined();
      const patch = lastPatch![1] as {
        status: string;
        messages: ExecutionChatMessage[];
      };
      expect(patch.status).toBe('loaded');
      const errMsg = patch.messages[patch.messages.length - 1];
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

      // Invoke twice concurrently — second should early-return without calling RPC
      // again.
      const p1 = service.abortCurrentMessage();
      const p2 = service.abortCurrentMessage();
      await Promise.all([p1, p2]);

      // No active session ⇒ no RPC at all.
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
      // Queue cleared after restoration.
      expect(tabManager.updateTab).toHaveBeenCalledWith(
        'tab-1',
        expect.objectContaining({ queuedContent: '', queuedOptions: null }),
      );
    });
  });
});
