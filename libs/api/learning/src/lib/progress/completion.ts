/**
 * THE THREE UNITS LESSON PROGRESS COUNTS IN, AND THE ONLY PLACE TWO OF THEM
 * MEET — RISK-O, R2.3.2, R2.3.4, ASSUMPTION-8.
 *
 * 🔴 THIS FILE EXISTS BECAUSE TWO OF THE THREE ARE THE SAME TYPE AND LOOK
 * IDENTICAL, AND THE THIRD IS NOT DERIVED FROM EITHER.
 *
 * ── THE UNITS ───────────────────────────────────────────────────────────────
 *
 *   A POSITION IN SECONDS — `LessonProgress.furthestPositionSeconds`. How far
 *                           into the video THIS member has watched. Monotonic;
 *                           the server only ever advances it (R2.3.1).
 *
 *   A DURATION IN SECONDS — `Lesson.videoDurationSeconds`. How long the video
 *                           IS. Fetched once at authoring time and persisted
 *                           (plan §4.5); `null` when there is none.
 *
 *   A PERCENTAGE          — `MemberCourseSummary.percent`. DERIVED FROM LESSON
 *                           COUNTS (`completedLessons / totalLessons`), NEVER
 *                           from a sum of seconds (R2.3.5). IT IS NOT COMPUTED
 *                           IN THIS FILE AND MUST NOT BE — see below.
 *
 * The first two are both non-negative `Int` columns whose names both end in
 * `Seconds`. Nothing in the type system distinguishes them, so
 * `furthest >= 0.9 * duration` and `duration >= 0.9 * furthest` BOTH compile,
 * both pass review, and one of them is nonsense that returns a plausible
 * boolean. The forum shipped exactly this class of defect with `postCount` and
 * `lastReadPostNumber` (TASK_2026_177 F-1): the two were "consistent with each
 * other and all wrong" across FOUR call sites, and no single-site test could
 * see it — including one WRITE path that stored one unit into the other's
 * column, which meant the obvious one-line fix would have created a louder
 * defect. `libs/api/forum/src/lib/common/post-numbering.ts` is the answer that
 * cost an extra dispatch; this file is the same answer, applied earlier.
 *
 * ⚠️ SO: NO CALL SITE IN THIS LIB WRITES `* 0.9`, AND NONE COMPARES A POSITION
 * TO A DURATION DIRECTLY. Both go through {@link isAutoComplete}. An
 * unexplained arithmetic expression is what the next reader "corrects", and it
 * cannot express the inverse direction at all — which is why
 * {@link completionThresholdSeconds} exists even though nothing on the write
 * path strictly needs it: it makes the round trip STATEABLE AS A PROPERTY
 * (`isAutoComplete(completionThresholdSeconds(d), d) === true`), and a property
 * is what a spec can assert without restating the implementation's arithmetic.
 *
 * ⚠️ THE PERCENTAGE IS DELIBERATELY ABSENT FROM THIS FILE. It is a third
 * quantity that a reader may assume is "seconds watched over seconds total".
 * It is not, and there is no function here that would let it be: R2.3.5 counts
 * LESSONS, because averaging watch positions across lessons of different
 * lengths produces a number that means nothing and that disagrees with the
 * completion badge next to it. `CourseReadService` owns that derivation and its
 * spec asserts it is computed from counts.
 */

/**
 * R2.3.2's "recommended 90%".
 *
 * ⚠️ ONE DECLARATION, AND THE SPEC DELIBERATELY DOES NOT IMPORT IT. A spec that
 * derived its expectation from this constant could only confirm the
 * implementation is self-consistent — which is precisely the state F-1 shipped
 * in. `completion.spec.ts` re-declares `NINETY_PERCENT` itself and states the
 * expectation as a RATIO (`position / duration >= 0.9`), which is the
 * requirement's own words and an independent formulation of the same fact.
 *
 * Overruling it is one number here; nothing else in the lib names 0.9.
 */
