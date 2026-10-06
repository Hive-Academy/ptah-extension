import type { Logger } from '@ptah-extension/vscode-core';

/**
 * Hard ceiling on any ONE external probe.
 *
 * The probes already run under a single `Promise.all`, so the handler costs
 * whatever the SLOWEST of them costs — which means one wedged source holds the
 * entire status payload, and with it the first render. Measured on the
 * 2026-08-29 smoke boot: `auth:getAuthStatus` reported 22736 ms and 19911 ms
 * for two coalesced callers, all of it inside the Claude-CLI probe, while the
 * secret reads beside it finished in milliseconds.
 *
 * 5s is far above every probe's measured cost (copilot and codex are file
 * reads; a healthy `claude --version` is ~2s) so this fires only in pathology.
 * A probe that trips it is NOT cancelled — it keeps running and populates the
 * memo for the next caller. See `ClaudeCliHealthProbe.probe`.
 */
export const AUTH_PROBE_TIMEOUT_MS = 5_000;

/**
 * Race marker for {@link withProbeTimeout}.
 *
 * A unique symbol rather than `undefined` or `null`, because a probe is allowed
 * to resolve to either of those and a sentinel a probe can produce is not a
 * sentinel.
 */
const TIMED_OUT = Symbol('auth-probe-timeout');

/**
 * Resolve to `fallback` if `probe` has not settled within `AUTH_PROBE_TIMEOUT_MS`.
 *
 * The probe is deliberately NOT cancelled. There is nothing to cancel — a
 * spawn is already running — and letting it finish is what lets it populate
 * whatever memo it owns, so the next caller is fast instead of paying the
 * same timeout again.
 */
export async function withProbeTimeout<T>(
  logger: Logger,
  label: string,
  probe: Promise<T>,
  fallback: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), AUTH_PROBE_TIMEOUT_MS);
    timer.unref?.();
  });

  try {
    const outcome = await Promise.race([probe, expiry]);
    if (outcome !== TIMED_OUT) return outcome as T;
    logger.warn(
      `${label} auth probe exceeded ${AUTH_PROBE_TIMEOUT_MS}ms — answering from the last known value`,
    );
    return fallback();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
