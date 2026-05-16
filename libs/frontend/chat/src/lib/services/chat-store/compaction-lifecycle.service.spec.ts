/**
 * CompactionLifecycleService specs â€” SDK session-compaction state machine.
 *
 * Coverage:
 *   - handleCompactionStart writes inFlight=true on the conversation registry
 *   - handleCompactionStart early-returns + warns when no tab matches sessionId
 *   - handleCompactionStart clears prior timeout before scheduling new one
 *   - Safety timeout fires: resets tab, marks idle, sets sessionManager loaded
 *   - handleCompactionComplete clears tree-builder cache, snapshots preloadedStats
 *   - handleCompactionComplete early-returns when tab no longer exists
 *   - clearCompactionStateForTab clears registry inFlight via tab→conv lookup
 *   - clearCompactionState(tabId) clears specified conversation + timeout
 *   - clearCompactionState(undefined) sweeps all in-flight conversations
 *
 * `ConversationRegistry` is the single source of truth for compaction state.
 * Per-tab `isCompacting` writes are gone; this spec asserts registry writes
 * via `setCompactionState` instead.
 */

import { TestBed } from '@angular/core/testing';
import { CompactionLifecycleService } from './compaction-lifecycle.service';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
  ConversationId,
  type TabId,
} from '@ptah-extension/chat-state';
import {
  SessionManager,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import { SessionLoaderService } from './session-loader.service';
import type { TabState } from '@ptah-extension/chat-types';
import { SessionId, TabId as SharedTabId } from '@ptah-extension/shared';

// Production `CompactionLifecycleService` calls `SessionId.from()` on every
// inbound session id (handleCompactionStart, handleCompactionComplete via
// compactionSessionId), and `TabId.from()` on the tabId for the
// closed-mid-compaction fallback path. Mint stable UUIDs once per spec run.
const SESS_1 = SessionId.create();
const SESS_RELOAD = SessionId.create();
const SESS_SHARED = SessionId.create();
const SESS_UNKNOWN = SessionId.create();
const SESS_X = SessionId.create();
const NONEXISTENT_TAB_ID = SharedTabId.create();

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Tab 1',
    status: 'streaming',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: SESS_1,
    isCompacting: false,
    compactionCount: 0,
    queuedContent: null,
    queuedOptions: null,
    preloadedStats: null,
    liveModelStats: null,
    modelUsageList: null,
    ...overrides,
  } as unknown as TabState;
}