export const COMPLETION_THRESHOLD_RATIO = 0.9;

/**
 * Is this a duration the 90% rule can be computed against at all?
 *
 * 🔴 `null` AND `<= 0` ARE BOTH "NO", AND THE SECOND HALF IS NOT PEDANTRY.
 *
 * ASSUMPTION-8 keys manual-only on `videoDurationSeconds === null`: a lesson
 * with no usable duration is manual-completion-only EVEN IF IT HAS A
 * `youtubeVideoId`, because the duration is the only reading that cannot
 * compute a threshold against nothing. That is right and it is INCOMPLETE.
 *
 * `0` is a duration this system can genuinely persist. YouTube emits `PT0S` for
 * a video that is still processing, `parseIso8601Duration` parses it honestly
 * to `0` (Batch 9A, Finding 4), and an admin can type `0` on the feature-off
 * path. With a `0` duration the naive threshold is `0`, so:
 *
 *     furthestPositionSeconds >= 0   ->   0 >= 0   ->   TRUE
 *
 * and every such lesson is complete the instant a member opens it — silently,
 * for every member, with no error anywhere. A negative duration is impossible
 * through the API and is refused here for the same reason rather than trusted.
 *
 * This predicate is the guard Batch 9A's Finding 4 handed to this task, and it
 * is one predicate in one file exactly as that finding said it should be.
 */
export function hasUsableDuration(
  videoDurationSeconds: number | null,
): videoDurationSeconds is number {
  return videoDurationSeconds !== null && videoDurationSeconds > 0;
}

/**
 * SECONDS -> SECONDS. The first POSITION at which a lesson auto-completes.
 *
 * ⚠️ THE ARGUMENT IS A DURATION AND THE RESULT IS A POSITION. They are
 * different quantities of the same type, which is the whole hazard this file
 * exists for; the parameter name and this sentence are the only things that say
 * so, because TypeScript cannot.
 *
 * ⚠️ `Math.ceil`, NOT `Math.floor` OR A BARE MULTIPLICATION. Positions arrive
 * from the player as whole seconds, so the useful answer is "the smallest
 * integer position that completes the lesson", not a fractional boundary
 * nothing can ever report. Rounding UP is also the conservative direction: a
 * lesson is never marked complete below 90%, whereas `floor` would complete a
 * 95-second video at 85 seconds — 89.5%, in breach of the requirement it is
 * implementing.
 *
 * ⚠️ IT REFUSES AN UNUSABLE DURATION RATHER THAN RETURNING `0`. Returning `0`
 * would hand back a threshold every position satisfies, which is the
 * zero-threshold defect one layer up. Callers ask {@link hasUsableDuration}
 * first, or use {@link isAutoComplete}, which does it for them.
 */
export function completionThresholdSeconds(
  videoDurationSeconds: number,
): number {
  if (!hasUsableDuration(videoDurationSeconds)) {
    throw new Error(
      `completionThresholdSeconds requires a usable duration; received ` +
        `${videoDurationSeconds}. A lesson with no usable duration is ` +
        `manual-completion-only (ASSUMPTION-8) and has no threshold — ask ` +
        `hasUsableDuration() first, or call isAutoComplete().`,
    );
  }
  return Math.ceil(videoDurationSeconds * COMPLETION_THRESHOLD_RATIO);
}

/**
 * SECONDS + SECONDS -> VERDICT. The one place the threshold is applied.
 *
 * ⚠️ THE ARGUMENT ORDER IS (POSITION, DURATION) AND SWAPPING IT IS NOT A TYPE
 * ERROR. It is, however, a behaviour change this file's spec catches: a
 * position of 10 into a 100-second video is not complete, and a "position" of
 * 100 into a "video" of 10 would be. Both parameter names carry their unit.
 *
 * ⚠️ RETURNS `false` FOR AN UNUSABLE DURATION, ALWAYS (ASSUMPTION-8 + the `0`
 * case above). That is what makes such a lesson manual-completion-only: there
 * is no position, however large, that auto-completes it. The position is still
 * RECORDED — it is useful for resume — which is `ProgressService`'s job, not
 * this function's.
 *
 * ⚠️ IT NEVER CONSULTS A CLOCK, A CLIENT FLAG OR A STORED `completedAt`.
 * Completion is computed server-side from two numbers (§4.6.6); the client has
 * no `completed` field to send and `UpdateProgressDto` has no property for one.
 * A manual completion (R2.3.3) is a DIFFERENT fact, stored in
 * `completionSource`, and it is deliberately not expressible here.
 */
