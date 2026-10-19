const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;

export interface AgentRun {
  readonly running: boolean;
  readonly startedAt?: number | null;
  readonly endedAt?: number | null;
  readonly reportedMs?: number | null;
}

/** A finished run never grows with the wall clock. */
export function agentRunDurationMs(run: AgentRun, now: number): number | null {
  const { startedAt, endedAt, reportedMs } = run;
  let ms: number | null = null;
  if (run.running) {
    if (startedAt != null && Number.isFinite(startedAt) && Number.isFinite(now)) {
      ms = now - startedAt;
    }
  } else if (startedAt != null && endedAt != null) {
    if (Number.isFinite(startedAt) && Number.isFinite(endedAt)) ms = endedAt - startedAt;
  } else if (reportedMs != null) {
    ms = reportedMs;
  }
  return ms !== null && Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export function agentRunLabel(run: AgentRun, now: number): string {
  const duration = agentRunDurationMs(run, now);
  const value = duration === null ? null : formatAgentDuration(duration);
  return run.running ? (value ? `Working · ${value}` : 'Working') : (value ? `Worked for ${value}` : 'Worked');
}

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
