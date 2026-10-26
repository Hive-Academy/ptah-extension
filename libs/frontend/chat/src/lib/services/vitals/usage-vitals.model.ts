import type { ActivityDay, PlanRingData } from '@ptah-extension/chat-ui';
import type {
  PlanLimitOwnerSnapshot,
  PlanLimitsSnapshot,
  PlanLimitUsed,
  PlanLimitWindow,
  UsageFact,
  UsageSummary,
} from '@ptah-extension/shared';

/**
 * Pure view models over `analytics:spendSummary` and the plan-limits
 * snapshot. No Angular at runtime (the chat-ui imports are types only): every
 * function is a plain mapping, unit-tested on its own.
 *
 * Day rule, shared by every function here: the host keys facts by UTC day
 * (`usage-summary.service.ts` buckets `toISOString().slice(0, 10)`), and a
 * day window ends at the later of the local and the UTC calendar day of `now`.
 * - Behind UTC in the evening, today's facts already carry tomorrow's UTC
 *   date; ending at the UTC day keeps them in the window.
 * - Ahead of UTC just after midnight, ending at the local day keeps the
 *   calendar the user sees; today's cell is empty until UTC catches up.
 * Days are labelled with the fact keys themselves, so a fact is counted in
 * exactly one day and the bars, the grid and `totals()` see the same facts.
 */

/**
 * Days in the activity grid: 13 weeks. One more than the 90 UTC days the
 * longest summary range returns, because the window can end one day past the
 * UTC day (ahead of UTC); with 91 cells every fetched day fits either way.
 */
export const ACTIVITY_DAY_COUNT = 91;
/** Days in the spend bars. */
export const SPEND_DAY_COUNT = 7;

/**
 * Activity per day. `metric` names what `value` counts: requests when every
 * fact in the window reports `requestCount`, else tokens (a mix of the two
 * units on one grid would misrank the days). `today` is the window's last day,
 * the cell the grid outlines.
 */
export interface UsageActivity {
  readonly metric: 'requests' | 'tokens';
  readonly today: string;
  readonly days: readonly ActivityDay[];
}

export interface UsageTotals {
  readonly tokens: number;
  /** `null` when every fact is unpriced (or there are none). */
  readonly costUsd: number | null;
}

const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function isValidDate(date: Date): boolean {
  return Number.isFinite(date.getTime());
}