export function isAutoComplete(
  furthestPositionSeconds: number,
  videoDurationSeconds: number | null,
): boolean {
  if (!hasUsableDuration(videoDurationSeconds)) return false;
  return (
    furthestPositionSeconds >= completionThresholdSeconds(videoDurationSeconds)
  );
}

/**
 * How far past the end of a video a reported position may sit before it is
 * refused rather than clamped — §4.6.5.
 *
 * ⚠️ PLAYERS OVERSHOOT, AND REFUSING THE OVERSHOOT WOULD PREVENT THE LAST WRITE
 * FROM EVER COMPLETING THE LESSON. The YouTube iframe API reports
 * `getCurrentTime()` from a 1-second poll, and the final tick after `ended`
 * routinely lands a fraction past the persisted duration — which is itself
 * rounded to whole seconds from an ISO-8601 string, so the two disagree by up
 * to a second before playback even starts. A member who watched to the end
 * would then have their completing write rejected.
 *
 * ⚠️ 5 SECONDS, AND WHY NOT MORE. It has to cover the poll interval plus the
 * rounding plus a little slack, and it has to stay well under any plausible
 * "this client is lying" margin — a member cannot claim to have watched a
 * 20-minute lesson by reporting 1205 seconds on a 20-second one, because the
 * value is CLAMPED rather than trusted (see {@link clampPositionSeconds}), so
 * the tolerance only decides refuse-vs-clamp, never what is stored.
 */
export const POSITION_OVERSHOOT_TOLERANCE_SECONDS = 5;

/**
 * Bring a client-reported position into range — §4.6.5, R2.3.1.
 *
 * ⚠️ CLAMPS RATHER THAN REJECTS, AND STORES THE CLAMPED VALUE. A position past
 * the end is normal (see the tolerance above); a position ABSURDLY past the end
 * is a broken or hostile client, and the honest response to both is the same —
 * store the largest value that could be true. Rejecting the first case breaks
 * completion for every member who watches to the end; trusting the second would
 * let a client mark any lesson complete by sending a large number, which is
 * exactly what §4.6.6 means by "completion is computed server-side".
 *
 * ⚠️ A NEGATIVE POSITION IS NOT CLAMPED HERE. It is a malformed argument, not
 * an overshoot, and `ProgressService` answers `400` — a value the DTO's
 * `@Min(0)` should already have refused, so reaching this function with one
 * means the boundary was bypassed. Returning `0` would hide that.
 *
 * ⚠️ AN UNUSABLE DURATION CLAMPS NOTHING. There is no ceiling to clamp to, and
 * the position is still worth recording for resume (ASSUMPTION-8).
 */
export function clampPositionSeconds(
  positionSeconds: number,
  videoDurationSeconds: number | null,
): number {
  if (!hasUsableDuration(videoDurationSeconds)) return positionSeconds;
  return Math.min(positionSeconds, videoDurationSeconds);
}

/**
 * Is a reported position so far past the end that it cannot be a real
 * overshoot? Used only to decide whether to log; the value is clamped either
 * way.
 */
export function isImplausiblePosition(
  positionSeconds: number,
  videoDurationSeconds: number | null,
): boolean {
  if (!hasUsableDuration(videoDurationSeconds)) return false;
  return (
    positionSeconds >
    videoDurationSeconds + POSITION_OVERSHOOT_TOLERANCE_SECONDS
  );
}
