import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlanLimitsStore } from '@ptah-extension/core';
import type { RecentWorkspace } from '@ptah-extension/shared';
import { HostInventoryCache } from './host-inventory.cache';
import { RecentWorkspacesStore } from './recent-workspaces.store';
import {
  fact,
  fakePlanLimits,
  fakeUsageCache,
  owner,
  planSnapshot,
  summary,
  type FakePlanLimits,
  type FakeUsageCache,
} from './testing/vitals-fixtures';
import {
  ACTIVITY_DAY_COUNT,
  SPEND_DAY_COUNT,
  usageDayWindow,
} from './usage-vitals.model';
import { UsageVitalsCache } from './usage-vitals.cache';
import {
  VITALS_EMPTY,
  VITALS_ERROR,
  VITALS_LOADING,
  vitalsReady,
  type VitalsLoad,
} from './vitals-load';
import { WelcomeVitalsStore } from './welcome-vitals.store';

const RECENT: RecentWorkspace = {
  path: '/work/ptah',
  name: 'ptah',
  lastOpenedAt: 1,
};

describe('WelcomeVitalsStore', () => {
  let usage: FakeUsageCache;
  let plan: FakePlanLimits;
  let recents: WritableSignal<VitalsLoad<readonly RecentWorkspace[]>>;
  let recentsLoad: jest.Mock;
  let clis: WritableSignal<VitalsLoad<number>>;
  let skills: WritableSignal<VitalsLoad<number>>;
  let cliCount: jest.Mock;

  function create(): WelcomeVitalsStore {
    TestBed.configureTestingModule({
      providers: [
        WelcomeVitalsStore,
        { provide: UsageVitalsCache, useValue: usage },
        { provide: PlanLimitsStore, useValue: plan },
        {
          provide: RecentWorkspacesStore,
          useValue: { recents, load: recentsLoad },
        },
        {
          provide: HostInventoryCache,
          useValue: { cliCount, skillCount: () => skills },
        },
      ],
    });
    const store = TestBed.inject(WelcomeVitalsStore);
    TestBed.flushEffects();
    return store;
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-26T12:00:00.000Z') });
    usage = fakeUsageCache();
    plan = fakePlanLimits();
    recents = signal<VitalsLoad<readonly RecentWorkspace[]>>(VITALS_LOADING);
    recentsLoad = jest.fn(async () => undefined);
    clis = signal<VitalsLoad<number>>(VITALS_LOADING);
    skills = signal<VitalsLoad<number>>(VITALS_LOADING);
    cliCount = jest.fn(() => clis);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('reads all-workspace usage for 90 and 7 days, rereads recents and loads plan limits once', () => {
    create();

    expect(usage.summary).toHaveBeenCalledWith(null, 90);
    expect(usage.summary).toHaveBeenCalledWith(null, 7);
    expect(usage.summary).toHaveBeenCalledTimes(2);
    expect(recentsLoad).toHaveBeenCalledTimes(1);
    expect(plan.load).toHaveBeenCalledTimes(1);
  });

  it('re-reads every cache on each shared clock tick, so a failure is retried', () => {
    const store = create();
    usage.entry(null, 90).set(VITALS_ERROR);
    clis.set(VITALS_ERROR);
    expect(store.activity90()).toEqual(VITALS_ERROR);
    expect(usage.summary).toHaveBeenCalledTimes(2);
    expect(cliCount).toHaveBeenCalledTimes(1);

    plan.now.set(plan.now() + 30_000);
    TestBed.flushEffects();
    expect(usage.summary).toHaveBeenCalledTimes(4);
    expect(cliCount).toHaveBeenCalledTimes(2);
  });

  it('rereads recents on a tick only after a failed read', () => {
    create();
    expect(recentsLoad).toHaveBeenCalledTimes(1);
    recents.set(vitalsReady([RECENT]));
    plan.now.set(plan.now() + 30_000);
    TestBed.flushEffects();
    expect(recentsLoad).toHaveBeenCalledTimes(1);

    recents.set(VITALS_ERROR);
    plan.now.set(plan.now() + 30_000);
    TestBed.flushEffects();
    expect(recentsLoad).toHaveBeenCalledTimes(2);
  });

  it('does not reload plan limits a chat surface already loaded', () => {
    plan.snapshot.set(planSnapshot([]));
    create();
    expect(plan.load).not.toHaveBeenCalled();
  });

  it('passes the host counts through', () => {
    const store = create();
    clis.set(vitalsReady(3));
    skills.set(VITALS_ERROR);
    expect(store.cliCount()).toEqual(vitalsReady(3));
    expect(store.skillCount()).toEqual(VITALS_ERROR);
  });

  describe('isFirstRun', () => {
    it('is null until both recents and usage have settled', () => {
      const store = create();
      expect(store.isFirstRun()).toBeNull();
      recents.set(VITALS_EMPTY);
      expect(store.isFirstRun()).toBeNull();
      recents.set(VITALS_LOADING);
      usage.entry(null, 90).set(vitalsReady(summary([])));
      expect(store.isFirstRun()).toBeNull();
    });

    it('is true with no recent workspace and no usage at all', () => {
      const store = create();
      recents.set(VITALS_EMPTY);
      usage.entry(null, 90).set(vitalsReady(summary([])));
      expect(store.isFirstRun()).toBe(true);
    });

    it('is false with a recent workspace or with any usage', () => {
      const store = create();
      recents.set(vitalsReady([RECENT]));
      usage.entry(null, 90).set(vitalsReady(summary([])));
      expect(store.isFirstRun()).toBe(false);
      recents.set(VITALS_EMPTY);
      usage.entry(null, 90).set(vitalsReady(summary([fact('2026-10-20')])));
      expect(store.isFirstRun()).toBe(false);
    });

    it('is false (not claimed) when either source failed', () => {
      const store = create();
      recents.set(VITALS_ERROR);
      usage.entry(null, 90).set(vitalsReady(summary([])));
      expect(store.isFirstRun()).toBe(false);
      recents.set(VITALS_EMPTY);
      usage.entry(null, 90).set(VITALS_ERROR);
      expect(store.isFirstRun()).toBe(false);
    });
  });

  it('maps the 90-day grid and totals over one window', () => {
    const store = create();
    const window = usageDayWindow(new Date(), ACTIVITY_DAY_COUNT);
    usage.entry(null, 90).set(
      vitalsReady(
        summary(
          [fact('2026-10-26'), fact('2020-01-01', { outputTokens: 1000 })],
          {
            sessionCount: 4,
          },
        ),
      ),
    );

    const activity = store.activity90();
    expect(activity.status).toBe('ready');
    if (activity.status !== 'ready') return;
    expect(activity.value.activity.days.map((day) => day.date)).toEqual(window);
    expect(
      activity.value.activity.days.find((day) => day.date === '2026-10-26')
        ?.value,
    ).toBe(2);
    // The fact outside the window is in neither the grid nor the totals.
    expect(activity.value.totals).toEqual({ tokens: 100, costUsd: 1.5 });
    expect(activity.value.sessionCount).toBe(4);
  });

  it('shows the Day 1 field (empty) for a summary with no facts and passes errors through', () => {
    const store = create();
    expect(store.activity90()).toEqual(VITALS_LOADING);
    usage.entry(null, 90).set(vitalsReady(summary([])));
    expect(store.activity90()).toEqual(VITALS_EMPTY);
    usage.entry(null, 90).set(VITALS_ERROR);
    expect(store.activity90()).toEqual(VITALS_ERROR);
  });

  it('maps the 7-day spend bars and totals over one window', () => {
    const store = create();
    usage
      .entry(null, 7)
      .set(vitalsReady(summary([fact('2026-10-26', { costUsd: 2.25 })])));

    const spend = store.spend7();
    expect(spend.status).toBe('ready');
    if (spend.status !== 'ready') return;
    expect(spend.value.days).toHaveLength(SPEND_DAY_COUNT);
    expect(spend.value.days.filter((day) => day !== null)).toEqual([2.25]);
    expect(spend.value.totals.costUsd).toBe(2.25);

    usage.entry(null, 7).set(vitalsReady(summary([])));
    expect(store.spend7()).toEqual(VITALS_EMPTY);
  });

  it('rolls the windows over when the shared clock reaches a new day', () => {
    const store = create();
    usage.entry(null, 90).set(vitalsReady(summary([fact('2026-10-26')])));
    const before = store.activity90();
    jest.setSystemTime(new Date('2026-10-28T12:00:00.000Z'));
    plan.now.set(Date.now());

    const after = store.activity90();
    expect(before.status === 'ready' && after.status === 'ready').toBe(true);
    if (before.status !== 'ready' || after.status !== 'ready') return;
    expect(after.value.activity.today > before.value.activity.today).toBe(true);
    expect(after.value.activity.days.map((day) => day.date)).toEqual(
      usageDayWindow(new Date(), ACTIVITY_DAY_COUNT),
    );
  });

  it('keeps the windows when the clock ticks within the same day', () => {
    const store = create();
    usage.entry(null, 90).set(vitalsReady(summary([fact('2026-10-26')])));
    const before = store.activity90();
    plan.now.set(Date.now() + 1_000);
    expect(store.activity90()).toBe(before);
  });

  it('shows the plan ring of the first known account, hidden when none is known', () => {
    const store = create();
    expect(store.planRing()).toEqual(VITALS_LOADING);
    plan.snapshot.set(planSnapshot([]));
    expect(store.planRing()).toEqual(VITALS_EMPTY);
    plan.snapshot.set(planSnapshot([owner('a', 38)]));
    expect(store.planRing()).toEqual(
      vitalsReady({ percent: 38, label: '5-hour', resetsInMs: null }),
    );
  });
});
