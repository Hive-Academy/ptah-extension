/**
 * Session-id normalization and the single scoping rule for session-owned
 * agent records (TASK_2026_295).
 *
 * The backend can put `''` on `FlatStreamEvent.sessionId` and
 * `AgentProcessInfo.parentSessionId` while the SDK session UUID is still
 * unresolved. `''` is a THIRD state nothing intends: it is not nullish, so
 * `??` fallbacks skip it, and it is falsy, so `!x` guards reject it. The
 * frontend therefore refuses to store it — every writer runs the raw value
 * through {@link knownSessionId} and keeps `undefined` as the one
 * representation of "owner not known".
 *
 * That leaves exactly two states, which is also what the pending widening of
 * `FlatStreamEvent.sessionId` / `SubagentRecord.parentSessionId` to optional
 * will produce. When that wave lands, the `''` branch below becomes dead and
 * can be deleted without touching a single call site.
 */

/**
 * Collapse a raw session id off the wire into "known" or "not known".
 *
 * Returns `undefined` for `''`, `null` and `undefined` alike, so callers can
 * distinguish an absent owner from a known session.
 */
export function knownSessionId(
  raw: string | null | undefined,
): string | undefined {
  return raw ? raw : undefined;
}

/**
 * A session view lists only records owned by that exact session.
 * Ownerless records remain available in the unscoped tray and must never be
 * claimed by whichever tab happens to be focused. An unresolved view shows
 * nothing. Destructive session operations also use strict owner equality.
 */
export function agentVisibleInSession(
  parentSessionId: string | undefined,
  sessionId: string | null | undefined,
): boolean {
  if (!sessionId) return false;
  return parentSessionId === sessionId;
}
