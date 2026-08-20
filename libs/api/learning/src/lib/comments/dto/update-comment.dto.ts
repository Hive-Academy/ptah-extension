import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `PATCH /api/v1/members/lesson-comments/:id` — R2.5.4, plan §3.4.
 *
 * ⚠️ BOUND WITH `dtoPipe(UpdateCommentDto)` (PRE-1).
 *
 * ⚠️ `bodyMarkdown` IS REQUIRED, NOT OPTIONAL, AND THAT IS DELIBERATE. It is the
 * only editable field on a comment, so an "optional" version would accept an
 * empty patch and answer `200` for a request that changed nothing. Making it
 * required means the boundary rejects that, once, instead of the service having
 * to detect a no-op.
 *
 * ⚠️ NO `parentId`. Re-parenting an existing comment would move a reply out from
 * under the question it answers and could push a subtree past the two-level
 * limit RK-12's repair maintains at write time. Delete and repost is the honest
 * route.
 *
 * ⚠️ NO `answered` — R2.5.3's own endpoint, with its own authorisation rule.
 *
 * ⚠️ `403` vs `404`, AND WHY THEY ARE NOT IN TENSION HERE. Editing ANOTHER
 * member's comment is a `403`: the member can already SEE it (it was in the
 * thread they just read), so its existence is not a secret and a `404` would be
 * a lie about something on their screen. But a comment on a lesson the member
 * can NO LONGER see is a `404` **even for its own author** — otherwise a member
 * whose cohort assignment was revoked could keep probing the course by editing
 * their old comments. Both are decided in `LessonCommentsService`.
 */
export class UpdateCommentDto {
  /** RAW MARKDOWN, never HTML (PRE-4, AD-1). Sets `LessonComment.editedAt`. */
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  bodyMarkdown!: string;
}
