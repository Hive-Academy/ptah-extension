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
import {
  SessionId,
  TabId as SharedTabId,
  type SdkCompactionCompletePayload,
} from '@ptah-extension/shared';

// Production `CompactionLifecycleService` calls `SessionId.from()` on every
// inbound session id (handleCompactionStart, handleCompactionComplete via
// compactionSessionId), and `TabId.from()` on the tabId for the
// closed-mid-compaction fallback path. Mint stable UUIDs once per spec run.
const SESS_1 = SessionId.create();
const SESS_RELOAD = SessionId.create();
const SESS_SHARED = SessionId.create();
const SESS_UNKNOWN = SessionId.create();
const SESS_X = SessionId.create();
// A live session id that has rotated away from the compacting session id —
// the canvas tile still points at it after an SDK session-id rotation.
const SESS_ROTATED = SessionId.create();
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
  let markCompactionCompleteMock: jest.Mock;
  let setCompactionMarkerTokensMock: jest.Mock;
  let setCompactionMarkerSummaryMock: jest.Mock;
  let conversationsMock: jest.Mock;
  let conversationForMock: jest.Mock;
  let tabsForMock: jest.Mock;
  let findContainingSessionMock: jest.Mock;
  let warn: jest.SpyInstance;

  // Each tab maps to a synthetic conversation id so registry writes are
  // observable without standing up the real binding service.
  const tabToConv: Record<string, ConversationId> = {
    'tab-1': 'conv-1' as unknown as ConversationId,
    'tab-2': 'conv-2' as unknown as ConversationId,
    'tab-3': 'conv-3' as unknown as ConversationId,
    // A canvas tile bound to the SAME conversation as `tab-1` (`conv-1`).
    // Used by the fan-out widening regression tests below.
    'tile-1': 'conv-1' as unknown as ConversationId,
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
    markCompactionCompleteMock = jest.fn();
    setCompactionMarkerTokensMock = jest.fn();
    setCompactionMarkerSummaryMock = jest.fn();
    conversationsMock = jest.fn(() => []);
    conversationForMock = jest.fn(
      (tabId: TabId) => tabToConv[tabId as unknown as string] ?? null,
    );
    // `tabsFor` mirrors the real binding by deriving membership from
    // `tabToConv` against whatever `tabs` the test sets, so the fan-out
    // conversation-expansion path resolves the same tiles a real workspace
    // would. Tabs with no `tabToConv` entry are treated as unbound.
    tabsForMock = jest.fn((convId: ConversationId) =>
      tabs
        .filter((t) => tabToConv[t.id as unknown as string] === convId)
        .map((t) => t.id),
    );
    // Defaults to "no containing conversation"; individual tests override to
    // exercise the SDK session-id-rotation branch.
    findContainingSessionMock = jest.fn(() => null);

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
      markCompactionComplete: markCompactionCompleteMock,
      setCompactionMarkerTokens: setCompactionMarkerTokensMock,
      setCompactionMarkerSummary: setCompactionMarkerSummaryMock,
      conversations: conversationsMock,
      findContainingSession: findContainingSessionMock,
    } as unknown as ConversationRegistry;

    const tabSessionBindingMock = {
      conversationFor: conversationForMock,
      tabsFor: tabsForMock,
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
      expect(switchSessionMock).toHaveBeenCalledWith(SESS_1, {
        reason: 'compaction',
      });
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
      expect(switchSessionMock).toHaveBeenCalledWith(SESS_SHARED, {
        reason: 'compaction',
      });
    });
  });

  // -------------------------------------------------------------------
  // N2 — widened fan-out to canvas tiles the plain `findTabsBySessionId`
  // path does NOT return. Regression for: after compaction a tile kept its
  // pre-compaction transcript because it was excluded from the fan-out, so
  // its `messages` were never cleared + reloaded in place. The widening
  // unions in (1) tabs whose `claudeSessionId === compactionSessionId`
  // directly, and (2) tabs bound to the same conversation(s).
  // -------------------------------------------------------------------
  describe('N2 — handleCompactionComplete widens the fan-out to excluded tiles', () => {
    it('includes a same-conversation tile whose claudeSessionId has rotated (not returned by findTabsBySessionId)', () => {
      // Originating tab-1 is on the compacting session. The tile shares the
      // SAME conversation (conv-1) but its live session id has rotated to
      // SESS_ROTATED, so `findTabsBySessionId(compactionSessionId)` returns
      // ONLY tab-1 — the tile is excluded from the plain path.
      tabs = [
        makeTab({
          id: 'tab-1',
          claudeSessionId: SESS_SHARED,
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
          compactionCount: 0,
        }),
        makeTab({
          id: 'tile-1',
          claudeSessionId: SESS_ROTATED,
          messages: [{ id: 'm2' } as unknown as TabState['messages'][number]],
          compactionCount: 3,
        }),
      ];

      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_SHARED,
      });

      // Plain path would only match tab-1; assert the tile is fanned out too.
      expect(findTabsBySessionIdMock).toHaveReturnedWith([tabs[0]]);
      // The tile's stale `messages` are cleared in place via
      // applyCompactionComplete (count incremented from its own value).
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
          ['tile-1', 4],
        ] as const),
      );
      expect(markTabIdleMock).toHaveBeenCalledWith('tile-1');
      // The tile is reloaded from disk via its own (rotated) session id.
      expect(switchSessionMock).toHaveBeenCalledWith(SESS_ROTATED, {
        reason: 'compaction',
      });
    });

    it('includes an UNBOUND tile whose claudeSessionId equals compactionSessionId via the direct-match path', () => {
      // Simulate the registry-driven lookup EXCLUDING an unbound tile: the
      // plain path returns []. The tile is not in `tabToConv` (unbound), so
      // only the direct claudeSessionId scan of `tabManager.tabs()` can
      // rescue it.
      findTabsBySessionIdMock.mockReturnValue([]);
      tabs = [
        makeTab({
          id: 'tab-1',
          claudeSessionId: SESS_SHARED,
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
        }),
        makeTab({
          id: 'tile-unbound',
          claudeSessionId: SESS_SHARED,
          messages: [{ id: 'm2' } as unknown as TabState['messages'][number]],
        }),
      ];

      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_SHARED,
      });

      const clearedTabIds = applyCompactionCompleteMock.mock.calls.map(
        (c) => c[0],
      );
      expect(clearedTabIds).toEqual(
        expect.arrayContaining(['tab-1', 'tile-unbound']),
      );
      expect(markTabIdleMock).toHaveBeenCalledWith('tile-unbound');
    });

    it('includes a tile via findContainingSession when the originating tab is unbound', () => {
      // The originating tab ('tab-orphan') has NO conversation binding
      // (absent from `tabToConv`), so the conversation for the fan-out can
      // only be discovered by resolving the compacting session through the
      // registry. `findContainingSession` returns conv-1, whose expansion
      // pulls in the same-conversation tile ('tile-1', rotated session id so
      // the direct-match path also misses it).
      findContainingSessionMock.mockReturnValue({
        id: tabToConv['tile-1'],
      });
      tabs = [
        makeTab({
          id: 'tab-orphan',
          claudeSessionId: SESS_SHARED,
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
        }),
        makeTab({
          id: 'tile-1',
          claudeSessionId: SESS_ROTATED,
          messages: [{ id: 'm2' } as unknown as TabState['messages'][number]],
        }),
      ];

      service.handleCompactionComplete({
        tabId: 'tab-orphan',
        compactionSessionId: SESS_SHARED,
      });

      expect(findContainingSessionMock).toHaveBeenCalledWith(SESS_SHARED);
      const clearedTabIds = applyCompactionCompleteMock.mock.calls.map(
        (c) => c[0],
      );
      expect(clearedTabIds).toEqual(
        expect.arrayContaining(['tab-orphan', 'tile-1']),
      );
      expect(switchSessionMock).toHaveBeenCalledWith(SESS_ROTATED, {
        reason: 'compaction',
      });
    });

    it('reloads a widened tile with a null claudeSessionId via the compactionSessionId fallback', () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          claudeSessionId: SESS_SHARED,
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
        }),
        makeTab({
          id: 'tile-1',
          claudeSessionId: null as unknown as SessionId,
          messages: [{ id: 'm2' } as unknown as TabState['messages'][number]],
        }),
      ];

      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_SHARED,
      });

      // Tile is cleared in place...
      const clearedTabIds = applyCompactionCompleteMock.mock.calls.map(
        (c) => c[0],
      );
      expect(clearedTabIds).toEqual(
        expect.arrayContaining(['tab-1', 'tile-1']),
      );
      // ...and the null-session tile still reloads via the compaction session.
      expect(switchSessionMock).toHaveBeenCalledWith(SESS_SHARED, {
        reason: 'compaction',
      });
    });
  });

  describe('compaction marker (token + summary merge inputs)', () => {
    it('handleCompactionComplete upserts token fields into the marker', () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          claudeSessionId: SESS_RELOAD,
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
        }),
      ];

      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_RELOAD,
        preTokens: 8000,
        postTokens: 1500,
        durationMs: 1200,
      });

      expect(setCompactionMarkerTokensMock).toHaveBeenCalledWith(
        tabToConv['tab-1'],
        expect.objectContaining({
          preTokens: 8000,
          postTokens: 1500,
          durationMs: 1200,
        }),
      );
    });

    it('handleCompactionComplete passes null token fields when the event omits them', () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          claudeSessionId: SESS_RELOAD,
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
        }),
      ];

      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_RELOAD,
      });

      expect(setCompactionMarkerTokensMock).toHaveBeenCalledWith(
        tabToConv['tab-1'],
        expect.objectContaining({
          preTokens: null,
          postTokens: null,
          durationMs: null,
        }),
      );
    });

    it('handleCompactionComplete reloads the session with { reason: compaction }', () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          claudeSessionId: SESS_RELOAD,
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
        }),
      ];

      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: SESS_RELOAD,
      });

      expect(switchSessionMock).toHaveBeenCalledWith(SESS_RELOAD, {
        reason: 'compaction',
      });
    });
  });

  describe('handleCompactionCompleteNotification (PostCompact RPC path)', () => {
    function makePayload(
      overrides: Partial<SdkCompactionCompletePayload> = {},
    ): SdkCompactionCompletePayload {
      return {
        sessionId: SESS_1,
        cwd: '/workspace',
        trigger: 'auto',
        compactSummary: 'summary',
        timestamp: 1_700_000_000_123,
        ...overrides,
      };
    }

    it('stamps the registry per conversation when tabs are bound to the session', () => {
      tabs = [makeTab({ id: 'tab-1', claudeSessionId: SESS_1 })];

      service.handleCompactionCompleteNotification(makePayload());

      expect(markCompactionCompleteMock).toHaveBeenCalledTimes(1);
      expect(markCompactionCompleteMock).toHaveBeenCalledWith(
        tabToConv['tab-1'],
        1_700_000_000_123,
      );
    });

    it('upserts the compaction marker summary from payload.compactSummary', () => {
      tabs = [makeTab({ id: 'tab-1', claudeSessionId: SESS_1 })];

      service.handleCompactionCompleteNotification(
        makePayload({ compactSummary: 'the recap text' }),
      );

      expect(setCompactionMarkerSummaryMock).toHaveBeenCalledWith(
        tabToConv['tab-1'],
        { summary: 'the recap text', completedAt: 1_700_000_000_123 },
      );
    });

    it('fans out across multiple tabs sharing the session, deduping by conversation id', () => {
      tabs = [
        makeTab({ id: 'tab-1', claudeSessionId: SESS_SHARED }),
        makeTab({ id: 'tab-2', claudeSessionId: SESS_SHARED }),
      ];

      service.handleCompactionCompleteNotification(
        makePayload({ sessionId: SESS_SHARED }),
      );

      const stampedConvIds = markCompactionCompleteMock.mock.calls.map(
        (c) => c[0],
      );
      expect(stampedConvIds).toEqual(
        expect.arrayContaining([tabToConv['tab-1'], tabToConv['tab-2']]),
      );
      expect(markCompactionCompleteMock).toHaveBeenCalledTimes(2);
    });

    it('warns and no-ops when no tab is bound to the session id', () => {
      tabs = [];

      service.handleCompactionCompleteNotification(
        makePayload({ sessionId: SESS_UNKNOWN }),
      );

      expect(markCompactionCompleteMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleCompactionCompleteNotification: no tab bound to sessionId',
        { sessionId: SESS_UNKNOWN },
      );
    });

    it('warns and no-ops when tabs exist but none resolves to a conversation id', () => {
      tabs = [makeTab({ id: 'tab-orphan', claudeSessionId: SESS_1 })];

      service.handleCompactionCompleteNotification(makePayload());

      expect(markCompactionCompleteMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleCompactionCompleteNotification: no conversation bound to tabs',
        { sessionId: SESS_1 },
      );
    });

    it('does not throw when the registry throws on a stale conversation id', () => {
      tabs = [makeTab({ id: 'tab-1', claudeSessionId: SESS_1 })];
      markCompactionCompleteMock.mockImplementation(() => {
        throw new Error('unknown conversation');
      });

      expect(() =>
        service.handleCompactionCompleteNotification(makePayload()),
      ).not.toThrow();

      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleCompactionCompleteNotification: registry stamp failed',
        expect.objectContaining({
          convId: tabToConv['tab-1'],
          error: 'unknown conversation',
        }),
      );
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
