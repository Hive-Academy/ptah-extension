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
 * use `??` and get the fallback they actually meant.
 */
export function knownSessionId(
  raw: string | null | undefined,
): string | undefined {
  return raw ? raw : undefined;
}

/**
 * The scoping rule, applied identically by every session-scoped agent view.
 *
 * A record with a KNOWN owner belongs to exactly that session. A record whose
 * owner is not known belongs to no session in particular and is therefore
 * visible from every one of them — an unattributed agent that renders nowhere
 * is an agent the user can neither steer nor stop, which is the failure this
 * rule exists to prevent.
 *
 * Deliberately NOT used by the destructive session operations
 * (`clearSessionAgents`, `clearCompletedInSession`, `forceClearSessionAgents`,
 * `BackgroundAgentStore.clearSession`): "visible here" must not mean "deletable
 * from here", or clearing one tile would wipe an agent out of every other tile.
 * Those stay on strict owner equality.
 */
export function agentVisibleInSession(
  parentSessionId: string | undefined,
  sessionId: string,
): boolean {
  return parentSessionId === undefined || parentSessionId === sessionId;
}
