/**
 * MessageSenderService specs — mediator that routes send/continue based on
 * whether the target tab already has a claudeSessionId.
 *
 * Coverage focuses on:
 *   - send(): validates & sanitizes, routes to startNewConversation when
 *     there is no session, to continueConversation when one exists
 *   - startNewConversation (happy path): auto-name, chat:start RPC payload
 *     including effective model/effort, user message appended
 *   - startNewConversation (RPC failure): marks loaded + failSession(), and
 *     removes the tab from the streaming set on BOTH pre-stream failure exits
 *     (structural rejection and throw) — TASK_2026_360 B1
 *   - startNewConversation (no workspace): still calls chat:start with
 *     workspacePath omitted so the backend can fall back to
 *     IWorkspaceProvider.getWorkspaceRoot() — fixes the bootstrap-restore
 *     race where Send was clicked before workspace info arrived
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
  AuthStateService,
  type AuthRequiredBanner,
} from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import {
  CARRY_OVER_CHECK_FAILED_TEXT,
  MessageSenderService,
} from './message-sender.service';
import {
  CARRY_OVER_BUSY_TEXT,
  CARRY_OVER_CHECK_TIMEOUT_MS,
  ProviderCarryOverService,
} from './provider-carry-over.service';
import { SessionAgentRosterService } from './session-agents/session-agent-roster.service';
import { UltracodeStateService } from './ultracode-state.service';
import {
  ABORT_REASON_SUPERSEDED,
  TabManagerService,
} from '@ptah-extension/chat-state';
import {
  SessionManager,
  StreamingHandlerService,
  AgentMonitorStore,
  BackgroundAgentStore,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import { MessageValidationService } from './message-validation.service';
import type { TabState } from '@ptah-extension/chat-types';
import {
  type ExecutionChatMessage,
  type SessionId,
} from '@ptah-extension/shared';

/** Test tabs take plain-string ids: the brands (TabId, SessionId) are applied by the cast below. */
function makeTab(
  overrides: Omit<Partial<TabState>, 'id' | 'claudeSessionId'> & {
    id?: string;
    claudeSessionId?: string | null;
  } = {},
): TabState {
  return {
    id: 'tab-1',
    title: 'Session',
    name: 'New Chat',
    status: 'loaded',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: null,
    titleOrigin: 'default',
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
    createTab: jest.Mock;
    switchTab: jest.Mock;
    markTabStreaming: jest.Mock;
    markTabIdle: jest.Mock;
    isTabStreaming: jest.Mock;
    // AbortController plumbing for tab-close → stream-cancel.
    createAbortController: jest.Mock;
    getAbortSignal: jest.Mock;
    applyNewConversationStreaming: jest.Mock;
    appendUserMessageAndResetStreaming: jest.Mock;
    markLoaded: jest.Mock;
    setLastTerminalReason: jest.Mock;
    markStreaming: jest.Mock;
    markResuming: jest.Mock;
    detachSessionAndMarkLoaded: jest.Mock;
    setMessages: jest.Mock;
    consumeFirstMessagePreamble: jest.Mock;
    setFirstMessagePreamble: jest.Mock;
    findTabByIdAcrossWorkspaces: jest.Mock;
    activeWorkspacePath: string | null;
  };
  /** Tabs parked in a NON-active workspace — absent from `tabs()` by design. */
  let backgroundTabsSignal: ReturnType<typeof signal<TabState[]>>;
  /**
   * Models `TabManagerService._streamingTabIds` (tab-manager.service.ts:157) —
   * the spinner/send-vs-queue set. It is a SEPARATE store from `TabState.status`:
   * `markLoaded` writes status alone (`:1104`) and only `markTabIdle` (`:2344`)
   * or `applyTurnState` (`:1197`) removes a tab from it. Modelling it here lets
   * the failure specs assert the set itself rather than a call count.
   */
  let streamingTabIds: Set<string>;
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
  let recordBoundary: jest.Mock;
  let removeBoundary: jest.Mock;
  let retirePendingPrompt: jest.Mock;
  let flagAuthRequired: jest.Mock;
  let authBanner: ReturnType<typeof signal<AuthRequiredBanner | null>>;
  let activeProvider: ReturnType<typeof signal<string | null>>;
  let vscodeConfig: jest.Mock;
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    tabsSignal = signal<TabState[]>([makeTab({ id: 'tab-1' })]);
    activeTabIdSignal = signal<string | null>('tab-1');
    backgroundTabsSignal = signal<TabState[]>([]);
    streamingTabIds = new Set<string>();

    const applyPatch = (tabId: string, patch: Partial<TabState>): void => {
      if (backgroundTabsSignal().some((t) => t.id === tabId)) {
        backgroundTabsSignal.update((tabs) =>
          tabs.map((t) =>
            t.id === tabId ? ({ ...t, ...patch } as TabState) : t,
          ),
        );
        return;
      }
      tabsSignal.update((tabs) =>
        tabs.map((t) =>
          t.id === tabId ? ({ ...t, ...patch } as TabState) : t,
        ),
      );
    };

    tabManager = {
      tabs: computed(() => tabsSignal()),
      activeTabId: computed(() => activeTabIdSignal()),
      activeTab: computed(
        () => tabsSignal().find((t) => t.id === activeTabIdSignal()) ?? null,
      ),
      createTab: jest.fn(() => 'tab-new'),
      switchTab: jest.fn(),
      markTabStreaming: jest.fn((tabId: string) => {
        streamingTabIds.add(tabId);
      }),
      markTabIdle: jest.fn((tabId: string) => {
        streamingTabIds.delete(tabId);
      }),
      isTabStreaming: jest.fn((tabId: string) => streamingTabIds.has(tabId)),
      consumeFirstMessagePreamble: jest.fn(() => null),
      setFirstMessagePreamble: jest.fn(),
      // Stub returns a real AbortSignal so the wireAbortDispatch listener
      // can attach without throwing.
      createAbortController: jest.fn(() => new AbortController().signal),
      // No existing controller tracked by default; individual tests override
      // this to simulate an in-flight (still-tracked) AbortController.
      getAbortSignal: jest.fn(() => undefined),
      applyNewConversationStreaming: jest.fn((tabId: string) =>
        applyPatch(tabId, { status: 'streaming' }),
      ),
      appendUserMessageAndResetStreaming: jest.fn(
        (tabId: string, messages: ExecutionChatMessage[]) =>
          applyPatch(tabId, {
            messages,
            currentMessageId: null,
            streamingState: null,
          }),
      ),
      setLastTerminalReason: jest.fn((tabId: string, reason: TabState['lastTerminalReason']) =>
        applyPatch(tabId, { lastTerminalReason: reason }),
      ),
      markLoaded: jest.fn((tabId: string) =>
        applyPatch(tabId, { status: 'loaded' }),
      ),
      markStreaming: jest.fn((tabId: string) =>
        applyPatch(tabId, { status: 'streaming' }),
      ),
      markResuming: jest.fn((tabId: string) =>
        applyPatch(tabId, { status: 'resuming' }),
      ),
      detachSessionAndMarkLoaded: jest.fn((tabId: string) =>
        applyPatch(tabId, { claudeSessionId: null, status: 'loaded' }),
      ),
      setMessages: jest.fn((tabId: string, messages: ExecutionChatMessage[]) =>
        applyPatch(tabId, { messages }),
      ),
      // Mirrors production: resolves the ACTIVE workspace and every background
      // partition, unlike `tabs()`.
      findTabByIdAcrossWorkspaces: jest.fn((tabId: string) => {
        const active = tabsSignal().find((t) => t.id === tabId);
        if (active) return { tab: active, workspacePath: 'D:/repo' };
        const background = backgroundTabsSignal().find((t) => t.id === tabId);
        return background
          ? { tab: background, workspacePath: 'D:/other-repo' }
          : null;
      }),
      activeWorkspacePath: 'D:/repo',
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
    recordBoundary = jest.fn();
    removeBoundary = jest.fn();
    retirePendingPrompt = jest.fn();
    flagAuthRequired = jest.fn(() => 1);
    authBanner = signal<AuthRequiredBanner | null>(null);
    activeProvider = signal<string | null>('anthropic');
    vscodeConfig = jest.fn(() => ({ workspaceRoot: 'D:/repo' }));

    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        MessageSenderService,
        SessionAgentRosterService,
        { provide: AgentMonitorStore, useValue: { subagents: signal(new Map()), agents: signal([]) } },
        { provide: BackgroundAgentStore, useValue: { agents: signal([]) } },
        { provide: PermissionHandlerService, useValue: {
          routingTargetRevision: signal(0), permissionRequests: signal([]), questionRequests: signal([]),
        } },
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionManager, useValue: sessionManager },
        {
          provide: StreamingHandlerService,
          useValue: {
            recordUserPromptBoundary: recordBoundary,
            removeUserPromptBoundary: removeBoundary,
            retirePendingPrompt,
          },
        },
        { provide: MessageValidationService, useValue: validator },
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: VSCodeService,
          useValue: { config: vscodeConfig, postMessage: jest.fn() },
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
          // Stateful like the real service: a successful write is readable back, which
          // UltracodeStateService.enable()/disable() check before reporting success.
          useValue: (() => {
            let effort: string | undefined = 'medium';
            return {
              currentEffort: jest.fn(() => effort),
              setEffort: jest.fn(async (next: string | undefined) => {
                effort = next;
                return true;
              }),
            };
          })(),
        },
        {
          provide: PtahCliStateService,
          useValue: { selectedAgentId: jest.fn(() => null) },
        },
        {
          provide: AuthStateService,
          // The banner and active-provider signals are read by the real
          // ProviderCarryOverService and the `/compact` fail-closed rule.
          useValue: {
            flagAuthRequired,
            authRequiredBanner: authBanner,
            activeProviderId: activeProvider,
            clearAuthRequiredBanner: jest.fn(),
          },
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
        // Third arg is RpcCallOptions with abort signal.
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
      const bubble = tabsSignal()[0].messages.at(-1);
      const payload = rpcCall.mock.calls.find((call) => call[0] === 'chat:continue')?.[1];
      expect(payload.clientMessageId).toBe(bubble?.id);
      expect(retirePendingPrompt).toHaveBeenCalledWith('tab-1', bubble?.id);
    });

    it('keeps an enqueued continue pending until its echo or consuming terminal', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      rpcCall.mockImplementation((method: string) => Promise.resolve(
        method === 'session:validate'
          ? { success: true, data: { exists: true } }
          : { success: true, data: { success: true, enqueued: true } },
      ));
      await service.send('queued', { tabId: 'tab-1' });
      expect(retirePendingPrompt).not.toHaveBeenCalled();
    });

    it('records the continued prompt as a boundary in the live tree', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      rpcCall.mockImplementation(
        (method: string): Promise<{ success: boolean; data?: unknown }> =>
          Promise.resolve(
            method === 'session:validate'
              ? { success: true, data: { exists: true } }
              : { success: true },
          ),
      );

      await service.send('sent mid-turn');

      const userMessage = tabsSignal()[0].messages.at(-1);
      expect(userMessage?.role).toBe('user');
      expect(recordBoundary).toHaveBeenCalledWith('tab-1', userMessage);
    });

    it('leaves a settled continue idle without starting a stream', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      rpcCall.mockImplementation((method: string): Promise<unknown> => {
        if (method === 'session:validate') {
          return Promise.resolve({ success: true, data: { exists: true } });
        }
        return Promise.resolve({
          success: true,
          data: { success: true, settled: true },
        });
      });

      await expect(service.send('/compact')).resolves.toEqual({
        success: true,
      });

      expect(tabsSignal()[0].status).toBe('loaded');
      expect(streamingTabIds.has('tab-1')).toBe(false);
      expect(tabManager.markStreaming).not.toHaveBeenCalled();
      expect(tabManager.markTabStreaming).not.toHaveBeenCalled();
      expect(tabManager.markTabIdle).toHaveBeenCalledWith('tab-1');
      expect(sessionManager.setStatus).toHaveBeenLastCalledWith('loaded');
      expect(removeBoundary).toHaveBeenCalledWith(
        'tab-1',
        tabsSignal()[0].messages.at(-1)?.id,
      );
    });

    it('starts streaming for a normal successful continue', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      rpcCall.mockImplementation((method: string): Promise<unknown> => {
        if (method === 'session:validate') {
          return Promise.resolve({ success: true, data: { exists: true } });
        }
        return Promise.resolve({ success: true, data: { success: true } });
      });

      await expect(service.send('hello again')).resolves.toEqual({
        success: true,
      });

      expect(tabsSignal()[0].status).toBe('streaming');
      expect(streamingTabIds.has('tab-1')).toBe(true);
      expect(tabManager.markTabStreaming).toHaveBeenCalledWith('tab-1');
      expect(sessionManager.setStatus).toHaveBeenLastCalledWith('streaming');
      expect(removeBoundary).not.toHaveBeenCalled();
    });

    describe('a continue whose prompt never reaches the backend', () => {
      /** `chat:continue` resolves to `continueResult`, or rejects with it. */
      const failContinue = (continueResult: unknown, reject = false): void => {
        rpcCall.mockImplementation((method: string): Promise<unknown> => {
          if (method === 'session:validate') {
            return Promise.resolve({ success: true, data: { exists: true } });
          }
          if (method === 'chat:continue') {
            return reject
              ? Promise.reject(continueResult)
              : Promise.resolve(continueResult);
          }
          return Promise.resolve({ success: true });
        });
      };

      /** The bubble the send recorded as a boundary. */
      const recordedBubbleId = (): string =>
        (recordBoundary.mock.calls[0][1] as ExecutionChatMessage).id;

      beforeEach(() => {
        tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      });

      it('removes the boundary but keeps the bubble when chat:continue is rejected', async () => {
        failContinue({ success: false, error: 'turn rejected' });

        const outcome = await service.send('follow up', { tabId: 'tab-1' });

        expect(outcome).toEqual(expect.objectContaining({ success: false }));
        expect(removeBoundary).toHaveBeenCalledWith(
          'tab-1',
          recordedBubbleId(),
        );
        expect(tabsSignal()[0].messages.map((m) => m.id)).toEqual([
          recordedBubbleId(),
        ]);
      });

      it('removes the boundary but keeps the bubble when chat:continue throws', async () => {
        failContinue(new Error('socket closed'), true);

        await service.send('follow up', { tabId: 'tab-1' });

        expect(removeBoundary).toHaveBeenCalledWith(
          'tab-1',
          recordedBubbleId(),
        );
        expect(tabsSignal()[0].messages.map((m) => m.id)).toEqual([
          recordedBubbleId(),
        ]);
      });

      it('returns no error code for any other rejection', async () => {
        failContinue({
          success: true,
          data: { success: false, errorCode: 'AUTH_REQUIRED', error: 'auth' },
        });

        const outcome = await service.send('follow up', { tabId: 'tab-1' });

        expect(outcome).toEqual({ success: false, error: 'auth' });
      });

      it('logs a refused continue at error', async () => {
        failContinue({ success: false, error: 'turn rejected' });

        await service.send('follow up', { tabId: 'tab-1' });

        expect(consoleError).toHaveBeenCalledWith(
          '[MessageSender] Failed to continue chat:',
          'turn rejected',
        );
      });

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

    it('appends the bubble to a BACKGROUND-workspace tab, not the active one (TASK_2026_382 W4)', async () => {
      const activeMsg = {
        id: 'active-msg',
        role: 'user',
        rawContent: 'active transcript',
        timestamp: 1,
      } as unknown as ExecutionChatMessage;
      const bgMsg = {
        id: 'bg-msg',
        role: 'user',
        rawContent: 'background transcript',
        timestamp: 1,
      } as unknown as ExecutionChatMessage;
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          claudeSessionId: 'sess-ACTIVE',
          messages: [activeMsg],
        }),
      ]);
      // Lives in another workspace, so `tabs()` cannot see it.
      backgroundTabsSignal.set([
        makeTab({
          id: 'tab-bg',
          claudeSessionId: 'sess-BG',
          messages: [bgMsg],
        }),
      ]);
      rpcCall.mockImplementation(
        (method: string): Promise<{ success: boolean; data?: unknown }> => {
          if (method === 'session:validate') {
            return Promise.resolve({ success: true, data: { exists: true } });
          }
          return Promise.resolve({ success: true });
        },
      );

      await service.send('hello background', { tabId: 'tab-bg' });

      // The background tab's OWN session was continued…
      const continueCall = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:continue',
      );
      expect(continueCall?.[1]).toEqual(
        expect.objectContaining({ sessionId: 'sess-BG', tabId: 'tab-bg' }),
      );

      // …and the bubble was appended to the BACKGROUND tab's transcript, on top
      // of its own history. Before the fix this wrote the ACTIVE tab's messages
      // (`active-msg`) over the background tab.
      const setMessagesCall = tabManager.setMessages.mock.calls.at(-1);
      expect(setMessagesCall?.[0]).toBe('tab-bg');
      const written = setMessagesCall?.[1] as ExecutionChatMessage[];
      expect(written.map((m) => m.id)).toContain('bg-msg');
      expect(written.map((m) => m.id)).not.toContain('active-msg');
      expect(written.at(-1)?.rawContent).toBe('hello background');
    });

    it("validates and continues a background tab's session against ITS workspace, not the active one", async () => {
      tabsSignal.set([
        makeTab({ id: 'tab-1', claudeSessionId: 'sess-ACTIVE' }),
      ]);
      backgroundTabsSignal.set([
        makeTab({ id: 'tab-bg', claudeSessionId: 'sess-BG' }),
      ]);
      rpcCall.mockImplementation(
        (
          method: string,
          payload: { workspacePath?: string },
        ): Promise<{ success: boolean; data?: unknown }> => {
          if (method === 'session:validate') {
            // The session file only exists under the background workspace.
            return Promise.resolve({
              success: true,
              data: { exists: payload.workspacePath === 'D:/other-repo' },
            });
          }
          return Promise.resolve({ success: true });
        },
      );

      await service.send('review feedback', { tabId: 'tab-bg' });

      const methods = rpcCall.mock.calls.map((c) => c[0]);
      expect(methods).not.toContain('chat:start');
      expect(tabManager.detachSessionAndMarkLoaded).not.toHaveBeenCalled();
      const validateCall = rpcCall.mock.calls.find(
        (c) => c[0] === 'session:validate',
      );
      expect(validateCall?.[1]).toEqual(
        expect.objectContaining({
          sessionId: 'sess-BG',
          workspacePath: 'D:/other-repo',
        }),
      );
      const continueCall = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:continue',
      );
      expect(continueCall?.[1]).toEqual(
        expect.objectContaining({
          sessionId: 'sess-BG',
          tabId: 'tab-bg',
          workspacePath: 'D:/other-repo',
        }),
      );
    });

    it('treats another spelling of the active workspace as the active workspace', async () => {
      tabsSignal.set([
        makeTab({ id: 'tab-1', claudeSessionId: 'sess-ACTIVE' }),
      ]);
      // Same folder, different separator, drive-letter case and trailing slash.
      tabManager.findTabByIdAcrossWorkspaces.mockImplementation(
        (tabId: string) => {
          const tab = tabsSignal().find((t) => t.id === tabId);
          return tab ? { tab, workspacePath: 'd:\\repo\\' } : null;
        },
      );
      rpcCall.mockResolvedValue({ success: true, data: { exists: true } });

      await service.send('review feedback', { tabId: 'tab-1' });

      const validateCall = rpcCall.mock.calls.find(
        (c) => c[0] === 'session:validate',
      );
      // The host's configured root, not the tab's alternate spelling.
      expect(validateCall?.[1]).toEqual(
        expect.objectContaining({
          sessionId: 'sess-ACTIVE',
          workspacePath: 'D:/repo',
        }),
      );
    });
  });

  describe('startNewConversation happy path (via send)', () => {
    it('clears node maps, transitions to streaming, and calls chat:start with model/effort', async () => {
      rpcCall.mockResolvedValue({ success: true });
      await service.send('Refactor auth to use Zod', {
        effort: 'high',
      });

      // TASK_2026_154 Wave 2: the node-map clear is SCOPED to the new
      // conversation's session id (a string arg), never a global wipe — a
      // global clearNodeMaps() would erase a session streaming in a background
      // workspace.
      expect(sessionManager.clearNodeMaps).toHaveBeenCalledWith(
        expect.any(String),
      );
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
        // Third arg is RpcCallOptions with abort signal.
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('sends the bounded first-message title to chat:start for a default tab', async () => {
      rpcCall.mockResolvedValue({ success: true });
      const prompt = 'Explain the new module boundaries in the monorepo';
      await service.send(prompt);

      const [, payload] = rpcCall.mock.calls.find(
        (call) => call[0] === 'chat:start',
      ) as [string, { name: string }];
      expect(payload.name).toBe('Explain the new module boundaries in…');
      expect(tabManager.applyNewConversationStreaming).toHaveBeenCalledWith(
        'tab-1',
      );
    });

    it('appends a user message with the raw content and files', async () => {
      rpcCall.mockResolvedValue({ success: true });
      await service.send('hello', { files: ['a.ts', 'b.ts'] });

      expect(
        tabManager.appendUserMessageAndResetStreaming,
      ).toHaveBeenCalledTimes(1);
      const [, msgs] = tabManager.appendUserMessageAndResetStreaming.mock
        .calls[0] as [string, ExecutionChatMessage[]];
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].rawContent).toBe('hello');
      expect((msgs[0] as { files?: string[] }).files).toEqual(['a.ts', 'b.ts']);
    });

    it('on RPC failure marks the tab loaded and calls failSession', async () => {
      rpcCall.mockResolvedValue({ success: false, error: 'nope' });
      await service.send('hello');
      expect(sessionManager.failSession).toHaveBeenCalled();
      expect(tabManager.markLoaded).toHaveBeenCalledWith('tab-1');
    });

    /**
     * TASK_2026_360 B1 — the optimistic `markTabStreaming` at
     * message-sender.service.ts:377 fires BEFORE `chat:start`. A pre-stream
     * failure creates no broadcaster, so no backend `turn_state` and no
     * CHAT_ERROR can ever repair the spinner set; Stop cannot heal it either
     * (the tab never bound a `claudeSessionId`). The send path must therefore
     * pair its own optimistic write with `markTabIdle` on BOTH failure exits,
     * exactly as `continueConversation` already does (`:653`, `:669`).
     *
     * These assert the SET, not the call: `markLoaded` alone leaves the tab in
     * `_streamingTabIds`, which lights Stop and silently queues every later
     * message (`tab-manager.service.ts:150-156`, TASK_2026_382).
     */
    it('leaves no tab in the streaming set after a structural chat:start rejection', async () => {
      rpcCall.mockResolvedValue({
        success: true,
        data: { success: false, error: 'AUTH_REQUIRED' },
      });

      await service.send('hello');

      expect(tabManager.markTabStreaming).toHaveBeenCalledWith('tab-1');
      expect(tabManager.markTabIdle).toHaveBeenCalledWith('tab-1');
      expect(tabManager.isTabStreaming('tab-1')).toBe(false);
    });

    it('marks a native start failure as an error for the session card and header', async () => {
      rpcCall.mockResolvedValue({ success: false, errorCode: 'SESSION_ENDED', error: 'Codex chat could not start.' });
      await expect(service.send('hello')).resolves.toEqual({ success: false, error: 'Codex chat could not start.' });
      expect(tabManager.setLastTerminalReason).toHaveBeenCalledWith('tab-1', 'api_error');
      expect(tabManager.isTabStreaming('tab-1')).toBe(false);
    });

    it('settles a cancelled continue without logging or failing the session', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      rpcCall.mockImplementation(async (method: string) => method === 'session:validate'
        ? { success: true, data: { exists: true } }
        : { success: true, data: { success: false, cancelled: true } });
      await expect(service.send('hello')).resolves.toEqual({ success: false, cancelled: true });
      expect(tabsSignal()[0].status).toBe('loaded');
      expect(streamingTabIds.has('tab-1')).toBe(false);
      expect(consoleError).not.toHaveBeenCalled();
      expect(sessionManager.failSession).not.toHaveBeenCalled();
    });

    it('leaves a settled compact failure to CHAT_ERROR without a second error or success state', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X', lastTerminalReason: 'api_error' })]);
      rpcCall.mockImplementation(async (method: string) => method === 'session:validate'
        ? { success: true, data: { exists: true } }
        : { success: true, data: { success: false, settled: true, errorCode: 'CODEX_RUNTIME_FAILED' } });

      await expect(service.send('/compact')).resolves.toEqual({
        success: false,
        errorAlreadyShown: true,
      });
      expect(consoleError).not.toHaveBeenCalled();
      expect(tabManager.markLoaded).not.toHaveBeenCalled();
      expect(tabManager.markStreaming).not.toHaveBeenCalled();
      expect(tabManager.setLastTerminalReason).not.toHaveBeenCalled();
      expect(removeBoundary).toHaveBeenCalled();
      expect(tabsSignal()[0].lastTerminalReason).toBe('api_error');
    });

    it('settles a cancelled start quietly, restores its preamble and leaves no failed chip', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', lastTerminalReason: 'completed' })]);
      tabManager.consumeFirstMessagePreamble.mockReturnValue('preamble');
      rpcCall.mockResolvedValue({ success: true, data: { success: false, cancelled: true } });

      await expect(service.send('hello')).resolves.toEqual({ success: false, cancelled: true });

      expect(tabManager.setFirstMessagePreamble).toHaveBeenCalledWith('tab-1', 'preamble');
      expect(tabsSignal()[0].status).toBe('loaded');
      expect(streamingTabIds.has('tab-1')).toBe(false);
      expect(sessionManager.failSession).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(flagAuthRequired).not.toHaveBeenCalled();
      expect(tabsSignal()[0].lastTerminalReason).toBe('completed');
      expect(TestBed.inject(SessionAgentRosterService).roster('tab-1')[0].status).toBeNull();
    });

    describe.each(['outer', 'data'])('Codex failure code on %s', (location) => {
      it.each([
        ['CODEX_BUSY', 'Codex is busy, try again when the current operation finishes'],
        ['CODEX_UNSUPPORTED_OPTION', 'Unsupported Codex option: maxTurns'],
        ['CODEX_UNAVAILABLE', 'Codex chat could not start.'],
        ['CODEX_RUNTIME_FAILED', 'Codex chat could not start.'],
      ])('maps %s and keeps the Orchestrator failed', async (errorCode, expected) => {
        const error = 'Unsupported Codex option: maxTurns';
        rpcCall.mockResolvedValue(location === 'outer'
          ? { success: false, errorCode, error }
          : { success: true, data: { success: false, errorCode, error } });

        await expect(service.send('hello')).resolves.toEqual({ success: false, error: expected });
        expect(streamingTabIds.has('tab-1')).toBe(false);
        expect(TestBed.inject(SessionAgentRosterService).roster('tab-1')[0].status).toBe('failed');
      });
    });

    it('leaves no tab in the streaming set after a transport-level chat:start failure', async () => {
      rpcCall.mockResolvedValue({ success: false, error: 'nope' });

      await service.send('hello');

      expect(tabManager.markTabIdle).toHaveBeenCalledWith('tab-1');
      expect(tabManager.isTabStreaming('tab-1')).toBe(false);
    });

    it('leaves no tab in the streaming set when chat:start throws', async () => {
      // AuthRequiredError raised inside sdkAdapter.startChatSession, before
      // streamEventsToWebview — no broadcaster exists to emit a terminal
      // turn_state. startNewConversation rethrows, so `send` rejects.
      const authError = new Error('AUTH_REQUIRED');
      rpcCall.mockRejectedValue(authError);

      await expect(service.send('hello')).rejects.toThrow('AUTH_REQUIRED');

      expect(tabManager.markTabStreaming).toHaveBeenCalledWith('tab-1');
      expect(tabManager.markTabIdle).toHaveBeenCalledWith('tab-1');
      expect(tabManager.isTabStreaming('tab-1')).toBe(false);
    });

    it('returns { success: true } on a started conversation (F-D2 contract)', async () => {
      rpcCall.mockResolvedValue({ success: true });
      await expect(service.send('hello')).resolves.toEqual({ success: true });
    });

    it('returns { success: false } on a structural chat:start failure (F-D2 contract)', async () => {
      // Transport OK, backend rejects the turn (data.success === false). The
      // send must report failure so the Tasks Start-flow bridge does not flip a
      // phantom `in_progress` transition.
      rpcCall.mockResolvedValue({
        success: true,
        data: { success: false, error: 'AUTH_REQUIRED' },
      });
      await expect(service.send('hello')).resolves.toEqual({
        success: false,
        error: 'AUTH_REQUIRED',
      });
    });

    it('prepends a hidden first-message preamble to the backend prompt only', async () => {
      rpcCall.mockResolvedValue({ success: true });
      tabManager.consumeFirstMessagePreamble.mockReturnValueOnce(
        'COUNCIL FRAMING\nObjective:',
      );

      await service.send('compare the two designs');

      // Backend prompt carries the framing + the user's objective.
      const [, payload] = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:start',
      ) as [string, { prompt: string }];
      expect(payload['prompt']).toBe(
        'COUNCIL FRAMING\nObjective:\n\ncompare the two designs',
      );

      // The visible bubble stays the user's plain text — no framing leak.
      const [, msgs] = tabManager.appendUserMessageAndResetStreaming.mock
        .calls[0] as [string, ExecutionChatMessage[]];
      expect(msgs[0].rawContent).toBe('compare the two designs');
    });

    it('restores a consumed preamble when chat:start fails so retry sends it', async () => {
      let preamble: string | null = 'NEW PROJECT SEED';
      tabManager.consumeFirstMessagePreamble.mockImplementation(() => {
        const value = preamble;
        preamble = null;
        return value;
      });
      tabManager.setFirstMessagePreamble.mockImplementation(
        (_tabId: string, value: string) => {
          preamble = value;
        },
      );
      rpcCall.mockResolvedValueOnce({ success: false, error: 'offline' });
      rpcCall.mockResolvedValue({ success: true });
      await expect(service.send('Clinic scheduler')).resolves.toMatchObject({
        success: false,
      });
      expect(preamble).toBe('NEW PROJECT SEED');
      await service.send('Clinic scheduler');
      const starts = rpcCall.mock.calls.filter(
        (call) => call[0] === 'chat:start',
      );
      expect(starts).toHaveLength(2);
      expect(starts[1][1].prompt).toBe('NEW PROJECT SEED\n\nClinic scheduler');
    });

    it('sends the raw content as prompt when no preamble is set', async () => {
      rpcCall.mockResolvedValue({ success: true });
      // default mock returns null (no preamble)
      await service.send('plain question');

      const [, payload] = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:start',
      ) as [string, { prompt: string }];
      expect(payload['prompt']).toBe('plain question');
    });

    it('flags a re-auth banner when chat:start returns AUTH_REQUIRED', async () => {
      rpcCall.mockResolvedValue({
        success: true,
        data: {
          success: false,
          error: 'OpenAI Codex token has expired. Run `codex login`.',
          errorCode: 'AUTH_REQUIRED',
          providerId: 'openai-codex',
        },
      });

      await service.send('hello');

      expect(flagAuthRequired).toHaveBeenCalledWith(
        'openai-codex',
        expect.stringContaining('codex login'),
      );
      // The send is treated as a failure so the spinner is released.
      expect(sessionManager.failSession).toHaveBeenCalled();
      expect(tabManager.markLoaded).toHaveBeenCalledWith('tab-1');
    });

    it('still calls chat:start with workspacePath omitted when workspace is empty (backend fallback)', async () => {
      // Bug fix: prior behavior silently dropped the user's message during
      // the bootstrap-restore race (Angular bootstrap → workspace:getInfo →
      // workspace:switch → updateWorkspaceRoot in electron-layout.service.ts).
      // The backend chat:start handler falls back to
      // IWorkspaceProvider.getWorkspaceRoot() when params.workspacePath is
      // missing, so the frontend must let the RPC through.
      vscodeConfig.mockReturnValue({ workspaceRoot: '' });
      rpcCall.mockResolvedValue({ success: true });

      await service.send('hello');

      // RPC must still be invoked — no silent bail-out.
      expect(rpcCall).toHaveBeenCalledTimes(1);
      const [method, payload] = rpcCall.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(method).toBe('chat:start');
      expect(payload['prompt']).toBe('hello');
      // workspacePath is either omitted entirely or explicitly undefined;
      // both forms let the backend resolve via IWorkspaceProvider.
      expect(payload['workspacePath']).toBeUndefined();
      // No "No workspace path" warning — that early-return was the bug.
      expect(consoleWarn).not.toHaveBeenCalledWith(
        expect.stringContaining('No workspace path'),
      );
    });
  });

  // TASK_2026_610 comp. 11 — the Electron webview renders `ptah-ui` fences as
  // live surfaces, so its sends carry the fence flag. VS Code omits the key
  // entirely: an absent optional reads as "no surfaces", and `false` would
  // carry the same meaning only by luck of the default.
  describe('ptahUiFence hint flag (chat:start / chat:continue params)', () => {
    /** Sets the host gate the sender reads (`vscodeService.isElectron`). */
    function setHost(host: 'electron' | 'vscode'): void {
      const vscodeStub = TestBed.inject(VSCodeService) as {
        isElectron?: boolean;
      };
      vscodeStub.isElectron = host === 'electron';
    }

    function payloadOf(
      method: 'chat:start' | 'chat:continue',
    ): Record<string, unknown> {
      const call = rpcCall.mock.calls.find((c) => c[0] === method);
      if (!call) throw new Error(`No ${method} RPC was sent.`);
      return call[1] as Record<string, unknown>;
    }

    /** Session-bound tab + session:validate mock so `send` reaches chat:continue. */
    function bindSession(): void {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      rpcCall.mockImplementation(
        (method: string): Promise<{ success: boolean; data?: unknown }> =>
          Promise.resolve(
            method === 'session:validate'
              ? { success: true, data: { exists: true } }
              : { success: true },
          ),
      );
    }

    it('sends ptahUiFence: true on chat:start when the host is Electron', async () => {
      setHost('electron');
      rpcCall.mockResolvedValue({ success: true });
      await service.send('hello');
      expect(payloadOf('chat:start')['ptahUiFence']).toBe(true);
    });

    it('omits the ptahUiFence key on chat:start when the host is VS Code (absent, not false)', async () => {
      setHost('vscode');
      rpcCall.mockResolvedValue({ success: true });
      await service.send('hello');
      expect('ptahUiFence' in payloadOf('chat:start')).toBe(false);
    });

    it('sends ptahUiFence: true on chat:continue when the host is Electron', async () => {
      setHost('electron');
      bindSession();
      await service.send('hello again');
      expect(payloadOf('chat:continue')['ptahUiFence']).toBe(true);
    });

    it('omits the ptahUiFence key on chat:continue when the host is VS Code', async () => {
      setHost('vscode');
      bindSession();
      await service.send('hello again');
      expect('ptahUiFence' in payloadOf('chat:continue')).toBe(false);
    });
  });

  describe('continueConversation bootstrap-restore race recovery', () => {
    // Scenario: stale tab is restored across a workspace wipe AND the user
    // clicks Send during the bootstrap-restore race. The local
    // vscodeService.config().workspaceRoot is still empty, so we must ask
    // the backend for the resolved workspace via workspace:getInfo BEFORE
    // running validateSessionExists — otherwise we'd skip the friendly
    // "session was deleted → start a new one" recovery and the user would
    // see a cryptic SDK error instead.
    it('resolves workspace via workspace:getInfo, then validates the session against it before chat:continue fires', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      vscodeConfig.mockReturnValue({ workspaceRoot: '' });

      rpcCall.mockImplementation(
        (
          method: string,
          // payload typed loosely; the test asserts shape via inspection.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          _payload: any,
        ): Promise<{ success: boolean; data?: unknown }> => {
          if (method === 'workspace:getInfo') {
            return Promise.resolve({
              success: true,
              data: { activeFolder: 'D:/test', folders: ['D:/test'] },
            });
          }
          if (method === 'session:validate') {
            return Promise.resolve({ success: true, data: { exists: true } });
          }
          return Promise.resolve({ success: true });
        },
      );

      await service.send('hello again');

      const callOrder = rpcCall.mock.calls.map((c) => c[0]);
      // workspace:getInfo MUST come before session:validate, and BOTH must
      // come before chat:continue (the actual send).
      const getInfoIdx = callOrder.indexOf('workspace:getInfo');
      const validateIdx = callOrder.indexOf('session:validate');
      const continueIdx = callOrder.indexOf('chat:continue');
      expect(getInfoIdx).toBeGreaterThanOrEqual(0);
      expect(validateIdx).toBeGreaterThan(getInfoIdx);
      expect(continueIdx).toBeGreaterThan(validateIdx);

      // session:validate must have been called with the workspace path
      // resolved from workspace:getInfo, NOT the empty cached one.
      const validateCall = rpcCall.mock.calls.find(
        (c) => c[0] === 'session:validate',
      );
      expect(validateCall?.[1]).toEqual(
        expect.objectContaining({
          sessionId: 'sess-X',
          workspacePath: 'D:/test',
        }),
      );

      // chat:continue must carry the resolved workspacePath so the backend
      // doesn't drift to a different one mid-flight.
      const continueCall = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:continue',
      );
      expect(continueCall?.[1]).toEqual(
        expect.objectContaining({ workspacePath: 'D:/test' }),
      );
    });

    it('still fires chat:continue with workspacePath omitted when workspace:getInfo also returns empty', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      vscodeConfig.mockReturnValue({ workspaceRoot: '' });

      rpcCall.mockImplementation(
        (
          method: string,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          _payload: any,
        ): Promise<{ success: boolean; data?: unknown }> => {
          if (method === 'workspace:getInfo') {
            // Both activeFolder and folders empty — backend has no workspace
            // either. We must NOT bail (that was the regression); the request
            // should still go through and let the backend surface the error.
            return Promise.resolve({
              success: true,
              data: { activeFolder: undefined, folders: [], root: undefined },
            });
          }
          // session:validate must NOT be called when we have no workspace
          // path to feed it; the test below asserts that.
          return Promise.resolve({ success: true });
        },
      );

      await service.send('hello again');

      const callOrder = rpcCall.mock.calls.map((c) => c[0]);
      expect(callOrder).toContain('workspace:getInfo');
      expect(callOrder).not.toContain('session:validate');
      expect(callOrder).toContain('chat:continue');

      const continueCall = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:continue',
      );
      // workspacePath must be omitted (or undefined) so backend falls back
      // to IWorkspaceProvider.getWorkspaceRoot().
      expect(
        (continueCall?.[1] as Record<string, unknown>)['workspacePath'],
      ).toBeUndefined();
      // And we must NOT have started a new conversation — the contract is
      // "send anyway, let the backend surface the error".
      expect(callOrder).not.toContain('chat:start');
    });

    it('happy path: cached workspaceRoot present → ZERO extra RPC calls (no workspace:getInfo)', async () => {
      // Guard against regression in the other direction: if the cached
      // workspaceRoot is populated, we MUST NOT incur the extra
      // workspace:getInfo roundtrip on every continueConversation send.
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      vscodeConfig.mockReturnValue({ workspaceRoot: 'D:/repo' });

      rpcCall.mockImplementation(
        (
          method: string,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          _payload: any,
        ): Promise<{ success: boolean; data?: unknown }> => {
          if (method === 'session:validate') {
            return Promise.resolve({ success: true, data: { exists: true } });
          }
          return Promise.resolve({ success: true });
        },
      );

      await service.send('hello again');

      const callOrder = rpcCall.mock.calls.map((c) => c[0]);
      expect(callOrder).not.toContain('workspace:getInfo');
      expect(callOrder).toEqual(['session:validate', 'chat:continue']);

      // session:validate uses the cached path directly.
      const validateCall = rpcCall.mock.calls.find(
        (c) => c[0] === 'session:validate',
      );
      expect(validateCall?.[1]).toEqual(
        expect.objectContaining({ workspacePath: 'D:/repo' }),
      );
    });
  });

  // TASK_2026_592 MOD-3: closing a tab aborts its stream through the listener
  // `wireAbortDispatch` installs. During the first turn no session id is bound
  // yet; the backend registers that turn's record under the tab id, so the tab
  // id must be sent instead of nothing (otherwise the process leaks).
  describe('abort listener (tab close)', () => {
    function wireAndAbort(tabId: string): void {
      const controller = new AbortController();
      tabManager.createAbortController.mockReturnValueOnce(controller.signal);
      (
        service as unknown as { wireAbortDispatch(id: string): AbortSignal }
      ).wireAbortDispatch(tabId);
      controller.abort();
    }

    beforeEach(() => {
      rpcCall.mockImplementation(() => Promise.resolve({ success: true }));
    });

    it('turn-1 close (no session id yet) sends chat:abort with the tab id', () => {
      const tabId = '33333333-3333-4333-8333-333333333333';
      tabsSignal.set([makeTab({ id: tabId, claudeSessionId: null })]);

      wireAndAbort(tabId);

      const aborts = rpcCall.mock.calls.filter((c) => c[0] === 'chat:abort');
      expect(aborts).toHaveLength(1);
      expect(aborts[0][1]).toEqual({ sessionId: tabId });
    });

    it('with a bound session id it still sends the session id', () => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);

      wireAndAbort('tab-1');

      const aborts = rpcCall.mock.calls.filter((c) => c[0] === 'chat:abort');
      expect(aborts).toHaveLength(1);
      expect(aborts[0][1]).toEqual({ sessionId: 'sess-X' });
    });
  });

  describe('abort listener (superseded by a newer send)', () => {
    it('does not send chat:abort when the controller was replaced, not closed', () => {
      rpcCall.mockImplementation(() => Promise.resolve({ success: true }));
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      const controller = new AbortController();
      tabManager.createAbortController.mockReturnValueOnce(controller.signal);
      (
        service as unknown as { wireAbortDispatch(id: string): AbortSignal }
      ).wireAbortDispatch('tab-1');

      controller.abort(ABORT_REASON_SUPERSEDED);

      expect(rpcCall.mock.calls.filter((c) => c[0] === 'chat:abort')).toEqual(
        [],
      );
    });
  });

  describe('submitQueuedFollowUp', () => {
    const queuedInput = () => ({
      content: 'queued',
      sessionId: 'sess-X' as SessionId,
      tabId: 'tab-1',
      clientMessageId: 'message-1',
    });

    it('submits the captured session and tab directly to the backend queue without changing the renderer stream', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X', status: 'streaming' })]);
      rpcCall.mockResolvedValue({ success: true, data: { success: true, queueState: 'queued' } });

      await expect(service.submitQueuedFollowUp({
        ...queuedInput(),
        options: {
          files: ['a.ts', 'b.ts'],
          images: [{ data: 'base64', mediaType: 'image/png' }],
          effort: 'high',
        },
      })).resolves.toEqual({ success: true, data: { success: true, queueState: 'queued' } });

      expect(rpcCall).toHaveBeenCalledWith('chat:continue', expect.objectContaining({
        prompt: 'queued', sessionId: 'sess-X', tabId: 'tab-1',
        clientMessageId: 'message-1', queueIntent: 'next-turn',
        files: ['a.ts', 'b.ts'],
        images: [{ data: 'base64', mediaType: 'image/png' }],
        effort: 'high',
      }));
      expect(rpcCall.mock.calls.map((call) => call[0])).toEqual(['chat:continue']);
      expect(tabManager.createAbortController).not.toHaveBeenCalled();
      expect(tabManager.markTabStreaming).not.toHaveBeenCalled();
      expect(tabsSignal()[0].messages).toEqual([]);
      expect(tabsSignal()[0].status).toBe('streaming');
      expect(recordBoundary).not.toHaveBeenCalled();
    });

    it('uses the captured tab even when another tab is active', async () => {
      tabsSignal.set([
        makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' }),
        makeTab({ id: 'tab-2', claudeSessionId: 'sess-Y' }),
      ]);
      activeTabIdSignal.set('tab-2');
      rpcCall.mockResolvedValue({ success: true, data: { success: true, queueState: 'queued' } });

      await service.submitQueuedFollowUp(queuedInput());

      expect(rpcCall).toHaveBeenCalledWith('chat:continue', expect.objectContaining({
        sessionId: 'sess-X', tabId: 'tab-1', clientMessageId: 'message-1',
        queueIntent: 'next-turn',
      }));
      expect(tabsSignal().every((tab) => tab.messages.length === 0)).toBe(true);
    });

    it('leaves failed acceptance to the queue service without writing a bubble', async () => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      rpcCall.mockResolvedValue({ success: false, error: 'rejected' });

      await expect(service.submitQueuedFollowUp(queuedInput())).resolves.toEqual({
        success: false, error: 'rejected',
      });
      expect(tabsSignal()[0].messages).toEqual([]);
      expect(recordBoundary).not.toHaveBeenCalled();
      expect(removeBoundary).not.toHaveBeenCalled();
    });
  });

  describe('ultracode keyword injection', () => {
    // Ultracode mode stamps outgoing human input with the `ultracode` keyword
    // so the backend SDK plans a workflow per task. The keyword rides on the
    // sanitized content, so it reaches both the chat:start prompt and the
    // visible user bubble. When off (default), messages are untouched.
    let ultracode: UltracodeStateService;

    beforeEach(() => {
      ultracode = TestBed.inject(UltracodeStateService);
    });

    afterEach(async () => {
      // Reset the session-scoped flag so it does not leak across specs.
      await ultracode.disable();
    });

    it('does NOT modify the prompt when ultracode is off (default)', async () => {
      rpcCall.mockResolvedValue({ success: true });
      await service.send('plain message');

      const [, payload] = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:start',
      ) as [string, { prompt: string }];
      expect(payload['prompt']).toBe('plain message');
    });

    it('prefixes the outgoing prompt with `ultracode:` when enabled', async () => {
      await ultracode.enable();
      rpcCall.mockResolvedValue({ success: true });

      await service.send('refactor the auth module');

      const [, payload] = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:start',
      ) as [string, { prompt: string }];
      expect(payload['prompt']).toBe('ultracode: refactor the auth module');
    });

    it('does not double-stamp content that already carries the keyword', async () => {
      await ultracode.enable();
      rpcCall.mockResolvedValue({ success: true });

      await service.send('ultracode: already tagged');

      const [, payload] = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:start',
      ) as [string, { prompt: string }];
      expect(payload['prompt']).toBe('ultracode: already tagged');
    });
  });

  // ---------------------------------------------------------------------
  // TASK_2026_865: provider carry-over (offer origin, pending guard and the
  // `/compact` trigger). The real ProviderCarryOverService runs; only the
  // host RPCs are mocked.
  // ---------------------------------------------------------------------
  describe('provider carry-over', () => {
    let carryOver: ProviderCarryOverService;

    const ELIGIBLE_CODEX = rpcSuccess({
      eligible: true,
      providerId: 'openai-codex',
      providerName: 'Codex',
    });
    const STARTED_CODEX = rpcSuccess({
      success: true,
      providerId: 'openai-codex',
      providerName: 'Codex',
    });

    /** Route each host method; unlisted ones get today's happy replies. */
    function routeRpc(replies: Record<string, () => Promise<unknown>>): void {
      rpcCall.mockImplementation((method: string): Promise<unknown> => {
        const reply = replies[method];
        if (reply) return reply();
        if (method === 'session:validate') {
          return Promise.resolve({ success: true, data: { exists: true } });
        }
        if (method === 'chat:continue') {
          return Promise.resolve({ success: true, data: { success: true } });
        }
        return Promise.resolve({ success: true });
      });
    }

    const callsOf = (method: string): unknown[][] =>
      rpcCall.mock.calls.filter((c) => c[0] === method);

    /** `chat:continue` params today's code sends for `prompt` on tab-1. */
    const todaysContinueParams = (prompt: string): Record<string, unknown> => ({
      prompt,
      sessionId: 'sess-X',
      tabId: 'tab-1',
      clientMessageId: expect.any(String),
      name: 'Old chat',
      workspacePath: 'D:/repo',
      model: 'claude-opus-4',
      files: [],
      effort: 'medium',
    });

    beforeEach(() => {
      carryOver = TestBed.inject(ProviderCarryOverService);
      tabsSignal.set([
        makeTab({
          id: 'tab-1',
          claudeSessionId: 'sess-X',
          name: 'Old chat',
          providerId: 'anthropic',
        }),
        makeTab({ id: 'tab-2', claudeSessionId: 'sess-Y', name: 'Other' }),
      ]);
      activeProvider.set('openai-codex');
    });

    describe('offer origin on a refused continue', () => {
      const REFUSED = {
        success: true,
        data: {
          success: false,
          errorCode: 'AUTH_REQUIRED',
          error: 'Sign in to Claude',
          providerId: 'anthropic',
        },
      };

      it('binds the banner to the chat and asks for one offer (AC 1.1, 7.1)', async () => {
        const offerFor = jest
          .spyOn(carryOver, 'offerFor')
          .mockResolvedValue(undefined);
        flagAuthRequired.mockReturnValue(7);
        routeRpc({ 'chat:continue': () => Promise.resolve(REFUSED) });

        const outcome = await service.send('hello', { tabId: 'tab-1' });

        expect(outcome).toEqual({ success: false, error: 'Sign in to Claude' });
        expect(flagAuthRequired).toHaveBeenCalledWith(
          'anthropic',
          'Sign in to Claude',
          { sessionId: 'sess-X', tabId: 'tab-1', workspacePath: 'D:/repo' },
        );
        expect(offerFor).toHaveBeenCalledTimes(1);
        expect(offerFor).toHaveBeenCalledWith(7);
      });

      it('keeps the refusal outcome when the offer check fails', async () => {
        jest
          .spyOn(carryOver, 'offerFor')
          .mockRejectedValue(new Error('check failed'));
        routeRpc({ 'chat:continue': () => Promise.resolve(REFUSED) });

        const outcome = await service.send('hello', { tabId: 'tab-1' });
        await Promise.resolve();

        expect(outcome).toEqual({ success: false, error: 'Sign in to Claude' });
        expect(tabsSignal()[0].status).toBe('loaded');
      });

      it('passes no origin on a refused chat:start', async () => {
        const offerFor = jest.spyOn(carryOver, 'offerFor');
        tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: null })]);
        rpcCall.mockResolvedValue(REFUSED);

        await service.send('hello', { tabId: 'tab-1' });

        expect(callsOf('chat:start')).toHaveLength(1);

        expect(flagAuthRequired).toHaveBeenCalledTimes(1);
        expect(flagAuthRequired.mock.calls[0]).toHaveLength(2);
        expect(offerFor).not.toHaveBeenCalled();
      });

      it('passes no origin and sends today\'s /compact when the workspace is unknown (A4)', async () => {
        vscodeConfig.mockReturnValue({ workspaceRoot: '' });
        const offerFor = jest.spyOn(carryOver, 'offerFor');
        routeRpc({
          'workspace:getInfo': () => Promise.resolve({ success: false }),
          'chat:continue': () => Promise.resolve(REFUSED),
        });

        await service.send('/compact', { tabId: 'tab-1' });

        expect(callsOf('chat:carry-over-check')).toHaveLength(0);
        expect(callsOf('chat:continue')).toHaveLength(1);
        expect(flagAuthRequired.mock.calls[0]).toHaveLength(2);
        expect(offerFor).not.toHaveBeenCalled();
      });
    });

    describe('pending guard (F3 Rev 1, AC 5.4)', () => {
      beforeEach(() => {
        jest
          .spyOn(carryOver, 'isPending')
          .mockImplementation((tabId: string) => tabId === 'tab-1');
        routeRpc({});
      });

      it('refuses a continue on the pending tab with no RPC', async () => {
        await expect(
          service.send('hello', { tabId: 'tab-1' }),
        ).resolves.toEqual({ success: false, error: CARRY_OVER_BUSY_TEXT });
        await expect(service.send('/compact')).resolves.toEqual({
          success: false,
          error: CARRY_OVER_BUSY_TEXT,
        });
        expect(rpcCall).not.toHaveBeenCalled();
      });

      it('refuses a start on the pending tab with no RPC', async () => {
        tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: null })]);

        await expect(
          service.send('hello', { tabId: 'tab-1' }),
        ).resolves.toEqual({ success: false, error: CARRY_OVER_BUSY_TEXT });
        expect(rpcCall).not.toHaveBeenCalled();
      });

      it('still sends on another tab', async () => {
        await expect(
          service.send('hello', { tabId: 'tab-2' }),
        ).resolves.toEqual({ success: true });
        expect(callsOf('chat:continue')).toHaveLength(1);
      });
    });

    describe('/compact trigger', () => {
      it('Claude -> Codex: one chat:carry-over, no chat:continue, no bubble (9.1, 9.2, 9.5)', async () => {
        routeRpc({
          'chat:carry-over-check': () => Promise.resolve(ELIGIBLE_CODEX),
          'chat:carry-over': () => Promise.resolve(STARTED_CODEX),
        });

        await expect(
          service.send('/compact', { tabId: 'tab-1' }),
        ).resolves.toEqual({ success: true });

        expect(callsOf('chat:carry-over-check')).toEqual([
          [
            'chat:carry-over-check',
            { sessionId: 'sess-X', workspacePath: 'D:/repo' },
            { timeout: CARRY_OVER_CHECK_TIMEOUT_MS },
          ],
        ]);
        expect(callsOf('chat:carry-over')).toHaveLength(1);
        expect(callsOf('chat:carry-over')[0][1]).toEqual({
          sessionId: 'sess-X',
          tabId: 'tab-1',
          workspacePath: 'D:/repo',
          name: 'Old chat',
          requestId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          ),
        });
        expect(callsOf('chat:continue')).toHaveLength(0);
        expect(tabsSignal()[0].messages).toEqual([]);
        expect(recordBoundary).not.toHaveBeenCalled();
        expect(tabManager.markResuming).not.toHaveBeenCalled();
        expect(carryOver.isPending('tab-1')).toBe(true);
      });

      it('Codex -> Claude: the same path for a native Codex chat (RPC mocked)', async () => {
        tabsSignal.set([
          makeTab({
            id: 'tab-1',
            claudeSessionId: 'sess-X',
            name: 'Old chat',
            providerId: 'openai-codex',
          }),
        ]);
        activeProvider.set('anthropic');
        routeRpc({
          'chat:carry-over-check': () =>
            Promise.resolve(
              rpcSuccess({
                eligible: true,
                providerId: 'anthropic',
                providerName: 'Claude',
              }),
            ),
          'chat:carry-over': () =>
            Promise.resolve(
              rpcSuccess({
                success: true,
                providerId: 'anthropic',
                providerName: 'Claude',
              }),
            ),
        });

        await expect(
          service.send('/compact', { tabId: 'tab-1' }),
        ).resolves.toEqual({ success: true });

        expect(callsOf('chat:carry-over')).toHaveLength(1);
        expect(callsOf('chat:continue')).toHaveLength(0);
        expect(tabsSignal()[0].messages).toEqual([]);
      });

      it.each<{ label: string; check: () => Promise<unknown> }>([
        {
          label: 'not eligible',
          check: () => Promise.resolve(rpcSuccess({ eligible: false })),
        },
        {
          label: 'a check RPC error',
          check: () => Promise.resolve(rpcError('Internal error')),
        },
        {
          label: 'a check timeout',
          check: () => Promise.resolve(rpcError('Request timed out')),
        },
        {
          label: 'a thrown check',
          check: () => Promise.reject(new Error('socket closed')),
        },
      ])(
        '$label with no known provider mismatch sends today\'s chat:continue (AC 1.5, 9.3)',
        async ({ check }) => {
          tabsSignal.set([
            makeTab({ id: 'tab-1', claudeSessionId: 'sess-X', name: 'Old chat' }),
          ]);
          routeRpc({ 'chat:carry-over-check': check });

          await expect(
            service.send('/compact', { tabId: 'tab-1' }),
          ).resolves.toEqual({ success: true });

          expect(callsOf('chat:carry-over')).toHaveLength(0);
          expect(callsOf('chat:continue')).toHaveLength(1);
          expect(callsOf('chat:continue')[0][1]).toEqual(
            todaysContinueParams('/compact'),
          );
        },
      );

      it('not eligible with a known mismatch still runs today\'s /compact', async () => {
        routeRpc({
          'chat:carry-over-check': () =>
            Promise.resolve(rpcSuccess({ eligible: false })),
        });

        await service.send('/compact', { tabId: 'tab-1' });

        expect(callsOf('chat:continue')).toHaveLength(1);
        expect(callsOf('chat:continue')[0][1]).toEqual(
          todaysContinueParams('/compact'),
        );
      });

      it.each<{ label: string; check: () => Promise<unknown> }>([
        {
          label: 'a check RPC error',
          check: () => Promise.resolve(rpcError('Internal error')),
        },
        {
          label: 'a check timeout',
          check: () => Promise.resolve(rpcError('Request timed out')),
        },
      ])(
        '$label with a known provider mismatch fails closed and sends nothing (P4 = A)',
        async ({ check }) => {
          routeRpc({ 'chat:carry-over-check': check });

          await expect(
            service.send('/compact', { tabId: 'tab-1' }),
          ).resolves.toEqual({
            success: false,
            error: CARRY_OVER_CHECK_FAILED_TEXT,
            errorIsFullText: true,
          });

          expect(callsOf('chat:continue')).toHaveLength(0);
          expect(callsOf('chat:carry-over')).toHaveLength(0);
          expect(tabsSignal()[0].messages).toEqual([]);
          expect(carryOver.isPending('tab-1')).toBe(false);
        },
      );

      it('a failed check with the same known provider runs today\'s /compact', async () => {
        activeProvider.set('anthropic');
        routeRpc({
          'chat:carry-over-check': () =>
            Promise.resolve(rpcError('Request timed out')),
        });

        await service.send('/compact', { tabId: 'tab-1' });

        expect(callsOf('chat:continue')).toHaveLength(1);
      });

      it('a failed check for a background-workspace tab runs today\'s /compact', async () => {
        backgroundTabsSignal.set([
          makeTab({
            id: 'tab-bg',
            claudeSessionId: 'sess-B',
            providerId: 'anthropic',
          }),
        ]);
        routeRpc({
          'chat:carry-over-check': () =>
            Promise.resolve(rpcError('Request timed out')),
        });

        await service.send('/compact', { tabId: 'tab-bg' });

        expect(callsOf('chat:continue')).toHaveLength(1);
      });

      it('redirects /compact with arguments and does not forward them (K21)', async () => {
        routeRpc({
          'chat:carry-over-check': () => Promise.resolve(ELIGIBLE_CODEX),
          'chat:carry-over': () => Promise.resolve(STARTED_CODEX),
        });

        await service.send('/compact focus on tests', { tabId: 'tab-1' });

        expect(callsOf('chat:carry-over')).toHaveLength(1);
        expect(JSON.stringify(callsOf('chat:carry-over')[0][1])).not.toContain(
          'focus on tests',
        );
        expect(callsOf('chat:continue')).toHaveLength(0);
      });

      it.each(['/compactx', '/compact\nfoo', 'ultracode: /compact'])(
        'does not redirect %j',
        async (prompt) => {
          routeRpc({
            'chat:carry-over-check': () => Promise.resolve(ELIGIBLE_CODEX),
          });

          await service.send(prompt, { tabId: 'tab-1' });

          expect(callsOf('chat:carry-over-check')).toHaveLength(0);
          expect(callsOf('chat:continue')).toHaveLength(1);
        },
      );

      it('gives the busy outcome when the session is already carried over elsewhere', async () => {
        jest.spyOn(carryOver, 'isBusy').mockReturnValue(true);
        routeRpc({
          'chat:carry-over-check': () => Promise.resolve(ELIGIBLE_CODEX),
        });

        await expect(
          service.send('/compact', { tabId: 'tab-1' }),
        ).resolves.toEqual({ success: false, error: CARRY_OVER_BUSY_TEXT });

        expect(callsOf('chat:carry-over')).toHaveLength(0);
        expect(callsOf('chat:continue')).toHaveLength(0);
      });

      it('returns a carry-over failure as the send failure', async () => {
        routeRpc({
          'chat:carry-over-check': () => Promise.resolve(ELIGIBLE_CODEX),
          'chat:carry-over': () =>
            Promise.resolve(
              rpcSuccess({
                success: false,
                reason: 'HISTORY_UNREADABLE',
                error: 'unreadable',
              }),
            ),
        });

        const outcome = await service.send('/compact', { tabId: 'tab-1' });

        expect(outcome.success).toBe(false);
        expect(outcome.error).toEqual(expect.any(String));
        expect(callsOf('chat:continue')).toHaveLength(0);
      });

      it('never checks eligibility for a plain prompt', async () => {
        routeRpc({});

        await service.send('hello again', { tabId: 'tab-1' });

        expect(callsOf('chat:carry-over-check')).toHaveLength(0);
        expect(callsOf('chat:continue')).toHaveLength(1);
      });
    });
  });
});
