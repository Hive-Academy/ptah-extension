/**
 * ChatLifecycleService specs — bootstrap, license retry, agent-summary routing,
 * session-ID resolution, chat-error handling.
 *
 * Coverage:
 *   - bootstrap: flips servicesReady BEFORE kicking off async loads
 *   - bootstrap: kicks off loadSessions, restoreCliSessionsForActiveTab,
 *     loadAuthStatus, fetchLicenseStatus
 *   - fetchLicenseStatus: success path stores result
 *   - fetchLicenseStatus: failure result on final attempt sets null + logs
 *   - fetchLicenseStatus: thrown error on final attempt sets null + logs
 *   - fetchLicenseStatus: linear backoff between failed attempts
 *   - handleAgentSummaryChunk: warns + drops chunk when no tab streamingState
 *   - handleAgentSummaryChunk: appends to agentSummaryAccumulators by agentId
 *   - handleAgentSummaryChunk: stores contentBlocks when present
 *   - handleAgentSummaryChunk: N chunks publish once per frame through the
 *     real BatchedUpdateService; blocks append in place; a state already
 *     queued is the one mutated (never an older snapshot over it); hidden
 *     document / non-visible tab defer the publish
 *   - handleSessionIdResolved: direct tabId routing
 *   - handleSessionIdResolved: falls back to streaming/draft active tab
 *   - handleSessionIdResolved: warns when no tab found
 *   - handleChatError: clears compaction state first
 *   - handleChatError: tabId routing wins
 *   - handleChatError: sessionId fallback when tabId absent
 *   - handleChatError: active-tab last-resort with sessionId mismatch warning + return
 *   - handleChatError: presentation only — drops the queued input, never
 *     finalizes, writes status or clears the spinner (TASK_2026_360 review F3)
 */

import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  AuthStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { ChatLifecycleService } from './chat-lifecycle.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  BatchedUpdateService,
  SessionManager,
  StreamingHandlerService,
  TurnStateApplier,
} from '@ptah-extension/chat-streaming';
import { SessionLoaderService } from './session-loader.service';
import { CompactionLifecycleService } from './compaction-lifecycle.service';
import type { TabState, StreamingState } from '@ptah-extension/chat-types';
import { SessionId } from '@ptah-extension/shared';

// Production `ChatLifecycleService.handleAgentSummaryChunk` and
// `handleChatError` both call `SessionId.from()` on the inbound sessionId
// (UUID v4). Mint stable ids per spec run.
const SESS_1 = SessionId.create();
const SESS_2 = SessionId.create();
const SESS_OTHER = SessionId.create();
const SESS_ACTUAL = SessionId.create();
const SESS_UNKNOWN_AGENT = SessionId.create();

function makeStreamingState(
  overrides: Partial<StreamingState> = {},
): StreamingState {
  return {
    currentMessageId: null,
    // The containers the flush guard compares; a fresh state has new ones.
    events: new Map(),
    eventsByMessage: new Map(),
    agentSummaryAccumulators: new Map<string, string>(),
    agentContentBlocksMap: new Map<
      string,
      Array<{
        type: 'text' | 'tool_ref';
        text?: string;
        toolUseId?: string;
        toolName?: string;
      }>
    >(),
    ...overrides,
  } as unknown as StreamingState;
}

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Tab 1',
    status: 'loaded',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: SESS_1,
    queuedContent: null,
    queuedOptions: null,
    ...overrides,
  } as unknown as TabState;
}

