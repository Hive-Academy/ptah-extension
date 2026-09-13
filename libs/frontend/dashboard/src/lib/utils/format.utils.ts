import type { DashboardSessionEntry } from '../services/session-analytics-state.service';

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

/** Cost text for one session in any stats state. */
export function formatSessionCost(
  session: Pick<DashboardSessionEntry, 'status' | 'totalCost'>,
): string {
  switch (session.status) {
    case 'pending':
      return 'Loading';
    case 'error':
      return 'Unavailable';
    case 'empty':
      return 'No usage';
    case 'ok':
      return formatEstimatedCost(session.totalCost);
  }
}

/**
 * Why a session's numbers are incomplete, one sentence per reason. Empty for
 * a pending or fully counted and priced session.
 */
export function sessionCoverageNotes(
  session: Pick<
    DashboardSessionEntry,
    | 'status'
    | 'coverage'
    | 'untimestampedCount'
    | 'pricingCoverage'
    | 'totalCost'
  >,
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
  if (session.status === 'ok' && session.totalCost === null) {
    notes.push('No current rate-card price for this usage; cost is unknown.');
  } else if (session.pricingCoverage === 'partial') {
    notes.push('Part of this usage has no rate-card price; cost is a lower bound.');
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
