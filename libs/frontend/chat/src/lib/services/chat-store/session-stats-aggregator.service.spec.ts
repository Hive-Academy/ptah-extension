/**
 * SessionStatsAggregatorService specs â€” SESSION_STATS aggregation.
 *
 * Coverage:
 *   - findTabBySessionId resolves correct tab
 *   - falls back to active tab when sessionId lookup fails (warns)
 *   - primary-model selection: highest costUSD wins
 *   - single-model array uses [0] without reduce
 *   - contextUsed uses lastTurnContextTokens when present
 *   - contextUsed falls back to inputTokens + cacheReadInputTokens + outputTokens
 *   - contextPercent rounding to 1 decimal place
 *   - accumulates preloadedStats with new turn data
 *   - clears compaction state via CompactionLifecycleService
 *   - calls streamingHandler.handleSessionStats and triggers auto-send
 *   - refreshes sidebar via SessionLoader.loadSessions
 */

import { TestBed } from '@angular/core/testing';
import { SessionStatsAggregatorService } from './session-stats-aggregator.service';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import { StreamingHandlerService } from '@ptah-extension/chat-streaming';
import { SessionLoaderService } from './session-loader.service';
import { CompactionLifecycleService } from './compaction-lifecycle.service';
import { MessageDispatchService } from './message-dispatch.service';
import type { TabState } from '@ptah-extension/chat-types';

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
    preloadedStats: null,
    liveModelStats: null,
    modelUsageList: null,
    ...overrides,
  } as unknown as TabState;
}

const baseStats = {
  sessionId: 'sess-1',
  cost: 0.5,
  tokens: { input: 100, output: 50, cacheRead: 10, cacheCreation: 5 },
  duration: 1000,
};