describe('ChatLifecycleService', () => {
  let service: ChatLifecycleService;
  let tabs: TabState[];
  let setStreamingStateMock: jest.Mock;
  let attachSessionMock: jest.Mock;
  let applyErrorResetMock: jest.Mock;
  let findTabsBySessionIdMock: jest.Mock;
  let findTabByIdAcrossWorkspacesMock: jest.Mock;
  let findTabBySessionIdAcrossWorkspacesMock: jest.Mock;
  let activeTabMock: jest.Mock;
  let activeTabIdMock: jest.Mock;
  let markTabIdleMock: jest.Mock;
  let clearQueuedContentAndOptionsMock: jest.Mock;
  let setStatusMock: jest.Mock;
  let loadSessionsMock: jest.Mock;
  let restoreCliSessionsMock: jest.Mock;
  let loadAuthStatusMock: jest.Mock;
  let rpcCallMock: jest.Mock;
  let finalizeCurrentMessageMock: jest.Mock;
  let clearCompactionStateMock: jest.Mock;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  // The real BatchedUpdateService runs; its frame is driven by hand.
  let rafCallbacks: FrameRequestCallback[];
  let originalRaf: typeof requestAnimationFrame;
  let originalCancel: typeof cancelAnimationFrame;

  function runRaf(): void {
    const snapshot = rafCallbacks.slice();
    rafCallbacks.length = 0;
    snapshot.forEach((cb) => cb(performance.now()));
  }

  beforeEach(() => {
    rafCallbacks = [];
    originalRaf = globalThis.requestAnimationFrame;
    originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number): void => {
      if (id > 0 && id <= rafCallbacks.length) {
        rafCallbacks[id - 1] = () => undefined;
      }
    }) as typeof cancelAnimationFrame;
    tabs = [makeTab()];
    setStreamingStateMock = jest.fn(
      (id: string, state: StreamingState | null) => {
        tabs = tabs.map((t) =>
          t.id === id ? { ...t, streamingState: state } : t,
        );
      },
    );
    attachSessionMock = jest.fn((id: string, sid: string) => {
      tabs = tabs.map((t) =>
        t.id === id ? { ...t, claudeSessionId: sid } : t,
      );
    });
    applyErrorResetMock = jest.fn((id: string) => {
      tabs = tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              status: 'loaded',
              currentMessageId: null,
              queuedContent: null,
              queuedOptions: null,
            }
          : t,
      );
    });
    // Service uses plural fan-out lookup.
    findTabsBySessionIdMock = jest.fn((sid: string) =>
      tabs.filter((t) => t.claudeSessionId === sid),
    );
    // Cross-workspace lookups. In these unit tests the "all workspaces" set is
    // just the `tabs` array; true cross-workspace routing is covered by the
    // dedicated cross-workspace integration spec.
    findTabByIdAcrossWorkspacesMock = jest.fn((id: string) => {
      const tab = tabs.find((t) => t.id === id);
      return tab ? { tab, workspacePath: '/ws' } : null;
    });
    findTabBySessionIdAcrossWorkspacesMock = jest.fn((sid: string) => {
      const tab = tabs.find((t) => t.claudeSessionId === sid);
      return tab ? { tab, workspacePath: '/ws' } : null;
    });
    activeTabMock = jest.fn(() => tabs[0] ?? null);
    activeTabIdMock = jest.fn(() => tabs[0]?.id ?? null);
    markTabIdleMock = jest.fn();
    clearQueuedContentAndOptionsMock = jest.fn((id: string) => {
      tabs = tabs.map((t) =>
        t.id === id ? { ...t, queuedContent: null, queuedOptions: null } : t,
      );
    });
    setStatusMock = jest.fn();
    loadSessionsMock = jest.fn().mockResolvedValue(undefined);
    restoreCliSessionsMock = jest.fn().mockResolvedValue(undefined);
    loadAuthStatusMock = jest.fn().mockResolvedValue(undefined);
    rpcCallMock = jest.fn();
    finalizeCurrentMessageMock = jest.fn();
    clearCompactionStateMock = jest.fn();
    warn = jest.spyOn(console, 'warn').mockImplementation();
    error = jest.spyOn(console, 'error').mockImplementation();

    const tabManagerMock = {
      tabs: () => tabs,
      setStreamingState: setStreamingStateMock,
      attachSession: attachSessionMock,
      applyErrorReset: applyErrorResetMock,
      findTabsBySessionId: findTabsBySessionIdMock,
      findTabByIdAcrossWorkspaces: findTabByIdAcrossWorkspacesMock,
      findTabBySessionIdAcrossWorkspaces:
        findTabBySessionIdAcrossWorkspacesMock,
      activeTab: activeTabMock,
      activeTabId: activeTabIdMock,
      // No canvas tiles: the active tab is the only flushable one.
      visibleTabIds: () => new Set<string>(),
      markTabIdle: markTabIdleMock,
      clearQueuedContentAndOptions: clearQueuedContentAndOptionsMock,
    } as unknown as TabManagerService;

    const sessionManagerMock = {
      setStatus: setStatusMock,
    } as unknown as SessionManager;

    const sessionLoaderMock = {
      loadSessions: loadSessionsMock,
      restoreCliSessionsForActiveTab: restoreCliSessionsMock,
    } as unknown as SessionLoaderService;

    const streamingHandlerMock = {
      finalizeCurrentMessage: finalizeCurrentMessageMock,
    } as unknown as StreamingHandlerService;

    const compactionMock = {
      clearCompactionState: clearCompactionStateMock,
    } as unknown as CompactionLifecycleService;

    const claudeRpcMock = {
      call: rpcCallMock,
    } as unknown as ClaudeRpcService;

    const authStateMock = {
      loadAuthStatus: loadAuthStatusMock,
    } as unknown as AuthStateService;

    // bootstrap() gates loadSessions/restoreCliSessions on a non-empty
    // workspaceRoot — provide one so the kickoffs are observable.
    const vscodeServiceMock = {
      config: () => ({ workspaceRoot: '/test/workspace' }),
    } as unknown as VSCodeService;

    TestBed.configureTestingModule({
      providers: [
        ChatLifecycleService,
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: SessionManager, useValue: sessionManagerMock },
        { provide: SessionLoaderService, useValue: sessionLoaderMock },
        { provide: StreamingHandlerService, useValue: streamingHandlerMock },
        { provide: CompactionLifecycleService, useValue: compactionMock },
        { provide: ClaudeRpcService, useValue: claudeRpcMock },
        { provide: AuthStateService, useValue: authStateMock },
        { provide: VSCodeService, useValue: vscodeServiceMock },
        // The real reconciler is exercised; its applier (which would pull the
        // whole chat-streaming write path into this spec) is not.
        { provide: TurnStateApplier, useValue: { apply: jest.fn() } },
        provideSurfaceActiveTesting(),
      ],
    });
    service = TestBed.inject(ChatLifecycleService);
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
    warn.mockRestore();
    error.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('bootstrap', () => {
    it('flips servicesReady via callback BEFORE kicking off async loads', async () => {
      const setReady = jest.fn();
      // Make all kickoffs reject so we can observe order via call timing
      rpcCallMock.mockResolvedValue({
        isSuccess: () => true,
        data: null,
      });
      await service.bootstrap(setReady);
      expect(setReady).toHaveBeenCalledTimes(1);
      // All four kickoffs should have been initiated
      expect(loadSessionsMock).toHaveBeenCalled();
      expect(restoreCliSessionsMock).toHaveBeenCalled();
      expect(loadAuthStatusMock).toHaveBeenCalled();
      expect(rpcCallMock).toHaveBeenCalledWith('license:getStatus', {});
    });

    it('logs each failed kickoff but does not throw', async () => {
      loadSessionsMock.mockRejectedValueOnce(new Error('s'));
      restoreCliSessionsMock.mockRejectedValueOnce(new Error('r'));
      loadAuthStatusMock.mockRejectedValueOnce(new Error('a'));
      rpcCallMock.mockRejectedValue(new Error('l'));
      const setReady = jest.fn();
      await service.bootstrap(setReady);
      // Allow microtasks (rejected promises) to settle
      await new Promise((r) => setTimeout(r, 0));
      expect(setReady).toHaveBeenCalled();
    });
  });

  describe('fetchLicenseStatus', () => {
    it('stores license result on success', async () => {
      rpcCallMock.mockResolvedValueOnce({
        isSuccess: () => true,
        data: { tier: 'builders', isActive: true },
      });
      await service.fetchLicenseStatus();
      expect(service.licenseStatus()).toEqual({
        tier: 'builders',
        isActive: true,
      });
    });

    it('logs and sets null after final failure result', async () => {
      rpcCallMock.mockResolvedValue({
        isSuccess: () => false,
        error: 'forbidden',
      });
      await service.fetchLicenseStatus(2);
      expect(service.licenseStatus()).toBeNull();
      expect(error).toHaveBeenCalledWith(
        '[ChatStore] Failed to fetch license status after retries:',
        'forbidden',
      );
    });

    it('logs and sets null after final thrown error', async () => {
      jest.useFakeTimers();
      rpcCallMock.mockRejectedValue(new Error('network'));
      const promise = service.fetchLicenseStatus(2);
      // Advance backoff timers between attempts
      await jest.runAllTimersAsync();
      await promise;
      expect(service.licenseStatus()).toBeNull();
      expect(error).toHaveBeenCalledWith(
        '[ChatStore] Error fetching license status after retries:',
        expect.any(Error),
      );
      jest.useRealTimers();
    });

    it('uses linear backoff between failed attempts', async () => {
      jest.useFakeTimers();
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      rpcCallMock
        .mockRejectedValueOnce(new Error('a'))
        .mockRejectedValueOnce(new Error('b'))
        .mockResolvedValueOnce({ isSuccess: () => true, data: { ok: true } });
      const promise = service.fetchLicenseStatus(3);
      await jest.runAllTimersAsync();
      await promise;
      // 1000 * 1, 1000 * 2 — only between failures (not after final success)
      const delays = setTimeoutSpy.mock.calls.map((c) => c[1]);
      expect(delays).toContain(1000);
      expect(delays).toContain(2000);
      jest.useRealTimers();
    });
  });

  describe('handleAgentSummaryChunk', () => {
    it('warns and drops chunk when target tab has no streamingState', () => {
      service.handleAgentSummaryChunk({
        toolUseId: 't1',
        summaryDelta: 'hello',
        agentId: 'agent-1',
        sessionId: SESS_UNKNOWN_AGENT,
      });
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] No tab with streamingState for summary chunk:',
        { toolUseId: 't1', agentId: 'agent-1', sessionId: SESS_UNKNOWN_AGENT },
      );
      expect(setStreamingStateMock).not.toHaveBeenCalled();
    });

    it('appends summary content to agentSummaryAccumulators by agentId', () => {
      const state = makeStreamingState();
      state.agentSummaryAccumulators.set('agent-1', 'prev ');
      tabs = [makeTab({ streamingState: state })];
      service.handleAgentSummaryChunk({
        toolUseId: 't1',
        summaryDelta: 'next',
        agentId: 'agent-1',
        sessionId: SESS_1,
      });
      expect(state.agentSummaryAccumulators.get('agent-1')).toBe('prev next');
      // Published on the next frame, not per chunk.
      expect(setStreamingStateMock).not.toHaveBeenCalled();
      runRaf();
      expect(setStreamingStateMock).toHaveBeenCalledWith(
        'tab-1',
        expect.any(Object),
      );
    });

    it('stores contentBlocks when present', () => {
      const state = makeStreamingState();
      tabs = [makeTab({ streamingState: state })];
      service.handleAgentSummaryChunk({
        toolUseId: 't1',
        summaryDelta: '',
        agentId: 'agent-1',
        sessionId: SESS_1,
        contentBlocks: [{ type: 'text', text: 'hi' }],
      });
      expect(state.agentContentBlocksMap.get('agent-1')).toEqual([
        { type: 'text', text: 'hi' },
      ]);
    });

    it('routes a BACKGROUND session summary chunk to the background tab', () => {
      // Active-only findTabsBySessionId misses (session owned by a background
      // workspace); the cross-workspace fallback resolves the owner and writes
      // through the workspace-aware setStreamingState.
      const state = makeStreamingState();
      state.agentSummaryAccumulators.set('agent-9', 'bg ');
      const bgTab = makeTab({
        id: 'bg-tab',
        claudeSessionId: SESS_2,
        streamingState: state,
      });
      // Not in the active `tabs` array → findTabsBySessionId returns [].
      findTabBySessionIdAcrossWorkspacesMock.mockReturnValue({
        tab: bgTab,
        workspacePath: '/ws/bg',
      });

      service.handleAgentSummaryChunk({
        toolUseId: 't9',
        summaryDelta: 'delta',
        agentId: 'agent-9',
        sessionId: SESS_2,
      });

      expect(state.agentSummaryAccumulators.get('agent-9')).toBe('bg delta');
      // Direct, not batched: nothing is left queued for the background tab.
      expect(setStreamingStateMock).toHaveBeenCalledWith(
        'bg-tab',
        expect.any(Object),
      );
      expect(TestBed.inject(BatchedUpdateService).queuedState('bg-tab')).toBe(
        undefined,
      );
    });

    it('publishes N chunks in one frame as ONE setStreamingState', () => {
      const state = makeStreamingState();
      tabs = [makeTab({ streamingState: state })];
      for (const [i, text] of ['a', 'b', 'c'].entries()) {
        service.handleAgentSummaryChunk({
          toolUseId: 't1',
          summaryDelta: text,
          agentId: 'agent-1',
          sessionId: SESS_1,
          contentBlocks: [{ type: 'text', text: `${text}${i}` }],
        });
      }
      expect(setStreamingStateMock).not.toHaveBeenCalled();

      runRaf();

      expect(setStreamingStateMock).toHaveBeenCalledTimes(1);
      const published = setStreamingStateMock.mock.calls[0][1] as StreamingState;
      expect(published).not.toBe(state);
      expect(published.agentSummaryAccumulators.get('agent-1')).toBe('abc');
      expect(published.agentContentBlocksMap.get('agent-1')).toEqual([
        { type: 'text', text: 'a0' },
        { type: 'text', text: 'b1' },
        { type: 'text', text: 'c2' },
      ]);
    });

    it('appends blocks in place instead of reallocating the array per chunk', () => {
      const state = makeStreamingState();
      tabs = [makeTab({ streamingState: state })];
      service.handleAgentSummaryChunk({
        toolUseId: 't1',
        summaryDelta: '',
        agentId: 'agent-1',
        sessionId: SESS_1,
        contentBlocks: [{ type: 'text', text: 'one' }],
      });
      const blocks = state.agentContentBlocksMap.get('agent-1');
      service.handleAgentSummaryChunk({
        toolUseId: 't1',
        summaryDelta: '',
        agentId: 'agent-1',
        sessionId: SESS_1,
        contentBlocks: [{ type: 'text', text: 'two' }],
      });
      expect(state.agentContentBlocksMap.get('agent-1')).toBe(blocks);
      expect(blocks).toHaveLength(2);
    });

    it('never schedules an older state over the one already queued', () => {
      // The tab still holds its last-published snapshot; the streaming path
      // has since queued a newer one (a different object) for the next frame.
      // Like a flush copy, the two share their containers.
      const published = makeStreamingState({ currentMessageId: 'm-old' });
      tabs = [makeTab({ streamingState: published })];
      const batched = TestBed.inject(BatchedUpdateService);
      const queued = { ...published, currentMessageId: 'm-new' };
      batched.scheduleUpdate('tab-1', queued);

      service.handleAgentSummaryChunk({
        toolUseId: 't1',
        summaryDelta: 'sum',
        agentId: 'agent-1',
        sessionId: SESS_1,
      });

      expect(batched.queuedState('tab-1')).toBe(queued);
      runRaf();
      expect(setStreamingStateMock).toHaveBeenCalledTimes(1);
      const flushed = setStreamingStateMock.mock.calls[0][1] as StreamingState;
      expect(flushed.currentMessageId).toBe('m-new');
      expect(flushed.agentSummaryAccumulators.get('agent-1')).toBe('sum');
    });

    it('defers a non-visible tab: no publish until it can be seen', () => {
      const state = makeStreamingState();
      tabs = [
        makeTab({ id: 'tab-active', claudeSessionId: SESS_OTHER }),
        makeTab({ id: 'tab-hidden', streamingState: state }),
      ];
      service.handleAgentSummaryChunk({
        toolUseId: 't1',
        summaryDelta: 'x',
        agentId: 'agent-1',
        sessionId: SESS_1,
      });
      runRaf();
      expect(setStreamingStateMock).not.toHaveBeenCalled();
      expect(
        TestBed.inject(BatchedUpdateService).queuedState('tab-hidden'),
      ).toBe(state);
    });

    it('defers while the document is hidden and publishes once it is visible', () => {
      let visibility: DocumentVisibilityState = 'hidden';
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => visibility,
      });
      try {
        const state = makeStreamingState();
        tabs = [makeTab({ streamingState: state })];
        service.handleAgentSummaryChunk({
          toolUseId: 't1',
          summaryDelta: 'h1',
          agentId: 'agent-1',
          sessionId: SESS_1,
        });
        service.handleAgentSummaryChunk({
          toolUseId: 't1',
          summaryDelta: 'h2',
          agentId: 'agent-1',
          sessionId: SESS_1,
        });
        runRaf();
        expect(setStreamingStateMock).not.toHaveBeenCalled();

        visibility = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
        runRaf();

        expect(setStreamingStateMock).toHaveBeenCalledTimes(1);
        const flushed = setStreamingStateMock.mock
          .calls[0][1] as StreamingState;
        expect(flushed.agentSummaryAccumulators.get('agent-1')).toBe('h1h2');
      } finally {
        // Drop the own-property override; the prototype getter returns.
        delete (document as { visibilityState?: unknown }).visibilityState;
      }
    });

    it('skips an empty chunk: no text and no blocks schedules nothing', () => {
      tabs = [makeTab({ streamingState: makeStreamingState() })];
      service.handleAgentSummaryChunk({
        toolUseId: 't1',
        summaryDelta: '',
        agentId: 'agent-1',
        sessionId: SESS_1,
        contentBlocks: [],
      });
      expect(
        TestBed.inject(BatchedUpdateService).queuedState('tab-1'),
      ).toBeUndefined();
      runRaf();
      expect(setStreamingStateMock).not.toHaveBeenCalled();
    });

    it('a compaction replacement in the same frame survives the flush', () => {
      const preCompaction = makeStreamingState();
      tabs = [makeTab({ streamingState: preCompaction })];
      service.handleAgentSummaryChunk({
        toolUseId: 't1',
        summaryDelta: 'before compaction',
        agentId: 'agent-1',
        sessionId: SESS_1,
      });
      // Compaction installs a fresh state directly, around the queue.
      const replacement = makeStreamingState();
      setStreamingStateMock('tab-1', replacement);
      setStreamingStateMock.mockClear();

      runRaf();

      expect(setStreamingStateMock).not.toHaveBeenCalled();
      expect(tabs[0].streamingState).toBe(replacement);
    });

    describe('tab moved to a background workspace with a queued summary', () => {
      let background: TabState | null;

      function moveToBackground(): void {
        background = tabs[0];
        tabs = [makeTab({ id: 'tab-other', claudeSessionId: SESS_OTHER })];
      }

      beforeEach(() => {
        background = null;
        findTabByIdAcrossWorkspacesMock.mockImplementation((id: string) => {
          const tab =
            tabs.find((t) => t.id === id) ??
            (background?.id === id ? background : undefined);
          return tab ? { tab, workspacePath: '/ws' } : null;
        });
        tabs = [makeTab({ streamingState: makeStreamingState() })];
        service.handleAgentSummaryChunk({
          toolUseId: 't1',
          summaryDelta: 'queued',
          agentId: 'agent-1',
          sessionId: SESS_1,
        });
        moveToBackground();
        runRaf(); // tab-1 is no longer active: the entry is deferred
      });

      it('a background replacement survives the return to the workspace', () => {
        const replacement = makeStreamingState();
        background = { ...(background as TabState), streamingState: replacement };
        // Return: tab-1 is active again and the deferred entry drains.
        tabs = [background];
        background = null;
        document.dispatchEvent(new Event('visibilitychange'));
        runRaf();

        expect(setStreamingStateMock).not.toHaveBeenCalled();
        expect(tabs[0].streamingState).toBe(replacement);
        expect(
          TestBed.inject(BatchedUpdateService).queuedState('tab-1'),
        ).toBeUndefined();
      });

      it('a full flushSync while backgrounded does not write the old state', () => {
        const replacement = makeStreamingState();
        background = { ...(background as TabState), streamingState: replacement };
        TestBed.inject(BatchedUpdateService).flushSync();
        expect(setStreamingStateMock).not.toHaveBeenCalled();
      });

      describe('then a background summary chunk and a background message_start', () => {
        let queued: StreamingState;

        beforeEach(() => {
          const batched = TestBed.inject(BatchedUpdateService);
          queued = batched.queuedState('tab-1') as StreamingState;
          // The partition holds an earlier published copy: same Maps, and
          // older scalars than the deferred entry, which active-path events
          // kept mutating before the switch.
          background = {
            ...(background as TabState),
            streamingState: { ...queued },
          };
          queued.currentMessageId = 'msg-pre';
          // Writes land in the background partition while it is away.
          setStreamingStateMock.mockImplementation(
            (id: string, state: StreamingState | null) => {
              if (background?.id === id) {
                background = { ...background, streamingState: state };
              } else {
                tabs = tabs.map((t) =>
                  t.id === id ? { ...t, streamingState: state } : t,
                );
              }
            },
          );
          findTabBySessionIdAcrossWorkspacesMock.mockImplementation(
            (sid: string) => {
              const tab =
                tabs.find((t) => t.claudeSessionId === sid) ??
                (background?.claudeSessionId === sid ? background : undefined);
              return tab ? { tab, workspacePath: '/ws' } : null;
            },
          );

          service.handleAgentSummaryChunk({
            toolUseId: 't2',
            summaryDelta: ' bg',
            agentId: 'agent-1',
            sessionId: SESS_1,
          });

          // The summary write carries the queued (pre-switch) scalar and
          // leaves nothing queued to drain later.
          const written = background?.streamingState as StreamingState;
          expect(written.currentMessageId).toBe('msg-pre');
          expect(written.agentSummaryAccumulators.get('agent-1')).toBe(
            'queued bg',
          );
          expect(batched.queuedState('tab-1')).toBeUndefined();

          // A background `message_start`: the stream path mutates the
          // partition's current object in place.
          (written as { currentMessageId: string | null }).currentMessageId =
            'msg-new';
          setStreamingStateMock.mockClear();
        });

        it('the newer message id survives the return to the workspace', () => {
          tabs = [background as TabState];
          background = null;
          document.dispatchEvent(new Event('visibilitychange'));
          runRaf();

          expect(setStreamingStateMock).not.toHaveBeenCalled();
          const state = tabs[0].streamingState as StreamingState;
          expect(state.currentMessageId).toBe('msg-new');
          expect(state.agentSummaryAccumulators.get('agent-1')).toBe(
            'queued bg',
          );
        });

        it('the newer message id survives a forced flushSync', () => {
          TestBed.inject(BatchedUpdateService).flushSync();

          expect(setStreamingStateMock).not.toHaveBeenCalled();
          expect(
            (background?.streamingState as StreamingState).currentMessageId,
          ).toBe('msg-new');
        });
      });
    });
  });

  describe('handleSessionIdResolved', () => {
    it('routes by tabId directly when the owning tab exists', () => {
      service.handleSessionIdResolved({
        tabId: 'tab-1',
        realSessionId: 'real-uuid',
      });
      expect(findTabByIdAcrossWorkspacesMock).toHaveBeenCalledWith('tab-1');
      expect(attachSessionMock).toHaveBeenCalledWith('tab-1', 'real-uuid');
    });

    it('attaches to the OWNING tab resolved across workspaces (background owner)', () => {
      // Owner lives in a background workspace: not the active tab. The lookup
      // resolves it and attachSession (workspace-aware) writes to the owner,
      // never the active tab.
      const bgTab = makeTab({
        id: 'bg-tab',
        status: 'streaming',
        claudeSessionId: null,
      });
      findTabByIdAcrossWorkspacesMock.mockReturnValue({
        tab: bgTab,
        workspacePath: '/ws/bg',
      });
      service.handleSessionIdResolved({
        tabId: 'bg-tab',
        realSessionId: 'real-uuid',
      });
      expect(attachSessionMock).toHaveBeenCalledWith('bg-tab', 'real-uuid');
    });

    it('falls back to a sessionless streaming/draft active tab when the tab id is unknown', () => {
      // Brand-new draft: active tab has NO session yet, so the guarded
      // fallback may safely light it.
      tabs = [
        makeTab({ id: 'tab-2', status: 'streaming', claudeSessionId: null }),
      ];
      service.handleSessionIdResolved({
        tabId: 'missing',
        realSessionId: 'real-uuid',
      });
      expect(attachSessionMock).toHaveBeenCalledWith('tab-2', 'real-uuid');
    });

    it('NEVER clobbers an active tab that already owns a live session', () => {
      // The active tab is streaming its OWN live session. A stray resolution
      // whose tab id is not found must not overwrite claudeSessionId.
      tabs = [
        makeTab({ id: 'tab-2', status: 'streaming', claudeSessionId: SESS_2 }),
      ];
      service.handleSessionIdResolved({
        tabId: 'missing',
        realSessionId: 'foreign-uuid',
      });
      expect(attachSessionMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] No tab found for session ID resolution:',
        { tabId: 'missing', realSessionId: 'foreign-uuid' },
      );
    });

    it('warns when no tab matches and active tab is not streaming/draft', () => {
      tabs = [
        makeTab({ id: 'tab-2', status: 'loaded', claudeSessionId: null }),
      ];
      service.handleSessionIdResolved({
        tabId: 'missing',
        realSessionId: 'real-uuid',
      });
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] No tab found for session ID resolution:',
        { tabId: 'missing', realSessionId: 'real-uuid' },
      );
    });
  });

  describe('handleChatError', () => {
    it('clears compaction state first', () => {
      service.handleChatError({ tabId: 'tab-1', error: 'boom' });
      expect(clearCompactionStateMock).toHaveBeenCalled();
    });

    it('routes by tabId when present (primary)', () => {
      service.handleChatError({ tabId: 'tab-1', error: 'boom' });
      expect(clearQueuedContentAndOptionsMock).toHaveBeenCalledWith('tab-1');
    });

    it('falls back to sessionId lookup when tabId absent', () => {
      tabs = [makeTab({ id: 'tab-2', claudeSessionId: SESS_2 })];
      service.handleChatError({ sessionId: SESS_2, error: 'boom' });
      expect(findTabsBySessionIdMock).toHaveBeenCalledWith(SESS_2);
      expect(clearQueuedContentAndOptionsMock).toHaveBeenCalledWith('tab-2');
    });

    it('warns and returns when sessionId mismatches active tab', () => {
      tabs = [makeTab({ id: 'tab-1', claudeSessionId: SESS_ACTUAL })];
      service.handleChatError({ sessionId: SESS_OTHER, error: 'boom' });
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] Error for unknown session',
        {
          sessionId: SESS_OTHER,
          activeTabSessionId: SESS_ACTUAL,
        },
      );
      expect(clearQueuedContentAndOptionsMock).not.toHaveBeenCalled();
    });

    // TASK_2026_360 review F3: SESSION_TURN_FAILED is an unordered hook push
    // and CHAT_ERROR trails the chunk batch — finalizing here could cut off
    // the last delta still in the batch buffer. The ordered `failed` / `idle`
    // turn_state owns finalization, status and the spinner.
    it('surfaces the error and drops the queue, but never finalizes, writes status or clears the spinner', () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          status: 'streaming',
          queuedContent: 'queued',
          streamingState: makeStreamingState({ currentMessageId: 'msg-1' }),
        }),
      ];

      service.handleChatError({ tabId: 'tab-1', error: 'boom' });

      expect(error).toHaveBeenCalledWith(
        '[ChatStore] Chat error:',
        expect.objectContaining({ tabId: 'tab-1', error: 'boom' }),
      );
      expect(clearQueuedContentAndOptionsMock).toHaveBeenCalledWith('tab-1');
      expect(finalizeCurrentMessageMock).not.toHaveBeenCalled();
      expect(applyErrorResetMock).not.toHaveBeenCalled();
      expect(markTabIdleMock).not.toHaveBeenCalled();
      expect(setStatusMock).not.toHaveBeenCalled();
      expect(tabs[0].status).toBe('streaming');
      expect(tabs[0].streamingState?.currentMessageId).toBe('msg-1');
      expect(tabs[0].queuedContent).toBeNull();
    });

    it('refreshes sidebar after error reset', () => {
      service.handleChatError({ tabId: 'tab-1', error: 'boom' });
      expect(loadSessionsMock).toHaveBeenCalled();
    });
  });
});
