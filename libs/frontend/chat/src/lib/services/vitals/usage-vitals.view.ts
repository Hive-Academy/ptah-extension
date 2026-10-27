import {
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import {
  PLAN_LIMITS_CLOCK_TICK_MS,
  PlanLimitsStore,
} from '@ptah-extension/core';
import type { PlanRingData } from '@ptah-extension/chat-ui';
import type { PlanLimitsSnapshot, UsageSummary } from '@ptah-extension/shared';
import { UsageVitalsCache, type UsageVitalsRange } from './usage-vitals.cache';
import {
  ACTIVITY_DAY_COUNT,
  SPEND_DAY_COUNT,
  hasUsage,
  lastNDays,
  localDayKey,
  selectPlanRing,
  toActivityDays,
  totals,
  usageDayWindow,
  utcDayKey,
  type UsageActivity,
  type UsageTotals,
} from './usage-vitals.model';
import {
  VITALS_EMPTY,
  VITALS_ERROR,
  VITALS_LOADING,
  vitalsReady,
  type VitalsLoad,
} from './vitals-load';

/**
 * Shared glue between the usage cache and the view-model stores: the day
 * windows and the two load mappings every screen draws.
 */

/**
 * The two day windows the empty screens draw. The activity grid and its
 * totals both read `activity`; the spend bars and their totals both read
 * `spend`; so a chart and its figures always count the same facts.
 */
export interface UsageDayWindows {
  readonly activity: Signal<readonly string[]>;
  readonly spend: Signal<readonly string[]>;
}

/** The activity grid plus the totals over the same window. */
export interface ActivityVitals {
  readonly activity: UsageActivity;
  readonly totals: UsageTotals;
  /** Sessions in the fetched range; `null` when the host did not count them. */
  readonly sessionCount: number | null;
}

/** The spend bars plus the totals over the same window. */
export interface SpendVitals {
  /** Spend per day, oldest first; `null` for a day without a priced fact. */
  readonly days: readonly (number | null)[];
  readonly totals: UsageTotals;
}

/**
 * The clock the vitals screens re-read on: `PlanLimitsStore.now`, the one
 * shared 30 s tick (no timer of its own).
 *
 * That tick starts with the store's first `load()`. When no surface has
 * loaded plan limits yet (no snapshot), or the tick has visibly stopped
 * (`now` is more than two periods behind the wall clock), this starts one
 * load, which also feeds the plan ring. A load already in flight is left to
 * start the tick, so a chat view that just loaded adds no second call.
 *
 * Call in an injection context.
 */
export function injectVitalsTick(): Signal<number> {
  const planLimits = inject(PlanLimitsStore);
  untracked(() => {
    if (planLimits.loading()) return;
    const stalled =
      Date.now() - planLimits.now() > 2 * PLAN_LIMITS_CLOCK_TICK_MS;
    if (planLimits.snapshot() === null || stalled) void planLimits.load();
  });
  return planLimits.now;
}

/**
 * Day windows that roll over at midnight (local or UTC, see
 * `usageDayWindow`). Each is computed once per day: `tick` (see
 * {@link injectVitalsTick}) reaches the windows only when the calendar day of
 * the tick changes. The window itself is taken from the wall clock when it is
 * computed, so a late tick cannot pin an old day.
 */
export function usageDayWindows(tick: Signal<number>): UsageDayWindows {
  const day = computed(() => {
    const at = new Date(tick());
    return `${localDayKey(at)}|${utcDayKey(at)}`;
  });
  return {
    activity: computed(() => {
      day();
      return usageDayWindow(new Date(), ACTIVITY_DAY_COUNT);
    }),
    spend: computed(() => {
      day();
      return usageDayWindow(new Date(), SPEND_DAY_COUNT);
    }),
  };
}

/**
 * A cached vitals source that keeps being re-read while the screen is open.
 *
 * `read(key)` (a cache `read()`) starts a fetch by writing the cache's own
 * signal, so it runs in an effect, never inside `computed()`. The effect runs
 * when `key` changes and on every `tick`; the cache decides whether a read is
 * due, so a good answer is refetched after its 60 s age and a failure is
 * retried on the first tick past its 5 s floor. `read` returning `null`
 * (nothing to read for this key) gives `loading`.
 *
 * Call in an injection context; the effect lives as long as that injector.
 */
export function injectVitalsSource<K, T>(
  key: () => K,
  read: (key: K) => Signal<VitalsLoad<T>> | null,
  tick: Signal<number>,
): Signal<VitalsLoad<T>> {
  const source = signal<Signal<VitalsLoad<T>> | null>(null);
  effect(() => {
    const current = key();
    tick();
    untracked(() => source.set(read(current)));
  });
  return computed(() => source()?.() ?? VITALS_LOADING);
}

/**
 * One workspace's usage summary for `range`, following `workspacePath` and
 * re-read on `tick` (see {@link injectVitalsSource}). `loading` while no
 * workspace is named: a workspace screen never falls back to the
 * all-workspaces figures.
 */
export function injectWorkspaceUsage(
  workspacePath: Signal<string | null>,
  range: UsageVitalsRange,
  tick: Signal<number>,
): Signal<VitalsLoad<UsageSummary>> {
  const cache = inject(UsageVitalsCache);
  return injectVitalsSource(
    () => workspacePath(),
    (path) => (path === null ? null : cache.summary(path, range)),
    tick,
  );
}

/**
 * The activity grid and its totals over `window`. A summary with no facts at
 * all is `empty` (the Day 1 field); an empty window (invalid clock) is
 * `error`. Loading and error pass through.
 */
export function toActivityVitals(
  load: VitalsLoad<UsageSummary>,
  window: readonly string[],
): VitalsLoad<ActivityVitals> {
  if (load.status !== 'ready') return load;
  const summary = load.value;
  if (!hasUsage(summary)) return VITALS_EMPTY;
  const activity = toActivityDays(summary, window);
  if (activity === null) return VITALS_ERROR;
  return vitalsReady({
    activity,
    totals: totals(summary, window),
    sessionCount: summary.sessionCount ?? null,
  });
}

/**
 * The plan ring as a load: `loading` until the first plan-limits snapshot,
 * `empty` when it names no owner or window with a known use (the ring is
 * hidden). A failed first read installs an empty snapshot, so it ends as
 * `empty` too.
 */
export function toPlanRingLoad(
  snapshot: PlanLimitsSnapshot | null,
  sessionId: string | null,
  now: number,
): VitalsLoad<PlanRingData> {
  if (snapshot === null) return VITALS_LOADING;
  const ring = selectPlanRing(snapshot, sessionId, now);
  return ring === null ? VITALS_EMPTY : vitalsReady(ring);
}

/**
 * The spend bars and their totals over `window`. A summary with no facts at
 * all is `empty` ("$0.00" with flat bars); an empty window is `error`.
 */
export function toSpendVitals(
  load: VitalsLoad<UsageSummary>,
  window: readonly string[],
): VitalsLoad<SpendVitals> {
  if (load.status !== 'ready') return load;
  const summary = load.value;
  if (!hasUsage(summary)) return VITALS_EMPTY;
  if (window.length === 0) return VITALS_ERROR;
  return vitalsReady({
    days: lastNDays(summary, window),
    totals: totals(summary, window),
  });
}
