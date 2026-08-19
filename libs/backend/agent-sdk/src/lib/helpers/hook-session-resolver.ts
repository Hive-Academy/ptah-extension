/**
 * Hook session identity resolution — the one place the payload-first rule lives.
 *
 * Every SDK hook callback is built with a session id captured in a closure. For
 * a NEW session that id does not exist yet — the canonical one arrives later, in
 * the system `init` message — so the closure holds nothing for the whole query.
 * The hook payload always carries the real id (`BaseHookInput.session_id`),
 * which is why a handler must read the payload first and fall back to the
 * closure only when the payload has none.
 *
 * `''` from EITHER source means absent, not "the empty session". It is a third
 * state nothing downstream intends: `SessionIdSchema` is `z.string().uuid()`,
 * the branded `SessionId` requires a UUID, and consumers disagree about whether
 * `''` means "no filter / apply to all" or "a valid id" — which is exactly how
 * PreCompact fanned `''` to the memory curator, whose transcript reader rejected
 * it as path traversal and curated a placeholder (TASK_2026_293).
 *
 * Returning `null` rather than `''` forces every caller to decide what to do
 * with "no id" instead of silently publishing one (TASK_2026_295).
 */

/**
 * Payload beats closure; a blank value from either is absent, not a value.
 *
 * The one implementation behind both exported resolvers — a file whose purpose
 * is to be the single definition of a rule should not state that rule twice.
 */
function resolveFirstPresent(
  fromPayload: string | undefined,
  fromClosure: string | null | undefined,
): string | null {
  if (typeof fromPayload === 'string' && fromPayload.length > 0) {
    return fromPayload;
  }
  if (typeof fromClosure === 'string' && fromClosure.length > 0) {
    return fromClosure;
  }
  return null;
}

/**
 * Resolve the session id a hook callback should report.
 *
 * @param fromPayload - `input.session_id` from the SDK hook payload
 * @param fromClosure - the id captured when the hooks were built
 * @returns the first non-empty id, or `null` when neither source has one
 */
export function resolveHookSessionId(
  fromPayload: string | undefined,
  fromClosure: string | null | undefined,
): string | null {
  return resolveFirstPresent(fromPayload, fromClosure);
}

/**
 * Same precedence rule as {@link resolveHookSessionId}, for the working dir.
 *
 * @param fromPayload - `input.cwd` from the SDK hook payload
 * @param fromClosure - the cwd captured when the hooks were built
 * @returns the first non-empty path, or `null` when neither source has one
 */
export function resolveHookCwd(
  fromPayload: string | undefined,
  fromClosure: string | null | undefined,
): string | null {
  return resolveFirstPresent(fromPayload, fromClosure);
}
