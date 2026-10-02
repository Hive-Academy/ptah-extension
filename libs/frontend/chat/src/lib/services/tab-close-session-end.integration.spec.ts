/**
 * TASK_2026_592 — integration across the real chain that ends a session when a
 * chat tab is closed:
 *
 *   TabManagerService (real) -> abort controller -> MessageSenderService (real)
 *   abort listener, and TabManagerService.closedTab -> ClosedTabSessionEnderService
 *   (real) -> ClaudeRpcService (mocked, records every `chat:abort`).
 *
 * Also pins the stale-abort regression: a newer send on the same tab replaces
 * the previous AbortController; that replacement must NOT dispatch `chat:abort`
 * (the backend resolves the abort by tab id / session id and would end the NEW
 * turn, which registers under the same ids).
 */

import { TestBed } from '@angular/core/testing';
import {
  AuthStateService,
  ClaudeRpcService,
  EffortStateService,
  ModelStateService,
  PtahCliStateService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  ConfirmationDialogService,
  ConversationRegistry,
  MODEL_REFRESH_CONTROL,
  TabManagerService,
  TabSessionBinding,
  TabWorkspacePartitionService,
  type ModelRefreshControl,
} from '@ptah-extension/chat-state';
import {
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { SessionId, type SessionTurnState } from '@ptah-extension/shared';
import { ClosedTabSessionEnderService } from './closed-tab-session-ender.service';
import { MessageSenderService } from './message-sender.service';
import { MessageValidationService } from './message-validation.service';

const WS_A = '/ws/a';
const WS_B = '/ws/b';

type RpcResult = { success: boolean; data?: unknown; error?: string };

function backgroundTurnState(
  phase: 'awaiting-background' | 'sleeping',
): SessionTurnState {
  return {
    phase,
    revision: 1,
    backgroundTasks: [],
    sessionCrons: [],
    terminalReason: null,
    timestamp: 1,
  };
}

describe('closing a tab ends its session (real tab manager + sender + ender)', () => {
  let rpcCall: jest.Mock;
  let confirm: jest.Mock;
  let tabManager: TabManagerService;
  let sender: MessageSenderService;
  /** Resolvers for RPCs that are intentionally held open (a running turn). */
  let pending: Array<(r: RpcResult) => void>;
  /** `session:validate` result; flipped per test. */
  let sessionExists: boolean;
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  const aborts = (): unknown[][] =>
    rpcCall.mock.calls.filter((c) => c[0] === 'chat:abort');
  const abortIds = (): unknown[] =>
    aborts().map((c) => (c[1] as { sessionId: string }).sessionId);

  /** Hold a streaming RPC open, like a real running turn. */
  const hold = (): Promise<RpcResult> =>
    new Promise<RpcResult>((resolve) => pending.push(resolve));

  beforeEach(() => {
    localStorage.clear();
    pending = [];
    sessionExists = true;
    confirm = jest.fn().mockResolvedValue(true);
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();

    rpcCall = jest.fn((method: string): Promise<RpcResult> => {
      if (method === 'session:validate') {
        return Promise.resolve({
          success: true,
          data: { exists: sessionExists },
        });
      }
      if (method === 'chat:start' || method === 'chat:continue') return hold();
      return Promise.resolve({ success: true });
    });

    const modelRefresh = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        MessageSenderService,
        MessageValidationService,
        { provide: ConfirmationDialogService, useValue: { confirm } },
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefresh },
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: VSCodeService,
          useValue: {
            config: jest.fn(() => ({ workspaceRoot: WS_A })),
            postMessage: jest.fn(),
          },
        },
        {
          provide: SessionManager,
          useValue: {
            setStatus: jest.fn(),
            setSessionId: jest.fn(),
            clearNodeMaps: jest.fn(),
            failSession: jest.fn(),
          },
        },
        {
          provide: StreamingHandlerService,
          useValue: {
            recordUserPromptBoundary: jest.fn(),
            removeUserPromptBoundary: jest.fn(),
          },
        },
        {
          provide: ModelStateService,
          useValue: {
            currentModel: jest.fn(() => 'claude-opus-4'),
            availableModels: jest.fn(() => [
              { id: 'claude-opus-4', name: 'Claude Opus 4', isSelected: true },
            ]),
          },
        },
        {
          provide: EffortStateService,
          useValue: { currentEffort: jest.fn(() => undefined) },
        },
        {
          provide: PtahCliStateService,
          useValue: { selectedAgentId: jest.fn(() => null) },
        },
        {
          provide: AuthStateService,
          useValue: { flagAuthRequired: jest.fn() },
        },
      ],
    });
    tabManager = TestBed.inject(TabManagerService);
    sender = TestBed.inject(MessageSenderService);
    TestBed.inject(ClosedTabSessionEnderService);
    TestBed.tick();
    tabManager.switchWorkspace(WS_A);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  /** Let async send() reach (and await) its streaming RPC. */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    TestBed.tick();
  };

  // ---------------------------------------------------------------------
  // Stale-abort regression (commit 573f0fa54 tab-id fallback)
  // ---------------------------------------------------------------------
  describe('a newer send replacing a live controller does not abort the new turn', () => {
    it('turn 1: a second send on the same tab (no session id yet) sends no chat:abort', async () => {
      const tabId = tabManager.createTab('t1');
      void sender.send('first', { tabId });
      await settle();
      expect(rpcCall.mock.calls.map((c) => c[0])).toContain('chat:start');
      const first = tabManager.getAbortSignal(tabId);
      expect(first).toBeDefined();

      void sender.send('second', { tabId });
      await settle();

      // The first controller really was replaced...
      expect(first?.aborted).toBe(true);
      expect(tabManager.getAbortSignal(tabId)).not.toBe(first);
      // ...but no chat:abort went out for it.
      expect(aborts()).toHaveLength(0);
      // The replacement is live: closing the tab now ends that turn once.
      await tabManager.closeTab(tabId);
      TestBed.tick();
      expect(abortIds()).toEqual([tabId]);
    });

    it('later turn: a second send on a tab with a session id sends no chat:abort', async () => {
      const sess = SessionId.create();
      const tabId = tabManager.createTab('t2');
      tabManager.attachSession(tabId, sess);
      void sender.send('first', { tabId });
      await settle();
      const first = tabManager.getAbortSignal(tabId);
      expect(first).toBeDefined();

      void sender.send('second', { tabId });
      await settle();

      expect(first?.aborted).toBe(true);
      expect(aborts()).toHaveLength(0);
    });

    it('continue falling back to a new conversation (session file gone) sends no chat:abort', async () => {
      sessionExists = false;
      const sess = SessionId.create();
      const tabId = tabManager.createTab('t3');
      tabManager.attachSession(tabId, sess);

      void sender.send('hello', { tabId });
      await settle();

      // continueConversation wired a controller, then detached the session and
      // restarted via startNewConversation, replacing it.
      expect(rpcCall.mock.calls.map((c) => c[0])).toContain('chat:start');
      expect(aborts()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------
  // Close paths
  // ---------------------------------------------------------------------
  describe('close paths', () => {
    it('idle tab with a session: exactly one chat:abort with the session id', async () => {
      const sess = SessionId.create();
      const tabId = tabManager.createTab('idle');
      tabManager.attachSession(tabId, sess);

      await tabManager.closeTab(tabId);
      TestBed.tick();

      expect(confirm).not.toHaveBeenCalled();
      expect(abortIds()).toEqual([sess]);
    });

    it('streaming tab (later turn): exactly one chat:abort with the session id', async () => {
      const sess = SessionId.create();
      const tabId = tabManager.createTab('streaming');
      tabManager.attachSession(tabId, sess);
      void sender.send('go', { tabId });
      await settle();
      expect(tabManager.getAbortSignal(tabId)).toBeDefined();

      await tabManager.closeTab(tabId);
      TestBed.tick();
      await settle();

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(abortIds()).toEqual([sess]);
    });

    it('turn-1 tab (no session id): exactly one chat:abort with the tab id', async () => {
      const tabId = tabManager.createTab('turn1');
      void sender.send('go', { tabId });
      await settle();
      expect(tabManager.isTabStreaming(tabId)).toBe(true);

      await tabManager.closeTab(tabId);
      TestBed.tick();
      await settle();

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(abortIds()).toEqual([tabId]);
    });

    it.each(['awaiting-background', 'sleeping'] as const)(
      'background (%s) tab: confirm -> one chat:abort; cancel -> none',
      async (phase) => {
        const sess = SessionId.create();
        const mk = (name: string): string => {
          const id = tabManager.createTab(name);
          tabManager.attachSession(id, sess);
          tabManager.markStreaming(id);
          tabManager.markTabStreaming(id);
          tabManager.applyTurnState(id, backgroundTurnState(phase), sess);
          expect(tabManager.tabs().find((t) => t.id === id)?.status).toBe(
            phase,
          );
          return id;
        };

        const keep = mk('bg-cancel');
        confirm.mockResolvedValueOnce(false);
        await tabManager.closeTab(keep);
        TestBed.tick();
        expect(aborts()).toHaveLength(0);
        expect(tabManager.tabs().map((t) => t.id)).toContain(keep);

        confirm.mockResolvedValueOnce(true);
        await tabManager.closeTab(keep);
        TestBed.tick();
        expect(abortIds()).toEqual([sess]);
        expect(tabManager.tabs().map((t) => t.id)).not.toContain(keep);
      },
    );

    it('workspace switch sends no chat:abort', async () => {
      const sA = SessionId.create();
      const sB = SessionId.create();
      const a = tabManager.createTab('a');
      tabManager.attachSession(a, sA);
      void sender.send('running', { tabId: a });
      await settle();

      tabManager.switchWorkspace(WS_B);
      const b = tabManager.createTab('b');
      tabManager.attachSession(b, sB);
      TestBed.tick();
      tabManager.switchWorkspace(WS_A);
      TestBed.tick();
      await settle();

      expect(aborts()).toHaveLength(0);
    });

    it('forceCloseTab sends no chat:abort, even for a streaming tab', async () => {
      const sess = SessionId.create();
      const tabId = tabManager.createTab('popout');
      tabManager.attachSession(tabId, sess);
      void sender.send('running', { tabId });
      await settle();
      expect(tabManager.getAbortSignal(tabId)).toBeDefined();

      tabManager.forceCloseTab(tabId);
      TestBed.tick();
      await settle();

      expect(aborts()).toHaveLength(0);
      expect(tabManager.tabs().map((t) => t.id)).not.toContain(tabId);
    });

    it('resetTabToFresh (/clear) on an idle tab sends no chat:abort', () => {
      const tabId = tabManager.createTab('clear');
      tabManager.attachSession(tabId, SessionId.create());

      tabManager.resetTabToFresh(tabId);
      TestBed.tick();

      expect(aborts()).toHaveLength(0);
      expect(tabManager.tabs().map((t) => t.id)).toContain(tabId);
    });

    it('a session also open in another tab: closing one sends no chat:abort', async () => {
      const sess = SessionId.create();
      const one = tabManager.createTab('one');
      tabManager.attachSession(one, sess);
      const two = tabManager.createTab('two');
      tabManager.attachSession(two, sess);

      await tabManager.closeTab(one);
      TestBed.tick();
      expect(aborts()).toHaveLength(0);

      await tabManager.closeTab(two);
      TestBed.tick();
      expect(abortIds()).toEqual([sess]);
    });
  });
});