function finite(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

/** Local calendar day of `date` as `YYYY-MM-DD`. */
export function localDayKey(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/** UTC calendar day of `date` as `YYYY-MM-DD`, the key the host buckets facts by. */
export function utcDayKey(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/**
 * The day rule on explicit keys: the `count` days ending at the later of
 * `localDay` and `utcDay`, oldest first. Stepping is done on UTC midnights,
 * so a DST change never skips or repeats a day. Empty for a malformed key or
 * a non-positive count.
 */
export function dayWindow(
  localDay: string,
  utcDay: string,
  count: number,
): string[] {
  if (!ISO_DAY.test(localDay) || !ISO_DAY.test(utcDay)) return [];
  if (!Number.isInteger(count) || count <= 0) return [];
  const match = ISO_DAY.exec(localDay > utcDay ? localDay : utcDay);
  if (!match) return [];
  const endMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(endMs)) return [];
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    keys.push(utcDayKey(new Date(endMs - offset * DAY_MS)));
  }
  return keys;
}

/**
 * The window every function below takes: {@link dayWindow} for the local and
 * UTC day of `now`. Compute it once per render and pass the same window to
 * the bars, the grid and `totals()`. Empty for an invalid date.
 */
export function usageDayWindow(now: Date, count: number): string[] {
  if (!isValidDate(now)) return [];
  return dayWindow(localDayKey(now), utcDayKey(now), count);
}

function factTokens(fact: UsageFact): number {
  return (
    finite(fact.inputUncachedTokens) +
    finite(fact.cacheReadTokens) +
    finite(fact.cacheWriteTokens) +
    finite(fact.outputTokens)
  );
}

function pricedCost(fact: UsageFact): number | null {
  return fact.costUsd !== null && Number.isFinite(fact.costUsd)
    ? fact.costUsd
    : null;
}

function factsInWindow(
  summary: UsageSummary,
  window: readonly string[],
): Map<string, UsageFact[]> {
  const byDay = new Map<string, UsageFact[]>(window.map((day) => [day, []]));
  for (const fact of summary.facts) byDay.get(fact.day)?.push(fact);
  return byDay;
}

/**
 * Activity for each day of `window` (the grid uses
 * `usageDayWindow(now, ACTIVITY_DAY_COUNT)`), oldest first; days without
 * facts are 0. `null` for an empty window (an invalid `now`).
 */
export function toActivityDays(
  summary: UsageSummary,
  window: readonly string[],
): UsageActivity | null {
  if (window.length === 0) return null;
  const byDay = factsInWindow(summary, window);
  const inWindow = [...byDay.values()].flat();
  const metric = inWindow.every((fact) => fact.requestCount !== undefined)
    ? 'requests'
    : 'tokens';
  const days = window.map((date) => {
    let value = 0;
    for (const fact of byDay.get(date) ?? []) {
      value += metric === 'requests' ? finite(fact.requestCount) : factTokens(fact);
    }
    return { date, value };
  });
  return { metric, today: window[window.length - 1], days };
}

/** True when the summary holds no usage at all (first-run signal). */
export function hasUsage(summary: UsageSummary): boolean {
  return summary.facts.length > 0;
}

/**
 * Token total over the 4 token fields and the priced cost total, over the
 * facts inside `window`: pass the window the bars or the grid draw, so the
 * totals and the chart count the same facts.
 */
export function totals(
  summary: UsageSummary,
  window: readonly string[],
): UsageTotals {
  let tokens = 0;
  let costUsd: number | null = null;
  for (const facts of factsInWindow(summary, window).values()) {
    for (const fact of facts) {
      tokens += factTokens(fact);
      const cost = pricedCost(fact);
      if (cost !== null) costUsd = (costUsd ?? 0) + cost;
    }
  }
  return { tokens, costUsd };
}

/**
 * Spend for each day of `window` (the bars use
 * `usageDayWindow(now, SPEND_DAY_COUNT)`), oldest first. A day without a
 * priced fact is `null` (the spend bars draw a dot for it).
 */
export function lastNDays(
  summary: UsageSummary,
  window: readonly string[],
): (number | null)[] {
  const byDay = factsInWindow(summary, window);
  return window.map((date) => {
    let cost: number | null = null;
    for (const fact of byDay.get(date) ?? []) {
      const priced = pricedCost(fact);
      if (priced !== null) cost = (cost ?? 0) + priced;
    }
    return cost;
  });
}

function usedPercent(used: PlanLimitUsed): number | null {
  const raw =
    used.kind === 'percent'
      ? used.percent
      : used.limit > 0
        ? (used.amount / used.limit) * 100
        : null;
  if (raw === null || !Number.isFinite(raw)) return null;
  return Math.min(100, Math.max(0, raw));
}

function windowPercent(window: PlanLimitWindow): number | null {
  return window.used ? usedPercent(window.used) : null;
}

function hasUsedWindow(owner: PlanLimitOwnerSnapshot): boolean {
  return owner.windows.some((window) => windowPercent(window) !== null);
}

function ownerForSession(
  snapshot: PlanLimitsSnapshot,
  sessionId: string | null,
): PlanLimitOwnerSnapshot | null {
  if (
    sessionId !== null &&
    Object.prototype.hasOwnProperty.call(snapshot.sessionOwners, sessionId)
  ) {
    const ownerKey = snapshot.sessionOwners[sessionId].ownerKey;
    if (ownerKey !== null) {
      // A session's own account is shown or nothing is: another account's
      // limits would misread as this session's.
      return snapshot.owners.find((owner) => owner.owner.key === ownerKey) ?? null;
    }
  }
  return snapshot.owners.find(hasUsedWindow) ?? null;
}

/**
 * The plan window to draw: the session's owner when the snapshot names one,
 * else the first owner with a known `used`; within it, the window with the
 * highest used percentage. `null` when nothing is known. A non-finite `now`
 * or `resetsAt` gives an unknown reset.
 */
export function selectPlanRing(
  snapshot: PlanLimitsSnapshot | null,
  sessionId: string | null,
  now: number,
): PlanRingData | null {
  if (snapshot === null) return null;
  const owner = ownerForSession(snapshot, sessionId);
  if (owner === null) return null;

  let best: { window: PlanLimitWindow; percent: number } | null = null;
  for (const window of owner.windows) {
    const percent = windowPercent(window);
    if (percent !== null && (best === null || percent > best.percent)) {
      best = { window, percent };
    }
  }
  if (best === null) return null;
  const { resetsAt } = best.window;
  const delay = resetsAt === undefined ? Number.NaN : resetsAt - now;
  return {
    percent: best.percent,
    label: best.window.label,
    resetsInMs: Number.isFinite(delay) ? Math.max(0, delay) : null,
  };
}
