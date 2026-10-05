/**
 * Display formatting for the session stats chips and the per-model table.
 * Pure functions: no Angular, no state.
 */

/** A dollar figure: `—` for unknown, four decimals below one cent. */
export function formatCost(cost: number | null): string {
  if (cost === null) {
    return '—';
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/** A token count: `1.2M`, `3.4k`, or the plain number below a thousand. */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return count.toString();
}

/** A row field an older producer may omit: absent is "—", never 0. */
export function formatOptionalTokens(count: number | undefined): string {
  return typeof count === 'number' ? formatTokens(count) : '—';
}

/** A duration: `850ms`, `12.5s`, or `2m 5s`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}
