import type { LiveState } from '@ptah-contracts/community';

/**
 * WHERE A SESSION SITS RELATIVE TO NOW — RISK-W, R3.3, R3.4.
 *
 * 🔴 ONE PURE FUNCTION, WITH `now` AS AN EXPLICIT PARAMETER. Never
 * `new Date()` inside. Two reasons, and the second is the one that bites:
 *
 *   1. A clock read inside the derivation makes the whole feed untestable at a
 *      boundary — "does a session that ends in one second read `live`?" becomes
 *      a race rather than an assertion.
 *   2. `LiveFeedService` classifies THREE lists from TWO sources in one request.
 *      With a clock read per item, a session can be `'live'` in `upcoming` and
 *      `'replay'` in `replays` on the same screen, because the two reads
 *      happened 40 ms apart. The contract already says the state is "derived
 *      server-side from a SINGLE clock read"; this signature is what makes that
 *      enforceable rather than aspirational.
 *
 * ── THE THREE STATES OVER TWO NULLABLE INPUTS ──────────────────────────────
 *
 * `endsAt` is nullable on `LiveSession` (plan §1.5) and a replay id is nullable
 * on every source, which is more branching than "three states" suggests. The
 * whole cross-product is table-driven in `live-feed-state.spec.ts`.
 *
 *   now <  startsAt                     -> 'upcoming'
 *   startsAt <= now <  effectiveEnd     -> 'live'
 *   now >= effectiveEnd, has a replay   -> 'replay'
 *   now >= effectiveEnd, no replay      -> null  (DROPPED FROM THE FEED)
 *
 * 🔴 `null` IS A REAL ANSWER AND IT IS WHY THE RETURN TYPE IS NULLABLE. The
 * contract says an item is only ever `'replay'` when there is something to
 * replay — "a past session with no recording drops out of the feed rather than
 * appearing as an empty `'replay'`". Modelling that as a fourth state, or as
 * `'replay'` with a null video, pushes the decision into every client; modelling
 * it as `null` makes the feed builder unable to emit the item at all.
 *
 * 🔴 `effectiveEnd` IS WHY {@link LIVE_FALLBACK_MINUTES} EXISTS. A naive
 * `startsAt < now < endsAt` makes a session with `endsAt: null` NEVER live —
 * `now < null` is false — so it would jump straight from `'upcoming'` to
 * whatever the past branch says, and a session that is actually streaming right
 * now would never show a live indicator. The alternative failure, treating a
 * null end as "live for ever", leaves a session from March pinned to the top of
 * the feed. A bounded window is the only answer that is wrong in neither
 * direction for long.
 */

/**
 * How long a session with NO `endsAt` counts as live after it starts.
 *
 * ⚠️ A NAMED CONSTANT, NOT A LITERAL, AND NOT A CONFIG VALUE. Named because
 * RISK-W is about this exact number being invisible; not configurable because a
 * deployment that tuned it would change what "live now" means without changing
 * any code a reviewer reads.
 *
 * Two hours: long enough to cover a full office-hours call plus overrun, short
 * enough that a session nobody ended stops claiming the live slot the same day.
 * `SessionsService`'s Calendar events always carry a real `endsAt`, so this only
 * ever applies to a Ptah-authored `LiveSession` whose author left the end blank.
 */
export const LIVE_FALLBACK_MINUTES = 120;

/** {@link LIVE_FALLBACK_MINUTES} in milliseconds — derived, never re-typed. */
export const LIVE_FALLBACK_MS = LIVE_FALLBACK_MINUTES * 60 * 1000;

/** The inputs the derivation actually reads — deliberately not a whole row. */
export interface LiveStateInput {
  readonly startsAt: Date;
  /** `null` when the source records no end (plan §1.5). */
  readonly endsAt: Date | null;
  /** Is there a recording to play once it is over? R3.4. */
  readonly hasReplay: boolean;
}

/**
 * The instant a session stops being live.
 *
 * Exported because `LiveFeedService`'s Postgres reads have to express the SAME
 * boundary as a `WHERE` clause — "every session that has not yet ended" is
 * `endsAt >= now OR (endsAt IS NULL AND startsAt >= now - LIVE_FALLBACK_MS)`.
 * Two spellings of one rule is exactly how the read and the classifier come to
 * disagree, so the classifier's own arithmetic is the thing the query is written
 * against.
 */
export function effectiveEnd(startsAt: Date, endsAt: Date | null): Date {
  return endsAt ?? new Date(startsAt.getTime() + LIVE_FALLBACK_MS);
}

/**
 * Classify one session at `now`, or `null` when it must not appear in the feed.
 *
 * ⚠️ THE BOUNDARIES ARE `[startsAt, effectiveEnd)`. A session is live AT its
 * start instant (a member refreshing on the hour sees the live indicator, not
 * "starts in 0 minutes") and is NOT live at its end instant (a session whose end
 * is now has ended). Both are asserted at the exact millisecond.
 *
 * ⚠️ AN UNPARSEABLE OR INVERTED RANGE IS NOT SPECIAL-CASED HERE. `startsAt` is a
 * non-null Postgres `timestamp` or a value `resolveTimestamp` already parsed, so
 * an invalid `Date` cannot reach this function through either source. Adding a
 * `Number.isFinite` guard would be a branch no test could reach honestly.
 */
export function deriveLiveState(
  input: LiveStateInput,
  now: Date,
): LiveState | null {
  const at = now.getTime();

  if (at < input.startsAt.getTime()) {
    return 'upcoming';
  }

  if (at < effectiveEnd(input.startsAt, input.endsAt).getTime()) {
    return 'live';
  }

  return input.hasReplay ? 'replay' : null;
}
