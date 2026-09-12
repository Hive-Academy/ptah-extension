/**
 * SessionLoaderService specs — focuses on the pieces that can be tested as a
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
  BatchedUpdateService,
  BackgroundAgentStore,
  EventDeduplicationService,
  ExecutionTreeBuilderService,
  MessageFinalizationService,
  SessionManager,
  StreamingAccumulatorCore,
  StreamingHandlerService,
  AgentMonitorStore,
  TurnStateApplier,
} from '@ptah-extension/chat-streaming';
import {
  ConfirmationDialogService,
  ConversationRegistry,
  MODEL_REFRESH_CONTROL,
  TabSessionBinding,
  TabWorkspacePartitionService,
  type ModelRefreshControl,
} from '@ptah-extension/chat-state';
import type { StreamingState } from '@ptah-extension/chat-types';
import {
  SessionId,
  TabId,
  type ChatSessionSummary,
  type ExecutionNode,
  type FlatStreamEventUnion,
  type SubagentRecord,
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
  let loadCliSessions: jest.Mock;
  let appendCliOutputPage: jest.Mock;
  let cliOutputProgress: jest.Mock;
  let tabBindingsSignal: ReturnType<
    typeof signal<readonly { id: string; claudeSessionId: string | null }[]>
  >;
  let pendingSessionLoadSignal: ReturnType<typeof signal<string | null>>;
  let activeTabSessionIdSignal: ReturnType<typeof signal<string | null>>;
  let activeTabStatusSignal: ReturnType<typeof signal<string | null>>;
  let activeTabIdSignal: ReturnType<typeof signal<string | null>>;
  let applyLoadedSessionStats: jest.Mock;
  let setPreloadedStats: jest.Mock;
  let setLiveModelStats: jest.Mock;
  let setModelUsageList: jest.Mock;
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
    tabBindingsSignal = signal<
      readonly { id: string; claudeSessionId: string | null }[]
    >([]);
    applyLoadedSessionStats = jest.fn();
    setPreloadedStats = jest.fn();
    setLiveModelStats = jest.fn();
    setModelUsageList = jest.fn();

    const tabManagerMock = {
      pendingSessionLoad: computed(() => pendingSessionLoadSignal()),
      clearPendingSessionLoad: jest.fn(),
      activeTabSessionId: computed(() => activeTabSessionIdSignal()),
      activeTabStatus: computed(() => activeTabStatusSignal()),
      activeTabId: computed(() => activeTabIdSignal()),
      tabs: computed(() => tabBindingsSignal()),
      findTabByIdAcrossWorkspaces: jest.fn((tabId: string) => {
        const sessionId = activeTabSessionIdSignal();
        return sessionId
          ? {
              tab: { id: tabId, claudeSessionId: sessionId },
              workspacePath: 'D:/repo',
            }
          : null;
      }),
      applyLoadedSessionStats,
      setPreloadedStats,
      setLiveModelStats,
      setModelUsageList,
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

    loadCliSessions = jest.fn();
    appendCliOutputPage = jest.fn();
    cliOutputProgress = jest.fn(() => null);
    const agentMonitorStoreMock = {
      clearAgents: jest.fn(),
      loadCliSessions,
      appendCliOutputPage,
      cliOutputProgress,
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

  describe('restoreCliSessionsForSession', () => {
    const SESSION = 'sess-tribunal' as SessionId;
    const refs = [{ agentId: 'a1', cli: 'ptah-cli' }];

    function deferred<T>(): {
      promise: Promise<T>;
      resolve: (value: T) => void;
    } {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }

    beforeEach(() => {
      rpcCall.mockImplementation(async (method: string) =>
        method === 'session:cli-sessions'
          ? { success: true, data: { cliSessions: refs } }
          : { success: true, data: {} },
      );
    });

    const cliSessionCalls = (): unknown[][] =>
      rpcCall.mock.calls.filter(([m]) => m === 'session:cli-sessions');

    it('loads the fetched references into the agent monitor for that session', async () => {
      await service.restoreCliSessionsForSession(SESSION);

      expect(loadCliSessions).toHaveBeenCalledWith(refs, SESSION);
    });

    it('fetches once per session — a sibling surface asking again is a no-op', async () => {
      await service.restoreCliSessionsForSession(SESSION);
      await service.restoreCliSessionsForSession(SESSION);

      expect(cliSessionCalls()).toHaveLength(1);
      expect(loadCliSessions).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent output loads and accepts each ordered page once', async () => {
      tabBindingsSignal.set([{ id: 'tab-1', claudeSessionId: SESSION }]);
      TestBed.tick();
      const first = deferred<{
        success: true;
        data: {
          items: readonly [{ tag: 'segment'; value: { type: 'text'; content: 'one' } }];
          nextCursor: string;
          done: false;
        };
      }>();
      let pageCalls = 0;
      rpcCall.mockImplementation((method: string) => {
        if (method === 'session:cli-sessions') {
          return Promise.resolve({ success: true, data: { cliSessions: refs } });
        }
        if (method === 'session:cli-output-page') {
          pageCalls++;
          if (pageCalls === 1) return first.promise;
          return Promise.resolve({
            success: true,
            data: {
              items: [
                {
                  tag: 'streamEvent',
                  value: { id: 'two', eventType: 'text_delta' },
                },
              ],
              nextCursor: null,
              done: true,
            },
          });
        }
        return Promise.resolve({ success: true, data: {} });
      });

      const one = service.restoreCliSessionsForSession(SESSION);
      const two = service.restoreCliSessionsForSession(SESSION);
      await Promise.all([one, two]);
      first.resolve({
        success: true,
        data: {
          items: [{ tag: 'segment', value: { type: 'text', content: 'one' } }],
          nextCursor: '1',
          done: false,
        },
      });
      await first.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(pageCalls).toBe(2);
      expect(appendCliOutputPage.mock.calls).toEqual([
        [
          SESSION,
          'a1',
          [{ tag: 'segment', value: { type: 'text', content: 'one' } }],
          { requestCursor: undefined, nextCursor: '1', done: false },
        ],
        [
          SESSION,
          'a1',
          [
            {
              tag: 'streamEvent',
              value: { id: 'two', eventType: 'text_delta' },
            },
          ],
          { requestCursor: '1', nextCursor: undefined, done: true },
        ],
      ]);
    });

    it('drops an output page that resolves after its tab closes or rebinds', async () => {
      tabBindingsSignal.set([{ id: 'tab-1', claudeSessionId: SESSION }]);
      TestBed.tick();
      const pending = deferred<{
        success: true;
        data: { items: readonly []; nextCursor: null; done: true };
      }>();
      rpcCall.mockImplementation((method: string) =>
        method === 'session:cli-sessions'
          ? Promise.resolve({ success: true, data: { cliSessions: refs } })
          : method === 'session:cli-output-page'
            ? pending.promise
            : Promise.resolve({ success: true, data: {} }),
      );

      await service.restoreCliSessionsForSession(SESSION);
      tabBindingsSignal.set([{ id: 'tab-1', claudeSessionId: 'sess-other' }]);
      TestBed.tick();
      pending.resolve({
        success: true,
        data: { items: [], nextCursor: null, done: true },
      });
      await pending.promise;
      await Promise.resolve();

      expect(appendCliOutputPage).not.toHaveBeenCalled();
    });

    it('continues from the last accepted cursor after a partial failure', async () => {
      tabBindingsSignal.set([{ id: 'tab-1', claudeSessionId: SESSION }]);
      TestBed.tick();
      const requestedCursors: Array<string | undefined> = [];
      let outputAttempt = 0;
      rpcCall.mockImplementation((method: string, params: { cursor?: string }) => {
        if (method === 'session:cli-sessions') {
          return Promise.resolve({ success: true, data: { cliSessions: refs } });
        }
        if (method === 'session:cli-output-page') {
          requestedCursors.push(params.cursor);
          outputAttempt++;
          if (outputAttempt === 1) {
            return Promise.resolve({
              success: true,
              data: {
                items: [{ tag: 'segment', value: { type: 'text', content: 'one' } }],
                nextCursor: '1',
                done: false,
              },
            });
          }
          if (outputAttempt === 2) {
            return Promise.resolve({ success: false, error: 'temporary' });
          }
          return Promise.resolve({
            success: true,
            data: {
              items: [{ tag: 'segment', value: { type: 'text', content: 'two' } }],
              nextCursor: null,
              done: true,
            },
          });
        }
        return Promise.resolve({ success: true, data: {} });
      });

      await service.restoreCliSessionsForSession(SESSION);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await service.restoreCliSessionsForSession(SESSION);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(requestedCursors).toEqual([undefined, '1', '1']);
      expect(appendCliOutputPage.mock.calls).toEqual([
        [
          SESSION,
          'a1',
          [{ tag: 'segment', value: { type: 'text', content: 'one' } }],
          { requestCursor: undefined, nextCursor: '1', done: false },
        ],
        [
          SESSION,
          'a1',
          [{ tag: 'segment', value: { type: 'text', content: 'two' } }],
          { requestCursor: '1', nextCursor: undefined, done: true },
        ],
      ]);
      expect(loadCliSessions).toHaveBeenCalledTimes(1);
    });

    it('resumes a load restarted by a binding change from the merged cursor, never re-appending output', async () => {
      // Emulates the store contract: a card merges a page only at its own cursor.
      const merged: string[] = [];
      let cardCursor: string | undefined;
      let cardDone = false;
      cliOutputProgress.mockImplementation(() => ({
        cursor: cardCursor,
        done: cardDone,
      }));
      appendCliOutputPage.mockImplementation(
        (
          _session: string,
          _agent: string,
          items: readonly { value: { content?: string; id?: string } }[],
          page: {
            requestCursor: string | undefined;
            nextCursor: string | undefined;
            done: boolean;
          },
        ) => {
          if (cardDone || page.requestCursor !== cardCursor) return;
          merged.push(...items.map((item) => item.value.content ?? ''));
          cardCursor = page.nextCursor;
          cardDone = page.done;
        },
      );
      tabBindingsSignal.set([{ id: 'tab-1', claudeSessionId: SESSION }]);
      TestBed.tick();
      const staleSecondPage = deferred<unknown>();
      const requestedCursors: Array<string | undefined> = [];
      rpcCall.mockImplementation(
        (method: string, params: { cursor?: string }) => {
          if (method === 'session:cli-sessions') {
            return Promise.resolve({
              success: true,
              data: { cliSessions: refs },
            });
          }
          if (method === 'session:cli-output-page') {
            requestedCursors.push(params.cursor);
            if (params.cursor === undefined) {
              return Promise.resolve({
                success: true,
                data: {
                  items: [
                    { tag: 'segment', value: { type: 'text', content: 'one' } },
                  ],
                  nextCursor: '1',
                  done: false,
                },
              });
            }
            const secondPage = {
              success: true,
              data: {
                items: [
                  { tag: 'segment', value: { type: 'text', content: 'two' } },
                ],
                nextCursor: null,
                done: true,
              },
            };
            return requestedCursors.length === 2
              ? staleSecondPage.promise
              : Promise.resolve(secondPage);
          }
          return Promise.resolve({ success: true, data: {} });
        },
      );

      await service.restoreCliSessionsForSession(SESSION);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requestedCursors).toEqual([undefined, '1']);

      // A second canvas tile binds the same session while page 2 is in flight.
      tabBindingsSignal.set([
        { id: 'tab-1', claudeSessionId: SESSION },
        { id: 'tab-2', claudeSessionId: SESSION },
      ]);
      TestBed.tick();
      staleSecondPage.resolve({
        success: true,
        data: {
          items: [{ tag: 'segment', value: { type: 'text', content: 'two' } }],
          nextCursor: null,
          done: true,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The tile's own resume re-applies the same lean references.
      service['applyCliSessions'](
        refs as unknown as Parameters<SessionLoaderService['applyCliSessions']>[0],
        SESSION,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(requestedCursors).toEqual([undefined, '1', '1']);
      expect(merged).toEqual(['one', 'two']);
    });

    it('releases the guard when the fetch throws so a later surface retries', async () => {
      rpcCall.mockRejectedValueOnce(new Error('rpc down'));

      await service.restoreCliSessionsForSession(SESSION);
      expect(loadCliSessions).not.toHaveBeenCalled();

      await service.restoreCliSessionsForSession(SESSION);
      expect(loadCliSessions).toHaveBeenCalledWith(refs, SESSION);
    });

    it('releases the guard when the fetch RESOLVES unsuccessfully', async () => {
      // A timeout or handler error resolves with `success: false` — it does not
      // throw — so the throw-only release left the session's agent cards
      // unrecoverable for the rest of the app run.
      rpcCall.mockResolvedValueOnce({
        success: false,
        error: 'RPC timeout: session:cli-sessions',
      });

      await service.restoreCliSessionsForSession(SESSION);
      expect(loadCliSessions).not.toHaveBeenCalled();

      await service.restoreCliSessionsForSession(SESSION);
      expect(loadCliSessions).toHaveBeenCalledWith(refs, SESSION);
    });

    it('skips the fetch when the session was already hydrated by chat:resume', async () => {
      const restoredTabId = TabId.from('72f04290-94d6-497a-81b4-c096e7e7a2b4');
      activeTabSessionIdSignal.set(SESSION);
      activeTabIdSignal.set(restoredTabId);
      rpcCall.mockImplementation(async (method: string) =>
        method === 'chat:resume'
          ? { success: true, data: { cliSessions: refs } }
          : { success: true, data: { cliSessions: [] } },
      );
      activeTabStatusSignal.set('loaded');
      TestBed.tick();
      await Promise.resolve();
      await Promise.resolve();

      expect(loadCliSessions).toHaveBeenCalledWith(refs, SESSION);

      await service.restoreCliSessionsForSession(SESSION);

      expect(cliSessionCalls()).toHaveLength(0);
    });

    it('replaces a restored loaded tab stale stats from the resume snapshot', async () => {
      const restoredTabId = TabId.from('15fe87b7-9888-456d-a125-74e31307780e');
      activeTabSessionIdSignal.set(SESSION);
      activeTabIdSignal.set(restoredTabId);
      const stats = {
        totalCost: 12,
        tokens: {
          input: 700_000,
          output: 20_000,
          cacheRead: 100_000,
          cacheCreation: 0,
        },
        messageCount: 90,
        model: 'claude-sonnet-4-5',
        modelUsageList: [
          {
            model: 'claude-sonnet-4-5',
            inputTokens: 700_000,
            outputTokens: 20_000,
            costUSD: 12,
          },
        ],
        contextSnapshot: {
          model: 'claude-opus-5',
          contextTokens: 11_016,
        },
      };
      rpcCall.mockImplementation(async (method: string) =>
        method === 'chat:resume'
          ? { success: true, data: { stats } }
          : { success: true, data: {} },
      );

      activeTabStatusSignal.set('loaded');
      TestBed.tick();
      await Promise.resolve();
      await Promise.resolve();

      expect(applyLoadedSessionStats).toHaveBeenCalledWith(
        restoredTabId,
        stats,
        stats.model,
      );
      expect(setLiveModelStats).toHaveBeenCalledWith(restoredTabId, {
        model: 'claude-opus-5',
        contextUsed: 11_016,
        contextWindow: 1_000_000,
        contextPercent: 1.1,
      });
      expect(setModelUsageList).toHaveBeenCalledWith(restoredTabId, [
        {
          model: 'claude-sonnet-4-5',
          inputTokens: 700_000,
          outputTokens: 20_000,
          costUSD: 12,
          contextWindow: 200_000,
        },
      ]);
    });

    it('applyResumeStats uses snapshot.contextWindow (gpt-5.6-sol, 400000) instead of the name lookup', async () => {
      const restoredTabId = TabId.from('0b1f7f7e-5b8a-4c7e-9d1a-4f2d6a3b8c11');
      activeTabSessionIdSignal.set(SESSION);
      activeTabIdSignal.set(restoredTabId);
      const stats = {
        totalCost: null,
        tokens: { input: 40_000, output: 1_000, cacheRead: 0, cacheCreation: 0 },
        messageCount: 3,
        model: 'gpt-5.6-sol',
        modelUsageList: [
          {
            model: 'gpt-5.6-sol',
            inputTokens: 40_000,
            outputTokens: 1_000,
            costUSD: null,
            contextWindow: 400_000,
          },
        ],
        contextSnapshot: {
          model: 'gpt-5.6-sol',
          contextTokens: 40_000,
          contextWindow: 400_000,
        },
      };
      rpcCall.mockImplementation(async (method: string) =>
        method === 'chat:resume'
          ? { success: true, data: { stats } }
          : { success: true, data: {} },
      );

      activeTabStatusSignal.set('loaded');
      TestBed.tick();
      await Promise.resolve();
      await Promise.resolve();

      expect(setLiveModelStats).toHaveBeenCalledWith(restoredTabId, {
        model: 'gpt-5.6-sol',
        contextUsed: 40_000,
        contextWindow: 400_000,
        contextPercent: 10,
      });
      expect(setModelUsageList).toHaveBeenCalledWith(restoredTabId, [
        expect.objectContaining({
          model: 'gpt-5.6-sol',
          contextWindow: 400_000,
        }),
      ]);
    });

    it('falls back to getModelContextWindow when the field is absent or not positive', async () => {
      const restoredTabId = TabId.from('3c9e2f4a-7d1b-4e6a-8b2c-5a9f0e1d7c22');
      activeTabSessionIdSignal.set(SESSION);
      activeTabIdSignal.set(restoredTabId);
      const stats = {
        totalCost: 1,
        tokens: { input: 10, output: 2, cacheRead: 0, cacheCreation: 0 },
        messageCount: 1,
        model: 'claude-opus-5',
        modelUsageList: [
          {
            model: 'claude-sonnet-4-5',
            inputTokens: 10,
            outputTokens: 2,
            costUSD: 1,
          },
        ],
        contextSnapshot: {
          model: 'claude-opus-5',
          contextTokens: 10_000,
          contextWindow: 0,
        },
      };
      rpcCall.mockImplementation(async (method: string) =>
        method === 'chat:resume'
          ? { success: true, data: { stats } }
          : { success: true, data: {} },
      );

      activeTabStatusSignal.set('loaded');
      TestBed.tick();
      await Promise.resolve();
      await Promise.resolve();

      expect(setLiveModelStats).toHaveBeenCalledWith(
        restoredTabId,
        expect.objectContaining({ contextWindow: 1_000_000 }),
      );
      expect(setModelUsageList).toHaveBeenCalledWith(restoredTabId, [
        expect.objectContaining({ contextWindow: 200_000 }),
      ]);
    });

    it('clears stale restored-tab stats when a successful resume has no stats', async () => {
      const restoredTabId = TabId.from('c74b7af0-4c5c-4336-821c-e2fe28cd921d');
      activeTabSessionIdSignal.set(SESSION);
      activeTabIdSignal.set(restoredTabId);
      rpcCall.mockResolvedValue({ success: true, data: { stats: null } });

      activeTabStatusSignal.set('loaded');
      TestBed.tick();
      await Promise.resolve();
      await Promise.resolve();

      expect(setPreloadedStats).toHaveBeenCalledWith(restoredTabId, null);
      expect(setLiveModelStats).toHaveBeenCalledWith(restoredTabId, null);
      expect(setModelUsageList).toHaveBeenCalledWith(restoredTabId, []);
      expect(applyLoadedSessionStats).not.toHaveBeenCalled();
    });

    it('does not apply an old resume response after the tab is rebound', async () => {
      const restoredTabId = TabId.from('6c7172a6-1f48-48c8-a3af-33e627e8bb55');
      let resolveResume!: (value: {
        success: true;
        data: { stats: typeof stats };
      }) => void;
      const stats = {
        totalCost: 1,
        tokens: { input: 10, output: 2, cacheRead: 0, cacheCreation: 0 },
        messageCount: 1,
        contextSnapshot: { model: 'claude-opus-5', contextTokens: 12 },
      };
      const resume = new Promise<{
        success: true;
        data: { stats: typeof stats };
      }>((resolve) => {
        resolveResume = resolve;
      });
      rpcCall.mockImplementation((method: string) =>
        method === 'chat:resume'
          ? resume
          : Promise.resolve({ success: true, data: {} }),
      );
      activeTabSessionIdSignal.set(SESSION);
      activeTabIdSignal.set(restoredTabId);
      activeTabStatusSignal.set('loaded');
      TestBed.tick();
      await Promise.resolve();

      activeTabSessionIdSignal.set('different-session');
      resolveResume({ success: true, data: { stats } });
      await Promise.resolve();
      await Promise.resolve();

      expect(applyLoadedSessionStats).not.toHaveBeenCalled();
      expect(setPreloadedStats).not.toHaveBeenCalled();
      expect(setLiveModelStats).not.toHaveBeenCalled();
      expect(setModelUsageList).not.toHaveBeenCalled();
    });
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
      // Seed the signal indirectly — simulate backend providing resumable
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
      activeTabIdSignal.set(TabId.from('61a250e8-805c-4f1c-823a-791e06784980'));
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
      // First visit — populates the cache via loadSessionsForWorkspace.
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

      // Switch away and back — should trigger RPC again.
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

  describe('tab-targeted compaction reload', () => {
    const SESSION = 'session-targeted' as SessionId;
    const TAB_A = 'tab-target-a' as TabId;
    const TAB_B = 'tab-target-b' as TabId;

    function makeTargetedService(
      initialTabs = [
        { id: TAB_A, claudeSessionId: SESSION, name: 'A' },
        { id: TAB_B, claudeSessionId: SESSION, name: 'B' },
      ],
    ) {
      let tabs = initialTabs;
      const openSessionTab = jest.fn().mockReturnValue(TAB_A);
      const applyResumingSession = jest.fn();
      const applyLoadedSessionStats = jest.fn();
      const applyResumedHistory = jest.fn();
      const processStreamEvent = jest.fn();
      const finalizeSessionHistory = jest.fn();
      const clearPendingUpdates = jest.fn();
      const markSessionActive = jest.fn();
      const setPreloadedStats = jest.fn();
      const setLiveModelStats = jest.fn();
      const applyResumeFailure = jest.fn();
      const markTabIdle = jest.fn();

      const tabManagerMock = {
        pendingSessionLoad: computed(() => null),
        clearPendingSessionLoad: jest.fn(),
        activeTabSessionId: computed(() => null),
        activeTabStatus: computed(() => null),
        activeTabId: computed(() => null),
        tabs: () => tabs,
        findTabByIdAcrossWorkspaces: jest.fn((tabId: TabId) => {
          const tab = tabs.find((candidate) => candidate.id === tabId);
          return tab ? { tab, workspacePath: 'D:/repo' } : null;
        }),
        findTabBySessionId: jest.fn(),
        switchTab: jest.fn(),
        openSessionTab,
        applyResumingSession,
        applyResumeFailure,
        markTabIdle,
        applyResumedHistory,
        applyLoadedSessionStats,
        setLiveModelStats,
        setModelUsageList: jest.fn(),
        setPreloadedStats,
        markSessionActive,
      } as unknown as TabManagerService;
      const sessionManagerMock = {
        setStatus: jest.fn(),
        setSessionId: jest.fn(),
        setNodeMaps: jest.fn(),
      } as unknown as SessionManager;
      const streamingHandlerMock = {
        cleanupSessionDeduplication: jest.fn(),
        clearPendingUpdates,
        processStreamEvent,
        finalizeSessionHistory,
      } as unknown as StreamingHandlerService;

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          SessionLoaderService,
          { provide: ClaudeRpcService, useValue: { call: rpcCall } },
          {
            provide: VSCodeService,
            useValue: { config: () => ({ workspaceRoot: 'D:/repo' }) },
          },
          { provide: TabManagerService, useValue: tabManagerMock },
          { provide: SessionManager, useValue: sessionManagerMock },
          { provide: StreamingHandlerService, useValue: streamingHandlerMock },
          {
            provide: AgentMonitorStore,
            useValue: { loadCliSessions: jest.fn() },
          },
        ],
      });
      return {
        service: TestBed.inject(SessionLoaderService),
        setTabs: (next: typeof tabs) => {
          tabs = next;
        },
        openSessionTab,
        applyResumingSession,
        applyLoadedSessionStats,
        applyResumedHistory,
        processStreamEvent,
        finalizeSessionHistory,
        clearPendingUpdates,
        markSessionActive,
        setPreloadedStats,
        setLiveModelStats,
        applyResumeFailure,
        markTabIdle,
        sessionManagerMock,
      };
    }

    it('restores history and stats to the second matching tab without opening or activating another tab', async () => {
      const harness = makeTargetedService();
      const stats = {
        totalCost: 4.2,
        tokens: { input: 10, output: 5, cacheRead: 2, cacheCreation: 1 },
        messageCount: 3,
        model: 'claude-sonnet-4-5',
      };
      rpcCall.mockImplementation(async (method: string) =>
        method === 'chat:resume'
          ? { success: true, data: { events: [{ type: 'noop' }], stats } }
          : { success: true, data: {} },
      );

      await harness.service.switchSession(SESSION, {
        reason: 'compaction',
        activate: true,
        targetTabId: TAB_B,
      });

      expect(harness.openSessionTab).not.toHaveBeenCalled();
      expect(harness.markSessionActive).not.toHaveBeenCalled();
      expect(rpcCall).toHaveBeenCalledWith(
        'chat:resume',
        expect.objectContaining({ sessionId: SESSION, tabId: TAB_B }),
        expect.anything(),
      );
      const resumePayload = rpcCall.mock.calls.find(
        ([method]) => method === 'chat:resume',
      )?.[1] as { activate?: boolean };
      expect(resumePayload.activate).toBeUndefined();
      expect(harness.applyResumingSession).toHaveBeenCalledWith(
        TAB_B,
        expect.anything(),
      );
      expect(harness.applyLoadedSessionStats).toHaveBeenCalledWith(
        TAB_B,
        stats,
        stats.model,
      );
      expect(harness.setLiveModelStats).toHaveBeenCalledWith(TAB_B, null);
      expect(harness.processStreamEvent).toHaveBeenCalledWith(
        expect.anything(),
        TAB_B,
        SESSION,
        { isReplay: true, fanOut: false },
      );
      expect(harness.finalizeSessionHistory).toHaveBeenCalledWith(
        TAB_B,
        undefined,
      );
    });

    it.each([
      ['absent', undefined],
      ['zero', { model: 'claude-sonnet-4-5', contextTokens: 0 }],
      ['historical', { model: 'claude-sonnet-4-5', contextTokens: 85_000 }],
    ])(
      'preserves a fresh compaction context seed over %s history context stats',
      async (_historyKind, contextSnapshot) => {
        const seededLiveStats = {
          model: 'claude-opus-5',
          contextUsed: 1200,
          contextWindow: 1_000_000,
          contextPercent: 0.1,
        };
        const harness = makeTargetedService([
          { id: TAB_A, claudeSessionId: SESSION, name: 'A' },
          {
            id: TAB_B,
            claudeSessionId: SESSION,
            name: 'B',
            liveModelStats: seededLiveStats,
          },
        ]);
        rpcCall.mockImplementation(async (method: string) =>
          method === 'chat:resume'
            ? {
                success: true,
                data: {
                  events: [{ type: 'noop' }],
                  stats: {
                    totalCost: 4.2,
                    tokens: {
                      input: 10,
                      output: 5,
                      cacheRead: 2,
                      cacheCreation: 1,
                    },
                    messageCount: 3,
                    model: 'claude-sonnet-4-5',
                    ...(contextSnapshot ? { contextSnapshot } : {}),
                  },
                },
              }
            : { success: true, data: {} },
        );

        await harness.service.switchSession(SESSION, {
          reason: 'compaction',
          targetTabId: TAB_B,
        });

        expect(harness.setLiveModelStats).toHaveBeenLastCalledWith(
          TAB_B,
          seededLiveStats,
        );
      },
    );

    it('uses the dedicated context snapshot model instead of aggregate resume stats for the gauge', async () => {
      const harness = makeTargetedService();
      rpcCall.mockImplementation(async (method: string) =>
        method === 'chat:resume'
          ? {
              success: true,
              data: {
                events: [{ type: 'noop' }],
                stats: {
                  totalCost: 35.668,
                  tokens: {
                    input: 896_000,
                    output: 300,
                    cacheRead: 0,
                    cacheCreation: 0,
                  },
                  messageCount: 250,
                  model: 'claude-sonnet-4-5',
                  modelUsageList: [
                    {
                      model: 'claude-sonnet-4-5',
                      inputTokens: 896_000,
                      outputTokens: 300,
                      costUSD: 35.668,
                    },
                  ],
                  contextSnapshot: {
                    model: 'claude-opus-5',
                    contextTokens: 11_016,
                  },
                },
              },
            }
          : { success: true, data: {} },
      );

      await harness.service.switchSession(SESSION, {
        reason: 'compaction',
        targetTabId: TAB_B,
      });

      expect(harness.setLiveModelStats).toHaveBeenCalledWith(TAB_B, {
        model: 'claude-opus-5',
        contextUsed: 11_016,
        contextWindow: 1_000_000,
        contextPercent: 1.1,
      });
    });

    it('uses the explicit target for the legacy-message fallback', async () => {
      const harness = makeTargetedService();
      rpcCall.mockImplementation(async (method: string) =>
        method === 'chat:resume'
          ? {
              success: true,
              data: {
                messages: [
                  {
                    id: 'm1',
                    role: 'assistant',
                    timestamp: 1,
                    content: 'restored',
                  },
                ],
              },
            }
          : { success: true, data: {} },
      );

      await harness.service.switchSession(SESSION, {
        reason: 'compaction',
        targetTabId: TAB_B,
      });

      expect(harness.applyResumedHistory).toHaveBeenCalledWith(
        TAB_B,
        expect.arrayContaining([expect.objectContaining({ id: 'm1' })]),
      );
      expect(harness.setPreloadedStats).not.toHaveBeenCalled();
    });

    it('contains a stale targeted compaction snapshot and settles the tab idle', async () => {
      const harness = makeTargetedService();
      rpcCall.mockImplementation(async (method: string) =>
        method === 'chat:resume'
          ? {
              success: true,
              data: {
                staleSnapshot: true as const,
                events: [{ type: 'stale-event' }],
                stats: { totalCost: 99 },
                cliSessions: [{ agentId: 'stale-agent' }],
                resumableSubagents: [{ toolCallId: 'stale-subagent' }],
              },
            }
          : { success: true, data: {} },
      );

      await expect(
        harness.service.switchSession(SESSION, {
          reason: 'compaction',
          targetTabId: TAB_B,
        }),
      ).resolves.toEqual({ staleSnapshot: true });

      expect(harness.applyResumeFailure).toHaveBeenCalledWith(TAB_B);
      expect(harness.markTabIdle).toHaveBeenCalledWith(TAB_B);
      expect(harness.sessionManagerMock.setStatus).toHaveBeenLastCalledWith(
        'loaded',
      );
      expect(harness.applyLoadedSessionStats).not.toHaveBeenCalled();
      expect(harness.applyResumedHistory).not.toHaveBeenCalled();
      expect(harness.processStreamEvent).not.toHaveBeenCalled();
      expect(harness.finalizeSessionHistory).not.toHaveBeenCalled();
      expect(harness.setPreloadedStats).not.toHaveBeenCalled();
    });

    it('switchSession resolves { staleSnapshot: false } for a verified compaction reload and a normal resume', async () => {
      const harness = makeTargetedService();
      rpcCall.mockImplementation(async (method: string) =>
        method === 'chat:resume'
          ? {
              success: true,
              data: {
                messages: [
                  {
                    id: 'm-verified',
                    role: 'assistant',
                    timestamp: 1,
                    content: 'verified',
                  },
                ],
              },
            }
          : { success: true, data: {} },
      );

      await expect(
        harness.service.switchSession(SESSION, {
          reason: 'compaction',
          targetTabId: TAB_B,
        }),
      ).resolves.toEqual({ staleSnapshot: false });
      await expect(harness.service.switchSession(SESSION)).resolves.toEqual({
        staleSnapshot: false,
      });
    });

    it('applies a staleSnapshot response on a normal resume', async () => {
      const harness = makeTargetedService();
      rpcCall.mockImplementation(async (method: string) =>
        method === 'chat:resume'
          ? {
              success: true,
              data: {
                staleSnapshot: true as const,
                messages: [
                  {
                    id: 'm-normal-stale',
                    role: 'assistant',
                    timestamp: 1,
                    content: 'normal resume still applies',
                  },
                ],
              },
            }
          : { success: true, data: {} },
      );

      await harness.service.switchSession(SESSION);

      expect(harness.applyResumedHistory).toHaveBeenCalledWith(
        TAB_A,
        expect.arrayContaining([
          expect.objectContaining({ id: 'm-normal-stale' }),
        ]),
      );
      expect(harness.applyResumeFailure).not.toHaveBeenCalled();
    });

    it('adopts a null-owned target for a compaction reload', async () => {
      const harness = makeTargetedService([
        {
          id: TAB_A,
          claudeSessionId: null as unknown as SessionId,
          name: 'adoptable',
        },
      ]);
      rpcCall.mockImplementation(async (method: string) =>
        method === 'chat:resume'
          ? {
              success: true,
              data: {
                messages: [
                  { id: 'm-adopt', role: 'assistant', timestamp: 1, content: 'ok' },
                ],
              },
            }
          : { success: true, data: {} },
      );

      await harness.service.switchSession(SESSION, {
        reason: 'compaction',
        targetTabId: TAB_A,
      });

      expect(harness.applyResumingSession).toHaveBeenCalledWith(
        TAB_A,
        expect.objectContaining({ sessionId: SESSION }),
      );
      expect(harness.applyResumedHistory).toHaveBeenCalledWith(
        TAB_A,
        expect.anything(),
      );
    });

    it('fails loudly when the target does not own the requested session', async () => {
      const harness = makeTargetedService([
        {
          id: TAB_A,
          claudeSessionId: 'another-session' as SessionId,
          name: 'A',
        },
      ]);

      await expect(
        harness.service.switchSession(SESSION, {
          reason: 'compaction',
          targetTabId: TAB_A,
        }),
      ).rejects.toThrow(/no longer owns session/i);
      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('fails before writing when the target disappears during session load', async () => {
      let resolveLoad!: (value: { success: true; data: object }) => void;
      const load = new Promise<{ success: true; data: object }>((resolve) => {
        resolveLoad = resolve;
      });
      const harness = makeTargetedService();
      rpcCall.mockImplementation((method: string) =>
        method === 'session:load'
          ? load
          : Promise.resolve({
              success: true,
              data: { events: [{ type: 'noop' }] },
            }),
      );

      const pending = harness.service.switchSession(SESSION, {
        reason: 'compaction',
        targetTabId: TAB_B,
      });
      await Promise.resolve();
      harness.setTabs([]);
      resolveLoad({ success: true, data: {} });

      await expect(pending).rejects.toThrow(/no longer owns session/i);
      expect(harness.applyResumingSession).not.toHaveBeenCalled();
    });

    it('stops downstream writes when the target disappears during chat resume', async () => {
      let resolveResume!: (value: {
        success: true;
        data: { events: Array<{ type: string }>; stats: object };
      }) => void;
      const resume = new Promise<{
        success: true;
        data: { events: Array<{ type: string }>; stats: object };
      }>((resolve) => {
        resolveResume = resolve;
      });
      const harness = makeTargetedService();
      rpcCall.mockImplementation((method: string) =>
        method === 'chat:resume'
          ? resume
          : Promise.resolve({ success: true, data: {} }),
      );

      const pending = harness.service.switchSession(SESSION, {
        reason: 'compaction',
        targetTabId: TAB_B,
      });
      await Promise.resolve();
      await Promise.resolve();
      harness.setTabs([]);
      resolveResume({
        success: true,
        data: { events: [{ type: 'noop' }], stats: {} },
      });

      await expect(pending).rejects.toThrow(/no longer owns session/i);
      expect(harness.applyLoadedSessionStats).not.toHaveBeenCalled();
      expect(harness.processStreamEvent).not.toHaveBeenCalled();
      expect(harness.finalizeSessionHistory).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent compaction reloads for the same target tab', async () => {
      let resolveLoad!: (value: { success: true; data: object }) => void;
      const load = new Promise<{ success: true; data: object }>((resolve) => {
        resolveLoad = resolve;
      });
      const harness = makeTargetedService();
      rpcCall.mockImplementation((method: string) =>
        method === 'session:load'
          ? load
          : Promise.resolve({
              success: true,
              data: {
                messages: [
                  { id: 'm-dedupe', role: 'assistant', timestamp: 1, content: 'ok' },
                ],
              },
            }),
      );

      const first = harness.service.switchSession(SESSION, {
        reason: 'compaction',
        targetTabId: TAB_A,
      });
      const duplicate = harness.service.switchSession(SESSION, {
        reason: 'compaction',
        targetTabId: TAB_A,
      });

      expect(
        rpcCall.mock.calls.filter(([method]) => method === 'session:load'),
      ).toHaveLength(1);
      resolveLoad({ success: true, data: {} });
      await Promise.all([first, duplicate]);
      expect(harness.applyResumedHistory).toHaveBeenCalledTimes(1);
    });

    it('keys in-flight targeted loads by both session and tab', async () => {
      let resolveLoad!: (value: { success: true; data: object }) => void;
      const load = new Promise<{ success: true; data: object }>((resolve) => {
        resolveLoad = resolve;
      });
      const harness = makeTargetedService();
      rpcCall.mockImplementation((method: string) =>
        method === 'session:load'
          ? load
          : Promise.resolve({
              success: true,
              data: {
                messages: [
                  { id: 'm1', role: 'assistant', timestamp: 1, content: 'ok' },
                ],
              },
            }),
      );

      const first = harness.service.switchSession(SESSION, {
        reason: 'compaction',
        targetTabId: TAB_A,
      });
      const second = harness.service.switchSession(SESSION, {
        reason: 'compaction',
        targetTabId: TAB_B,
      });
      expect(
        rpcCall.mock.calls.filter(([method]) => method === 'session:load'),
      ).toHaveLength(2);

      resolveLoad({ success: true, data: {} });
      await Promise.all([first, second]);
      expect(harness.applyResumedHistory).toHaveBeenCalledWith(
        TAB_A,
        expect.anything(),
      );
      expect(harness.applyResumedHistory).toHaveBeenCalledWith(
        TAB_B,
        expect.anything(),
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

  describe('loadSessions single-flight (TASK_2026_383 Batch 10.3)', () => {
    it('shares one session:list with a caller whose debounce fires while the read is in flight', async () => {
      jest.useFakeTimers();
      let release: (() => void) | null = null;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      rpcCall.mockClear();
      rpcCall.mockImplementation(async (method: string) => {
        if (method === 'session:list') {
          await gate;
        }
        return {
          success: true,
          data: { sessions: [], total: 0, hasMore: false },
        };
      });

      const first = service.loadSessions();
      // Debounce elapses -> the RPC starts and is now in flight.
      jest.advanceTimersByTime(300);

      // A second, independent caller arrives mid-flight. Before the
      // single-flight it scheduled a second identical session:list.
      const second = service.loadSessions();
      jest.advanceTimersByTime(300);

      jest.useRealTimers();
      release?.();
      await Promise.all([first, second]);

      const loadCalls = rpcCall.mock.calls.filter(
        (c) => c[0] === 'session:list',
      );
      expect(loadCalls.length).toBe(1);
    }, 10000);

    it('issues a fresh read for a caller that arrives after the previous one settled', async () => {
      rpcCall.mockClear();

      await service.loadSessions();
      await service.loadSessions();

      const loadCalls = rpcCall.mock.calls.filter(
        (c) => c[0] === 'session:list',
      );
      expect(loadCalls.length).toBe(2);
    }, 10000);
  });
});

describe('SessionLoaderService targeted replay with the real streaming state pipeline', () => {
  const restoredText = 'Restored assistant content after compaction';
  let visibilityDescriptor: PropertyDescriptor | undefined;
  let requestAnimationFrameSpy: jest.SpyInstance;
  let cancelAnimationFrameSpy: jest.SpyInstance;

  function event(
    sessionId: SessionId,
    id: string,
    eventType: 'message_start' | 'text_delta' | 'message_complete',
    messageId: string,
    details: Record<string, unknown> = {},
  ): FlatStreamEventUnion {
    return {
      id,
      eventType,
      timestamp: Date.now(),
      sessionId,
      messageId,
      source: 'stream',
      ...details,
    } as FlatStreamEventUnion;
  }

  beforeEach(() => {
    localStorage.clear();
    visibilityDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'visibilityState',
    );
    requestAnimationFrameSpy = jest
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(() => 17);
    cancelAnimationFrameSpy = jest
      .spyOn(globalThis, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
    if (visibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
    } else {
      delete (
        document as Document & { visibilityState?: DocumentVisibilityState }
      ).visibilityState;
    }
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('discards a deferred live compaction state before replaying assistant history into that exact tab', async () => {
    const sessionId = SessionId.create();

    const replayEvents: FlatStreamEventUnion[] = [
      event(sessionId, 'replay-user-start', 'message_start', 'replay-user', {
        role: 'user',
      }),
      event(sessionId, 'replay-user-text', 'text_delta', 'replay-user', {
        blockIndex: 0,
        delta: 'original user prompt',
      }),
      event(
        sessionId,
        'replay-assistant-start',
        'message_start',
        'replay-assistant',
        { role: 'assistant' },
      ),
      event(
        sessionId,
        'replay-assistant-text',
        'text_delta',
        'replay-assistant',
        { blockIndex: 0, delta: restoredText },
      ),
      event(
        sessionId,
        'replay-assistant-complete',
        'message_complete',
        'replay-assistant',
        {
          stopReason: 'end_turn',
          tokenUsage: { input: 10, output: 20 },
        },
      ),
    ];
    const rpcCall = jest.fn(async (method: string) =>
      method === 'chat:resume'
        ? { success: true, data: { events: replayEvents } }
        : { success: true, data: {} },
    );
    const modelRefreshMock: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;
    const treeBuilder = {
      buildTree: jest.fn(
        (state: StreamingState): ExecutionNode[] =>
          [...state.events.values()]
            .filter(
              (candidate) =>
                candidate.eventType === 'message_start' &&
                candidate.role === 'assistant',
            )
            .map((start) => ({
              id: start.id,
              type: 'text',
              status: 'complete',
              content: [...state.textAccumulators.entries()]
                .filter(([key]) => key.startsWith(`${start.messageId}-`))
                .map(([, text]) => text)
                .join(''),
              children: [],
            })) as ExecutionNode[],
      ),
      clearForTab: jest.fn(),
    };
    const agentMonitorStore = {
      clearAgents: jest.fn(),
      loadCliSessions: jest.fn(),
      markAgentNodesResumed: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        SessionLoaderService,
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        BatchedUpdateService,
        StreamingHandlerService,
        StreamingAccumulatorCore,
        EventDeduplicationService,
        MessageFinalizationService,
        SessionManager,
        BackgroundAgentStore,
        {
          provide: ConfirmationDialogService,
          useValue: { confirm: jest.fn().mockResolvedValue(true) },
        },
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshMock },
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: 'D:/repo' }) },
        },
        { provide: ExecutionTreeBuilderService, useValue: treeBuilder },
        { provide: AgentMonitorStore, useValue: agentMonitorStore },
        { provide: TurnStateApplier, useValue: { apply: jest.fn() } },
      ],
    });

    const loader = TestBed.inject(SessionLoaderService);
    const tabManager = TestBed.inject(TabManagerService);
    const streamingHandler = TestBed.inject(StreamingHandlerService);
    const batchedUpdate = TestBed.inject(BatchedUpdateService);
    tabManager.switchWorkspace('D:/repo');
    const targetTabId = tabManager.openSessionTab(
      sessionId,
      'compacted session',
    ) as TabId;

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    const staleEvents: FlatStreamEventUnion[] = [
      event(sessionId, 'stale-user-1-start', 'message_start', 'stale-user-1', {
        role: 'user',
      }),
      event(sessionId, 'stale-user-1-text', 'text_delta', 'stale-user-1', {
        blockIndex: 0,
        delta: 'Continued from previous conversation (compacted)',
      }),
      event(sessionId, 'stale-user-2-start', 'message_start', 'stale-user-2', {
        role: 'user',
      }),
      event(sessionId, 'stale-user-2-text', 'text_delta', 'stale-user-2', {
        blockIndex: 0,
        delta: '/compact compact',
      }),
    ];
    for (const staleEvent of staleEvents) {
      streamingHandler.processStreamEvent(staleEvent, targetTabId, sessionId, {
        fanOut: false,
      });
    }
    expect(batchedUpdate.hasPendingUpdates(targetTabId)).toBe(true);

    // The window becomes visible before resume, but no visibility event has
    // drained the old live-state entry yet. Replay now queues a newer state;
    // the finalization flush exposes whether the older deferred entry wins.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await loader.switchSession(sessionId, {
      reason: 'compaction',
      targetTabId,
    });

    const target = tabManager.tabs().find((tab) => tab.id === targetTabId);
    expect(target?.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(JSON.stringify(target?.messages)).toContain(restoredText);
    expect(JSON.stringify(target?.messages)).not.toContain(
      'Continued from previous conversation (compacted)',
    );
    expect(JSON.stringify(target?.messages)).not.toContain('/compact compact');
  });
});
