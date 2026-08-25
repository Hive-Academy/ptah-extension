import { IsBoolean } from 'class-validator';

/**
 * `PUT /api/v1/admin/courses/:id/published` — R2.1.2, R8.1, plan §3.4.
 *
 * ⚠️ BOUND WITH `dtoPipe(SetPublishedDto)` (PRE-1).
 *
 * ⚠️ `PUT` AND A BOOLEAN, NOT `POST /publish` + `POST /unpublish`. The request
 * expresses a desired END STATE, so a retried request converges on what the
 * admin asked for instead of toggling back — the same reasoning the forum's
 * reaction and accepted-answer toggles use.
 *
 * ⚠️ IT IS A SEPARATE ENDPOINT FROM `PATCH :id`, WITH ITS OWN AUDIT ACTION.
 * `learning.course.publish` is the row that answers "who made this course
 * visible to members, and when". Folded into `learning.course.update`, that
 * question becomes answerable only by diffing a `metadata` array — which is
 * reconstruction rather than record (the granularity argument
 * `AdminAuditAction`'s docblock makes for `community.topic.pin`).
 *
 * ⚠️ ONE ACTION FOR BOTH DIRECTIONS, WITH `{ published }` IN `metadata`.
 * `learning.course.unpublish` was considered and not added: the audit vocabulary
 * Batch 9B handed forward enumerates `publish` alone, and splitting it here
 * would put a value in the union that nothing in `tasks.md` names. The direction
 * is not lost — it is on the row, in `metadata.published`.
 */
export class SetPublishedDto {
  /**
   * `true` makes the course visible to every member its `visibility` and
   * `cohortKeys` admit; `false` returns it to draft, where R2.1.2 makes it a
   * `404` for everyone including the admin who wrote it.
   */
  @IsBoolean()
  published!: boolean;
}
