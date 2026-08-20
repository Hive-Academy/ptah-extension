import { IsBoolean } from 'class-validator';

/**
 * `PUT /api/v1/members/courses/:slug/lessons/:lessonSlug/completion` — R2.3.3,
 * plan §3.4.
 *
 * ⚠️ BOUND WITH `dtoPipe(SetCompletionDto)` (PRE-1).
 *
 * ⚠️ THIS IS NOT THE FLAG {@link UpdateProgressDto} REFUSES, AND THE DIFFERENCE
 * IS THE WHOLE DESIGN. R2.3.3 gives a member an EXPLICIT "mark this complete /
 * mark this incomplete" control — a lesson with no video, or one they watched
 * elsewhere, has no other route to done. What §4.6.6 forbids is a completion
 * flag riding along with a POSITION report, where the client would be asserting
 * a verdict the server is supposed to derive.
 *
 * So the two live on two endpoints with two DTOs:
 *
 *   `…/progress`    { positionSeconds }  → the server DERIVES completion
 *   `…/completion`  { complete }         → the member DECLARES it, and it is
 *                                          recorded as `completionSource:
 *                                          'manual'`
 *
 * A single endpoint carrying both would make the two indistinguishable in the
 * stored row, and "did they watch it or tick it" is exactly what
 * `completionSource` exists to answer.
 *
 * ⚠️ NO `completedAt` AND NO `completionSource`. The timestamp is the server's
 * clock and the source is decided by which endpoint was called;
 * `forbidNonWhitelisted` makes sending either a `400`.
 *
 * ⚠️ A KNOWN AND DELIBERATE CONSEQUENCE OF `complete: false` (R2.3.3): a member
 * who un-ticks a lesson they have already watched past the threshold WILL be
 * auto-completed again by the next progress write, because completion is derived
 * from a position that is still stored. That is the honest reading of a rule
 * derived from position; a sticky "manually incomplete" state would need a
 * column plan §1.4 does not have. In practice the client stops sending positions
 * when playback stops, so the reversal holds for a member who simply un-ticks
 * the box. `progress.service.spec.ts` pins both halves.
 */
export class SetCompletionDto {
  /** `true` marks it done; `false` clears `completedAt` and `completionSource`. */
  @IsBoolean()
  complete!: boolean;
}
