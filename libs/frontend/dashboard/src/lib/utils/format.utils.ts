/**
 * Format a USD cost value for display.
 * - Zero: $0.00
 * - Sub-cent (0 < cost < 0.01): $X.XXXX (4 decimals)
 * - Normal: $X.XX (2 decimals)
 */
export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost > 0 && cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Format a token count for compact display.
 * - Millions: X.XM
 * - Thousands: X.XK
 * - Small: raw number
 */
export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}
