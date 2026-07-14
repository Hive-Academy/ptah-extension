/**
 * MessageSenderService specs â€” mediator that routes send/continue based on
 * whether the target tab already has a claudeSessionId.
 *
 * Coverage focuses on:
 *   - send(): validates & sanitizes, routes to startNewConversation when
 *     there is no session, to continueConversation when one exists
 *   - startNewConversation (happy path): auto-name, chat:start RPC payload
 *     including effective model/effort, user message appended
 *   - startNewConversation (RPC failure): marks loaded + failSession()
 *   - startNewConversation (no workspace): still calls chat:start with
 *     workspacePath omitted so the backend can fall back to
 *     IWorkspaceProvider.getWorkspaceRoot() — fixes the bootstrap-restore
 *     race where Send was clicked before workspace info arrived
 *   - tabId option scopes to a non-active tab (canvas tile isolation)
 *
 * The full continueConversation path involves SessionManager state machine +
 * backend resume semantics â€” out of scope for this unit spec; covered by the
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
import { TabManagerService } from '@ptah-extension/chat-state';
import { SessionManager } from '@ptah-extension/chat-streaming';
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
  let flagAuthRequired: jest.Mock;
  let vscodeConfig: jest.Mock;
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    tabsSignal = signal<TabState[]>([makeTab({ id: 'tab-1' })]);
    activeTabIdSignal = signal<string | null>('tab-1');

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
      activeTab: computed(
        () => tabsSignal().find((t) => t.id === activeTabIdSignal()) ?? null,
      ),
      createTab: jest.fn(() => 'tab-new'),
      switchTab: jest.fn(),
      markTabStreaming: jest.fn(),
      markTabIdle: jest.fn(),
      consumeFirstMessagePreamble: jest.fn(() => null),
      // Stub returns a real AbortSignal so the wireAbortDispatch listener
      // can attach without throwing.
      createAbortController: jest.fn(() => new AbortController().signal),
      // No existing controller tracked by default; individual tests override
      // this to simulate an in-flight (still-tracked) AbortController.
      getAbortSignal: jest.fn(() => undefined),
      applyNewConversationStreaming: jest.fn((tabId: string, name: string) =>
        applyPatch(tabId, {
          name,
          title: name,
          status: 'streaming',
        } as Partial<TabState>),
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
    flagAuthRequired = jest.fn();
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
          useValue: {
            currentModel: jest.fn(() => 'claude-opus-4'),
            availableModels: jest.fn(() => [
              { id: 'claude-opus-4', name: 'Claude Opus 4', isSelected: true },
            ]),
          },
        },
        {
          provide: EffortStateService,
          useValue: { currentEffort: jest.fn(() => 'medium') },
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

    it('auto-names the tab from the first 50 chars when name is still "New Chat"', async () => {
      rpcCall.mockResolvedValue({ success: true });
      const prompt = 'Explain the new module boundaries in the monorepo';
      await service.send(prompt);

      expect(tabManager.applyNewConversationStreaming).toHaveBeenCalledWith(
        'tab-1',
        prompt.substring(0, 50).trim(),
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
});
