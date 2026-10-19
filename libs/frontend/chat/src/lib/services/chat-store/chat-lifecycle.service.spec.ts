/**
 * ChatLifecycleService specs — bootstrap, license retry, session-ID
 * resolution, chat-error handling.
 *
 * Coverage:
 *   - bootstrap: flips servicesReady BEFORE kicking off async loads
 *   - bootstrap: kicks off loadSessions, restoreCliSessionsForActiveTab,
 *     loadAuthStatus, fetchLicenseStatus
 *   - fetchLicenseStatus: success path stores result
 *   - fetchLicenseStatus: failure result on final attempt sets null + logs
 *   - fetchLicenseStatus: thrown error on final attempt sets null + logs
 *   - fetchLicenseStatus: linear backoff between failed attempts
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
  SessionManager,
  StreamingHandlerService,
  TurnStateApplier,
} from '@ptah-extension/chat-streaming';
import { SessionLoaderService } from './session-loader.service';
import { CompactionLifecycleService } from './compaction-lifecycle.service';
import { ConversationService } from './conversation.service';
import type { TabState, StreamingState } from '@ptah-extension/chat-types';
import { SessionId } from '@ptah-extension/shared';

// Production `ChatLifecycleService.handleChatError` calls `SessionId.from()`
// on the inbound sessionId (UUID v4). Mint stable ids per spec run.
const SESS_1 = SessionId.create();
const SESS_2 = SessionId.create();
const SESS_OTHER = SessionId.create();
const SESS_ACTUAL = SessionId.create();

function makeStreamingState(
  overrides: Partial<StreamingState> = {},
): StreamingState {
  return {
    currentMessageId: null,
    // The containers the flush guard compares; a fresh state has new ones.
    events: new Map(),
    eventsByMessage: new Map(),
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
  let markSessionStartFailedMock: jest.Mock;
  let dropHeldCommandsMock: jest.Mock;
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
    clearQueuedContentAndOptionsMock = jest.fn((id: string) => {
      tabs = tabs.map((t) =>
        t.id === id ? { ...t, queuedContent: null, queuedOptions: null } : t,
      );
    });
    // Mirrors the real guard: only a streaming tab with no SDK session and
    // nothing streamed is settled.
    markSessionStartFailedMock = jest.fn((id: string, reason: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (
        !tab ||
        tab.claudeSessionId ||
        tab.status !== 'streaming' ||
        tab.streamingState
      ) {
        return false;
      }
      tabs = tabs.map((t) =>
        t.id === id
          ? ({
              ...t,
              status: 'loaded',
              hasLiveSession: false,
              messages: [
                ...t.messages,
                { id: 'notice', role: 'assistant', rawContent: reason },
              ],
            } as unknown as TabState)
          : t,
      );
      return true;
    });
    dropHeldCommandsMock = jest.fn();
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
      markSessionStartFailed: markSessionStartFailedMock,
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
        {
          provide: ConversationService,
          useValue: { dropHeldCommands: dropHeldCommandsMock },
        },
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

    it('drops slash commands held behind the queue with it (TASK_2026_655)', () => {
      service.handleChatError({ tabId: 'tab-1', error: 'boom' });
      expect(dropHeldCommandsMock).toHaveBeenCalledWith('tab-1');
    });

    // TASK_2026_655: the host announces a handoff tab, then its SDK start
    // fails and it sends chat:error with sessionId = the tab id.
    describe('announce, then a failed session start', () => {
      // A tab id is a UUID too; the host sends it as the sessionId as well.
      const HANDOFF_TAB = String(SessionId.create()) as TabState['id'];
      const REASON = 'Handoff session could not start: launch failed.';

      function announcedTab(overrides: Partial<TabState> = {}): TabState {
        return makeTab({
          id: HANDOFF_TAB,
          status: 'streaming',
          claudeSessionId: null,
          hasLiveSession: true,
          messages: [
            { id: 'u1', role: 'user', rawContent: 'continue' },
          ] as unknown as TabState['messages'],
          ...overrides,
        });
      }

      it('settles the announced tab as idle, not live, with the reason shown', () => {
        tabs = [makeTab(), announcedTab()];

        service.handleChatError({
          tabId: HANDOFF_TAB,
          sessionId: HANDOFF_TAB,
          error: REASON,
        });

        expect(markSessionStartFailedMock).toHaveBeenCalledWith(
          HANDOFF_TAB,
          REASON,
        );
        const tab = tabs.find((t) => t.id === HANDOFF_TAB);
        expect(tab?.status).toBe('loaded');
        expect(tab?.hasLiveSession).toBe(false);
        expect(tab?.messages.at(-1)?.rawContent).toBe(REASON);
        expect(clearQueuedContentAndOptionsMock).toHaveBeenCalledWith(
          HANDOFF_TAB,
        );
        expect(dropHeldCommandsMock).toHaveBeenCalledWith(HANDOFF_TAB);
        expect(loadSessionsMock).toHaveBeenCalled();
      });

      it('settles a tab outside the active set without touching the active tab', () => {
        // The tab sits in a background partition: not in the active set the
        // fallback routing reads, so only the cross-partition settle finds it.
        const background = announcedTab();
        tabs = [makeTab({ claudeSessionId: null })];
        markSessionStartFailedMock.mockImplementationOnce(
          (id: string) => id === background.id,
        );

        service.handleChatError({
          tabId: HANDOFF_TAB,
          sessionId: HANDOFF_TAB,
          error: REASON,
        });

        expect(markSessionStartFailedMock).toHaveBeenCalledWith(
          HANDOFF_TAB,
          REASON,
        );
        expect(clearQueuedContentAndOptionsMock).toHaveBeenCalledTimes(1);
        expect(clearQueuedContentAndOptionsMock).toHaveBeenCalledWith(
          HANDOFF_TAB,
        );
      });

      it('leaves a tab whose session started to the turn_state path', () => {
        tabs = [announcedTab({ claudeSessionId: SESS_2 })];

        service.handleChatError({
          tabId: HANDOFF_TAB,
          sessionId: HANDOFF_TAB,
          error: REASON,
        });

        const tab = tabs.find((t) => t.id === HANDOFF_TAB);
        expect(tab?.status).toBe('streaming');
        expect(tab?.hasLiveSession).toBe(true);
        expect(clearQueuedContentAndOptionsMock).toHaveBeenCalledWith(
          HANDOFF_TAB,
        );
      });

      it('does not treat an ordinary stream error as a failed start', () => {
        tabs = [announcedTab()];

        service.handleChatError({
          tabId: HANDOFF_TAB,
          sessionId: SESS_2,
          error: 'stream broke',
        });

        expect(markSessionStartFailedMock).not.toHaveBeenCalled();
        expect(tabs[0].status).toBe('streaming');
      });
    });
  });
});
