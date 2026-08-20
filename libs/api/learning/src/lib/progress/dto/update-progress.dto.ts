import { IsInt, Max, Min } from 'class-validator';

/**
 * `PUT /api/v1/members/courses/:slug/lessons/:lessonSlug/progress` — R2.3.1,
 * R2.3.2, §4.6.6, plan §3.4.
 *
 * ⚠️ BOUND WITH `dtoPipe(UpdateProgressDto)` (PRE-1).
 *
 * 🔴 EXACTLY ONE PROPERTY, AND THE ABSENT ONES ARE THE POINT. There is no
 * `completed`, no `completionSource`, no `completedAt`, no `duration`. §4.6.6:
 * **the client never sends a completion flag.** Completion is derived
 * SERVER-SIDE from `furthestPositionSeconds >= 0.9 * videoDurationSeconds`
 * against the PERSISTED duration (ASSUMPTION-8), inside
 * `progress/completion.ts`.
 *
 * ⚠️ AND IT IS UNREPRESENTABLE RATHER THAN IGNORED, ON BOTH SIDES. `dtoPipe`
 * runs with `forbidNonWhitelisted: true`, so `{ positionSeconds: 12,
 * completed: true }` is a `400` — not a `200` that silently dropped the flag,
 * which would leave a client author believing the field works. And
 * `ProgressService.updateProgress(ctx, lessonId, positionSeconds)` takes a PLAIN
 * NUMBER as its third argument, so even a controller bug has no object in which
 * to smuggle one. Two independent mechanisms, because this is the exit-gate
 * clause that says the client cannot decide completion.
 *
 * ⚠️ THE VALUE IS A **POSITION** IN SECONDS — HOW FAR INTO THE VIDEO — AND
 * NEVER A DURATION (RISK-O). The two are both integer seconds, both named
 * `*Seconds`, and interchangeable at every call site without a type error. This
 * one is the position; the duration lives on `Lesson.videoDurationSeconds` and
 * is written only by the authoring path.
 */
export class UpdateProgressDto {
  /**
   * How far into the video this member has reached, in whole seconds.
   *
   * ⚠️ MONOTONIC, ENFORCED BY POSTGRES. A lower value never moves the stored
   * `furthestPositionSeconds` backwards — `ProgressService` emits
   * `where: { furthestPositionSeconds: { lt: position } }` so the comparison
   * happens in the database rather than between two reads. Seeking backwards is
   * ordinary playback, not a regression to record.
   *
   * ⚠️ AN OVERSHOOT IS CLAMPED TO THE DURATION BEFORE THE 90% RULE IS APPLIED,
   * so a hostile client cannot complete a lesson by claiming an hour into a
   * five-minute video — it can only claim the five minutes it would have had to
   * watch anyway.
   *
   * The cap is ~11.5 days of seconds. It exists so a garbage integer cannot be
   * stored at all, not as a statement about video length; the real bound on what
   * counts is the clamp above.
   */
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  positionSeconds!: number;
}
