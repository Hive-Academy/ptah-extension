/**
 * SessionStatsAggregatorService specs — SESSION_STATS aggregation.
 *
 * Coverage:
 *   - findTabBySessionId resolves correct tab
 *   - falls back to active tab when sessionId lookup fails (warns)
 *   - primary-model selection: highest costUSD wins
 *   - single-model array uses [0] without reduce
 *   - contextUsed uses lastTurnContextTokens when present
 *   - contextUsed marks absent main context unknown without cumulative fallback
 *   - contextPercent rounding to 1 decimal place
 *   - installs the backend session snapshot (never adds footer fields)
 *   - clears compaction state via CompactionLifecycleService
 *   - calls streamingHandler.handleSessionStats and triggers auto-send
 *   - refreshes sidebar via SessionLoader.loadSessions
 */

import { TestBed } from '@angular/core/testing';
import { SessionStatsAggregatorService } from './session-stats-aggregator.service';
import {
  ConversationRegistry,
  SurfaceSessionStatsRegistry,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { StreamRouter } from '@ptah-extension/chat-routing';
import { StreamingHandlerService } from '@ptah-extension/chat-streaming';
import { SessionLoaderService } from './session-loader.service';
import { CompactionLifecycleService } from './compaction-lifecycle.service';
import { MessageDispatchService } from './message-dispatch.service';
import type { TabState } from '@ptah-extension/chat-types';
import { SessionId, type SessionStatsEntry } from '@ptah-extension/shared';

// Production `SessionStatsAggregatorService.handleSessionStats` validates the
// inbound sessionId via `SessionId.from()` (UUID v4). Mint stable ids per run.
const SESS_1 = SessionId.create();
const SESS_UNKNOWN = SessionId.create();

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
    sessionStats: null,
    liveModelStats: null,
    ...overrides,
  } as unknown as TabState;
}

/** A backend session snapshot (TASK_2026_533); `cost` scales every figure. */
function makeSnapshot(
  sessionId: string,
  revision: number,
  cost: number,
): SessionStatsEntry {
  return {
    sessionId,
    model: 'claude-opus-4-7',
    totalCost: cost,
    knownCost: cost,
    tokens: {
      input: cost * 100,
      output: cost * 10,
      cacheRead: cost * 1000,
      cacheCreation: cost,
    },
    tokenCount: cost * 1111,
    messageCount: 0,
    agentSessionCount: 2,
    status: 'ok',
    pricingCoverage: 'full',
    scope: 'session',
    revision,
  };
}

const baseStats = {
  sessionId: SESS_1,
  cost: 0.5,
  tokens: { input: 100, output: 50, cacheRead: 10, cacheCreation: 5 },
  duration: 1000,
};

