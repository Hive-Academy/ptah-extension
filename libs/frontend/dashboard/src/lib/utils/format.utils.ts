import {
  sessionCostEstimate,
  type DashboardSessionEntry,
} from '../models/session-analytics.models';

/** Tooltip for the "≥" marker on a cost that covers only the priced usage. */
export const LOWER_BOUND_COST_TITLE =
  'Lower bound: part of the usage has no rate-card price, so the real cost is at least this much';

/** Session fields that decide which cost figure is shown and how. */
type SessionCostFields = Pick<
  DashboardSessionEntry,
  'status' | 'totalCost' | 'knownCost' | 'pricingCoverage' | 'cliAgents'
>;

/**
 * Format a USD cost value for display.
 * - null / NaN / undefined: $--
 * - Zero: $0.00
 * - Sub-cent (0 < cost < 0.01): $X.XXXX (4 decimals)
 * - Normal: $X.XX (2 decimals)
 */
export function formatCost(cost: number | null): string {
  if (cost === null || isNaN(cost)) return '$--';
  if (cost === 0) return '$0.00';
  if (cost > 0 && cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Format a current-rate-card cost estimate. `null` is an unknown price, shown
 * as "Unknown" so it can never be read as $0.
 */
export function formatEstimatedCost(cost: number | null): string {
  if (cost === null || isNaN(cost)) return 'Unknown';
  return formatCost(cost);
}

/**
 * Cost text for one session in any stats state. A partially priced session
 * shows its priced subtotal; callers render the lower-bound marker next to it
 * (see {@link sessionShowsLowerBound}). A session that only ran CLI agents
 * reads "Unknown": their spend is never recorded, so it is not "No usage" and
 * never $0.
 */
export function formatSessionCost(session: SessionCostFields): string {
  switch (session.status) {
    case 'pending':
      return 'Loading';
    case 'error':
      return 'Unavailable';
    case 'empty':
      return session.cliAgents.length > 0 ? 'Unknown' : 'No usage';
    case 'ok':
      return formatEstimatedCost(sessionCostEstimate(session).cost);
  }
}

/** True when the session's shown cost is a known figure (not a state word). */
export function sessionHasKnownCost(session: SessionCostFields): boolean {
  return session.status === 'ok' && sessionCostEstimate(session).cost !== null;
}

/** True when the shown cost is a priced subtotal, i.e. "at least" this much. */
export function sessionShowsLowerBound(session: SessionCostFields): boolean {
  if (session.status !== 'ok') return false;
  const estimate = sessionCostEstimate(session);
  return estimate.cost !== null && estimate.isLowerBound;
}

/**
 * Cost per message from the same figure the session shows. `null` when the
 * cost is unknown or there are no messages; a lower bound whenever the
 * session's cost is one (same marker).
 */
export function sessionCostPerMessage(
  session: SessionCostFields & Pick<DashboardSessionEntry, 'messageCount'>,
): number | null {
  if (session.status !== 'ok' || session.messageCount <= 0) return null;
  const cost = sessionCostEstimate(session).cost;
  return cost === null ? null : cost / session.messageCount;
}

/**
 * Text colour class for a cost value: the success colour only for a known
 * figure; unknown, unavailable, loading and "no usage" words stay neutral so
 * they can never read as a (green) amount.
 */
export function costValueClass(known: boolean): string {
  return known ? 'text-success' : 'text-base-content-muted';
}

/**
 * Why a session's numbers are incomplete, one sentence per reason. Empty for
 * a pending or fully counted and priced session.
 */
export function sessionCoverageNotes(
  session: SessionCostFields &
    Pick<DashboardSessionEntry, 'coverage' | 'untimestampedCount'>,
): string[] {
  if (session.status === 'pending') return [];
  if (session.status === 'error') {
    return ['Stats could not be read for this session.'];
  }
  const notes: string[] = [];
  if (session.untimestampedCount > 0) {
    const n = session.untimestampedCount;
    notes.push(
      `${n} usage ${n === 1 ? 'record has' : 'records have'} no timestamp and ${n === 1 ? 'is' : 'are'} not counted in this range.`,
    );
  } else if (session.coverage === 'partial') {
    notes.push('Some usage (such as a subagent transcript) could not be read.');
  }
  if (session.status === 'ok') {
    const estimate = sessionCostEstimate(session);
    if (estimate.cost === null) {
      notes.push('No current rate-card price for this usage; cost is unknown.');
    } else if (estimate.isLowerBound) {
      notes.push(
        'Part of this usage has no rate-card price; the cost shown is the priced part only, a lower bound.',
      );
    }
  }
  if (session.cliAgents.length > 0) {
    notes.push(
      `CLI agent runs (${session.cliAgents.join(', ')}) record no cost; they are not included in this estimate.`,
    );
  }
  return notes;
}

/**
 * Format a token count for compact display.
 * - NaN / undefined: --
 * - Millions: X.XM
 * - Thousands: X.XK
 * - Small: raw number
 */
export function formatTokenCount(count: number): string {
  if (isNaN(count)) return '--';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

/**
 * Format a count for compact display (no currency, thousands separators).
 * NaN/undefined → '0'.
 */
export function formatCompact(count: number): string {
  if (!Number.isFinite(count)) return '0';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}

/**
 * Format a duration in milliseconds as a compact human string
 * ("<1m", "42m", "3h 12m", "2d 4h"). Returns '--' for non-finite or
 * negative durations.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '--';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24)
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

/**
 * Format an absolute timestamp as a full date-time string
 * ("Jul 14, 2026, 3:45 PM"). Returns 'Unknown' for falsy/NaN/epoch-zero.
 */
export function formatFullDate(timestamp: number): string {
  if (!timestamp || isNaN(timestamp)) return 'Unknown';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format a past timestamp as a short relative string ("just now", "2h ago").
 * Falls back to '' for falsy/NaN/epoch-zero or future timestamps.
 */
export function formatRelativeTime(timestamp: number): string {
  if (!timestamp || isNaN(timestamp)) return '';
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return '';
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