describe('CompactionLifecycleService', () => {
  let service: CompactionLifecycleService;
  let tabs: TabState[];
  let applyCompactionTimeoutResetMock: jest.Mock;
  let applyCompactionCompleteMock: jest.Mock;
  let findTabsBySessionIdMock: jest.Mock;
  let markTabIdleMock: jest.Mock;
  let setStatusMock: jest.Mock;
  let clearCacheMock: jest.Mock;
  let switchSessionMock: jest.Mock;
  let setCompactionStateMock: jest.Mock;
  let conversationsMock: jest.Mock;
  let conversationForMock: jest.Mock;
  let warn: jest.SpyInstance;

  // Each tab maps to a synthetic conversation id so registry writes are
  // observable without standing up the real binding service.
  const tabToConv: Record<string, ConversationId> = {
    'tab-1': 'conv-1' as unknown as ConversationId,
    'tab-2': 'conv-2' as unknown as ConversationId,
    'tab-3': 'conv-3' as unknown as ConversationId,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    tabs = [makeTab()];
    applyCompactionTimeoutResetMock = jest.fn();
    applyCompactionCompleteMock = jest.fn();
    // Service uses plural fan-out lookup.
    findTabsBySessionIdMock = jest.fn((sessionId: string) =>
      tabs.filter((t) => t.claudeSessionId === sessionId),
    );
    markTabIdleMock = jest.fn();
    setStatusMock = jest.fn();
    clearCacheMock = jest.fn();
    switchSessionMock = jest.fn().mockResolvedValue(undefined);
    setCompactionStateMock = jest.fn();
    conversationsMock = jest.fn(() => []);
    conversationForMock = jest.fn(
      (tabId: TabId) => tabToConv[tabId as unknown as string] ?? null,
    );

    const tabManagerMock = {
      applyCompactionTimeoutReset: applyCompactionTimeoutResetMock,
      applyCompactionComplete: applyCompactionCompleteMock,
      findTabsBySessionId: findTabsBySessionIdMock,
      markTabIdle: markTabIdleMock,
      tabs: () => tabs,
    } as unknown as TabManagerService;

    const sessionManagerMock = {
      setStatus: setStatusMock,
    } as unknown as SessionManager;

    const treeBuilderMock = {
      clearCache: clearCacheMock,
    } as unknown as ExecutionTreeBuilderService;

    const sessionLoaderMock = {
      switchSession: switchSessionMock,
    } as unknown as SessionLoaderService;

    const conversationRegistryMock = {
      setCompactionState: setCompactionStateMock,
      conversations: conversationsMock,
    } as unknown as ConversationRegistry;

    const tabSessionBindingMock = {
      conversationFor: conversationForMock,
    } as unknown as TabSessionBinding;

    warn = jest.spyOn(console, 'warn').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        CompactionLifecycleService,
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: SessionManager, useValue: sessionManagerMock },
        { provide: ExecutionTreeBuilderService, useValue: treeBuilderMock },
        { provide: SessionLoaderService, useValue: sessionLoaderMock },
        { provide: ConversationRegistry, useValue: conversationRegistryMock },
        { provide: TabSessionBinding, useValue: tabSessionBindingMock },
      ],
    });
    service = TestBed.inject(CompactionLifecycleService);
  });

  afterEach(() => {
    warn.mockRestore();
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  describe('handleCompactionStart', () => {
    it('writes inFlight=true on the conversation registry and schedules safety timeout', () => {
      service.handleCompactionStart(SESS_1);
      expect(setCompactionStateMock).toHaveBeenCalledWith(
        tabToConv['tab-1'],
        expect.objectContaining({ inFlight: true }),
      );
    });

    it('warns and does nothing when no tab matches sessionId', () => {
      service.handleCompactionStart(SESS_UNKNOWN);
      expect(setCompactionStateMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleCompactionStart: no tab found for sessionId',
        { sessionId: SESS_UNKNOWN },
      );
    });

    it('clears prior timeout before scheduling new one', () => {
      service.handleCompactionStart(SESS_1);
      service.handleCompactionStart(SESS_1);
      // Advance time to verify only ONE timeout fires (the second one)
      jest.advanceTimersByTime(120000);
      expect(applyCompactionTimeoutResetMock).toHaveBeenCalledTimes(1);
    });

    it('safety timeout resets tab fields, marks idle, sets sessionManager loaded', () => {
      service.handleCompactionStart(SESS_1);
      jest.advanceTimersByTime(120000);
      expect(applyCompactionTimeoutResetMock).toHaveBeenCalledWith('tab-1');
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-1');
      expect(setStatusMock).toHaveBeenCalledWith('loaded');
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] Compaction safety timeout reached â€” compaction_complete event may have been lost',
      );
    });
  });

  describe('handleCompactionComplete', () => {
    it('clears tree-builder cache, resets tab, increments compactionCount, switches session', () => {
      tabs = [
        makeTab({
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
          compactionCount: 2,
        }),
      ];
      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_RELOAD,
      });
      expect(clearCacheMock).toHaveBeenCalled();
      expect(applyCompactionCompleteMock).toHaveBeenCalledWith(
        'tab-1',
        expect.objectContaining({ compactionCount: 3 }),
      );
      expect(switchSessionMock).toHaveBeenCalledWith(SESS_1);
    });

    it('snapshots preloadedStats when none exist and messages are present', () => {
      tabs = [
        makeTab({
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
          preloadedStats: null,
        }),
      ];
      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_RELOAD,
      });
      const call = applyCompactionCompleteMock.mock.calls.find(
        (c) => (c[1] as { compactionCount: number }).compactionCount === 1,
      );
      expect(call).toBeDefined();
      const payload = (
        call as unknown as [string, { preloadedStats: unknown }]
      )[1];
      expect(payload.preloadedStats).toBeDefined();
    });

    it('does nothing when tab no longer exists', () => {
      service.handleCompactionComplete({
        tabId: NONEXISTENT_TAB_ID,
        compactionSessionId: SESS_X,
      });
      // tree builder cache still cleared from clearCompactionState path
      expect(switchSessionMock).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------
    // Additional regression gates.
    // -----------------------------------------------------------------

    it('B2 — resets preloadedStats.tokens to zero {0,0,0,0} while preserving totalCost (lifetime cost)', () => {
      tabs = [
        makeTab({
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
          preloadedStats: {
            totalCost: 2.34,
            tokens: {
              input: 1000,
              output: 500,
              cacheRead: 100,
              cacheCreation: 50,
            },
            messageCount: 7,
          },
        }),
      ];

      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_RELOAD,
      });

      expect(applyCompactionCompleteMock).toHaveBeenCalledTimes(1);
      const [, payload] = applyCompactionCompleteMock.mock.calls[0] as [
        string,
        {
          preloadedStats: {
            totalCost: number;
            tokens: {
              input: number;
              output: number;
              cacheRead: number;
              cacheCreation: number;
            };
            messageCount: number;
          };
        },
      ];
      expect(payload.preloadedStats.tokens).toEqual({
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
      });
      // Cumulative session cost ($) survives the boundary — only context-fill
      // tokens reset. messageCount is also preserved.
      expect(payload.preloadedStats.totalCost).toBeCloseTo(2.34);
      expect(payload.preloadedStats.messageCount).toBe(7);
    });

    it('B4 — flips suppressAnimateOnce true synchronously and resets it via microtask', async () => {
      tabs = [
        makeTab({
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
        }),
      ];

      expect(service.suppressAnimateOnce()).toBe(false);

      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_RELOAD,
      });

      // Synchronously after the call: suppression must be ON for the
      // current change-detection tick.
      expect(service.suppressAnimateOnce()).toBe(true);

      // After a microtask flush, the flag returns to false. The outer suite
      // uses jest.useFakeTimers() (legacy timers do not drain microtasks
      // via Promise.resolve), so explicitly advance both timer queues.
      jest.runAllTicks();
      await Promise.resolve();
      expect(service.suppressAnimateOnce()).toBe(false);
    });

    it('C1 — writes through ConversationRegistry.setCompactionState on complete (clears inFlight)', async () => {
      tabs = [
        makeTab({
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
        }),
      ];

      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_RELOAD,
      });

      // inFlight is cleared in the `switchSession(...).finally(...)` settle
      // handler, so we must drain the microtask queue before asserting. Both
      // timer queues advance to ensure the finally handler in the fan-out
      // path fires.
      jest.runAllTicks();
      await Promise.resolve();
      await Promise.resolve();

      // The complete path goes through `clearCompactionState(tabId)` which
      // resolves the conversation id via the binding and writes
      // {inFlight:false} — the single source of truth lives in the registry.
      expect(setCompactionStateMock).toHaveBeenCalledWith(tabToConv['tab-1'], {
        inFlight: false,
      });
    });
  });

  // -------------------------------------------------------------------
  // Registry write-through is exercised on BOTH the start and complete
  // halves of the lifecycle. The "start" assertion already covers
  // `inFlight:true` above; this test pins the pair.
  // -------------------------------------------------------------------
  describe('C1 registry write-through (start + complete)', () => {
    it('writes inFlight=true on start and inFlight=false on complete for the same conversation id', async () => {
      tabs = [
        makeTab({
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
        }),
      ];

      service.handleCompactionStart(SESS_1);
      expect(setCompactionStateMock).toHaveBeenCalledWith(
        tabToConv['tab-1'],
        expect.objectContaining({ inFlight: true }),
      );

      setCompactionStateMock.mockClear();

      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_RELOAD,
      });
      // inFlight clear is async (settles after the switchSession reload
      // promise). Drain microtasks before asserting.
      jest.runAllTicks();
      await Promise.resolve();
      await Promise.resolve();
      expect(setCompactionStateMock).toHaveBeenCalledWith(tabToConv['tab-1'], {
        inFlight: false,
      });
    });
  });

  // -------------------------------------------------------------------
  // Symmetric fan-out on handleCompactionComplete.
  // Start fanned out to all session-bound tabs but Complete only reset the
  // originating tab; siblings kept stale messages + banners. The Complete
  // path now resolves all tabs bound to compactionSessionId and applies
  // applyCompactionComplete + markTabIdle to each. Reload via switchSession
  // is deduped by unique claudeSessionId.
  // -------------------------------------------------------------------
  describe('N1 — handleCompactionComplete fans out to sibling tabs', () => {
    it('applies applyCompactionComplete + markTabIdle to every tab bound to compactionSessionId', () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          claudeSessionId: SESS_SHARED,
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
          compactionCount: 0,
        }),
        makeTab({
          id: 'tab-2',
          claudeSessionId: SESS_SHARED,
          messages: [{ id: 'm2' } as unknown as TabState['messages'][number]],
          compactionCount: 4,
        }),
      ];

      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_SHARED,
      });

      // Both tabs reset; per-tab compactionCount incremented from its own value.
      const calls = applyCompactionCompleteMock.mock.calls.map(
        (c) =>
          [
            c[0],
            (c[1] as { compactionCount: number }).compactionCount,
          ] as const,
      );
      expect(calls).toEqual(
        expect.arrayContaining([
          ['tab-1', 1],
          ['tab-2', 5],
        ] as const),
      );
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-1');
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-2');
    });

    it('dedupes switchSession reload by unique claudeSessionId', () => {
      // Both tiles share the same on-disk session — only one reload should fire.
      tabs = [
        makeTab({
          id: 'tab-1',
          claudeSessionId: SESS_SHARED,
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
        }),
        makeTab({
          id: 'tab-2',
          claudeSessionId: SESS_SHARED,
          messages: [],
        }),
      ];

      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_SHARED,
      });

      expect(switchSessionMock).toHaveBeenCalledTimes(1);
      expect(switchSessionMock).toHaveBeenCalledWith(SESS_SHARED);
    });
  });

  describe('clearCompactionStateForTab', () => {
    it('clears registry inFlight via tab→conversation lookup', () => {
      service.clearCompactionStateForTab('tab-1');
      expect(setCompactionStateMock).toHaveBeenCalledWith(tabToConv['tab-1'], {
        inFlight: false,
      });
    });
  });

  describe('clearCompactionState', () => {
    it('clears specified conversation and the timeout', () => {
      service.handleCompactionStart(SESS_1);
      setCompactionStateMock.mockClear();
      service.clearCompactionState('tab-1');
      expect(setCompactionStateMock).toHaveBeenCalledWith(tabToConv['tab-1'], {
        inFlight: false,
      });
      jest.advanceTimersByTime(120000);
      // No safety-timeout reset call should appear
      expect(applyCompactionTimeoutResetMock).not.toHaveBeenCalled();
    });

    it('without tabId, sweeps all in-flight conversations', () => {
      const c1 = tabToConv['tab-1'];
      const c2 = tabToConv['tab-2'];
      const c3 = tabToConv['tab-3'];
      conversationsMock.mockReturnValue([
        { id: c1, compactionInFlight: true },
        { id: c2, compactionInFlight: true },
        { id: c3, compactionInFlight: false },
      ]);
      service.clearCompactionState();
      expect(setCompactionStateMock).toHaveBeenCalledWith(c1, {
        inFlight: false,
      });
      expect(setCompactionStateMock).toHaveBeenCalledWith(c2, {
        inFlight: false,
      });
      expect(setCompactionStateMock).not.toHaveBeenCalledWith(c3, {
        inFlight: false,
      });
    });
  });
});
