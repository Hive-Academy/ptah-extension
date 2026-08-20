import { IsString, MaxLength, MinLength } from 'class-validator';

import {
  IsOptionalNotNull,
  NullMeansAbsent,
} from '../../common/optional-field';

/**
 * `POST /api/v1/members/lesson-comments` — R2.5.1, R2.5.2, RK-12, plan §3.4.
 *
 * ⚠️ BOUND WITH `dtoPipe(CreateCommentDto)` (PRE-1).
 *
 * ⚠️ IT IS A SEPARATE CONTROLLER FROM `v1/members/courses`, AND THE REASON IS
 * ROUTING (plan §3.4: "separate, to avoid contesting `courses/:slug`"). Hanging
 * comments off the course prefix would put a literal segment beside `:slug` at
 * the same depth, which is the shape RI-1/RI-3 exist to keep out of this server.
 *
 * ⚠️ NO `authorId`. The author is `req.memberContext.userId`, resolved once by
 * `MemberGuard` (R7.3). A field naming an author would let any entitled member
 * post as anyone; there is nothing to forge here because there is no identity in
 * the request to forge.
 *
 * ⚠️ NO `answered`. R2.5.3 makes that an admin-or-lesson-author action on its
 * own endpoint (`PUT :id/answered`); `forbidNonWhitelisted` turns a member who
 * sends it into a `400` rather than a silently ignored field.
 */
export class CreateCommentDto {
  /**
   * The lesson being commented on.
   *
   * ⚠️ VISIBILITY AND LOCKING BOTH INHERIT FROM THE COURSE (R2.5.1), and both
   * are decided in `LessonCommentsService.create`, not here: an invisible or
   * draft course's lesson is a `404` (the `where` finds nothing), and a lesson in
   * a LOCKED module is a `403 { reason, unlocksAt }`. The write path and the
   * read path reach that verdict through the SAME `ModuleLockService`, which is
   * what makes "you cannot comment on what you cannot open" true rather than
   * conventional.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  lessonId!: string;

  /**
   * RAW MARKDOWN, never HTML — rendered through the one sanitizer (PRE-4, AD-1).
   *
   * 10 000 rather than the lesson body's 50 000: a comment is a question about a
   * lesson, not a second lesson.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  bodyMarkdown!: string;

  /**
   * The comment being replied to, or absent for a top-level comment.
   *
   * 🔴 `null` AND ABSENT GENUINELY DENOTE THE SAME THING HERE, WHICH IS WHY THIS
   * IS THE ONE `NullMeansAbsent()` CALL SITE IN THE LIB. A comment with no parent
   * IS a top-level comment — exactly what omitting the key means — and
   * `MemberLessonComment.parentId` is `string | null` on the wire, so a client
   * that holds one and hands it straight back is doing a reasonable thing rather
   * than a malformed one. The transform runs during `plainToInstance` and turns
   * `null` into `undefined`; `IsOptionalNotNull()` then skips the property, while
   * a value of the WRONG TYPE still meets `@IsString()`.
   *
   * ⚠️ IT IS NOT A GENERAL SOFTENER, and `optional-field.ts` says so: on
   * `UpdateCourseDto.title` the same transform would turn "clear the title" into
   * "change nothing" — a request that looks honoured and is not.
   *
   * ⚠️ A DEPTH-3 REPLY IS REPAIRED TO DEPTH 2, NOT REJECTED (RK-12). The comment
   * is saved, re-pointed to its parent's parent, because a `400` loses a
   * member's writing over an implementation detail they cannot see — the client
   * renders two levels, and a "reply" control under a depth-2 comment is a
   * reasonable thing for a UI to offer and for a member to click. A parent in
   * ANOTHER lesson, or a tombstoned parent, is a `404` and is deliberately not
   * repaired: those are not depth questions.
   */
  @NullMeansAbsent()
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  parentId?: string;
}
