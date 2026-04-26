/**
 * SessionStatsAggregatorService specs — SESSION_STATS aggregation.
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
import { TabManagerService } from '../tab-manager.service';
import { StreamingHandlerService } from './streaming-handler.service';
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
  let findTabBySessionIdMock: jest.Mock;
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
    findTabBySessionIdMock = jest.fn(
      (sid: string) => tabs.find((t) => t.claudeSessionId === sid) ?? null,
    );
    activeTabMock = jest.fn(() => tabs[0] ?? null);
    streamHandleStatsMock = jest.fn().mockReturnValue(null);
    loadSessionsMock = jest.fn().mockResolvedValue(undefined);
    clearCompactionStateMock = jest.fn();
    sendQueuedMock = jest.fn();
    warn = jest.spyOn(console, 'warn').mockImplementation();

    const tabManagerMock = {
      findTabBySessionId: findTabBySessionIdMock,
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

    TestBed.configureTestingModule({
      providers: [
        SessionStatsAggregatorService,
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: StreamingHandlerService, useValue: streamingHandlerMock },
        { provide: SessionLoaderService, useValue: sessionLoaderMock },
        { provide: CompactionLifecycleService, useValue: compactionMock },
        { provide: MessageDispatchService, useValue: dispatchMock },
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
    expect(findTabBySessionIdMock).toHaveBeenCalledWith('sess-1');
    expect(clearCompactionStateMock).toHaveBeenCalledWith('tab-1');
  });

  it('falls back to active tab when sessionId lookup fails (warns)', () => {
    findTabBySessionIdMock.mockReturnValue(null);
    service.handleSessionStats({ ...baseStats, sessionId: 'unknown' });
    expect(warn).toHaveBeenCalledWith(
      '[ChatStore] handleSessionStats: findTabBySessionId failed, fell back to activeTab',
      { sessionId: 'unknown', activeTabId: 'tab-1' },
    );
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
      // 23456 / 100000 * 1000 = 234.56 → round = 235 / 10 = 23.5
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
    findTabBySessionIdMock.mockImplementation(
      (sid: string) => tabs.find((t) => t.claudeSessionId === sid) ?? null,
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
});
