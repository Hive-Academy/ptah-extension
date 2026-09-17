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
} from '@ptah-extension/core';
import { MessageSenderService } from './message-sender.service';
import { UltracodeStateService } from './ultracode-state.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { MessageValidationService } from './message-validation.service';
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
    markStreaming: jest.Mock;
    markResuming: jest.Mock;
    detachSessionAndMarkLoaded: jest.Mock;
    setMessages: jest.Mock;
    consumeFirstMessagePreamble: jest.Mock;
    findTabByIdAcrossWorkspaces: jest.Mock;
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
  let flagAuthRequired: jest.Mock;
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
        const tab =
          tabsSignal().find((t) => t.id === tabId) ??
          backgroundTabsSignal().find((t) => t.id === tabId);
        return tab ? { tab, workspacePath: 'D:/repo' } : null;
      }),
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
    flagAuthRequired = jest.fn();
    vscodeConfig = jest.fn(() => ({ workspaceRoot: 'D:/repo' }));

    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        MessageSenderService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionManager, useValue: sessionManager },
        {
          provide: StreamingHandlerService,
          useValue: {
            recordUserPromptBoundary: recordBoundary,
            removeUserPromptBoundary: removeBoundary,
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
          useValue: {
            currentEffort: jest.fn(() => 'medium'),
            setEffort: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: PtahCliStateService,
          useValue: { selectedAgentId: jest.fn(() => null) },
        },
        {
          provide: AuthStateService,
          useValue: { flagAuthRequired },
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

      it('also removes the bubble when a rejected queue flush re-queues the text', async () => {
        failContinue({ success: true, data: { success: false, error: 'no' } });

        await service.continueExistingSessionForQueueFlush('queued', 'sess-X', {
          tabId: 'tab-1',
        });

        expect(removeBoundary).toHaveBeenCalledWith(
          'tab-1',
          recordedBubbleId(),
        );
        expect(tabsSignal()[0].messages).toEqual([]);
      });

      it('also removes the bubble when a queue flush throws', async () => {
        failContinue(new Error('socket closed'), true);

        await service.continueExistingSessionForQueueFlush('queued', 'sess-X', {
          tabId: 'tab-1',
        });

        expect(removeBoundary).toHaveBeenCalledWith(
          'tab-1',
          recordedBubbleId(),
        );
        expect(tabsSignal()[0].messages).toEqual([]);
      });

      it('rolls nothing back when the continue is delivered', async () => {
        failContinue({ success: true });

        await service.continueExistingSessionForQueueFlush('queued', 'sess-X', {
          tabId: 'tab-1',
        });

        expect(removeBoundary).not.toHaveBeenCalled();
        expect(tabsSignal()[0].messages).toHaveLength(1);
      });

      it('drops the undelivered prompt from a turn that finalized before the flush failed', async () => {
        // Accepted behaviour (TASK_2026_420 round 4, S3): the prompt never
        // reached the backend, so it must not sit between reply parts the
        // model produced without it. The text goes back to the queue.
        let reachContinue!: () => void;
        const continueReached = new Promise<void>((resolve) => {
          reachContinue = resolve;
        });
        let rejectContinue!: (reason: unknown) => void;
        rpcCall.mockImplementation((method: string): Promise<unknown> => {
          if (method === 'session:validate') {
            return Promise.resolve({ success: true, data: { exists: true } });
          }
          if (method === 'chat:continue') {
            reachContinue();
            return new Promise((_resolve, reject) => {
              rejectContinue = reject;
            });
          }
          return Promise.resolve({ success: true });
        });

        const pending = service.continueExistingSessionForQueueFlush(
          'queued',
          'sess-X',
          { tabId: 'tab-1' },
        );
        await continueReached;

        // The interrupted turn finalizes while `chat:continue` is in flight.
        const bubble = tabsSignal()[0].messages[0];
        expect(bubble.id).toBe(recordedBubbleId());
        const before = {
          id: 'before',
          role: 'assistant',
        } as ExecutionChatMessage;
        const after = {
          id: 'after',
          role: 'assistant',
        } as ExecutionChatMessage;
        tabsSignal.update((tabs) =>
          tabs.map((t) =>
            t.id === 'tab-1'
              ? ({
                  ...t,
                  messages: [before, bubble, after],
                  streamingState: null,
                } as TabState)
              : t,
          ),
        );

        rejectContinue(new Error('socket closed'));

        await expect(pending).resolves.toEqual(
          expect.objectContaining({ success: false }),
        );
        expect(removeBoundary).toHaveBeenCalledWith('tab-1', bubble.id);
        const messages = tabsSignal()[0].messages;
        expect(messages.map((m) => m.id)).toEqual(['before', 'after']);
        expect(messages[0]).toBe(before);
        expect(messages[1]).toBe(after);
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
      expect(payload.prompt).toBe(
        'COUNCIL FRAMING\nObjective:\n\ncompare the two designs',
      );

      // The visible bubble stays the user's plain text — no framing leak.
      const [, msgs] = tabManager.appendUserMessageAndResetStreaming.mock
        .calls[0] as [string, ExecutionChatMessage[]];
      expect(msgs[0].rawContent).toBe('compare the two designs');
    });

    it('sends the raw content as prompt when no preamble is set', async () => {
      rpcCall.mockResolvedValue({ success: true });
      // default mock returns null (no preamble)
      await service.send('plain question');

      const [, payload] = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:start',
      ) as [string, { prompt: string }];
      expect(payload.prompt).toBe('plain question');
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
      expect(payload.prompt).toBe('hello');
      // workspacePath is either omitted entirely or explicitly undefined;
      // both forms let the backend resolve via IWorkspaceProvider.
      expect(payload.workspacePath).toBeUndefined();
      // No "No workspace path" warning — that early-return was the bug.
      expect(consoleWarn).not.toHaveBeenCalledWith(
        expect.stringContaining('No workspace path'),
      );
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
        (continueCall?.[1] as Record<string, unknown>).workspacePath,
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

  describe('continueExistingSessionForQueueFlush', () => {
    // The post-stream queue flush (`MessageDispatchService.sendQueuedMessage`)
    // fires on turn-end while the previous stream's AbortController may still
    // be tracked. The dedicated flush method must NOT call
    // `createAbortController` (which aborts the existing controller → fires
    // the previous `wireAbortDispatch` abort listener → stray `chat:abort`
    // RPC → session killed). Instead it reuses the existing signal when one
    // is tracked, or sends with no signal when the controller was already
    // cleared by finalization. Stop-button / tab-close still work because the
    // reused controller remains tracked by TabManagerService.
    beforeEach(() => {
      tabsSignal.set([makeTab({ id: 'tab-1', claudeSessionId: 'sess-X' })]);
      rpcCall.mockImplementation(
        (method: string): Promise<{ success: boolean; data?: unknown }> => {
          if (method === 'session:validate') {
            return Promise.resolve({ success: true, data: { exists: true } });
          }
          return Promise.resolve({ success: true });
        },
      );
    });

    it('reuses the existing AbortSignal and does NOT call createAbortController', async () => {
      const existing = new AbortController();
      tabManager.getAbortSignal.mockReturnValue(existing.signal);

      await service.continueExistingSessionForQueueFlush('queued', 'sess-X', {
        tabId: 'tab-1',
      });

      expect(tabManager.createAbortController).not.toHaveBeenCalled();
      // The chat:continue RPC must carry the reused signal so stop/close still
      // cancels the in-flight request.
      const continueCall = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:continue',
      );
      expect(continueCall?.[2]).toEqual(
        expect.objectContaining({ signal: existing.signal }),
      );
    });

    it('sends with no signal when no existing controller is tracked (already finalized)', async () => {
      tabManager.getAbortSignal.mockReturnValue(undefined);

      await service.continueExistingSessionForQueueFlush('queued', 'sess-X', {
        tabId: 'tab-1',
      });

      // Clean tab — must NOT install a fresh controller (that would be the
      // old band-aid behavior that risks aborting a still-tracked controller
      // in the race window).
      expect(tabManager.createAbortController).not.toHaveBeenCalled();
      const continueCall = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:continue',
      );
      // signal is undefined — the RPC layer treats an absent signal as
      // non-cancellable, which is fine here because finalization already
      // cleared the controller.
      expect(continueCall?.[2]).toEqual(
        expect.objectContaining({ signal: undefined }),
      );
    });

    it('forwards files, images, and effort to the chat:continue payload', async () => {
      tabManager.getAbortSignal.mockReturnValue(undefined);

      await service.continueExistingSessionForQueueFlush('queued', 'sess-X', {
        tabId: 'tab-1',
        files: ['a.ts', 'b.ts'],
        images: [{ data: 'base64', mediaType: 'image/png' }],
        effort: 'high',
      });

      const continueCall = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:continue',
      );
      expect(continueCall?.[1]).toEqual(
        expect.objectContaining({
          prompt: 'queued',
          sessionId: 'sess-X',
          tabId: 'tab-1',
          files: ['a.ts', 'b.ts'],
          images: [{ data: 'base64', mediaType: 'image/png' }],
          effort: 'high',
        }),
      );
    });

    it('reused signal is not pre-aborted (clean handoff, stop button still works)', async () => {
      const existing = new AbortController();
      tabManager.getAbortSignal.mockReturnValue(existing.signal);

      await service.continueExistingSessionForQueueFlush('queued', 'sess-X', {
        tabId: 'tab-1',
      });

      // The previous stream ended cleanly — the reused controller must NOT be
      // aborted, otherwise chat:abort would fire spuriously. The stop button
      // (TabManagerService.abortStreamingForTab) can still abort it later.
      expect(existing.signal.aborted).toBe(false);
      const continueCall = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:continue',
      );
      expect(continueCall?.[2]).toEqual(
        expect.objectContaining({ signal: existing.signal }),
      );
    });

    it('default user-initiated send path still calls createAbortController for the stop button', async () => {
      // Guard: the queue-flush specialization must NOT regress the regular
      // continueConversation path, which still wires a fresh AbortController
      // so the stop button / tab-close can cancel the new stream.
      await service.send('follow up', { tabId: 'tab-1' });

      expect(tabManager.createAbortController).toHaveBeenCalledWith('tab-1');
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
      expect(payload.prompt).toBe('plain message');
    });

    it('prefixes the outgoing prompt with `ultracode:` when enabled', async () => {
      await ultracode.enable();
      rpcCall.mockResolvedValue({ success: true });

      await service.send('refactor the auth module');

      const [, payload] = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:start',
      ) as [string, { prompt: string }];
      expect(payload.prompt).toBe('ultracode: refactor the auth module');
    });

    it('does not double-stamp content that already carries the keyword', async () => {
      await ultracode.enable();
      rpcCall.mockResolvedValue({ success: true });

      await service.send('ultracode: already tagged');

      const [, payload] = rpcCall.mock.calls.find(
        (c) => c[0] === 'chat:start',
      ) as [string, { prompt: string }];
      expect(payload.prompt).toBe('ultracode: already tagged');
    });
  });
});
