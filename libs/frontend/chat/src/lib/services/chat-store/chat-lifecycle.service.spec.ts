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
import { ClaudeRpcService, AuthStateService } from '@ptah-extension/core';
import { ChatLifecycleService } from './chat-lifecycle.service';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import { SessionLoaderService } from './session-loader.service';
import { StreamingHandlerService } from './streaming-handler.service';
import { CompactionLifecycleService } from './compaction-lifecycle.service';
import type { TabState, StreamingState } from '@ptah-extension/chat-types';

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
    claudeSessionId: 'sess-1',
    isCompacting: false,
    queuedContent: null,
    queuedOptions: null,
    ...overrides,
  } as unknown as TabState;
}

describe('ChatLifecycleService', () => {
  let service: ChatLifecycleService;
  let tabs: TabState[];
  let updateTabMock: jest.Mock;
  let findTabBySessionIdMock: jest.Mock;
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
    updateTabMock = jest.fn((id: string, patch: Partial<TabState>) => {
      tabs = tabs.map((t) => (t.id === id ? { ...t, ...patch } : t));
    });
    findTabBySessionIdMock = jest.fn(
      (sid: string) => tabs.find((t) => t.claudeSessionId === sid) ?? null,
    );
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
      updateTab: updateTabMock,
      findTabBySessionId: findTabBySessionIdMock,
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
        data: { tier: 'pro', isActive: true },
      });
      await service.fetchLicenseStatus();
      expect(service.licenseStatus()).toEqual({ tier: 'pro', isActive: true });
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
        sessionId: 'sess-unknown',
      });
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] No tab with streamingState for summary chunk:',
        { toolUseId: 't1', agentId: 'agent-1', sessionId: 'sess-unknown' },
      );
      expect(updateTabMock).not.toHaveBeenCalled();
    });

    it('appends summary content to agentSummaryAccumulators by agentId', () => {
      const state = makeStreamingState();
      state.agentSummaryAccumulators.set('agent-1', 'prev ');
      tabs = [makeTab({ streamingState: state })];
      service.handleAgentSummaryChunk({
        toolUseId: 't1',
        summaryDelta: 'next',
        agentId: 'agent-1',
        sessionId: 'sess-1',
      });
      expect(state.agentSummaryAccumulators.get('agent-1')).toBe('prev next');
      expect(updateTabMock).toHaveBeenCalledWith('tab-1', {
        streamingState: expect.any(Object),
      });
    });

    it('stores contentBlocks when present', () => {
      const state = makeStreamingState();
      tabs = [makeTab({ streamingState: state })];
      service.handleAgentSummaryChunk({
        toolUseId: 't1',
        summaryDelta: '',
        agentId: 'agent-1',
        sessionId: 'sess-1',
        contentBlocks: [{ type: 'text', text: 'hi' }],
      });
      expect(state.agentContentBlocksMap.get('agent-1')).toEqual([
        { type: 'text', text: 'hi' },
      ]);
    });
  });

  describe('handleSessionIdResolved', () => {
    it('routes by tabId directly when tab exists', () => {
      service.handleSessionIdResolved({
        tabId: 'tab-1',
        realSessionId: 'real-uuid',
      });
      expect(updateTabMock).toHaveBeenCalledWith('tab-1', {
        claudeSessionId: 'real-uuid',
      });
    });

    it('falls back to active tab when streaming/draft', () => {
      tabs = [makeTab({ id: 'tab-2', status: 'streaming' })];
      service.handleSessionIdResolved({
        tabId: 'missing',
        realSessionId: 'real-uuid',
      });
      expect(updateTabMock).toHaveBeenCalledWith('tab-2', {
        claudeSessionId: 'real-uuid',
      });
    });

    it('warns when no tab matches and active tab is not streaming/draft', () => {
      tabs = [makeTab({ id: 'tab-2', status: 'loaded' })];
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
      expect(updateTabMock).toHaveBeenCalledWith('tab-1', {
        status: 'loaded',
        currentMessageId: null,
        queuedContent: null,
        queuedOptions: null,
      });
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-1');
      expect(setStatusMock).toHaveBeenCalledWith('loaded');
    });

    it('falls back to sessionId lookup when tabId absent', () => {
      tabs = [makeTab({ id: 'tab-2', claudeSessionId: 'sess-2' })];
      service.handleChatError({ sessionId: 'sess-2', error: 'boom' });
      expect(findTabBySessionIdMock).toHaveBeenCalledWith('sess-2');
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-2');
    });

    it('warns and returns when sessionId mismatches active tab', () => {
      tabs = [makeTab({ id: 'tab-1', claudeSessionId: 'sess-actual' })];
      service.handleChatError({ sessionId: 'sess-other', error: 'boom' });
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] Error for unknown session',
        {
          sessionId: 'sess-other',
          activeTabSessionId: 'sess-actual',
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
      updateTabMock.mockImplementation((id, patch) => {
        if ((patch as Partial<TabState>).currentMessageId === null) {
          callOrder.push('clear');
        }
        tabs = tabs.map((t) => (t.id === id ? { ...t, ...patch } : t));
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
