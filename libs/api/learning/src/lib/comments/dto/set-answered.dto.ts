import { IsBoolean } from 'class-validator';

/**
 * `PUT /api/v1/members/lesson-comments/:id/answered` — R2.5.3, plan §3.4.
 *
 * ⚠️ BOUND WITH `dtoPipe(SetAnsweredDto)` (PRE-1).
 *
 * ⚠️ `PUT` AND A BOOLEAN, NOT `POST /answered` + `DELETE /answered`. The request
 * expresses a desired end state, so a retry converges rather than toggling back
 * — the same contract shape the forum's reaction and accepted-answer toggles
 * use, and the same one `PUT :id/published` uses on the admin side.
 *
 * ⚠️ IT SITS ON THE MEMBER CONTROLLER BEHIND `MemberGuard`, NOT ON AN ADMIN ONE,
 * AND THE AUTHORISATION IS INSIDE THE SERVICE. R2.5.3 allows an ADMIN **or the
 * lesson author** to mark a comment answered, and "the lesson author" is not an
 * admin identity — `Lesson` has no `authorId` in plan §1.4, so
 * `LessonCommentsService.setAnswered` resolves it through `Course.createdBy`
 * (`ctx.isAdmin || course.createdBy === ctx.userId`). Putting the route behind
 * `AdminGuard` would delete the second half of the requirement; putting it on
 * this controller with a service-side check keeps both.
 *
 * ⚠️ ON THE SEEDED CURRICULUM THAT MAKES IT ADMIN-ONLY, and that is stated
 * rather than discovered: Batch 11 writes no `Course.createdBy`, so the second
 * branch matches nobody until an admin creates a course through the API.
 * `lesson-comments.service.spec.ts` carries that as its own case.
 *
 * ⚠️ IT IS NOT AN "ACCEPTED ANSWER" AND THERE IS NO POINTER ON THE LESSON. The
 * forum's `Topic.acceptedPostId` hoists one post to the top of a thread; this is
 * a per-comment boolean on `LessonComment.answered`, and a lesson may have any
 * number of answered comments. Do not unify them.
 */
export class SetAnsweredDto {
  /** `true` marks the comment answered; `false` clears the mark. */
  @IsBoolean()
  answered!: boolean;
}