describe('SessionStatsAggregatorService', () => {
  let service: SessionStatsAggregatorService;
  let tabs: TabState[];
  let setLiveModelStatsAndUsageListMock: jest.Mock;
  let setPreloadedStatsMock: jest.Mock;
  let findTabsBySessionIdMock: jest.Mock;
  let activeTabMock: jest.Mock;
  let streamHandleStatsMock: jest.Mock;
  let loadSessionsMock: jest.Mock;
  let clearCompactionStateMock: jest.Mock;
  let sendQueuedMock: jest.Mock;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    tabs = [makeTab()];
    setLiveModelStatsAndUsageListMock = jest.fn();
    setPreloadedStatsMock = jest.fn();
    // Service uses plural fan-out lookup.
    findTabsBySessionIdMock = jest.fn((sid: string) =>
      tabs.filter((t) => t.claudeSessionId === sid),
    );
    activeTabMock = jest.fn(() => tabs[0] ?? null);
    streamHandleStatsMock = jest.fn().mockReturnValue(null);
    loadSessionsMock = jest.fn().mockResolvedValue(undefined);
    clearCompactionStateMock = jest.fn();
    sendQueuedMock = jest.fn();
    warn = jest.spyOn(console, 'warn').mockImplementation();

    const tabManagerMock = {
      findTabsBySessionId: findTabsBySessionIdMock,
      activeTab: activeTabMock,
      setLiveModelStatsAndUsageList: setLiveModelStatsAndUsageListMock,
      setPreloadedStats: setPreloadedStatsMock,
    } as unknown as TabManagerService;
    const streamingHandlerMock = {
      handleSessionStats: streamHandleStatsMock,
    } as unknown as StreamingHandlerService;
    const sessionLoaderMock = {
      loadSessions: loadSessionsMock,
    } as unknown as SessionLoaderService;
    const compactionMock = {
      clearCompactionState: clearCompactionStateMock,
    } as unknown as CompactionLifecycleService;
    const dispatchMock = {
      sendQueuedMessage: sendQueuedMock,
    } as unknown as MessageDispatchService;
    // `isLateAfterCompaction` reads from
    // ConversationRegistry / TabSessionBinding. Tests in this file create
    // tabs with no conversation binding so the fallback (per-tab
    // `lastCompactionAt`) drives the grace-window check; the registry is
    // never consulted because `conversationFor` returns null.
    const conversationRegistryMock = {
      compactionStateFor: jest.fn(() => null),
    } as unknown as ConversationRegistry;
    const tabSessionBindingMock = {
      conversationFor: jest.fn(() => null),
    } as unknown as TabSessionBinding;

    TestBed.configureTestingModule({
      providers: [
        SessionStatsAggregatorService,
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: StreamingHandlerService, useValue: streamingHandlerMock },
        { provide: SessionLoaderService, useValue: sessionLoaderMock },
        { provide: CompactionLifecycleService, useValue: compactionMock },
        { provide: MessageDispatchService, useValue: dispatchMock },
        { provide: ConversationRegistry, useValue: conversationRegistryMock },
        { provide: TabSessionBinding, useValue: tabSessionBindingMock },
      ],
    });
    service = TestBed.inject(SessionStatsAggregatorService);
  });

  afterEach(() => {
    warn.mockRestore();
    TestBed.resetTestingModule();
  });

  it('finds tab by sessionId and clears compaction state', () => {
    service.handleSessionStats(baseStats);
    expect(findTabsBySessionIdMock).toHaveBeenCalledWith('sess-1');
    expect(clearCompactionStateMock).toHaveBeenCalledWith('tab-1');
  });

  // Drop active-tab fallback. Was: fall back to activeTab when
  // findTabsBySessionId returned empty. Now: warn and drop the event so
  // foreign-session stats cannot pollute the active tab during a tab switch.
  it('N7 — drops the event without active-tab fallback when no tab is bound', () => {
    findTabsBySessionIdMock.mockReturnValue([]);
    service.handleSessionStats({ ...baseStats, sessionId: 'unknown' });
    expect(warn).toHaveBeenCalledWith(
      '[ChatStore] handleSessionStats: no tab bound to sessionId, dropping event',
      { sessionId: 'unknown' },
    );
    // None of the downstream side-effects fire — the event is fully dropped.
    expect(setLiveModelStatsAndUsageListMock).not.toHaveBeenCalled();
    expect(setPreloadedStatsMock).not.toHaveBeenCalled();
    expect(streamHandleStatsMock).not.toHaveBeenCalled();
    expect(loadSessionsMock).not.toHaveBeenCalled();
    expect(clearCompactionStateMock).not.toHaveBeenCalled();
  });

  describe('primary-model selection', () => {
    it('highest costUSD wins', () => {
      service.handleSessionStats({
        ...baseStats,
        modelUsage: [
          {
            model: 'haiku',
            inputTokens: 100,
            outputTokens: 100,
            contextWindow: 200000,
            costUSD: 0.1,
          },
          {
            model: 'opus',
            inputTokens: 50,
            outputTokens: 50,
            contextWindow: 200000,
            costUSD: 1.0,
          },
        ],
      });
      const [, liveStats] = setLiveModelStatsAndUsageListMock.mock.calls[0];
      expect((liveStats as { model: string }).model).toBe('opus');
    });

    it('single-model array uses [0]', () => {
      service.handleSessionStats({
        ...baseStats,
        modelUsage: [
          {
            model: 'sonnet',
            inputTokens: 100,
            outputTokens: 100,
            contextWindow: 200000,
            costUSD: 0.5,
          },
        ],
      });
      const [, liveStats] = setLiveModelStatsAndUsageListMock.mock.calls[0];
      expect((liveStats as { model: string }).model).toBe('sonnet');
    });
  });

  describe('contextUsed', () => {
    it('uses lastTurnContextTokens when present', () => {
      service.handleSessionStats({
        ...baseStats,
        modelUsage: [
          {
            model: 'opus',
            inputTokens: 100,
            outputTokens: 50,
            contextWindow: 200000,
            costUSD: 0.5,
            cacheReadInputTokens: 25,
            lastTurnContextTokens: 12345,
          },
        ],
      });
      const [, liveStats] = setLiveModelStatsAndUsageListMock.mock.calls[0];
      expect((liveStats as { contextUsed: number }).contextUsed).toBe(12345);
    });

    it('falls back to inputTokens + cacheReadInputTokens + outputTokens', () => {
      service.handleSessionStats({
        ...baseStats,
        modelUsage: [
          {
            model: 'opus',
            inputTokens: 100,
            outputTokens: 50,
            contextWindow: 200000,
            costUSD: 0.5,
            cacheReadInputTokens: 25,
          },
        ],
      });
      const [, liveStats] = setLiveModelStatsAndUsageListMock.mock.calls[0];
      expect((liveStats as { contextUsed: number }).contextUsed).toBe(175);
    });

    it('contextPercent rounding to 1 decimal place', () => {
      service.handleSessionStats({
        ...baseStats,
        modelUsage: [
          {
            model: 'opus',
            inputTokens: 23456,
            outputTokens: 0,
            contextWindow: 100000,
            costUSD: 0.5,
            lastTurnContextTokens: 23456,
          },
        ],
      });
      const [, liveStats] = setLiveModelStatsAndUsageListMock.mock.calls[0];
      // 23456 / 100000 * 1000 = 234.56 â†’ round = 235 / 10 = 23.5
      expect((liveStats as { contextPercent: number }).contextPercent).toBe(
        23.5,
      );
    });
  });

  it('accumulates preloadedStats with new turn data', () => {
    tabs = [
      makeTab({
        preloadedStats: {
          totalCost: 1.0,
          tokens: {
            input: 1000,
            output: 500,
            cacheRead: 100,
            cacheCreation: 50,
          },
          messageCount: 5,
        },
      }),
    ];
    findTabsBySessionIdMock.mockImplementation((sid: string) =>
      tabs.filter((t) => t.claudeSessionId === sid),
    );
    service.handleSessionStats(baseStats);
    expect(setPreloadedStatsMock).toHaveBeenCalledTimes(1);
    const [, stats] = setPreloadedStatsMock.mock.calls[0] as [
      string,
      NonNullable<TabState['preloadedStats']>,
    ];
    expect(stats.totalCost).toBeCloseTo(1.5);
    expect(stats.tokens.input).toBe(1100);
    expect(stats.tokens.output).toBe(550);
    expect(stats.tokens.cacheRead).toBe(110);
    expect(stats.tokens.cacheCreation).toBe(55);
    expect(stats.messageCount).toBe(6);
  });

  it('does not touch preloadedStats when undefined (fresh session)', () => {
    service.handleSessionStats(baseStats);
    expect(setPreloadedStatsMock).not.toHaveBeenCalled();
  });

  it('triggers auto-send via MessageDispatchService when queuedContent returned', () => {
    streamHandleStatsMock.mockReturnValue({
      tabId: 'tab-1',
      queuedContent: 'queued message',
    });
    service.handleSessionStats(baseStats);
    expect(sendQueuedMock).toHaveBeenCalledWith('tab-1', 'queued message');
  });

  it('refreshes sidebar via SessionLoader.loadSessions', () => {
    service.handleSessionStats(baseStats);
    expect(loadSessionsMock).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Late-event grace window + primary-model determinism.
  // ------------------------------------------------------------------

  describe('B3 — late SESSION_STATS dropped within grace window', () => {
    it('drops the event without clearing compaction state or mutating preloadedStats when lastCompactionAt is fresh', () => {
      tabs = [
        makeTab({
          // Very recent compaction completion → inside the 2s grace window.
          lastCompactionAt: Date.now() - 100,
          preloadedStats: {
            totalCost: 1.0,
            tokens: {
              input: 1000,
              output: 500,
              cacheRead: 100,
              cacheCreation: 50,
            },
            messageCount: 5,
          },
        }),
      ];
      // Re-bind the lookup mock against the new tabs array.
      findTabsBySessionIdMock.mockImplementation((sid: string) =>
        tabs.filter((t) => t.claudeSessionId === sid),
      );

      service.handleSessionStats(baseStats);

      // Late event must NOT prematurely dismiss the banner …
      expect(clearCompactionStateMock).not.toHaveBeenCalled();
      // … and must NOT poison the just-reset preloadedStats.
      expect(setPreloadedStatsMock).not.toHaveBeenCalled();
      // The aggregator logs a warning to make the drop observable.
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleSessionStats: dropped late event after compaction',
        expect.objectContaining({ sessionId: 'sess-1' }),
      );
    });
  });

  // ------------------------------------------------------------------
  // TASK_2026_109_FOLLOWUP N2 — extend cumulative-fallback skip rule to
  // non-compacted sessions when the cumulative sum exceeds contextWindow.
  // Long sessions on third-party providers (OpenRouter, Moonshot, Ollama)
  // never emit `lastTurnContextTokens`, so the cumulative input + output +
  // cacheRead can climb past contextWindow and produce 1000%+ CTX badges.
  // ------------------------------------------------------------------
  describe('N2 — skip cumulative-fallback when cumulative > contextWindow', () => {
    it('drops the live-stats update without compaction when cumulative exceeds the window', () => {
      // No lastTurnContextTokens, no compaction history — only the new
      // "cumulative > window" rule should engage.
      service.handleSessionStats({
        ...baseStats,
        modelUsage: [
          {
            model: 'openrouter/long-context',
            inputTokens: 150_000,
            outputTokens: 60_000,
            cacheReadInputTokens: 20_000,
            contextWindow: 200_000,
            costUSD: 0.5,
          },
        ],
      });
      // 150k + 20k + 60k = 230k > 200k window → skip.
      expect(setLiveModelStatsAndUsageListMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleSessionStats: skipped post-compaction cumulative-fallback update',
        expect.any(Object),
      );
    });

    it('still publishes live stats when cumulative is within the window', () => {
      service.handleSessionStats({
        ...baseStats,
        modelUsage: [
          {
            model: 'openrouter/long-context',
            inputTokens: 50_000,
            outputTokens: 10_000,
            cacheReadInputTokens: 5_000,
            contextWindow: 200_000,
            costUSD: 0.5,
          },
        ],
      });
      // 50k + 5k + 10k = 65k ≤ 200k → publish.
      expect(setLiveModelStatsAndUsageListMock).toHaveBeenCalledTimes(1);
      const [, liveStats] = setLiveModelStatsAndUsageListMock.mock.calls[0];
      expect((liveStats as { contextUsed: number }).contextUsed).toBe(65_000);
    });
  });

  // ------------------------------------------------------------------
  // TASK_2026_109_FOLLOWUP N5 — sticky primary model. Prefer the tab's
  // sessionModel over the cost-based pickPrimaryModel when sessionModel is
  // present in the modelUsage array. Stops Haiku-via-subagent bursts from
  // visibly flipping the displayed primary model away from the user's pick.
  // ------------------------------------------------------------------
  describe('N5 — sticky primary model by sessionModel', () => {
    it('prefers tab sessionModel over the higher-cost cost-based pick', () => {
      tabs = [
        makeTab({
          claudeSessionId: 'sess-1',
          // The user picked Opus for this session.
          sessionModel: 'claude-opus-4',
        } as Partial<TabState>),
      ];
      findTabsBySessionIdMock.mockImplementation((sid: string) =>
        tabs.filter((t) => t.claudeSessionId === sid),
      );

      service.handleSessionStats({
        ...baseStats,
        modelUsage: [
          // Subagent burst: Haiku out-bills Opus this turn.
          {
            model: 'claude-haiku',
            inputTokens: 100,
            outputTokens: 100,
            contextWindow: 200_000,
            costUSD: 5.0,
            lastTurnContextTokens: 1000,
          },
          {
            model: 'claude-opus-4',
            inputTokens: 50,
            outputTokens: 50,
            contextWindow: 200_000,
            costUSD: 1.0,
            lastTurnContextTokens: 500,
          },
        ],
      });
      const [, liveStats] = setLiveModelStatsAndUsageListMock.mock.calls[0];
      expect((liveStats as { model: string }).model).toBe('claude-opus-4');
    });

    it('falls back to cost-based primary when sessionModel is absent from modelUsage', () => {
      tabs = [
        makeTab({
          claudeSessionId: 'sess-1',
          sessionModel: 'claude-opus-4',
        } as Partial<TabState>),
      ];
      findTabsBySessionIdMock.mockImplementation((sid: string) =>
        tabs.filter((t) => t.claudeSessionId === sid),
      );

      service.handleSessionStats({
        ...baseStats,
        modelUsage: [
          {
            model: 'claude-haiku',
            inputTokens: 100,
            outputTokens: 100,
            contextWindow: 200_000,
            costUSD: 5.0,
          },
          {
            model: 'claude-sonnet',
            inputTokens: 50,
            outputTokens: 50,
            contextWindow: 200_000,
            costUSD: 1.0,
          },
        ],
      });
      const [, liveStats] = setLiveModelStatsAndUsageListMock.mock.calls[0];
      // sessionModel ("claude-opus-4") is not in modelUsage, so the
      // cost-based heuristic wins (haiku has the highest costUSD).
      expect((liveStats as { model: string }).model).toBe('claude-haiku');
    });
  });

  describe('C3 — primary-model selection delegated to shared pickPrimaryModel', () => {
    it('returns the same model name on tied costs across runs (deterministic ordering)', () => {
      const tiedUsage = [
        {
          model: 'claude-haiku',
          inputTokens: 100,
          outputTokens: 100,
          contextWindow: 200000,
          costUSD: 0.5,
        },
        {
          model: 'claude-sonnet',
          inputTokens: 100,
          outputTokens: 100,
          contextWindow: 200000,
          costUSD: 0.5,
        },
      ];

      service.handleSessionStats({ ...baseStats, modelUsage: tiedUsage });
      const [, firstStats] = setLiveModelStatsAndUsageListMock.mock.calls[0];
      const firstPick = (firstStats as { model: string }).model;

      setLiveModelStatsAndUsageListMock.mockClear();

      // Reverse the order to prove ordering does not flip the result.
      service.handleSessionStats({
        ...baseStats,
        modelUsage: [...tiedUsage].reverse(),
      });
      const [, secondStats] = setLiveModelStatsAndUsageListMock.mock.calls[0];
      const secondPick = (secondStats as { model: string }).model;

      expect(firstPick).toBe(secondPick);
    });
  });
});
