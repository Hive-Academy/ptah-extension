/**
 * SessionAnalyticsStateService — progressive paging and staleness.
 *
 * The host rejects a `session:stats-batch` page of more than
 * `SESSION_STATS_BATCH_MAX_IDS` ids (TASK_2026_411 B4), so these specs pin:
 *   - pages never exceed the cap and share one `[since, until)` window;
 *   - each page paints before the next one is even requested;
 *   - a range change, a workspace change or a cancel aborts the load, and a
 *     late response from it can never write;
 *   - partial coverage, failed pages and unknown (null) cost stay visible and
 *     are never folded into $0.
 */
import { TestBed } from '@angular/core/testing';
import {
  AppStateManager,
  ClaudeRpcService,
  ModelStateService,
  RpcResult,
} from '@ptah-extension/core';
import {
  SESSION_STATS_BATCH_MAX_IDS,
  type SessionStatsBatchParams,
  type SessionStatsBatchResult,
} from '@ptah-extension/shared';

import { SessionAnalyticsStateService } from './session-analytics-state.service';
import {
  DAY_MS,
  analyticsTestDoubles,
  answerList,
  answerStats,
  flush,
  okStats,
  sessionId,
  sessions,
  type AnalyticsTestDoubles,
} from './session-analytics-state.testing';

const T0 = 1_800_000_000_000;

