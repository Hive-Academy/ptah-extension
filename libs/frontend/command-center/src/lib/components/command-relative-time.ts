/** A shared, clock-driven freshness label. Invalid dates are unknown. */
export function relativeTime(timestamp: number | undefined, now: number): string | null {
  if (timestamp === undefined || !Number.isFinite(timestamp) || !Number.isFinite(now)) return null;
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
