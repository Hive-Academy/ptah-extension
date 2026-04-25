/**
 * MessageSenderService specs — mediator that routes send/continue based on
 * whether the target tab already has a claudeSessionId.
 *
 * Coverage focuses on:
 *   - send(): validates & sanitizes, routes to startNewConversation when
 *     there is no session, to continueConversation when one exists
 *   - sendOrQueue(): returns early (queues handled elsewhere) while streaming,
 *     otherwise forwards to send
 *   - startNewConversation (happy path): auto-name, chat:start RPC payload
 *     including effective model/effort, user message appended
 *   - startNewConversation (RPC failure): marks loaded + failSession()
 *   - startNewConversation (no workspace): warns and returns
 *   - tabId option scopes to a non-active tab (canvas tile isolation)
 *
 * The full continueConversation path involves SessionManager state machine +
 * backend resume semantics — out of scope for this unit spec; covered by the
 * chat flow integration tests.
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import {
  ClaudeRpcService,
  EffortStateService,
  ModelStateService,
  PtahCliStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { MessageSenderService } from './message-sender.service';
import { TabManagerService } from './tab-manager.service';
import { SessionManager } from './session-manager.service';
import { MessageValidationService } from './message-validation.service';
import type { TabState } from '@ptah-extension/chat-types';

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

describe('MessageSenderService', () => {
  let service: MessageSenderService;
  let tabsSignal: ReturnType<typeof signal<TabState[]>>;
  let activeTabIdSignal: ReturnType<typeof signal<string | null>>;
  let tabManager: {
    tabs: ReturnType<typeof computed<TabState[]>>;
    activeTabId: ReturnType<typeof computed<string | null>>;
    activeTab: ReturnType<typeof computed<TabState | null>>;
    updateTab: jest.Mock;
    createTab: jest.Mock;
    switchTab: jest.Mock;
    markTabStreaming: jest.Mock;
    markTabIdle: jest.Mock;
    // TASK_2026_103 Wave E2: AbortController plumbing for tab-close → stream-cancel.
    createAbortController: jest.Mock;
  };
  let sessionManager: jest.Mocked<
    Pick<
      SessionManager,
      'setStatus' | 'setSessionId' | 'clearNodeMaps' | 'failSession'
    >
  >;
  let validator: jest.Mocked<
    Pick<MessageValidationService, 'validate' | 'sanitize'>
  >;
  let rpcCall: jest.Mock;
  let vscodeConfig: jest.Mock;
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    tabsSignal = signal<TabState[]>([makeTab({ id: 'tab-1' })]);
    activeTabIdSignal = signal<string | null>('tab-1');

    tabManager = {
      tabs: computed(() => tabsSignal()),
      activeTabId: computed(() => activeTabIdSignal()),
      activeTab: computed(
        () => tabsSignal().find((t) => t.id === activeTabIdSignal()) ?? null,
      ),
      updateTab: jest.fn((tabId: string, patch: Partial<TabState>) => {
        tabsSignal.update((tabs) =>
          tabs.map((t) =>
            t.id === tabId ? ({ ...t, ...patch } as TabState) : t,
          ),
        );
      }),
      createTab: jest.fn(() => 'tab-new'),
      switchTab: jest.fn(),
      markTabStreaming: jest.fn(),
      markTabIdle: jest.fn(),
      // TASK_2026_103 Wave E2: stub returns a real AbortSignal so the
      // wireAbortDispatch listener can attach without throwing.
      createAbortController: jest.fn(() => new AbortController().signal),
    };

    sessionManager = {
      setStatus: jest.fn(),
      setSessionId: jest.fn(),
      clearNodeMaps: jest.fn(),
      failSession: jest.fn(),
    } as jest.Mocked<
      Pick<
        SessionManager,
        'setStatus' | 'setSessionId' | 'clearNodeMaps' | 'failSession'
      >
    >;

    validator = {
      validate: jest.fn(() => ({ valid: true })),
      sanitize: jest.fn((s: string) => s.trim()),
    } as unknown as jest.Mocked<
      Pick<MessageValidationService, 'validate' | 'sanitize'>
    >;

    rpcCall = jest.fn();
    vscodeConfig = jest.fn(() => ({ workspaceRoot: 'D:/repo' }));

    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        MessageSenderService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionManager, useValue: sessionManager },
        { provide: MessageValidationService, useValue: validator },
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: VSCodeService,
          useValue: { config: vscodeConfig, postMessage: jest.fn() },
        },
        {
          provide: ModelStateService,
          useValue: { currentModel: jest.fn(() => 'claude-opus-4') },
        },
        {
          provide: EffortStateService,
          useValue: { currentEffort: jest.fn(() => 'medium') },
        },
        {
          provide: PtahCliStateService,
          useValue: { selectedAgentId: jest.fn(() => null) },
        },
      ],
    });
    service = TestBed.inject(MessageSenderService);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('send', () => {
    it('warns and skips on invalid content', async () => {
      validator.validate.mockReturnValue({ valid: false, reason: 'empty' });
      await service.send('');
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid message content'),
      );
      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('routes to startNewConversation when no session exists', async () => {
      rpcCall.mockResolvedValue({ success: true });
      await service.send('hello');
      expect(rpcCall).toHaveBeenCalledWith(
        'chat:start',
        expect.objectContaining({ prompt: 'hello' }),
        // TASK_2026_103 Wave E2: third arg is RpcCallOptions with abort signal.
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('routes to continueConversation when claudeSessionId is set', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      // session:validate must return exists: true to actually reach chat:continue.
      rpcCall.mockImplementation(
        (method: string): Promise<{ success: boolean; data?: unknown }> => {
          if (method === 'session:validate') {
            return Promise.resolve({ success: true, data: { exists: true } });
          }
          return Promise.resolve({ success: true });
        },
      );

      await service.send('hello again');

      const startCalled = rpcCall.mock.calls.some((c) => c[0] === 'chat:start');
      const continueCalled = rpcCall.mock.calls.some(
        (c) => c[0] === 'chat:continue',
      );
      expect(startCalled).toBe(false);
      expect(continueCalled).toBe(true);
    });

    it('uses the options.tabId to target a non-active tab (canvas tile isolation)', async () => {
      tabsSignal.set([
        makeTab({ id: 'tab-1' }),
        makeTab({ id: 'tile-7', claudeSessionId: 'sess-T' }),
      ]);
      rpcCall.mockImplementation(
        (method: string): Promise<{ success: boolean; data?: unknown }> => {
          if (method === 'session:validate') {
            return Promise.resolve({ success: true, data: { exists: true } });
          }
          return Promise.resolve({ success: true });
        },
      );

      await service.send('ping', { tabId: 'tile-7' });

      // Should route to continue (tile-7 has a session), not start.
      expect(rpcCall.mock.calls.some((c) => c[0] === 'chat:continue')).toBe(
        true,
      );
    });
  });

  describe('sendOrQueue', () => {
    it('returns early while streaming (queue handled by caller)', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', status: 'streaming' })]);
      await service.sendOrQueue('x');
      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('forwards to send() when not streaming', async () => {
      rpcCall.mockResolvedValue({ success: true });
      await service.sendOrQueue('x');
      expect(rpcCall).toHaveBeenCalledWith(
        'chat:start',
        expect.objectContaining({ prompt: 'x' }),
        // TASK_2026_103 Wave E2: third arg is RpcCallOptions with abort signal.
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  describe('startNewConversation happy path (via send)', () => {
    it('clears node maps, transitions to streaming, and calls chat:start with model/effort', async () => {
      rpcCall.mockResolvedValue({ success: true });
      await service.send('Refactor auth to use Zod', {
        effort: 'high',
      });

      expect(sessionManager.clearNodeMaps).toHaveBeenCalled();
      expect(sessionManager.setStatus).toHaveBeenCalledWith('streaming');
      expect(tabManager.markTabStreaming).toHaveBeenCalledWith('tab-1');

      expect(rpcCall).toHaveBeenCalledWith(
        'chat:start',
        expect.objectContaining({
          prompt: 'Refactor auth to use Zod',
          tabId: 'tab-1',
          workspacePath: 'D:/repo',
          options: expect.objectContaining({
            model: 'claude-opus-4',
            effort: 'high',
          }),
        }),
        // TASK_2026_103 Wave E2: third arg is RpcCallOptions with abort signal.
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('auto-names the tab from the first 50 chars when name is still "New Chat"', async () => {
      rpcCall.mockResolvedValue({ success: true });
      const prompt = 'Explain the new module boundaries in the monorepo';
      await service.send(prompt);

      const naming = tabManager.updateTab.mock.calls
        .map((c) => c[1])
        .find(
          (p): p is { name: string; title: string } =>
            typeof (p as { name?: unknown }).name === 'string',
        );
      expect(naming!.name).toBe(prompt.substring(0, 50).trim());
    });

    it('appends a user message with the raw content and files', async () => {
      rpcCall.mockResolvedValue({ success: true });
      await service.send('hello', { files: ['a.ts', 'b.ts'] });

      const messagesPatch = tabManager.updateTab.mock.calls
        .map((c) => c[1])
        .find((p) => Array.isArray((p as { messages?: unknown }).messages)) as {
        messages: Array<{ role: string; rawContent: string; files?: string[] }>;
      };
      expect(messagesPatch.messages[0].role).toBe('user');
      expect(messagesPatch.messages[0].rawContent).toBe('hello');
      expect(messagesPatch.messages[0].files).toEqual(['a.ts', 'b.ts']);
    });

    it('on RPC failure marks the tab loaded and calls failSession', async () => {
      rpcCall.mockResolvedValue({ success: false, error: 'nope' });
      await service.send('hello');
      expect(sessionManager.failSession).toHaveBeenCalled();
      const lastStatusPatch = tabManager.updateTab.mock.calls
        .slice()
        .reverse()
        .find((c) => (c[1] as { status?: unknown }).status === 'loaded');
      expect(lastStatusPatch).toBeDefined();
    });

    it('warns and returns early when no workspace is available', async () => {
      vscodeConfig.mockReturnValue({ workspaceRoot: '' });
      await service.send('hello');
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('No workspace path'),
      );
      expect(rpcCall).not.toHaveBeenCalled();
    });
  });
});