describe('SessionAnalyticsStateService', () => {
  let doubles: AnalyticsTestDoubles;
  let service: SessionAnalyticsStateService;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(T0);
    doubles = analyticsTestDoubles();
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: doubles.rpc },
        {
          provide: AppStateManager,
          useValue: { workspaceInfo: doubles.workspaceInfo },
        },
        {
          provide: ModelStateService,
          useValue: { availableModels: doubles.availableModels },
        },
      ],
    });
    service = TestBed.inject(SessionAnalyticsStateService);
    TestBed.tick();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const listCalls = () => doubles.rpc.of('session:list');
  const statsCalls = () => doubles.rpc.of('session:stats-batch');
  const statsParams = () =>
    statsCalls().map((c) => c.params as SessionStatsBatchParams);
  const statuses = () => service.displayedSessions().map((s) => s.status);

  describe('paging', () => {
    it('reads 45 sessions as sequential pages of 20/20/5 sharing one range window', async () => {
      const done = service.loadDashboardData();
      expect(listCalls()).toHaveLength(1);
      expect(listCalls()[0].params).toEqual({
        workspacePath: '/ws/a',
        limit: 200,
        offset: 0,
        since: T0 - 7 * DAY_MS,
      });

      answerList(listCalls()[0], sessions(45));
      await flush();
      for (let page = 0; page < 3; page++) {
        // The next page is requested only after the previous one landed.
        expect(statsCalls()).toHaveLength(page + 1);
        answerStats(statsCalls()[page]);
        await flush();
      }
      await done;

      const params = statsParams();
      expect(params.map((p) => p.sessionIds.length)).toEqual([20, 20, 5]);
      for (const p of params) {
        expect(p.sessionIds.length).toBeLessThanOrEqual(
          SESSION_STATS_BATCH_MAX_IDS,
        );
        expect(p).toMatchObject({
          workspacePath: '/ws/a',
          scope: 'range',
          since: T0 - 7 * DAY_MS,
          until: T0,
        });
      }
      expect(new Set(params.flatMap((p) => p.sessionIds)).size).toBe(45);
      expect(statuses().every((s) => s === 'ok')).toBe(true);
      expect(service.isLoadingStats()).toBe(false);
      expect(service.statsProgress()).toEqual({ loaded: 45, total: 45 });
    });

    it('reads a capped 200-session range in ten pages and reports the cap', async () => {
      const done = service.loadDashboardData();
      answerList(listCalls()[0], sessions(200), true);
      await flush();
      for (let page = 0; page < 10; page++) {
        answerStats(statsCalls()[page]);
        await flush();
      }
      await done;

      expect(statsCalls()).toHaveLength(10);
      expect(
        Math.max(...statsParams().map((p) => p.sessionIds.length)),
      ).toBeLessThanOrEqual(SESSION_STATS_BATCH_MAX_IDS);
      expect(service.hasMoreSessions()).toBe(true);
      expect(service.sessionCap).toBe(200);
      expect(service.totalSessionCount()).toBe(200);
    });

    it('issues no stats call for an empty range', async () => {
      const done = service.loadDashboardData();
      answerList(listCalls()[0], []);
      await done;

      expect(statsCalls()).toHaveLength(0);
      expect(service.isLoadingStats()).toBe(false);
    });

    it('reports a missing workspace without calling the host', async () => {
      doubles.workspaceInfo.set(null);
      TestBed.tick();
      await service.loadDashboardData();

      expect(doubles.rpc.calls).toHaveLength(0);
      expect(service.loadError()).toMatch(/No workspace/);
    });
  });

  describe('progressive paint', () => {
    it('paints the first page while later pages are still outstanding', async () => {
      void service.loadDashboardData();
      answerList(listCalls()[0], sessions(45));
      await flush();

      expect(statuses().every((s) => s === 'pending')).toBe(true);
      expect(service.isLoadingStats()).toBe(true);
      expect(service.statsProgress()).toEqual({ loaded: 0, total: 45 });
      expect(service.aggregates().pendingSessionCount).toBe(45);
      expect(service.aggregates().totalCost).toBeNull();

      answerStats(statsCalls()[0]);
      await flush();

      const painted = statuses();
      expect(painted.slice(0, 20).every((s) => s === 'ok')).toBe(true);
      expect(painted.slice(20).every((s) => s === 'pending')).toBe(true);
      expect(service.statsProgress()).toEqual({ loaded: 20, total: 45 });
      expect(service.aggregates().totalCost).toBeCloseTo(10);
      expect(service.aggregates().pendingSessionCount).toBe(25);
      // Page two is in flight, page three not yet requested.
      expect(statsCalls()).toHaveLength(2);
      expect(service.isLoadingStats()).toBe(true);
    });
  });

  describe('stale responses', () => {
    it('a range change aborts the load and its late page cannot write', async () => {
      void service.loadDashboardData();
      answerList(listCalls()[0], sessions(45));
      await flush();
      const stalePage = statsCalls()[0];

      void service.setDateRange('1d');
      expect(stalePage.signal?.aborted).toBe(true);
      expect(listCalls()).toHaveLength(2);
      expect(listCalls()[1].params).toMatchObject({ since: T0 - DAY_MS });
      expect(service.displayedSessions()).toHaveLength(0);

      answerStats(stalePage);
      await flush();
      // The aborted load issues no further page.
      expect(statsCalls()).toHaveLength(1);

      // Same session ids in the new range: nothing from the stale page leaks.
      answerList(listCalls()[1], sessions(3));
      await flush();
      expect(statuses()).toEqual(['pending', 'pending', 'pending']);
      expect(statsParams()[1]).toMatchObject({
        since: T0 - DAY_MS,
        until: T0,
        sessionIds: [sessionId(0), sessionId(1), sessionId(2)],
      });
    });

    it("a late session:list from the old range cannot replace the new range's sessions", async () => {
      void service.loadDashboardData();
      const staleList = listCalls()[0];
      void service.setDateRange('14d');
      expect(staleList.signal?.aborted).toBe(true);

      answerList(listCalls()[1], sessions(2));
      await flush();
      answerList(staleList, sessions(45));
      await flush();

      expect(service.displayedSessions()).toHaveLength(2);
      expect(statsCalls()).toHaveLength(1);
      expect(statsParams()[0].sessionIds).toHaveLength(2);
    });

    it('a workspace change aborts the load in flight and clears its data', async () => {
      void service.loadDashboardData();
      answerList(listCalls()[0], sessions(45));
      await flush();
      const stalePage = statsCalls()[0];

      doubles.workspaceInfo.set({ path: '/ws/b' });
      TestBed.tick();

      expect(stalePage.signal?.aborted).toBe(true);
      expect(service.displayedSessions()).toHaveLength(0);
      expect(service.isLoadingStats()).toBe(false);
    });

    it('a page that lands after a workspace change cannot write, even before the abort runs', async () => {
      void service.loadDashboardData();
      answerList(listCalls()[0], sessions(25));
      await flush();

      doubles.workspaceInfo.set({ path: '/ws/b' });
      answerStats(statsCalls()[0]);
      await flush();

      expect(statuses().every((s) => s === 'pending')).toBe(true);
      expect(statsCalls()).toHaveLength(1);
    });

    it('A -> B -> A: a page from the first A load cannot write into the second', async () => {
      void service.loadDashboardData();
      answerList(listCalls()[0], sessions(5));
      await flush();
      const stalePage = statsCalls()[0];

      doubles.workspaceInfo.set({ path: '/ws/b' });
      TestBed.tick();
      doubles.workspaceInfo.set({ path: '/ws/a' });
      TestBed.tick();

      // Same workspace, range and (frozen) until: only the generation differs.
      void service.loadDashboardData();
      answerList(listCalls()[1], sessions(5));
      await flush();
      answerStats(stalePage);
      await flush();

      expect(statuses().every((s) => s === 'pending')).toBe(true);

      answerStats(statsCalls()[1]);
      await flush();
      expect(statuses().every((s) => s === 'ok')).toBe(true);
    });

    it('joins a load already in flight for the same workspace and range', () => {
      void service.loadDashboardData();
      void service.loadDashboardData();

      expect(listCalls()).toHaveLength(1);
    });

    it('cancelLoad aborts and stops further pages', async () => {
      void service.loadDashboardData();
      answerList(listCalls()[0], sessions(45));
      await flush();
      const page = statsCalls()[0];

      service.cancelLoad();
      expect(page.signal?.aborted).toBe(true);

      answerStats(page);
      await flush();
      expect(statsCalls()).toHaveLength(1);
      expect(statuses().every((s) => s === 'pending')).toBe(true);
      expect(service.isLoadingStats()).toBe(false);
    });

    it('keeps each load in its own until: a reload repaints from pending', async () => {
      const first = service.loadDashboardData();
      answerList(listCalls()[0], sessions(3));
      await flush();
      answerStats(statsCalls()[0]);
      await first;
      expect(statuses()).toEqual(['ok', 'ok', 'ok']);

      (Date.now as jest.Mock).mockReturnValue(T0 + 60_000);
      void service.loadDashboardData();
      answerList(listCalls()[1], sessions(3));
      await flush();

      expect(statuses()).toEqual(['pending', 'pending', 'pending']);
      expect(statsParams()[1]).toMatchObject({ until: T0 + 60_000 });
    });
  });

  describe('coverage, failures and cost', () => {
    it('marks a failed page as error and still reads the pages after it', async () => {
      const done = service.loadDashboardData();
      answerList(listCalls()[0], sessions(25));
      await flush();
      statsCalls()[0].reply.resolve(
        new RpcResult(false, undefined, 'RPC timeout: session:stats-batch'),
      );
      await flush();
      answerStats(statsCalls()[1]);
      await done;

      const s = statuses();
      expect(s.slice(0, 20).every((x) => x === 'error')).toBe(true);
      expect(s.slice(20).every((x) => x === 'ok')).toBe(true);
      expect(service.aggregates().errorSessionCount).toBe(20);
      expect(service.loadError()).toBeNull();
      expect(service.isLoadingStats()).toBe(false);
    });

    it('treats an unanswered id and a page for another window as unreadable', async () => {
      const done = service.loadDashboardData();
      answerList(listCalls()[0], sessions(23));
      await flush();

      // Page 1: answers only two of its ids, plus one it never asked for.
      statsCalls()[0].reply.resolve(
        new RpcResult<SessionStatsBatchResult>(true, {
          sessionStats: [
            okStats(sessionId(0)),
            okStats(sessionId(1)),
            okStats(sessionId(999)),
          ],
          scope: 'range',
          since: T0 - 7 * DAY_MS,
          until: T0,
        }),
      );
      await flush();
      // Page 2: echoes a different until.
      const p2 = statsCalls()[1].params as SessionStatsBatchParams;
      statsCalls()[1].reply.resolve(
        new RpcResult<SessionStatsBatchResult>(true, {
          sessionStats: p2.sessionIds.map((id) => okStats(id)),
          scope: 'range',
          since: p2.since,
          until: T0 - 1,
        }),
      );
      await done;

      const s = statuses();
      expect(s.slice(0, 2)).toEqual(['ok', 'ok']);
      expect(s.slice(2).every((x) => x === 'error')).toBe(true);
      expect(service.displayedSessions()).toHaveLength(23);
    });

    it('keeps unknown cost null and reports partial coverage and pricing', async () => {
      const done = service.loadDashboardData();
      answerList(listCalls()[0], sessions(4));
      await flush();
      answerStats(statsCalls()[0], (id) => {
        if (id === sessionId(0)) return { totalCost: 1.25 };
        if (id === sessionId(1)) {
          return { totalCost: null, pricingCoverage: 'none' };
        }
        if (id === sessionId(2)) {
          return {
            coverage: 'partial',
            untimestampedCount: 4,
            pricingCoverage: 'partial',
          };
        }
        return {
          status: 'empty',
          totalCost: null,
          pricingCoverage: 'none',
          tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
          messageCount: 0,
        };
      });
      await done;

      const entries = service.displayedSessions();
      expect(entries[1].totalCost).toBeNull();
      expect(entries[2]).toMatchObject({
        coverage: 'partial',
        untimestampedCount: 4,
        pricingCoverage: 'partial',
      });
      const agg = service.aggregates();
      expect(agg.totalCost).toBeCloseTo(1.75);
      expect(agg.avgCostPerSession).toBeCloseTo(0.875);
      expect(agg.unknownCostSessionCount).toBe(1);
      expect(agg.partialSessionCount).toBe(1);
      expect(agg.untimestampedCount).toBe(4);
      expect(agg.partiallyPricedSessionCount).toBe(1);
      expect(agg.errorSessionCount).toBe(0);
    });

    it('leaves the total null, not 0, when no session has a price', async () => {
      const done = service.loadDashboardData();
      answerList(listCalls()[0], sessions(2));
      await flush();
      answerStats(statsCalls()[0], () => ({
        totalCost: null,
        pricingCoverage: 'none',
      }));
      await done;

      expect(service.aggregates().totalCost).toBeNull();
      expect(service.aggregates().avgCostPerSession).toBeNull();
      expect(service.aggregates().unknownCostSessionCount).toBe(2);
    });
  });
});
