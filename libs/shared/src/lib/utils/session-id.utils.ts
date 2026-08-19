/**
 * The one blankness converter for session ids.
 *
 * `''` is not a session id — the branded `SessionId` is a UUID — so a blank
 * string arriving on a session-id field is an upstream defect, not a scope.
 * Left alone it becomes a THIRD state beside "present" and "absent": a value
 * that reads back as legitimately scoped, survives every `a ?? b` chain, keys
 * its own row in every map and table, and silently collides with every other
 * caller that shared the same defect (TASK_2026_295).
 *
 * Before this module the rule was re-derived independently in five places with
 * four different trim policies, so a whitespace-only id was "absent" to three
 * of them and "a valid id" to two. That is a behavioural fork, not a style
 * inconsistency, and it is what these two functions exist to end.
 *
 * ## Trim policy — decided once, for every caller
 *
 * **Trim, and treat whitespace-only as absent.** `'   '` is absent and
 * `'  abc  '` normalises to `'abc'`. It is the majority policy of the
 * implementations this module replaces, and the only one that cannot be
 * defeated by a stray space.
 *
 * ### The one deliberate exception, recorded so it is not read as an oversight
 *
 * `knownSessionId` (`libs/frontend/chat-streaming/src/lib/session-scope.ts:25`)
 * deliberately does **not** trim — it is a bare truthiness check, so `'   '` is
 * a *present* id there. That divergence is pinned by `session-scope.spec.ts`
 * and is out of scope for the sweep that introduced this file: changing its
 * trim behaviour is a behavioural change on a frontend scoping rule and needs
 * its own justification. Do not "restore consistency" by editing it.
 */

/**
 * Collapse a blank session id to `undefined`.
 *
 * This is the primary form. `undefined` is the codebase's canonical
 * representation of absence (`libs/shared/CLAUDE.md` guideline 1), and it is
 * the only value `??` falls through on — so a normalised id can flow straight
 * into a `a ?? b ?? fallback` default chain and into an optional field.
 *
 * The `typeof` check is deliberate rather than redundant: the callers are
 * boundaries that read ids off the wire, out of SQLite, and out of parsed JSON,
 * where the declared `string` is a claim and not a guarantee.
 *
 * @param value - A possibly absent, possibly blank session id
 * @returns The trimmed id, or `undefined` when absent, empty or whitespace-only
 */
export function blankToUndefined(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Collapse a blank session id to `null`, for SQL binds.
 *
 * This exists for one concrete reason, and it is not a style preference:
 * **better-sqlite3 cannot bind `undefined` — it throws.** `null` is *required*
 * at the SQL boundary, and it is also the value the column already carries for
 * "this row has no session", which is the honest record. See
 * `libs/backend/memory-curator/src/lib/memory.store.ts:188-189`, where the
 * sibling binds in the same parameter object are all `?? null`.
 *
 * `blankToUndefined` stays the primary and this is a one-line wrapper of it, so
 * the trim policy is defined in exactly one place and the SQL boundary does not
 * re-derive the rule a sixth time.
 *
 * @param value - A possibly absent, possibly blank session id
 * @returns The trimmed id, or `null` when absent, empty or whitespace-only
 */
export function blankToNull(value: string | null | undefined): string | null {
  return blankToUndefined(value) ?? null;
}
