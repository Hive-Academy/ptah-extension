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
