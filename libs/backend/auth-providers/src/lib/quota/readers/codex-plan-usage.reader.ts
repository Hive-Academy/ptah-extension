/**
 * Codex plan-usage reader (TASK_2026_596, Component 6; Req 2.3, 2.10).
 *
 * Adapts `ICodexAccountUsageService` (the App Server account read, with its
 * own 30 s cache and single flight) to the plan-limit window shape:
 *
 * - Each bucket keeps primary before secondary. The active `codex` bucket
 *   comes first, followed by the other buckets in client-provided order.
 *   The kind comes from `windowDurationMins`
 *   through `windowKindFromDuration`; an absent or unrecognised duration is
 *   labelled by position only ("Window 1", "Window 2"), never guessed.
 * - `resetsAt` goes through `normaliseInstant` (the App Server reports epoch
 *   seconds).
 * - Safe account plan, activity and optional allowances pass through.
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
  type PlanLimitAllowance,
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
type CodexBucket = NonNullable<CodexAccountUsageResult['buckets']>[number];

/** The Codex service surface this reader needs. */
export type CodexPlanUsageSource = Pick<
  ICodexAccountUsageService,
  'getAccountUsage'
>;

export function createCodexPlanUsageReader(
  usage: CodexPlanUsageSource,
  now: () => number = Date.now,
  homeSource?: () => string | undefined,
): PlanUsageReader {
  return async ({ refresh, signal }) =>
    mapCodexAccountUsage(
      await usage.getAccountUsage({
        refresh,
        ...(signal && { signal }),
        ...(homeSource && { home: homeSource() }),
      }),
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
  const buckets: readonly CodexBucket[] = result.buckets ?? [{
    id: 'codex',
    label: 'Codex',
    ...result.quota,
  }];
  const qualified = result.buckets !== undefined;
  const windows = buckets.flatMap((bucket) => [
    toWindow(bucket, bucket.primary, 1, observedAt, qualified),
    toWindow(bucket, bucket.secondary, 2, observedAt, qualified),
  ]).filter((window): window is PlanLimitWindow => window !== undefined);
  const individual = (bucket: CodexBucket) => {
    if (!bucket.individualLimit) return undefined;
    const resetsAt = normaliseInstant(bucket.individualLimit.resetsAt);
    return {
      limit: bucket.individualLimit.limit,
      used: bucket.individualLimit.used,
      remainingPercent: bucket.individualLimit.remainingPercent,
      ...(resetsAt !== undefined && { resetsAt }),
    };
  };
  const allowances: PlanLimitAllowance[] = buckets.flatMap((bucket) => {
    const mappedIndividual = individual(bucket);
    return bucket.credits || mappedIndividual || bucket.rateLimitReachedType || bucket.spendControlReached != null
      ? [{
          bucketId: bucket.id,
          label: bucket.label,
          ...(bucket.rateLimitReachedType && { reachedType: bucket.rateLimitReachedType }),
          ...(bucket.spendControlReached != null && { spendControlReached: bucket.spendControlReached }),
          ...(bucket.credits && { credits: bucket.credits }),
          ...(mappedIndividual && { individual: mappedIndividual }),
        }]
      : [];
  });
  const active = buckets.find((bucket) => bucket.id === 'codex');
  const activeIndividual = allowances.find((allowance) => allowance.bucketId === 'codex')?.individual;
  return {
    status: result.status,
    fetchedAt: observedAt,
    windowSetEstablished: true,
    windows,
    ...(allowances.length > 0 && { allowances }),
    ...(active?.credits && { credits: active.credits }),
    ...(activeIndividual && { individualAllowance: activeIndividual }),
    ...(result.resetCreditsAvailable && { resetCreditsAvailable: true }),
    ...(result.upsellAvailable && { upsellAvailable: true }),
    ...(result.account && { account: result.account }),
    ...(result.activity && { activity: result.activity }),
  };
}

function toWindow(
  bucket: CodexBucket,
  quota: CodexQuotaWindow | undefined,
  position: 1 | 2,
  observedAt: number,
  qualified: boolean,
): PlanLimitWindow | undefined {
  if (!quota) return undefined;
  const atLimit =
    Number.isFinite(quota.usedPercent) && quota.usedPercent >= 100;
  const descriptor = windowKindFromDuration(quota.windowDurationMins, position);
  const resetsAt = normaliseInstant(quota.resetsAt);
  const durationMins = quota.windowDurationMins;
  return {
    ...descriptor,
    ...(qualified && bucket.id !== 'codex' && {
      key: `other:${bucket.id}:${position === 1 ? 'primary' : 'secondary'}` as const,
      label: `${bucket.label} ${descriptor.label}`,
    }),
    ...(qualified && { bucketId: bucket.id }),
    ...(qualified && bucket.rateLimitReachedType !== undefined && {
      reachedType: bucket.rateLimitReachedType,
    }),
    ...(qualified && bucket.spendControlReached != null && {
      spendControlReached: bucket.spendControlReached,
    }),
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
    ...(bucket.rateLimitReachedType !== undefined &&
      atLimit && {
        exhaustion: { observedAt, source: 'provider-api' },
      }),
    observedAt,
  };
}
