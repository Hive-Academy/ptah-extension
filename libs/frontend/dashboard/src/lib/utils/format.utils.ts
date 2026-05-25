/**
 * Format a USD cost value for display.
 * - NaN / undefined: $--
 * - Zero: $0.00
 * - Sub-cent (0 < cost < 0.01): $X.XXXX (4 decimals)
 * - Normal: $X.XX (2 decimals)
 */
export function formatCost(cost: number): string {
  if (isNaN(cost)) return '$--';
  if (cost === 0) return '$0.00';
  if (cost > 0 && cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
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
