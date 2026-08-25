/**
 * ISO-8601 duration parsing for `contentDetails.duration` — R2.2.3.
 *
 * ⚠️ DETERMINISTIC AND PURE. No network I/O, no configuration, never throws.
 *
 * ⚠️ THIS FUNCTION RETURNS `null`, NEVER `0`, FOR A FORM IT DOES NOT
 * UNDERSTAND — and that distinction is the whole reason it is a named module
 * with its own spec rather than three lines inside the provider.
 *
 * The number this produces is persisted as `Lesson.videoDurationSeconds`, and
 * it is the ONLY duration R2.3.2's completion rule is permitted to read
 * (ASSUMPTION-8). That rule is `furthestPositionSeconds >= 0.9 *
 * videoDurationSeconds`. If an unparseable duration degraded to `0`, the
 * threshold would become `0`, and `0 >= 0` is TRUE — every lesson would be
 * marked complete the instant a member opened it, silently, with no error
 * anywhere. `null` propagates into a nullable column, and a lesson with a
 * `null` duration is manual-completion-only by ASSUMPTION-8. A wrong number is
 * invisible; a missing one is not.
 *
 * 🔴 KNOWN GAP, HANDED FORWARD TO THE COMPLETION MODULE (Batch 9, Task 9.13).
 * `PT0S` is a duration this function DOES understand — YouTube emits it for a
 * video that is still processing — and it correctly returns `0`. A persisted
 * `videoDurationSeconds` of `0` reproduces the failure described above by a
 * different route: `0.9 * 0 === 0`, and `furthestPositionSeconds` defaults to
 * `0`. ASSUMPTION-8 keys manual-only on `null` and therefore does not catch it.
 * The completion predicate must treat a duration of `0` (and any negative) as
 * "no usable duration", exactly as it treats `null`. That guard belongs where
 * the comparison is written, not here: `0` is the honest parse of `PT0S` and
 * this function's contract is to report what YouTube said.
 */

/**
 * Days / hours / minutes / seconds, each optional, at least one required.
 *
 * ⚠️ YEARS, MONTHS AND WEEKS ARE DELIBERATELY UNSUPPORTED and fall through to
 * `null`. `P1Y` and `P1M` have no fixed length in seconds — a year is 365 or
 * 366 days and a month is 28 to 31 — so any constant chosen for them would be
 * wrong for most inputs, and it would be wrong SILENTLY. YouTube's
 * `contentDetails.duration` never emits them: a video's runtime is bounded by
 * the 12-hour upload limit and live streams are reported in hours. If one ever
 * appears it is a malformed response and should be surfaced as one.
 *
 * ⚠️ THE TWO `(?!$)` GUARDS REJECT THE DEGENERATE FORMS. Without the first,
 * `"P"` would match with every group undefined; without the second, `"PT"`
 * would. Both are syntactically well-formed ISO-8601 designators carrying no
 * quantity, and both would otherwise sum to `0` — the exact value the docblock
 * above forbids inventing.
 *
 * Fractional seconds (`PT1.5S`) are not accepted either: `Lesson`'s column is
 * an `Int`, so a fraction would have to be rounded somewhere, and doing it here
 * would hide the rounding from the call site.
 */
const ISO8601_DURATION_PATTERN =
  /^P(?!$)(?:(\d+)D)?(?:T(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_MINUTE = 60;

/**
 * Convert an ISO-8601 duration to whole seconds, or `null` if the input is not
 * a form this parser understands.
 *
 * Handles every shape YouTube actually emits:
 * - `PT1H2M3S` → `3723`
 * - `PT0S` → `0` (a zero-length or still-processing video — see the module
 *   docblock's known gap)
 * - `P1DT2H` → `93600` (a stream longer than 24 hours)
 * - `PT5M` → `300` (a missing component)
 * - `PT` → `null` (a designator with no quantity)
 * - `"5 minutes"` → `null`
 */
export function parseIso8601Duration(value: string): number | null {
  const match = ISO8601_DURATION_PATTERN.exec(value.trim());
  if (match === null) {
    return null;
  }

  const [, days, hours, minutes, seconds] = match;

  // The pattern's `(?!$)` guards already reject `P` and `PT`, but a form like
  // `P` followed only by an empty `T` group cannot occur and this check costs
  // nothing next to the cost of being wrong about that.
  if (
    days === undefined &&
    hours === undefined &&
    minutes === undefined &&
    seconds === undefined
  ) {
    return null;
  }

  const total =
    toNumber(days) * SECONDS_PER_DAY +
    toNumber(hours) * SECONDS_PER_HOUR +
    toNumber(minutes) * SECONDS_PER_MINUTE +
    toNumber(seconds);

  // A duration large enough to leave the safe-integer range is not a duration;
  // it is an upstream defect or an attack on a downstream `Int` column. Refuse
  // it rather than persisting a number that has already lost precision.
  return Number.isSafeInteger(total) ? total : null;
}

/** An absent component contributes nothing; `\d+` guarantees a finite parse. */
function toNumber(component: string | undefined): number {
  return component === undefined ? 0 : Number(component);
}
