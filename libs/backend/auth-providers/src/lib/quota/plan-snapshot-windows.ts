/**
 * Which ledger windows an owner snapshot carries for a reading status.
 *
 * - A readable status (`available`, `stale`, `service-unavailable`) carries
 *   every ledger window.
 * - A "no source" status carries only windows with exhaustion evidence, so an
 *   observed limit hit is never discarded because nothing can measure the
 *   owner. `classifyWindow` drops them by rule once they reset.
 * - `unsupported-auth` and `unsupported-config` carry none: such an owner
 *   cannot be on a plan (for example a Claude API key).
 */
import type {
  PlanLimitWindow,
  ProviderAccountUsageStatus,
} from '@ptah-extension/shared';

const NO_SOURCE_STATUSES: ReadonlySet<ProviderAccountUsageStatus> = new Set([
  'no-usage-source',
  'provider-unsupported',
  'cli-unavailable',
  'cli-version-unsupported',
]);

const NO_PLAN_STATUSES: ReadonlySet<ProviderAccountUsageStatus> = new Set([
  'unsupported-auth',
  'unsupported-config',
]);

export function snapshotWindowsForStatus(
  status: ProviderAccountUsageStatus,
  ledgerWindows: readonly PlanLimitWindow[],
): PlanLimitWindow[] {
  if (NO_PLAN_STATUSES.has(status)) return [];
  if (NO_SOURCE_STATUSES.has(status)) {
    return ledgerWindows.filter((window) => window.exhaustion !== undefined);
  }
  return [...ledgerWindows];
}
