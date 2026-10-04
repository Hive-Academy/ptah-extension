/** Formats a known USD cost exactly as the chat cost badge does. */
export function formatUsdCost(cost: number | null | undefined): string | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return null;

  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

/** Formats a duration exactly as the chat duration badge does. */
export function formatDurationMs(durationMs: number): string {
  let ms = durationMs;
  if (ms > 0 && ms < 100) {
    ms *= 1000;
  }

  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
