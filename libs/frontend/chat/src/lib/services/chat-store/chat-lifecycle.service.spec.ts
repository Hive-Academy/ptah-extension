/**
 * ChatLifecycleService specs â€” bootstrap, license retry, agent-summary routing,
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
 *   - handleSessionIdResolved: direct tabId routing
 *   - handleSessionIdResolved: falls back to streaming/draft active tab
 *   - handleSessionIdResolved: warns when no tab found
 *   - handleChatError: clears compaction state first
 *   - handleChatError: tabId routing wins
 *   - handleChatError: sessionId fallback when tabId absent
 *   - handleChatError: active-tab last-resort with sessionId mismatch warning + return
 *   - handleChatError: finalizes streaming BEFORE clearing currentMessageId
 *   - handleChatError: resets full state (status/queued + markTabIdle + setStatus)
 */

import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  AuthStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { ChatLifecycleService } from './chat-lifecycle.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  SessionManager,
  StreamingHandlerService,
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
    isCompacting: false,
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
  let setStatusMock: jest.Mock;
  let loadSessionsMock: jest.Mock;
  let restoreCliSessionsMock: jest.Mock;
  let loadAuthStatusMock: jest.Mock;
  let rpcCallMock: jest.Mock;
  let finalizeCurrentMessageMock: jest.Mock;
  let clearCompactionStateMock: jest.Mock;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
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
      markTabIdle: markTabIdleMock,
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
      ],
    });
    service = TestBed.inject(ChatLifecycleService);
  });

  afterEach(() => {
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
      // 1000 * 1, 1000 * 2 â€” only between failures (not after final success)
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
      expect(setStreamingStateMock).toHaveBeenCalledWith(
        'bg-tab',
        expect.any(Object),
      );
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
      expect(applyErrorResetMock).toHaveBeenCalledWith('tab-1');
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-1');
      expect(setStatusMock).toHaveBeenCalledWith('loaded');
    });

    it('falls back to sessionId lookup when tabId absent', () => {
      tabs = [makeTab({ id: 'tab-2', claudeSessionId: SESS_2 })];
      service.handleChatError({ sessionId: SESS_2, error: 'boom' });
      expect(findTabsBySessionIdMock).toHaveBeenCalledWith(SESS_2);
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-2');
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
      expect(markTabIdleMock).not.toHaveBeenCalled();
    });

    it('finalizes streaming BEFORE clearing currentMessageId', () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          streamingState: makeStreamingState({ currentMessageId: 'msg-1' }),
        }),
      ];
      const callOrder: string[] = [];
      finalizeCurrentMessageMock.mockImplementation(() =>
        callOrder.push('finalize'),
      );
      applyErrorResetMock.mockImplementation((id: string) => {
        callOrder.push('clear');
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
      service.handleChatError({ tabId: 'tab-1', error: 'boom' });
      expect(callOrder).toEqual(['finalize', 'clear']);
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('tab-1', true);
    });

    it('skips finalization when no currentMessageId on streamingState', () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          streamingState: makeStreamingState({ currentMessageId: null }),
        }),
      ];
      service.handleChatError({ tabId: 'tab-1', error: 'boom' });
      expect(finalizeCurrentMessageMock).not.toHaveBeenCalled();
    });

    it('refreshes sidebar after error reset', () => {
      service.handleChatError({ tabId: 'tab-1', error: 'boom' });
      expect(loadSessionsMock).toHaveBeenCalled();
    });
  });
});
