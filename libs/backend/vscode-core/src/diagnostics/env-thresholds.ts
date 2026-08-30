/**
 * Environment-sourced millisecond thresholds for the diagnostics seam.
 *
 * Every threshold in `src/diagnostics/` (and the two slow-path warnings in
 * `messaging/rpc-handler.ts` and vscode-lm-tools' `protocol-dispatcher.ts`)
 * ships with a default that is correct for a healthy machine. The reason they
 * are ALSO readable from the environment is that the failure these tools exist
 * to catch — TASK_2026_323, "the app hangs with three sessions open" — has no
 * known reproduction trigger. It happens on a user's machine, on a build that
 * is already installed. A threshold that can only be changed by a rebuild is a
 * threshold that cannot be tightened on the box that is actually hanging.
 *
 * Parsing is deliberately strict-but-silent: a malformed value falls back to
 * the compiled default rather than throwing, because a typo in an env var must
 * never be able to prevent the app from booting.
 */

/**
 * Read a positive, finite millisecond value from `process.env`.
 *
 * @param name - Environment variable name (e.g. `PTAH_LOOP_LAG_WARN_MS`).
 * @returns The parsed milliseconds, or `undefined` when the variable is unset,
 *   blank, non-numeric, or not strictly positive. Zero is rejected on purpose:
 *   `PTAH_RPC_SLOW_WARN_MS=0` reads like "disable", but would in fact warn on
 *   every single call, so it is treated as unset instead.
 */
export function readMsEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/**
 * Round a duration to one decimal place for logging.
 *
 * Sub-millisecond precision on a lag warning is noise — the histogram
 * resolution is 20 ms and the RPC threshold is 2000 ms — but truncating to a
 * whole number makes fast handlers all report `0`, which reads like a broken
 * timer rather than a fast call.
 */
export function roundMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}