describe('SessionStatsAggregatorService', () => {
  let service: SessionStatsAggregatorService;
  let tabs: TabState[];
  let setLiveModelStatsMock: jest.Mock;
  let installSessionStatsMock: jest.Mock;
  let findTabsBySessionIdMock: jest.Mock;
  let findAcrossWorkspacesMock: jest.Mock;
  let activeTabMock: jest.Mock;
  let streamHandleStatsMock: jest.Mock;
  let loadSessionsMock: jest.Mock;
  let clearCompactionStateMock: jest.Mock;
  let sendQueuedMock: jest.Mock;
  let surfacesForSessionMock: jest.Mock;
  let surfaceStats: SurfaceSessionStatsRegistry;
  let warn: jest.SpyInstance;

  it('clears known fill for an unknown provider on tabs and surfaces without replacing accounting', () => {
    const contextCapacity = {
      tokens: 2000,
      source: 'provider-catalog' as const,
      providerId: 'openrouter',
      model: 'm',
    };
    const row = {
      model: 'm',
      inputTokens: 108,
      outputTokens: 0,
      costUSD: 1,
      contextWindow: 2000,
      lastTurnContextTokens: 1000,
      contextCapacity,
    };
    const stored = makeSnapshot(SESS_1, 1, 10);
    service.handleSessionStats({
      ...baseStats,
      sessionStats: stored,
      modelUsage: [row],
    });
    service.handleSessionStats({
      ...baseStats,
      modelUsage: [
        {
          ...row,
          lastTurnContextTokens: undefined,
          contextCapacity: {
            ...contextCapacity,
            providerId: 'openai-codex',
            tokens: null,
            source: 'unknown',
          },
        },
      ],
    });
    expect(setLiveModelStatsMock).toHaveBeenLastCalledWith(
      'tab-1',
      expect.objectContaining({ contextKnown: false, contextWindow: 0 }),
    );
    expect(installSessionStatsMock).toHaveBeenCalledTimes(1);
    tabs = [];
    surfacesForSessionMock.mockReturnValue(['surface']);
    service.handleSessionStats({
      ...baseStats,
      sessionStats: stored,
      modelUsage: [row],
    });
    service.handleSessionStats({
      ...baseStats,
      modelUsage: [
        {
          ...row,
          lastTurnContextTokens: undefined,
          contextCapacity: {
            ...contextCapacity,
            providerId: 'openai-codex',
            tokens: null,
            source: 'unknown',
          },
        },
      ],
    });
    expect(surfaceStats.peek(SESS_1)?.live).toEqual(
      expect.objectContaining({ contextKnown: false, contextWindow: 0 }),
    );
    expect(surfaceStats.peek(SESS_1)?.snapshot).toBe(stored);
  });

  beforeEach(() => {
    tabs = [makeTab()];
    setLiveModelStatsMock = jest.fn();
    installSessionStatsMock = jest.fn();
    // Service uses plural fan-out lookup.
    findTabsBySessionIdMock = jest.fn((sid: string) =>
      tabs.filter((t) => t.claudeSessionId === sid),
    );
    findAcrossWorkspacesMock = jest.fn(() => null);
    activeTabMock = jest.fn(() => tabs[0] ?? null);
    streamHandleStatsMock = jest.fn().mockReturnValue(null);
    loadSessionsMock = jest.fn().mockResolvedValue(undefined);
    clearCompactionStateMock = jest.fn();
    sendQueuedMock = jest.fn();
    surfacesForSessionMock = jest.fn(() => []);
    warn = jest.spyOn(console, 'warn').mockImplementation();

    const tabManagerMock = {
      findTabsBySessionId: findTabsBySessionIdMock,
      findTabBySessionIdAcrossWorkspaces: findAcrossWorkspacesMock,
      activeTab: activeTabMock,
      setLiveModelStats: setLiveModelStatsMock,
      installSessionStats: installSessionStatsMock,
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
        // Real registries — they are plain signal stores with no outbound deps,
        // so stubbing them would only weaken the assertions.
        SurfaceSessionStatsRegistry,
        ConversationRegistry,
        { provide: TabManagerService, useValue: tabManagerMock },
        {
          provide: StreamRouter,
          useValue: {
            surfacesForSession: surfacesForSessionMock,
          } as unknown as StreamRouter,
        },
        { provide: StreamingHandlerService, useValue: streamingHandlerMock },
        { provide: SessionLoaderService, useValue: sessionLoaderMock },
        { provide: CompactionLifecycleService, useValue: compactionMock },
        { provide: MessageDispatchService, useValue: dispatchMock },
      ],
    });
    service = TestBed.inject(SessionStatsAggregatorService);
    surfaceStats = TestBed.inject(SurfaceSessionStatsRegistry);
  });

  afterEach(() => {
    warn.mockRestore();
    TestBed.resetTestingModule();
  });

  it('finds tab by sessionId and clears compaction state', () => {
    service.handleSessionStats(baseStats);
    expect(findTabsBySessionIdMock).toHaveBeenCalledWith(SESS_1);
    expect(clearCompactionStateMock).toHaveBeenCalledWith('tab-1');
  });

  // Drop active-tab fallback. Was: fall back to activeTab when
  // findTabsBySessionId returned empty. Now: warn and drop the event so
  // foreign-session stats cannot pollute the active tab during a tab switch.
  it('N7 — drops the event without active-tab fallback when no tab is bound', () => {
    findTabsBySessionIdMock.mockReturnValue([]);
    service.handleSessionStats({ ...baseStats, sessionId: SESS_UNKNOWN });
    expect(warn).toHaveBeenCalledWith(
      '[ChatStore] handleSessionStats: no tab bound to sessionId, dropping event',
      { sessionId: SESS_UNKNOWN },
    );
    // None of the downstream side-effects fire — the event is fully dropped.
    expect(setLiveModelStatsMock).not.toHaveBeenCalled();
    expect(installSessionStatsMock).not.toHaveBeenCalled();
    expect(streamHandleStatsMock).not.toHaveBeenCalled();
    expect(loadSessionsMock).not.toHaveBeenCalled();
    expect(clearCompactionStateMock).not.toHaveBeenCalled();
  });

  describe('background-workspace owner (user switched folders mid-stream)', () => {
    const BG_SESSION = SessionId.create();

    it('applies the stats to the background tab and delegates to streamingHandler instead of dropping', () => {
      const bgTab = makeTab({ id: 'bg-tab', claudeSessionId: BG_SESSION });
      findTabsBySessionIdMock.mockReturnValue([]);
      findAcrossWorkspacesMock.mockReturnValue({
        tab: bgTab,
        workspacePath: 'D:\\projects\\other',
      });

      service.handleSessionStats({
        ...baseStats,
        sessionId: BG_SESSION,
        modelUsage: [
          {
            model: 'claude-fable-5',
            inputTokens: 570,
            outputTokens: 2628,
            contextWindow: 1_000_000,
            costUSD: 1.26,
            cacheReadInputTokens: 52_614,
            lastTurnContextTokens: 54_291,
          },
        ],
      });

      expect(findAcrossWorkspacesMock).toHaveBeenCalledWith(BG_SESSION);
      expect(clearCompactionStateMock).toHaveBeenCalledWith('bg-tab');
      expect(setLiveModelStatsMock).toHaveBeenCalledWith(
        'bg-tab',
        expect.objectContaining({ model: 'claude-fable-5' }),
      );
      expect(streamHandleStatsMock).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('no tab bound to sessionId'),
        expect.anything(),
      );
    });

    it('prefers the active-workspace tabs and never consults the partition when one is bound', () => {
      service.handleSessionStats(baseStats);
      expect(findAcrossWorkspacesMock).not.toHaveBeenCalled();
    });
  });

  it('records to the surface registry instead of dropping, when a surface owns the session', () => {
    // New Project / harness builder / wizard-phase sessions have no tab BY
    // DESIGN, so every turn of theirs used to log "dropping event" and vanish.
    // The per-tab writes really are inapplicable — but the stats are good.
    findTabsBySessionIdMock.mockReturnValue([]);
    surfacesForSessionMock.mockReturnValue(['surface-1']);

    const surfaceSnapshot = makeSnapshot(SESS_UNKNOWN, 1, 0.5);
    service.handleSessionStats({
      ...baseStats,
      sessionId: SESS_UNKNOWN,
      sessionStats: surfaceSnapshot,
      modelUsage: [
        {
          model: 'claude-opus-5',
          inputTokens: 100,
          outputTokens: 50,
          contextWindow: 1_000_000,
          costUSD: 0.5,
          cacheReadInputTokens: 10,
          lastTurnContextTokens: 160,
        },
      ],
    });

    expect(warn).not.toHaveBeenCalled();
    expect(setLiveModelStatsMock).not.toHaveBeenCalled();

    const stats = surfaceStats.peek(SESS_UNKNOWN);
    expect(stats?.snapshot).toBe(surfaceSnapshot);
    expect(stats?.live).toEqual({
      model: 'claude-opus-5',
      contextUsed: 160,
      contextKnown: true,
      contextWindow: 0,
      contextPercent: 0,
    });
  });

  it('still warns when neither a tab nor a surface owns the session', () => {
    // Nothing routed the event anywhere — that is a real drop and a real bug.
    findTabsBySessionIdMock.mockReturnValue([]);
    surfacesForSessionMock.mockReturnValue([]);

    service.handleSessionStats({ ...baseStats, sessionId: SESS_UNKNOWN });

    expect(warn).toHaveBeenCalledWith(
      '[ChatStore] handleSessionStats: no tab bound to sessionId, dropping event',
      { sessionId: SESS_UNKNOWN },
    );
    expect(surfaceStats.peek(SESS_UNKNOWN)).toBeNull();
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
      const [, liveStats] = setLiveModelStatsMock.mock.calls[0];
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
      const [, liveStats] = setLiveModelStatsMock.mock.calls[0];
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
      const [, liveStats] = setLiveModelStatsMock.mock.calls[0];
      expect((liveStats as { contextUsed: number }).contextUsed).toBe(12345);
    });

    it('marks absent main context unknown without cumulative fallback', () => {
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
      const [, liveStats] = setLiveModelStatsMock.mock.calls[0];
      expect(liveStats).toEqual(
        expect.objectContaining({ contextKnown: false }),
      );
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
            contextCapacity: {
              tokens: 100000,
              source: 'sdk-native',
              providerId: null,
              model: 'opus',
            },
            costUSD: 0.5,
            lastTurnContextTokens: 23456,
          },
        ],
      });
      const [, liveStats] = setLiveModelStatsMock.mock.calls[0];
      // 23456 / 100000 * 1000 = 234.56 → round = 235 / 10 = 23.5
      expect((liveStats as { contextPercent: number }).contextPercent).toBe(
        23.5,
      );
    });
  });

  // TASK_2026_533: the backend owns session accounting. Every SESSION_STATS
  // carries its lifetime snapshot; the aggregator installs it as-is and never
  // adds the per-turn footer fields to anything.
  describe('backend session snapshot', () => {
    const snapshot = (revision: number, cost: number): SessionStatsEntry =>
      makeSnapshot(SESS_1, revision, cost);

    it('installs snapshots 10 then 15 without addition for tabs and surfaces', () => {
      const s10 = snapshot(10, 10);
      const s15 = snapshot(15, 15);
      const turns = [s10, s15, s15, s10];

      // Tab path.
      for (const sessionStats of turns) {
        service.handleSessionStats({ ...baseStats, sessionStats });
      }
      // Each write is the backend object itself: assignment, never a sum.
      // The revision guard lives in TabManagerService.installSessionStats.
      expect(installSessionStatsMock.mock.calls).toEqual(
        turns.map((s) => ['tab-1', s]),
      );
      // Footer fields reach the streaming handler unchanged.
      expect(streamHandleStatsMock).toHaveBeenLastCalledWith({
        ...baseStats,
        sessionStats: s10,
      });

      // Surface path (real registry): 10, 15, duplicate 15, then a stale 10.
      findTabsBySessionIdMock.mockReturnValue([]);
      surfacesForSessionMock.mockReturnValue(['surface-1']);
      for (const sessionStats of turns) {
        service.handleSessionStats({ ...baseStats, sessionStats });
      }
      expect(surfaceStats.peek(SESS_1)?.snapshot).toBe(s15);
    });

    it('never installs a snapshot that names a different session', () => {
      const foreign = { ...snapshot(3, 3), sessionId: SESS_UNKNOWN };

      service.handleSessionStats({ ...baseStats, sessionStats: foreign });

      expect(installSessionStatsMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleSessionStats: session snapshot names a different session, ignoring it',
        { sessionId: SESS_1, snapshotSessionId: SESS_UNKNOWN },
      );
    });

    it('leaves the installed snapshot alone when a result carries none', () => {
      service.handleSessionStats(baseStats);

      expect(installSessionStatsMock).not.toHaveBeenCalled();
    });

    // Revision 1 of the review (Defect 2). A payload with no per-turn footer
    // fields is a snapshot update, not a turn result. Forwarding it to
    // StreamingHandlerService would overwrite a finalized message's footer
    // (cost 7, tokens, duration 1000) and a streaming tab's pendingStats with
    // `undefined`, so none of the turn-result side effects may run.
    it('installs a snapshot-only payload and runs no footer, compaction, refresh or queue handling', () => {
      streamHandleStatsMock.mockReturnValue({
        tabId: 'tab-1',
        queuedContent: 'queued message',
      });
      const sessionStats = snapshot(6, 7);

      service.handleSessionStats({ sessionId: SESS_1, sessionStats });

      expect(installSessionStatsMock).toHaveBeenCalledWith(
        'tab-1',
        sessionStats,
      );
      expect(streamHandleStatsMock).not.toHaveBeenCalled();
      expect(clearCompactionStateMock).not.toHaveBeenCalled();
      expect(loadSessionsMock).not.toHaveBeenCalled();
      expect(sendQueuedMock).not.toHaveBeenCalled();
      expect(setLiveModelStatsMock).not.toHaveBeenCalled();
    });

    it('records a snapshot-only payload for a surface without touching the footer path', () => {
      findTabsBySessionIdMock.mockReturnValue([]);
      surfacesForSessionMock.mockReturnValue(['surface-1']);
      const sessionStats = snapshot(2, 2);

      service.handleSessionStats({ sessionId: SESS_1, sessionStats });

      expect(surfaceStats.peek(SESS_1)?.snapshot).toBe(sessionStats);
      expect(streamHandleStatsMock).not.toHaveBeenCalled();
    });

    it('still treats a zero or null cost as a present footer field', () => {
      const event = {
        sessionId: SESS_1,
        cost: null,
        tokens: { input: 0, output: 0 },
        duration: 0,
        sessionStats: snapshot(3, 0),
      };

      service.handleSessionStats(event);

      expect(streamHandleStatsMock).toHaveBeenCalledWith(event);
      expect(clearCompactionStateMock).toHaveBeenCalledWith('tab-1');
    });

    // Revision 1 of the review (Defect 3): validated at the boundary.
    it('rejects a malformed snapshot with one warning and no payload contents', () => {
      const malformed = {
        ...snapshot(0, 9),
        revision: '9',
      } as unknown as SessionStatsEntry;

      service.handleSessionStats({ ...baseStats, sessionStats: malformed });

      expect(installSessionStatsMock).not.toHaveBeenCalled();
      const rejections = warn.mock.calls.filter(
        ([message]) =>
          message ===
          '[ChatStore] handleSessionStats: rejected a malformed session snapshot',
      );
      expect(rejections).toEqual([
        [
          '[ChatStore] handleSessionStats: rejected a malformed session snapshot',
          { sessionId: SESS_1 },
        ],
      ]);
      // The footer result itself is still a valid turn result.
      expect(streamHandleStatsMock).toHaveBeenCalledTimes(1);
    });

    it('keeps $16 on a surface when a revision "9" snapshot follows revision 16', () => {
      findTabsBySessionIdMock.mockReturnValue([]);
      surfacesForSessionMock.mockReturnValue(['surface-1']);
      const accepted = snapshot(16, 16);
      service.handleSessionStats({ ...baseStats, sessionStats: accepted });

      service.handleSessionStats({
        ...baseStats,
        sessionStats: {
          ...snapshot(0, 9),
          revision: '9',
        } as unknown as SessionStatsEntry,
      });

      expect(surfaceStats.peek(SESS_1)?.snapshot).toBe(accepted);
    });

    it('rejects malformed tokens', () => {
      service.handleSessionStats({
        ...baseStats,
        sessionStats: {
          ...snapshot(4, 4),
          tokens: { input: 1, output: 1 },
        } as unknown as SessionStatsEntry,
      });

      expect(installSessionStatsMock).not.toHaveBeenCalled();
    });
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

  describe('SESSION_STATS arriving INSIDE the deleted 2s grace window now finalizes', () => {
    it('installs the snapshot and finalizes via streamingHandler even when lastCompactionAt is fresh (would have been dropped pre-fix)', () => {
      tabs = [makeTab({ lastCompactionAt: Date.now() - 100 })];
      findTabsBySessionIdMock.mockImplementation((sid: string) =>
        tabs.filter((t) => t.claudeSessionId === sid),
      );
      const event = { ...baseStats, sessionStats: makeSnapshot(SESS_1, 5, 1) };

      service.handleSessionStats(event);

      expect(clearCompactionStateMock).toHaveBeenCalledWith('tab-1');
      expect(installSessionStatsMock).toHaveBeenCalledTimes(1);
      expect(streamHandleStatsMock).toHaveBeenCalledWith(event);
      expect(warn).not.toHaveBeenCalledWith(
        '[ChatStore] handleSessionStats: dropped late event after compaction',
        expect.anything(),
      );
    });
  });

  // ------------------------------------------------------------------
  // Extend cumulative-fallback skip rule to non-compacted sessions when
  // the cumulative sum exceeds contextWindow. Long sessions on third-party
  // providers (OpenRouter, Moonshot, Ollama) never emit
  // `lastTurnContextTokens`, so the cumulative input + output + cacheRead
  // can climb past contextWindow and produce 1000%+ CTX badges.
  //
  // The skip suppresses only the untrustworthy CONTEXT-FILL number. The
  // model name and per-model rows come from the backend session snapshot,
  // which is installed independently.
  // ------------------------------------------------------------------
  describe('N2 — skip cumulative-fallback when cumulative > contextWindow', () => {
    it('suppresses the context-fill update but preserves the model breakdown when cumulative exceeds the window', () => {
      // No lastTurnContextTokens, no compaction history — only the new
      // "cumulative > window" rule should engage.
      const modelUsage = [
        {
          model: 'openrouter/long-context',
          inputTokens: 150_000,
          outputTokens: 60_000,
          cacheReadInputTokens: 20_000,
          contextWindow: 200_000,
          costUSD: 0.5,
        },
      ];
      service.handleSessionStats({ ...baseStats, modelUsage });
      // 150k + 20k + 60k = 230k > 200k window → suppress context-fill.
      expect(setLiveModelStatsMock).toHaveBeenCalledWith(
        'tab-1',
        expect.objectContaining({ contextKnown: false }),
      );
      expect(warn).not.toHaveBeenCalled();
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
      expect(setLiveModelStatsMock).toHaveBeenCalledTimes(1);
      const [, liveStats] = setLiveModelStatsMock.mock.calls[0];
      expect(liveStats).toEqual(
        expect.objectContaining({ contextKnown: false }),
      );
    });
  });

  // ------------------------------------------------------------------
  // Regression: a long, single-model, resumed session never emits
  // `lastTurnContextTokens`, and its lone model carries the whole session's
  // cumulative tokens — guaranteeing cumulative > contextWindow. The
  // context-fill % is withheld, and the model badge renders from the backend
  // session snapshot (`snapshot.model`), which is installed regardless.
  // ------------------------------------------------------------------
  describe('regression — single-model long session keeps the model badge', () => {
    it('installs the snapshot (model name source) while withholding context-fill', () => {
      const sessionStats = {
        ...makeSnapshot(SESS_1, 8, 2.07),
        model: 'claude-opus-4-8',
      };
      service.handleSessionStats({
        ...baseStats,
        cost: 2.07,
        sessionStats,
        modelUsage: [
          {
            model: 'claude-opus-4-8',
            inputTokens: 900_000,
            outputTokens: 200_000,
            cacheReadInputTokens: 1_000_000,
            contextWindow: 200_000,
            costUSD: 2.07,
            // No lastTurnContextTokens — resumed session, no message_start seen.
          },
        ],
      });

      // Context-fill is untrustworthy here → not published.
      expect(setLiveModelStatsMock).toHaveBeenCalledWith(
        'tab-1',
        expect.objectContaining({ contextKnown: false }),
      );
      // The snapshot that names the model is installed as-is.
      expect(installSessionStatsMock).toHaveBeenCalledWith(
        'tab-1',
        sessionStats,
      );
    });
  });

  // ------------------------------------------------------------------
  // Sticky primary model. Prefer the tab's sessionModel over the cost-based
  // pickPrimaryModel when sessionModel is present in the modelUsage array.
  // Stops Haiku-via-subagent bursts from visibly flipping the displayed
  // primary model away from the user's pick.
  // ------------------------------------------------------------------
  describe('N5 — sticky primary model by sessionModel', () => {
    it('prefers tab sessionModel over the higher-cost cost-based pick', () => {
      tabs = [
        makeTab({
          claudeSessionId: SESS_1,
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
      const [, liveStats] = setLiveModelStatsMock.mock.calls[0];
      expect((liveStats as { model: string }).model).toBe('claude-opus-4');
    });

    it('falls back to cost-based primary when sessionModel is absent from modelUsage', () => {
      tabs = [
        makeTab({
          claudeSessionId: SESS_1,
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
      const [, liveStats] = setLiveModelStatsMock.mock.calls[0];
      // sessionModel ("claude-opus-4") is not in modelUsage, so the
      // cost-based heuristic wins (haiku has the highest costUSD).
      expect((liveStats as { model: string }).model).toBe('claude-haiku');
    });
  });

  // Phase 2 Batch 4 — SESSION_STATS demotion. Stop / StopFailure (via
  // TurnEndHandlerService) is now the primary turn-end pivot. The aggregator
  // never mutated tab.status directly; this suite locks that invariant in
  // and proves both post-Stop and pre-Stop SESSION_STATS still reach the
  // streamingHandler safety-net / merge entry point.
  //
  // The status-flip vs no-flip behavior itself is enforced by the
  // Stop-observed guard inside StreamingHandlerService.handleSessionStats
  // (see streaming-handler.service.spec.ts → "Stop-observed guard"
  // describe block).
  describe('Phase 2 Batch 4 — SESSION_STATS demotion', () => {
    it('SESSION_STATS arriving AFTER Stop installs the snapshot and delegates to streamingHandler (no aggregator-side status mutation)', () => {
      tabs = [
        makeTab({
          status: 'loaded',
          lastTerminalReason: 'completed',
        } as Partial<TabState>),
      ];
      findTabsBySessionIdMock.mockImplementation((sid: string) =>
        tabs.filter((t) => t.claudeSessionId === sid),
      );

      const event = { ...baseStats, sessionStats: makeSnapshot(SESS_1, 4, 1) };
      service.handleSessionStats(event);

      expect(installSessionStatsMock).toHaveBeenCalledTimes(1);
      expect(streamHandleStatsMock).toHaveBeenCalledWith(event);
      expect(tabs[0].status).toBe('loaded');
    });

    it('SESSION_STATS arriving WITHOUT Stop still installs the snapshot and delegates safety-net finalize via streamingHandler', () => {
      tabs = [
        makeTab({
          status: 'streaming',
          lastTerminalReason: undefined,
        } as Partial<TabState>),
      ];
      findTabsBySessionIdMock.mockImplementation((sid: string) =>
        tabs.filter((t) => t.claudeSessionId === sid),
      );

      const event = { ...baseStats, sessionStats: makeSnapshot(SESS_1, 4, 1) };
      service.handleSessionStats(event);

      expect(installSessionStatsMock).toHaveBeenCalledTimes(1);
      expect(streamHandleStatsMock).toHaveBeenCalledWith(event);
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
      const [, firstStats] = setLiveModelStatsMock.mock.calls[0];
      const firstPick = (firstStats as { model: string }).model;

      setLiveModelStatsMock.mockClear();

      // Reverse the order to prove ordering does not flip the result.
      service.handleSessionStats({
        ...baseStats,
        modelUsage: [...tiedUsage].reverse(),
      });
      const [, secondStats] = setLiveModelStatsMock.mock.calls[0];
      const secondPick = (secondStats as { model: string }).model;

      expect(firstPick).toBe(secondPick);
    });
  });
});
