import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  LoggingService,
  PLAN_LIMITS_CLOCK_TICK_MS,
  PlanLimitsStore,
  RpcResult,
} from '@ptah-extension/core';
import {
  fact,
  fakePlanLimits,
  fakeUsageCache,
  owner,
  planSnapshot,
  summary,
  type FakePlanLimits,
} from './testing/vitals-fixtures';
import { UsageVitalsCache } from './usage-vitals.cache';
import {
  ACTIVITY_DAY_COUNT,
  SPEND_DAY_COUNT,
  usageDayWindow,
} from './usage-vitals.model';
import {
  injectVitalsTick,
  injectWorkspaceUsage,
  toActivityVitals,
  toPlanRingLoad,
  toSpendVitals,
  usageDayWindows,
} from './usage-vitals.view';
import {
  VITALS_EMPTY,
  VITALS_ERROR,
  VITALS_ERROR_RETRY_MS,
  VITALS_LOADING,
  vitalsReady,
} from './vitals-load';

describe('usage vitals view', () => {
  const window = ['2026-10-25', '2026-10-26'];

  describe('toActivityVitals', () => {
    it('passes loading, empty and error through', () => {
      expect(toActivityVitals(VITALS_LOADING, window)).toBe(VITALS_LOADING);
      expect(toActivityVitals(VITALS_EMPTY, window)).toBe(VITALS_EMPTY);
      expect(toActivityVitals(VITALS_ERROR, window)).toBe(VITALS_ERROR);
    });

    it('is empty for no facts and error for an empty window', () => {
      expect(toActivityVitals(vitalsReady(summary([])), window)).toEqual(
        VITALS_EMPTY,
      );
      expect(
        toActivityVitals(vitalsReady(summary([fact('2026-10-26')])), []),
      ).toEqual(VITALS_ERROR);
    });

    it('counts the grid and the totals over the same window', () => {
      const load = toActivityVitals(
        vitalsReady(summary([fact('2026-10-26'), fact('2026-10-24')])),
        window,
      );
      expect(load).toEqual(
        vitalsReady({
          activity: {
            metric: 'requests',
            today: '2026-10-26',
            days: [
              { date: '2026-10-25', value: 0 },
              { date: '2026-10-26', value: 2 },
            ],
          },
          totals: { tokens: 100, costUsd: 1.5 },
          sessionCount: null,
        }),
      );
    });
  });

  describe('toSpendVitals', () => {
    it('maps bars and totals over the same window', () => {
      expect(
        toSpendVitals(
          vitalsReady(
            summary([fact('2026-10-26', { costUsd: 2 }), fact('2026-10-20')]),
          ),
          window,
        ),
      ).toEqual(
        vitalsReady({ days: [null, 2], totals: { tokens: 100, costUsd: 2 } }),
      );
    });

    it('is empty without facts, error without a window, and passes states through', () => {
      expect(toSpendVitals(vitalsReady(summary([])), window)).toEqual(
        VITALS_EMPTY,
      );
      expect(
        toSpendVitals(vitalsReady(summary([fact('2026-10-26')])), []),
      ).toEqual(VITALS_ERROR);
      expect(toSpendVitals(VITALS_LOADING, window)).toBe(VITALS_LOADING);
    });
  });

  describe('toPlanRingLoad', () => {
    it('is loading before the first snapshot, empty without a known window', () => {
      expect(toPlanRingLoad(null, null, 0)).toEqual(VITALS_LOADING);
      expect(toPlanRingLoad(planSnapshot([]), null, 0)).toEqual(VITALS_EMPTY);
      expect(toPlanRingLoad(planSnapshot([owner('a', 50)]), null, 0)).toEqual(
        vitalsReady({ percent: 50, label: '5-hour', resetsInMs: null }),
      );
    });
  });

  describe('injected helpers', () => {
    afterEach(() => {
      TestBed.resetTestingModule();
      jest.useRealTimers();
    });

    it('gives both windows for the current day', () => {
      jest.useFakeTimers({ now: new Date('2026-10-26T12:00:00.000Z') });
      const windows = usageDayWindows(signal(Date.now()));
      expect(windows.activity()).toEqual(
        usageDayWindow(new Date(), ACTIVITY_DAY_COUNT),
      );
      expect(windows.spend()).toEqual(
        usageDayWindow(new Date(), SPEND_DAY_COUNT),
      );
    });

    describe('injectVitalsTick', () => {
      function tickWith(plan: FakePlanLimits) {
        TestBed.configureTestingModule({
          providers: [{ provide: PlanLimitsStore, useValue: plan }],
        });
        return TestBed.runInInjectionContext(() => injectVitalsTick());
      }

      it('starts the shared clock with one load when nothing loaded plan limits', () => {
        const plan = fakePlanLimits();
        expect(tickWith(plan)).toBe(plan.now);
        expect(plan.load).toHaveBeenCalledTimes(1);
      });

      it('adds no load when a load is in flight or the clock runs', () => {
        const loading = fakePlanLimits();
        loading.loading.set(true);
        tickWith(loading);
        expect(loading.load).not.toHaveBeenCalled();
        TestBed.resetTestingModule();

        const running = fakePlanLimits();
        running.snapshot.set(planSnapshot([]));
        tickWith(running);
        expect(running.load).not.toHaveBeenCalled();
      });

      it('loads when a snapshot exists but the clock has stopped', () => {
        const plan = fakePlanLimits();
        plan.snapshot.set(planSnapshot([]));
        plan.now.set(Date.now() - 2 * PLAN_LIMITS_CLOCK_TICK_MS - 1);
        tickWith(plan);
        expect(plan.load).toHaveBeenCalledTimes(1);
      });
    });

    it('reads the cache in an effect, per workspace and on every tick', () => {
      const usage = fakeUsageCache();
      TestBed.configureTestingModule({
        providers: [{ provide: UsageVitalsCache, useValue: usage }],
      });
      const path = signal<string | null>(null);
      const tick = signal(0);
      const load = TestBed.runInInjectionContext(() =>
        injectWorkspaceUsage(path, 90, tick),
      );
      TestBed.flushEffects();
      expect(load()).toEqual(VITALS_LOADING);
      expect(usage.summary).not.toHaveBeenCalled();

      path.set('/a');
      TestBed.flushEffects();
      usage.entry('/a', 90).set(VITALS_ERROR);
      expect(load()).toEqual(VITALS_ERROR);
      // Reading the result does not read the cache again.
      load();
      expect(usage.summary).toHaveBeenCalledTimes(1);

      tick.set(1);
      TestBed.flushEffects();
      expect(usage.summary).toHaveBeenCalledTimes(2);
      expect(usage.summary).toHaveBeenLastCalledWith('/a', 90);

      path.set('/b');
      TestBed.flushEffects();
      expect(load()).toEqual(VITALS_LOADING);
      expect(usage.summary).toHaveBeenLastCalledWith('/b', 90);
    });

    it('retries a failed usage read on a tick past the error floor', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-26T12:00:00.000Z') });
      const call = jest
        .fn()
        .mockResolvedValueOnce(new RpcResult(false, undefined, 'down'))
        .mockResolvedValue(new RpcResult(true, summary([fact('2026-10-26')])));
      TestBed.configureTestingModule({
        providers: [
          { provide: ClaudeRpcService, useValue: { call } },
          { provide: LoggingService, useValue: { error: jest.fn() } },
        ],
      });
      const tick = signal(0);
      const load = TestBed.runInInjectionContext(() =>
        injectWorkspaceUsage(signal('/a'), 90, tick),
      );
      TestBed.flushEffects();
      await flush();
      expect(load()).toEqual(VITALS_ERROR);

      // A tick inside the floor does not refetch.
      jest.advanceTimersByTime(VITALS_ERROR_RETRY_MS - 1);
      tick.set(1);
      TestBed.flushEffects();
      await flush();
      expect(call).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1);
      tick.set(2);
      TestBed.flushEffects();
      await flush();
      expect(call).toHaveBeenCalledTimes(2);
      expect(load().status).toBe('ready');
    });
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
