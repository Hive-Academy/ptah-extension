/**
 * Codex plan-usage reader (TASK_2026_596, Component 6; Req 2.3, 2.10).
 *
 * Adapts `ICodexAccountUsageService` (the App Server account read, with its
 * own 30 s cache and single flight) to the plan-limit window shape:
 *
 * - `quota.primary` is window position 1 and `quota.secondary` position 2,
 *   always in that order, so `windows[0]`/`windows[1]` keep the primary /
 *   secondary meaning (Req 2.10). The kind comes from `windowDurationMins`
 *   through `windowKindFromDuration`; an absent or unrecognised duration is
 *   labelled by position only ("Window 1", "Window 2"), never guessed.
 * - `resetsAt` goes through `normaliseInstant` (the App Server reports epoch
 *   seconds).
 * - `account.planType` and `activity` pass through unchanged.
 * - `quota.rateLimitReachedType` is window evidence (Component 7): the
 *   window it names carries `exhaustion {observedAt, source:'provider-api'}`.
 *   No reached type the App Server defines today names a window (they name
 *   the cause: rate limit, credits, workspace usage), so it lands on every
 *   window at or over 100%; with none, no window is marked. The ledger's
 *   `supersedes` keeps newer live evidence over this reading.
 * - Every non-`available` status passes through. A `stale` answer (the
 *   service's own cache after a failed read) keeps its windows at the time
 *   they were originally read, never the time they were re-served.
 *
 * No credential: the App Server authenticates from `CODEX_HOME`.
 */
import {
  normaliseInstant,
  windowKindFromDuration,
  type PlanLimitWindow,
} from '@ptah-extension/shared';
import type {
  CodexAccountUsageResult,
  ICodexAccountUsageService,
} from '../../providers/codex/codex-provider.types';
import type {
  PlanUsageReader,
  PlanUsageReading,
} from './plan-usage-reader.types';

type CodexQuotaWindow = NonNullable<
  NonNullable<CodexAccountUsageResult['quota']>['primary']
>;

/** The Codex service surface this reader needs. */
export type CodexPlanUsageSource = Pick<
  ICodexAccountUsageService,
  'getAccountUsage'
>;

export function createCodexPlanUsageReader(
  usage: CodexPlanUsageSource,
  now: () => number = Date.now,
): PlanUsageReader {
  return async ({ refresh, signal }) =>
    mapCodexAccountUsage(
      await usage.getAccountUsage({ refresh, ...(signal && { signal }) }),
      now(),
    );
}

/** Map one Codex account result; `readAt` stands in for a missing `fetchedAt`. */
export function mapCodexAccountUsage(
  result: CodexAccountUsageResult,
  readAt: number,
): PlanUsageReading {
  if (result.status !== 'available' && result.status !== 'stale') {
    return { status: result.status, windowSetEstablished: false, windows: [] };
  }
  const observedAt = result.fetchedAt ?? readAt;
  const reached = Boolean(result.quota?.rateLimitReachedType);
  const windows = [
    toWindow(result.quota?.primary, 1, observedAt, reached),
    toWindow(result.quota?.secondary, 2, observedAt, reached),
  ].filter((window): window is PlanLimitWindow => window !== undefined);
  return {
    status: result.status,
    fetchedAt: observedAt,
    windowSetEstablished: true,
    windows,
    ...(result.account && { account: result.account }),
    ...(result.activity && { activity: result.activity }),
  };
}

function toWindow(
  quota: CodexQuotaWindow | undefined,
  position: 1 | 2,
  observedAt: number,
  limitReached: boolean,
): PlanLimitWindow | undefined {
  if (!quota) return undefined;
  const atLimit =
    Number.isFinite(quota.usedPercent) && quota.usedPercent >= 100;
  const descriptor = windowKindFromDuration(quota.windowDurationMins, position);
  const resetsAt = normaliseInstant(quota.resetsAt);
  const durationMins = quota.windowDurationMins;
  return {
    ...descriptor,
    ...(typeof durationMins === 'number' && { durationMins }),
    ...(Number.isFinite(quota.usedPercent) && {
      used: { kind: 'percent', percent: quota.usedPercent },
      usedSource: 'provider-api',
      usedObservedAt: observedAt,
    }),
    ...(resetsAt !== undefined && {
      resetsAt,
      resetSource: 'provider-api',
    }),
    ...(limitReached &&
      atLimit && {
        exhaustion: { observedAt, source: 'provider-api' },
      }),
    observedAt,
  };
}
