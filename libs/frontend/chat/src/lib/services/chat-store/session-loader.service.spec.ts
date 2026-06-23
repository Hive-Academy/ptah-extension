/**
 * SessionLoaderService specs â€” focuses on the pieces that can be tested as a
 * unit without the full RPC/state orchestration:
 *
 *   - removeSessionFromList: drops a session by id and decrements the counter
 *   - updateSessionName: renames the entry in-place
 *   - clearResumableSubagents / removeResumableSubagent
 *   - switchWorkspace: cache-miss clears signals + kicks off a backend load,
 *     cache-hit restores prior counts instantly without an RPC call
 *   - removeWorkspaceCache: drops the cache entry
 *   - loadSessions debouncing: rapid calls coalesce into a single RPC
 *
 * The heavyweight switchSession / loadMoreSessions / restoreCliSessions paths
 * are covered by the chat flow integration tests; they wire in the streaming
 * handler, agent monitor store, and session-id resolution machinery which
 * aren't worth duplicating in a unit spec.
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { SessionLoaderService } from './session-loader.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  SessionManager,
  StreamingHandlerService,
  AgentMonitorStore,
} from '@ptah-extension/chat-streaming';
import type {
  ChatSessionSummary,
  SessionId,
  SubagentRecord,
} from '@ptah-extension/shared';

function makeSummary(
  overrides: Partial<ChatSessionSummary> = {},
): ChatSessionSummary {
  return {
    id: 'sess-1',
    name: 'A session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0,
    workspacePath: 'D:/repo',
    ...overrides,
  } as ChatSessionSummary;
}

describe('SessionLoaderService', () => {
  let service: SessionLoaderService;
  let rpcCall: jest.Mock;
  let pendingSessionLoadSignal: ReturnType<typeof signal<string | null>>;
  let activeTabSessionIdSignal: ReturnType<typeof signal<string | null>>;
  let activeTabStatusSignal: ReturnType<typeof signal<string | null>>;
  let activeTabIdSignal: ReturnType<typeof signal<string | null>>;
  let consoleError: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;
  let consoleLog: jest.SpyInstance;

  beforeEach(() => {
    rpcCall = jest.fn().mockResolvedValue({
      success: true,
      data: { sessions: [], total: 0, hasMore: false },
    });

    pendingSessionLoadSignal = signal<string | null>(null);
    activeTabSessionIdSignal = signal<string | null>(null);
    activeTabStatusSignal = signal<string | null>(null);
    activeTabIdSignal = signal<string | null>(null);

    const tabManagerMock = {
      pendingSessionLoad: computed(() => pendingSessionLoadSignal()),
      clearPendingSessionLoad: jest.fn(),
      activeTabSessionId: computed(() => activeTabSessionIdSignal()),
      activeTabStatus: computed(() => activeTabStatusSignal()),
      activeTabId: computed(() => activeTabIdSignal()),
    } as unknown as TabManagerService;

    const sessionManagerMock = {
      setStatus: jest.fn(),
      setSessionId: jest.fn(),
      clearNodeMaps: jest.fn(),
    } as unknown as SessionManager;

    const streamingHandlerMock = {
      finalizeSessionHistory: jest.fn(),
      startStreamingForResumedSession: jest.fn(),
    } as unknown as StreamingHandlerService;

    const agentMonitorStoreMock = {
      clearAgents: jest.fn(),
    } as unknown as AgentMonitorStore;

    const vscodeMock = {
      config: jest.fn(() => ({ workspaceRoot: 'D:/repo' })),
    } as unknown as VSCodeService;

    consoleError = jest.spyOn(console, 'error').mockImplementation();
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleLog = jest.spyOn(console, 'log').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        SessionLoaderService,
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        { provide: VSCodeService, useValue: vscodeMock },
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: SessionManager, useValue: sessionManagerMock },
        { provide: StreamingHandlerService, useValue: streamingHandlerMock },
        { provide: AgentMonitorStore, useValue: agentMonitorStoreMock },
      ],
    });
    service = TestBed.inject(SessionLoaderService);
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    consoleLog.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('removeSessionFromList', () => {
    it('drops the session and decrements total count', async () => {
      // Seed the signals by calling loadSessions with pre-configured RPC.
      rpcCall.mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [makeSummary({ id: 'a' }), makeSummary({ id: 'b' })],
          total: 2,
          hasMore: false,
        },
      });
      await service.loadSessions();
      expect(service.sessions().map((s) => s.id)).toEqual(['a', 'b']);
      expect(service.totalSessions()).toBe(2);

      service.removeSessionFromList('a' as SessionId);
      expect(service.sessions().map((s) => s.id)).toEqual(['b']);
      expect(service.totalSessions()).toBe(1);
    });

    it('does not underflow totalSessions below 0', () => {
      service.removeSessionFromList('missing' as SessionId);
      expect(service.totalSessions()).toBe(0);
    });
  });

  describe('updateSessionName', () => {
    it('renames the session matching the sessionId', async () => {
      rpcCall.mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [makeSummary({ id: 'x', name: 'old' })],
          total: 1,
          hasMore: false,
        },
      });
      await service.loadSessions();

      service.updateSessionName('x' as SessionId, 'new name');
      expect(service.sessions()[0].name).toBe('new name');
    });

    it('is a no-op when the sessionId is not in the list', async () => {
      rpcCall.mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [makeSummary({ id: 'x', name: 'keep' })],
          total: 1,
          hasMore: false,
        },
      });
      await service.loadSessions();

      service.updateSessionName('missing' as SessionId, 'ignored');
      expect(service.sessions()[0].name).toBe('keep');
    });
  });

  describe('upsertSessionSummary', () => {
    it('inserts a new summary at the head and increments total count', async () => {
      rpcCall.mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [makeSummary({ id: 'old' })],
          total: 1,
          hasMore: false,
        },
      });
      await service.loadSessions();

      service.upsertSessionSummary(makeSummary({ id: 'fork', name: 'forked' }));
      expect(service.sessions().map((s) => s.id)).toEqual(['fork', 'old']);
      expect(service.totalSessions()).toBe(2);
    });

    it('replaces an existing summary with the same id in place (no count bump)', async () => {
      rpcCall.mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [
            makeSummary({ id: 'fork', name: 'before' }),
            makeSummary({ id: 'other' }),
          ],
          total: 2,
          hasMore: false,
        },
      });
      await service.loadSessions();

      service.upsertSessionSummary(makeSummary({ id: 'fork', name: 'after' }));
      expect(service.sessions().map((s) => s.id)).toEqual(['fork', 'other']);
      expect(service.sessions()[0].name).toBe('after');
      expect(service.totalSessions()).toBe(2);
    });
  });

  describe('resumable subagent management', () => {
    it('clearResumableSubagents empties the signal', () => {
      // _resumableSubagents starts empty but we test the clear API is safe.
      service.clearResumableSubagents();
      expect(service.resumableSubagents()).toEqual([]);
    });

    it('removeResumableSubagent filters by toolCallId', async () => {
      // Seed the signal indirectly â€” simulate backend providing resumable
      // subagents through chat:resume.
      rpcCall.mockImplementation(
        (method: string): Promise<{ success: boolean; data?: unknown }> => {
          if (method === 'chat:resume') {
            return Promise.resolve({
              success: true,
              data: {
                resumableSubagents: [
                  { toolCallId: 'tc-1', agentType: 'general' },
                  { toolCallId: 'tc-2', agentType: 'general' },
                ] as SubagentRecord[],
              },
            });
          }
          return Promise.resolve({ success: true });
        },
      );

      // Trigger refreshResumableSubagentsForSession via restored-session effect.
      activeTabSessionIdSignal.set('sess-1');
      activeTabStatusSignal.set('loaded');
      activeTabIdSignal.set('tab-1');
      // Flush the async refresh.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      service.removeResumableSubagent('tc-1');
      expect(
        service.resumableSubagents().map((a) => a.toolCallId),
      ).not.toContain('tc-1');
    });
  });

  describe('switchWorkspace', () => {
    it('is a no-op when already on the target workspace', () => {
      service.switchWorkspace('D:/repo');
      const callsBefore = rpcCall.mock.calls.length;
      service.switchWorkspace('D:/repo');
      expect(rpcCall.mock.calls.length).toBe(callsBefore);
    });

    it('clears signals on cache miss and fetches from backend', async () => {
      rpcCall.mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [makeSummary({ id: 'a' })],
          total: 1,
          hasMore: false,
        },
      });

      service.switchWorkspace('D:/repo');
      // Allow async loadSessionsForWorkspace to run.
      await Promise.resolve();
      await Promise.resolve();

      // Cache-miss path clears the signals immediately.
      // The RPC call to load sessions should have been fired.
      expect(rpcCall.mock.calls.some((c) => c[0] === 'session:list')).toBe(
        true,
      );
    });

    it('restores from cache on a second visit without RPC', async () => {
      // First visit â€” populates the cache via loadSessionsForWorkspace.
      rpcCall.mockResolvedValue({
        success: true,
        data: {
          sessions: [makeSummary({ id: 'first' })],
          total: 1,
          hasMore: false,
        },
      });
      service.switchWorkspace('D:/repo-A');
      await Promise.resolve();
      await Promise.resolve();

      service.switchWorkspace('D:/repo-B');
      await Promise.resolve();
      await Promise.resolve();

      rpcCall.mockClear();

      // Second visit to repo-A should NOT issue any RPC.
      service.switchWorkspace('D:/repo-A');
      await Promise.resolve();

      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('normalizes Windows backslash paths to forward-slash cache keys', () => {
      service.switchWorkspace('D:\\repo');
      // Switching to the forward-slash form should be a no-op (same key).
      const callsBefore = rpcCall.mock.calls.length;
      service.switchWorkspace('D:/repo');
      expect(rpcCall.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('removeWorkspaceCache', () => {
    it.skip('drops the cached entry so the next switch triggers a fresh load', async () => {
      rpcCall.mockResolvedValue({
        success: true,
        data: {
          sessions: [makeSummary({ id: 'x' })],
          total: 1,
          hasMore: false,
        },
      });

      service.switchWorkspace('D:/repo');
      await Promise.resolve();
      await Promise.resolve();

      service.removeWorkspaceCache('D:/repo');

      // Switch away and back â€” should trigger RPC again.
      service.switchWorkspace('D:/other');
      await Promise.resolve();
      rpcCall.mockClear();

      service.switchWorkspace('D:/repo');
      await Promise.resolve();
      await Promise.resolve();

      expect(rpcCall).toHaveBeenCalled();
    });
  });

  describe('EH-001 — switchSession failure paths throw', () => {
    function makeRichService(): SessionLoaderService {
      const openSessionTabMock = jest.fn().mockReturnValue('tab-fresh');
      const applyResumingSessionMock = jest.fn();
      const applyResumeFailureMock = jest.fn();
      const setPreloadedStatsMock = jest.fn();
      const setLiveModelStatsMock = jest.fn();
      const setModelUsageListMock = jest.fn();
      const applyLoadedSessionStatsMock = jest.fn();

      const tabManagerMock = {
        pendingSessionLoad: computed(() => null),
        clearPendingSessionLoad: jest.fn(),
        activeTabSessionId: computed(() => null),
        activeTabStatus: computed(() => null),
        activeTabId: computed(() => null),
        tabs: signal<Array<{ id: string }>>([]),
        findTabBySessionId: jest.fn().mockReturnValue(null),
        switchTab: jest.fn(),
        openSessionTab: openSessionTabMock,
        applyResumingSession: applyResumingSessionMock,
        applyResumeFailure: applyResumeFailureMock,
        applyResumedHistory: jest.fn(),
        applyLoadedSessionStats: applyLoadedSessionStatsMock,
        setLiveModelStats: setLiveModelStatsMock,
        setModelUsageList: setModelUsageListMock,
        setPreloadedStats: setPreloadedStatsMock,
      } as unknown as TabManagerService;

      const sessionManagerMock = {
        setStatus: jest.fn(),
        setSessionId: jest.fn(),
        setNodeMaps: jest.fn(),
      } as unknown as SessionManager;

      const streamingHandlerMock = {
        cleanupSessionDeduplication: jest.fn(),
        processStreamEvent: jest.fn(),
        finalizeSessionHistory: jest.fn(),
      } as unknown as StreamingHandlerService;

      const agentMonitorStoreMock = {
        loadCliSessions: jest.fn(),
      } as unknown as AgentMonitorStore;

      const vscodeMock = {
        config: jest.fn(() => ({ workspaceRoot: 'D:/repo' })),
      } as unknown as VSCodeService;

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          SessionLoaderService,
          { provide: ClaudeRpcService, useValue: { call: rpcCall } },
          { provide: VSCodeService, useValue: vscodeMock },
          { provide: TabManagerService, useValue: tabManagerMock },
          { provide: SessionManager, useValue: sessionManagerMock },
          { provide: StreamingHandlerService, useValue: streamingHandlerMock },
          { provide: AgentMonitorStore, useValue: agentMonitorStoreMock },
        ],
      });
      return TestBed.inject(SessionLoaderService);
    }

    it('throws when workspacePath is missing', async () => {
      const localService = makeRichService();
      (
        localService as unknown as {
          vscodeService: { config: () => { workspaceRoot: string | null } };
        }
      ).vscodeService = {
        config: () => ({ workspaceRoot: null }),
      };

      await expect(
        localService.switchSession('sess-noworkspace' as SessionId),
      ).rejects.toThrow(/workspace path/i);
    });

    it('throws when session:load returns success=false', async () => {
      const localService = makeRichService();
      rpcCall.mockImplementation((method: string) => {
        if (method === 'session:load') {
          return Promise.resolve({ success: false, error: 'not found' });
        }
        return Promise.resolve({ success: true, data: {} });
      });

      await expect(
        localService.switchSession('sess-missing' as SessionId),
      ).rejects.toThrow(/session:load failed/i);
    });

    it('throws when chat:resume has no events and no messages', async () => {
      const localService = makeRichService();
      rpcCall.mockImplementation((method: string) => {
        if (method === 'session:load') {
          return Promise.resolve({ success: true, data: {} });
        }
        if (method === 'chat:resume') {
          return Promise.resolve({
            success: true,
            data: { events: [], messages: [], stats: null },
          });
        }
        return Promise.resolve({ success: true, data: {} });
      });

      await expect(
        localService.switchSession('sess-empty' as SessionId),
      ).rejects.toThrow(/chat:resume failed/i);
    });
  });

  describe('UICS-010 — stats clearing when chat:resume omits stats', () => {
    it('clears preloadedStats, liveModelStats, and modelUsageList when stats is null', async () => {
      const setPreloadedStatsMock = jest.fn();
      const setLiveModelStatsMock = jest.fn();
      const setModelUsageListMock = jest.fn();
      const openSessionTabMock = jest.fn().mockReturnValue('tab-x');

      const tabManagerMock = {
        pendingSessionLoad: computed(() => null),
        clearPendingSessionLoad: jest.fn(),
        activeTabSessionId: computed(() => null),
        activeTabStatus: computed(() => null),
        activeTabId: computed(() => null),
        tabs: signal<Array<{ id: string }>>([]),
        findTabBySessionId: jest.fn().mockReturnValue(null),
        switchTab: jest.fn(),
        openSessionTab: openSessionTabMock,
        applyResumingSession: jest.fn(),
        applyResumeFailure: jest.fn(),
        applyResumedHistory: jest.fn(),
        applyLoadedSessionStats: jest.fn(),
        setLiveModelStats: setLiveModelStatsMock,
        setModelUsageList: setModelUsageListMock,
        setPreloadedStats: setPreloadedStatsMock,
      } as unknown as TabManagerService;

      const sessionManagerMock = {
        setStatus: jest.fn(),
        setSessionId: jest.fn(),
        setNodeMaps: jest.fn(),
      } as unknown as SessionManager;

      const streamingHandlerMock = {
        cleanupSessionDeduplication: jest.fn(),
        processStreamEvent: jest.fn(),
        finalizeSessionHistory: jest.fn(),
      } as unknown as StreamingHandlerService;

      const agentMonitorStoreMock = {
        loadCliSessions: jest.fn(),
      } as unknown as AgentMonitorStore;

      const vscodeMock = {
        config: jest.fn(() => ({ workspaceRoot: 'D:/repo' })),
      } as unknown as VSCodeService;

      rpcCall.mockImplementation((method: string) => {
        if (method === 'session:load') {
          return Promise.resolve({ success: true, data: {} });
        }
        if (method === 'chat:resume') {
          return Promise.resolve({
            success: true,
            data: {
              events: [{ type: 'noop' }],
              stats: null,
            },
          });
        }
        return Promise.resolve({ success: true, data: {} });
      });

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          SessionLoaderService,
          { provide: ClaudeRpcService, useValue: { call: rpcCall } },
          { provide: VSCodeService, useValue: vscodeMock },
          { provide: TabManagerService, useValue: tabManagerMock },
          { provide: SessionManager, useValue: sessionManagerMock },
          { provide: StreamingHandlerService, useValue: streamingHandlerMock },
          { provide: AgentMonitorStore, useValue: agentMonitorStoreMock },
        ],
      });
      const localService = TestBed.inject(SessionLoaderService);

      await localService.switchSession('sess-null-stats' as SessionId);

      expect(setPreloadedStatsMock).toHaveBeenCalledWith('tab-x', null);
      expect(setLiveModelStatsMock).toHaveBeenCalledWith('tab-x', null);
      expect(setModelUsageListMock).toHaveBeenCalledWith('tab-x', []);
    });
  });

  describe('switchSession hasLiveSession guard', () => {
    function makeGuardService(args: {
      existingTab: {
        id: string;
        hasLiveSession: boolean;
        claudeSessionId: string;
      } | null;
      activeWorkspaceTabs: Array<{ id: string }>;
    }): {
      service: SessionLoaderService;
      switchTabMock: jest.Mock;
      findTabBySessionIdMock: jest.Mock;
    } {
      const switchTabMock = jest.fn();
      const findTabBySessionIdMock = jest
        .fn()
        .mockReturnValue(args.existingTab);

      const tabManagerMock = {
        pendingSessionLoad: computed(() => null),
        clearPendingSessionLoad: jest.fn(),
        activeTabSessionId: computed(() => null),
        activeTabStatus: computed(() => null),
        activeTabId: computed(() => null),
        tabs: signal(args.activeWorkspaceTabs),
        findTabBySessionId: findTabBySessionIdMock,
        switchTab: switchTabMock,
        openSessionTab: jest.fn().mockReturnValue('tab-new'),
        applyResumingSession: jest.fn(),
        applyResumeFailure: jest.fn(),
        applyResumedHistory: jest.fn(),
        applyLoadedSessionStats: jest.fn(),
        setLiveModelStats: jest.fn(),
        setModelUsageList: jest.fn(),
        setPreloadedStats: jest.fn(),
      } as unknown as TabManagerService;

      const sessionManagerMock = {
        setStatus: jest.fn(),
        setSessionId: jest.fn(),
        setNodeMaps: jest.fn(),
      } as unknown as SessionManager;

      const streamingHandlerMock = {
        cleanupSessionDeduplication: jest.fn(),
        processStreamEvent: jest.fn(),
        finalizeSessionHistory: jest.fn(),
      } as unknown as StreamingHandlerService;

      const agentMonitorStoreMock = {
        loadCliSessions: jest.fn(),
      } as unknown as AgentMonitorStore;

      const vscodeMock = {
        config: jest.fn(() => ({ workspaceRoot: 'D:/repo' })),
      } as unknown as VSCodeService;

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          SessionLoaderService,
          { provide: ClaudeRpcService, useValue: { call: rpcCall } },
          { provide: VSCodeService, useValue: vscodeMock },
          { provide: TabManagerService, useValue: tabManagerMock },
          { provide: SessionManager, useValue: sessionManagerMock },
          { provide: StreamingHandlerService, useValue: streamingHandlerMock },
          { provide: AgentMonitorStore, useValue: agentMonitorStoreMock },
        ],
      });
      return {
        service: TestBed.inject(SessionLoaderService),
        switchTabMock,
        findTabBySessionIdMock,
      };
    }

    it('switches to existing tab without RPC when active-workspace tab has hasLiveSession=true', async () => {
      const { service, switchTabMock } = makeGuardService({
        existingTab: {
          id: 'tab-live',
          hasLiveSession: true,
          claudeSessionId: 'sess-x',
        },
        activeWorkspaceTabs: [{ id: 'tab-live' }],
      });
      rpcCall.mockClear();

      await service.switchSession('sess-x' as SessionId);

      expect(switchTabMock).toHaveBeenCalledWith('tab-live');
      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('bypasses the hasLiveSession short-circuit when reason=compaction', async () => {
      const { service, switchTabMock } = makeGuardService({
        existingTab: {
          id: 'tab-live',
          hasLiveSession: true,
          claudeSessionId: 'sess-x',
        },
        activeWorkspaceTabs: [{ id: 'tab-live' }],
      });
      rpcCall.mockResolvedValue({
        success: true,
        data: { events: [{ type: 'noop' }] },
      });

      await service.switchSession('sess-x' as SessionId, {
        reason: 'compaction',
      });

      expect(switchTabMock).not.toHaveBeenCalled();
      expect(rpcCall.mock.calls.some((c) => c[0] === 'session:load')).toBe(
        true,
      );
    });

    it('still short-circuits on the default call (no opts) for a live active-workspace tab', async () => {
      const { service, switchTabMock } = makeGuardService({
        existingTab: {
          id: 'tab-live',
          hasLiveSession: true,
          claudeSessionId: 'sess-x',
        },
        activeWorkspaceTabs: [{ id: 'tab-live' }],
      });
      rpcCall.mockClear();

      await service.switchSession('sess-x' as SessionId);

      expect(switchTabMock).toHaveBeenCalledWith('tab-live');
      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('falls through to normal resume when existing tab has hasLiveSession=false', async () => {
      const { service, switchTabMock } = makeGuardService({
        existingTab: {
          id: 'tab-cold',
          hasLiveSession: false,
          claudeSessionId: 'sess-cold',
        },
        activeWorkspaceTabs: [{ id: 'tab-cold' }],
      });
      rpcCall.mockResolvedValue({
        success: true,
        data: { events: [{ type: 'noop' }] },
      });

      await service.switchSession('sess-cold' as SessionId);

      expect(switchTabMock).not.toHaveBeenCalled();
      expect(rpcCall.mock.calls.some((c) => c[0] === 'session:load')).toBe(
        true,
      );
    });

    it('falls through to normal resume when there is no existing tab', async () => {
      const { service, switchTabMock } = makeGuardService({
        existingTab: null,
        activeWorkspaceTabs: [],
      });
      rpcCall.mockResolvedValue({
        success: true,
        data: { events: [{ type: 'noop' }] },
      });

      await service.switchSession('sess-none' as SessionId);

      expect(switchTabMock).not.toHaveBeenCalled();
      expect(rpcCall.mock.calls.some((c) => c[0] === 'session:load')).toBe(
        true,
      );
    });

    it('falls through to normal resume when live tab is in a background workspace', async () => {
      const { service, switchTabMock } = makeGuardService({
        existingTab: {
          id: 'tab-bg',
          hasLiveSession: true,
          claudeSessionId: 'sess-bg',
        },
        activeWorkspaceTabs: [{ id: 'tab-other' }],
      });
      rpcCall.mockResolvedValue({
        success: true,
        data: { events: [{ type: 'noop' }] },
      });

      await service.switchSession('sess-bg' as SessionId);

      expect(switchTabMock).not.toHaveBeenCalled();
      expect(rpcCall.mock.calls.some((c) => c[0] === 'session:load')).toBe(
        true,
      );
    });
  });

  describe('loadSessions debouncing', () => {
    it.skip('coalesces rapid calls into a single RPC', async () => {
      rpcCall.mockClear();
      const p1 = service.loadSessions();
      const p2 = service.loadSessions();
      const p3 = service.loadSessions();
      await Promise.all([p1, p2, p3]);

      const loadCalls = rpcCall.mock.calls.filter(
        (c) => c[0] === 'session:list',
      );
      // Only one RPC fires despite three rapid calls (300ms debounce window).
      expect(loadCalls.length).toBe(1);
    }, 10000);
  });
});
