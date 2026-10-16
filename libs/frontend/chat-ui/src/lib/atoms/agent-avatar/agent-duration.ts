const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;

/**
 * An agent's run time for display: `{s}s` under a minute, `{m}m {ss}s` under
 * an hour, `{h}h {mm}m` from an hour. Returns `null` for a non-finite or
 * negative value and for anything under one second; callers then show no
 * number at all (`Worked` / `Working`, not `0s`).
 */
export function formatAgentDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < SECOND_MS) return null;
  const totalSeconds = Math.floor(ms / SECOND_MS);
  if (totalSeconds < MINUTE_S) return `${totalSeconds}s`;
  if (totalSeconds < HOUR_S) {
    const minutes = Math.floor(totalSeconds / MINUTE_S);
    const seconds = totalSeconds % MINUTE_S;
    return `${minutes}m ${pad2(seconds)}s`;
  }
  const hours = Math.floor(totalSeconds / HOUR_S);
  const minutes = Math.floor((totalSeconds % HOUR_S) / MINUTE_S);
  return `${hours}h ${pad2(minutes)}m`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
