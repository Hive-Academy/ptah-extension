import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type {
  LockReason,
  MemberLessonComment,
} from '@ptah-contracts/community';

import { NOT_DELETED } from '../common/soft-delete';
import { DETERMINISTIC_ORDER_BY } from '../common/sort-order';
import { buildLessonCourseVisibilityWhere } from '../common/visibility';
import {
  ModuleLockService,
  type LockCourse,
  type LockModule,
} from '../courses/module-lock.service';
import { ProgressService } from '../progress/progress.service';

import { resolveParentForDepthTwo, wasDepthRepaired } from './comment-depth';

/**
 * LessonCommentsService — R2.5.1 – R2.5.5, A-8, AD-5, RK-12, plan §3.4.
 *
 * 🔴 A LESSON COMMENT IS A DISTINCT MODEL, NEVER A POLYMORPHIC COMMENT TABLE
 * SHARED WITH `Post` (a Checkpoint-0 decision, plan §1.4). What it shares with
 * the forum is the one-level nesting rule and its server-side enforcement —
 * `comment-depth.ts` holds that decision and names its forum sibling.
 *
 * ⚠️ A-8 — NO REACTIONS, EVER. Lesson comments get the "Answered" treatment
 * INSTEAD of reactions, matching the `course_learning` screens. There is no
 * `REACTION_TYPES` import in this lib and there must not be one; `answeredAt` /
 * `answeredBy` is the whole vocabulary.
 *
 * 🔴 VISIBILITY AND LOCKING BOTH INHERIT FROM THE LESSON (R2.5.1), ON THE WRITE
 * PATH AS WELL AS THE READ. A comment is visible exactly to the members who can
 * see its lesson, so:
 *   - an INVISIBLE or DRAFT course ⇒ **404**, by the same `where` clause every
 *     other read uses. There is no branch here that could produce a `403` for
 *     it, because nothing in this service ever learns the row existed.
 *   - a LOCKED MODULE ⇒ **403 `{ reason, unlocksAt }`**, because the member has
 *     already been shown that module and its lesson titles in the outline
 *     (R2.4.4). Visible-but-forbidden is what 403 is for.
 * Batch 6C proved the 404-not-403 posture holds on the write path as well as
 * the read for categories; both are asserted here.
 *
 * ⚠️ R2.5.5 — THE DISPLAYED COMMENT COUNT EXCLUDES TOMBSTONES, AND IT IS NOT
 * DENORMALISED. AD-11 permits exactly ONE denormalised counter in this task
 * (`Topic.postCount`) and nothing else, so live comments are counted in the
 * read query. That also means the forum's `postCount` drift hazard has no
 * miniature here — there is no second number to disagree with the rows.
 *
 * ⚠️ THIS FILE MUST NOT IMPORT `@ptah-api/youtube` (NFR-P6).
 */
@Injectable()
export class LessonCommentsService {
  private readonly logger = new Logger(LessonCommentsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModuleLockService) private readonly locks: ModuleLockService,
    @Inject(ProgressService) private readonly progress: ProgressService,
  ) {}

  /**
   * Every comment on a lesson, flat, oldest first — the thread
   * `MemberLessonDetail.comments` carries.
   *
   * ⚠️ A TOMBSTONE WITH LIVE CHILDREN IS RETURNED; A CHILDLESS ONE IS OMITTED.
   * That is the same rule the forum thread read uses, and it is what makes this
   * read satisfy AD-5 HONESTLY rather than needing an exemption: removing a
   * tombstoned parent outright would orphan its replies in the rendered thread,
   * and returning every tombstone would show removals nobody needs to see.
   *
   * ⚠️ THE WITHHELD BODY IS REPLACED BY A STATED PLACEHOLDER, NOT BY `''`.
   * Batch 7's thread page found that handing `''` to the markdown renderer
   * produces a silently blank row that reads as a rendering bug rather than as
   * a removal. The removed text reaches the wire in neither form.
   *
   * TWO QUERIES: the comments, and ONE batched author-name lookup. Never one
   * lookup per comment.
   */
  async listForLesson(lessonId: string): Promise<MemberLessonComment[]> {
    const comments = await this.prisma.lessonComment.findMany({
      where: {
        lessonId,
        // A tombstone is kept only while it still holds a live child — see the
        // docblock. `RULE-FILTER` accepts this because it names the constant;
        // the OTHER branch here is NARROWER than the first, not wider, which is
        // the review the analyser's known limit hands to a human.
        OR: [{ ...NOT_DELETED }, { children: { some: { ...NOT_DELETED } } }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        lessonId: true,
        parentId: true,
        bodyMarkdown: true,
        authorId: true,
        answeredAt: true,
        deletedAt: true,
        createdAt: true,
        editedAt: true,
      },
    });

    if (comments.length === 0) return [];

    // ONE batched lookup over the DEDUPLICATED author ids of LIVE comments. A
    // tombstone withholds its author, so fetching names for one would be a
    // disclosure with a query attached to it.
    const authorIds = [
      ...new Set(
        comments
          .filter((c) => c.deletedAt === null && c.authorId !== null)
          .map((c) => c.authorId as string),
      ),
    ];
    const authors =
      authorIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: authorIds } },
            // ⚠️ NAME ONLY, NEVER AN EMAIL (NFR-S4). `authorEmail` belongs to
            // an admin shape, and this lib has none.
            select: { id: true, firstName: true, lastName: true },
          });

    const nameById = new Map(
      authors.map((a) => [a.id, displayName(a.firstName, a.lastName)]),
    );

    return comments.map((c) => toMemberLessonComment(c, nameById));
  }

  /**
   * Post a comment — R2.5.1, R2.5.2, RK-12.
   *
   * Order of decisions, and each is a different status:
   *  1. the lesson must be visible to this member ⇒ else **404**;
   *  2. its module must be unlocked ⇒ else **403 `{ reason, unlocksAt }`**;
   *  3. a supplied `parentId` must name a live comment ON THIS LESSON ⇒ else
   *     **404**. A parent in another lesson and a tombstoned parent are NOT
   *     depth questions and must not be repaired into one;
   *  4. depth repair (`comment-depth.ts`).
   */
  async create(
    ctx: MemberContext,
    input: CreateLessonCommentInput,
  ): Promise<CreateLessonCommentResult> {
    const lesson = await this.requireCommentableLesson(ctx, input.lessonId);

    let parentId: string | null = null;
    let depthRepaired = false;

    if (input.parentId !== undefined && input.parentId !== null) {
      const parent = await this.prisma.lessonComment.findFirst({
        where: {
          id: input.parentId,
          // Scoped to the lesson: a parent in another lesson is a 404, not a
          // cross-lesson thread.
          lessonId: lesson.id,
          ...NOT_DELETED,
        },
        select: { id: true, parentId: true },
      });
      if (!parent) throw new NotFoundException('Comment not found');

      parentId = resolveParentForDepthTwo(parent);
      depthRepaired = wasDepthRepaired(parent, parentId);
    }

    const created = await this.prisma.lessonComment.create({
      data: {
        lessonId: lesson.id,
        parentId,
        bodyMarkdown: input.bodyMarkdown,
        authorId: ctx.userId,
      },
      select: COMMENT_SELECT,
    });

    this.logger.log(
      `Lesson comment created: id=${created.id} lessonId=${lesson.id} ` +
        `depthRepaired=${depthRepaired}`,
    );

    return {
      comment: toMemberLessonComment(created, new Map()),
      depthRepaired,
    };
  }

  /**
   * Edit a comment — R2.5.4.
   *
   * ⚠️ ANOTHER MEMBER'S COMMENT IS A `403`, NOT A `404`, AND THAT IS NOT IN
   * TENSION WITH THE VISIBILITY RULE. The member can already SEE the comment —
   * it is in the thread they just read — so its existence is not a secret and
   * `404` would be a lie about something on their screen. The 404 posture
   * protects rows the member cannot see at all, which the visibility clause
   * has already excluded by the time we get here.
   *
   * ⚠️ AN ADMIN MAY EDIT ANOTHER MEMBER'S COMMENT. That is a MODERATION grant,
   * not a widening of visibility — the one place in this lib besides
   * {@link setAnswered} where `isAdmin` decides who may ACT.
   */
  async update(
    ctx: MemberContext,
    commentId: string,
    bodyMarkdown: string,
  ): Promise<MemberLessonComment> {
    const existing = await this.requireOwnOrAdmin(ctx, commentId);

    const updated = await this.prisma.lessonComment.update({
      where: { id: existing.id },
      data: { bodyMarkdown, editedAt: new Date() },
      select: COMMENT_SELECT,
    });

    this.logger.log(`Lesson comment edited: id=${commentId}`);
    return toMemberLessonComment(updated, new Map());
  }

  /**
   * Soft-delete a comment — R2.5.4, AD-5.
   *
   * ⚠️ THE ROW SURVIVES, WITH ITS CHILDREN STILL ATTACHED.
   * `LessonComment.parent` is `onDelete: Restrict` (plan §1.4), so the database
   * would refuse a hard delete of a parent that has replies — which is what
   * makes "a child can never be orphaned" true rather than conventional. This
   * service only ever soft-deletes, so that constraint never fires; it is the
   * backstop, not the mechanism.
   *
   * ⚠️ `deletedBy` IS WRITTEN HERE, UNLIKE ON COURSES AND LESSONS.
   * `LessonComment` is the one model among the five that HAS the column (plan
   * §1.4), and the caller must supply a real actor — a soft delete storing a
   * placeholder is a deletion with no owner.
   */
  async remove(
    ctx: MemberContext,
    commentId: string,
  ): Promise<{ deleted: boolean }> {
    const existing = await this.requireOwnOrAdmin(ctx, commentId);

    await this.prisma.lessonComment.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), deletedBy: ctx.userId },
    });

    this.logger.log(`Lesson comment soft-deleted: id=${commentId}`);
    return { deleted: true };
  }

  /**
   * Mark a comment answered — R2.5.3: **an admin OR the lesson author**.
   *
   * 🔴 `Lesson` HAS NO `authorId` COLUMN. Plan §1.4 gives one to
   * `LessonComment` and to nothing else in the course tree; the nearest thing
   * to "the lesson's author" is `Course.createdBy`, and that is what this
   * method uses:
   *
   *     ctx.isAdmin || course.createdBy === ctx.userId
   *
   * ⚠️ AND ON THE SEEDED DATA THAT MEANS ADMIN-ONLY, WHICH IS FINE AND IS SAID
   * RATHER THAN DISCOVERED. Batch 11 writes no author, so `Course.createdBy` is
   * `null` on the seeded curriculum and the second branch matches nobody. The
   * alternative — inventing a `Lesson.authorId` — is a schema change that would
   * need migration 4's slot, for a distinction no current data expresses.
   */
  async setAnswered(
    ctx: MemberContext,
    commentId: string,
    answered: boolean,
  ): Promise<MemberLessonComment> {
    const comment = await this.prisma.lessonComment.findFirst({
      where: {
        id: commentId,
        ...NOT_DELETED,
        lesson: {
          ...NOT_DELETED,
          ...buildLessonCourseVisibilityWhere(ctx),
        },
      },
      select: { id: true, lessonId: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    if (!ctx.isAdmin) {
      const course = await this.prisma.course.findFirst({
        where: {
          ...NOT_DELETED,
          modules: {
            some: {
              ...NOT_DELETED,
              lessons: { some: { id: comment.lessonId, ...NOT_DELETED } },
            },
          },
        },
        select: { createdBy: true },
      });

      if (course?.createdBy !== ctx.userId) {
        throw new ForbiddenException(
          'Only the course author or an administrator can mark a comment as answered',
        );
      }
    }

    const updated = await this.prisma.lessonComment.update({
      where: { id: comment.id },
      data: answered
        ? { answeredAt: new Date(), answeredBy: ctx.userId }
        : { answeredAt: null, answeredBy: null },
      select: COMMENT_SELECT,
    });

    this.logger.log(`Lesson comment answered=${answered}: id=${commentId}`);
    return toMemberLessonComment(updated, new Map());
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Resolve a lesson this member may COMMENT ON: visible (else 404) and in an
   * unlocked module (else 403).
   *
   * ⚠️ THE LOCK IS EVALUATED WITH THE SAME `ModuleLockService` THE READ PATH
   * USES, over the same course tree and the same completion set. Two
   * independently written lock checks would drift, and the drift would be
   * invisible: one of them would silently allow writes into a module the
   * outline shows as closed.
   */
  private async requireCommentableLesson(
    ctx: MemberContext,
    lessonId: string,
  ): Promise<{ id: string }> {
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id: lessonId,
        ...NOT_DELETED,
        ...buildLessonCourseVisibilityWhere(ctx),
      },
      select: { id: true, moduleId: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');

    const course = await this.prisma.course.findFirst({
      where: {
        ...NOT_DELETED,
        modules: { some: { ...NOT_DELETED, id: lesson.moduleId } },
      },
      select: {
        sequential: true,
        modules: {
          where: { ...NOT_DELETED },
          orderBy: [...DETERMINISTIC_ORDER_BY],
          select: {
            id: true,
            releaseAt: true,
            lessons: {
              where: { ...NOT_DELETED },
              orderBy: [...DETERMINISTIC_ORDER_BY],
              select: { id: true },
            },
          },
        },
      },
    });
    if (!course) throw new NotFoundException('Lesson not found');

    const modules: LockModule[] = course.modules.map((m) => ({
      id: m.id,
      releaseAt: m.releaseAt,
      lessonIds: m.lessons.map((l) => l.id),
    }));
    const lockCourse: LockCourse = {
      sequential: course.sequential,
      modules,
    };
    const target = modules.find((m) => m.id === lesson.moduleId);
    if (!target) throw new NotFoundException('Lesson not found');

    const completed = await this.completedLessonIds(
      ctx,
      modules.flatMap((m) => m.lessonIds),
    );

    const verdict = this.locks.evaluate(
      target,
      lockCourse,
      completed,
      new Date(),
    );
    if (verdict.locked) {
      // ⚠️ THE MACHINE `reason` AND `unlocksAt`, NEVER A SENTENCE. `LOCK_REASONS`
      // is the shared vocabulary and the UI matches on the value.
      throw new ForbiddenException({
        reason: verdict.reason satisfies LockReason | null,
        unlocksAt: verdict.unlocksAt?.toISOString() ?? null,
        message: 'This module is not open yet.',
      });
    }

    return { id: lesson.id };
  }

  /** THIS member's completed lesson ids among a set — NFR-S4, one query. */
  private async completedLessonIds(
    ctx: MemberContext,
    lessonIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const rows = await this.progress.listProgressFor(ctx, lessonIds);
    return new Set(
      [...rows.values()]
        .filter((row) => row.completedAt !== null)
        .map((row) => row.lessonId),
    );
  }

  /**
   * Resolve a comment this member may MODIFY: their own, or any if they are an
   * admin.
   *
   * ⚠️ THE VISIBILITY CLAUSE COMES FIRST, SO THE 404 AND THE 403 STAY IN THE
   * RIGHT ORDER. A comment on a lesson the member cannot see must be `404`
   * even when they are its author — otherwise a member whose cohort assignment
   * was revoked could still probe the course by editing their old comments.
   */
  private async requireOwnOrAdmin(
    ctx: MemberContext,
    commentId: string,
  ): Promise<{ id: string; authorId: string | null }> {
    const comment = await this.prisma.lessonComment.findFirst({
      where: {
        id: commentId,
        ...NOT_DELETED,
        lesson: { ...NOT_DELETED, ...buildLessonCourseVisibilityWhere(ctx) },
      },
      select: { id: true, authorId: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    if (!ctx.isAdmin && comment.authorId !== ctx.userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }
    return comment;
  }
}

/* -------------------------------------------------------------------------- */
/* Projection and mapping                                                      */
/* -------------------------------------------------------------------------- */

/** The columns every comment response is built from. Never `deletedBy`. */
const COMMENT_SELECT = {
  id: true,
  lessonId: true,
  parentId: true,
  bodyMarkdown: true,
  authorId: true,
  answeredAt: true,
  deletedAt: true,
  createdAt: true,
  editedAt: true,
} as const;

/**
 * What a tombstone shows in place of the removed text.
 *
 * ⚠️ A SENTENCE, NOT `''`. Batch 7's thread page found that handing the empty
 * string to the markdown renderer produces a silently blank row that reads as a
 * rendering bug rather than as a removal. The client can still branch on
 * `deleted: true` to style it; this is what it renders if it does not.
 */
export const DELETED_COMMENT_PLACEHOLDER = 'This comment was removed.';

/** A stored row as the wire type — the ONE mapper. */
export function toMemberLessonComment(
  row: {
    id: string;
    lessonId: string;
    parentId: string | null;
    bodyMarkdown: string;
    authorId: string | null;
    answeredAt: Date | null;
    deletedAt: Date | null;
    createdAt: Date;
    editedAt: Date | null;
  },
  nameById: ReadonlyMap<string, string>,
): MemberLessonComment {
  const deleted = row.deletedAt !== null;

  return {
    id: row.id,
    lessonId: row.lessonId,
    parentId: row.parentId,
    // 🔴 THE REMOVED TEXT NEVER REACHES THE WIRE. The row keeps it so an admin
    // restore is a single-row write; the withholding happens here, at the read
    // model, not in the client.
    bodyMarkdown: deleted ? DELETED_COMMENT_PLACEHOLDER : row.bodyMarkdown,
    authorName: deleted ? null : (nameById.get(row.authorId ?? '') ?? null),
    answered: row.answeredAt !== null,
    deleted,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  };
}

/**
 * A display name from the two stored parts.
 *
 * `null` when neither part is set — a member who never completed their profile
 * renders as an anonymous author rather than as an empty string, which the UI
 * cannot tell from a rendering failure.
 */
function displayName(
  firstName: string | null,
  lastName: string | null,
): string {
  return [firstName, lastName].filter(Boolean).join(' ').trim();
}

/* -------------------------------------------------------------------------- */
/* Inputs and results                                                          */
/* -------------------------------------------------------------------------- */

/** @see LessonCommentsService.create */
export interface CreateLessonCommentInput {
  readonly lessonId: string;
  readonly bodyMarkdown: string;
  /** `null` and absent both mean "a top-level comment". */
  readonly parentId?: string | null;
}

/** @see LessonCommentsService.create */
export interface CreateLessonCommentResult {
  readonly comment: MemberLessonComment;
  /**
   * The RK-12 repair fired — the reply was re-pointed to its parent's parent.
   *
   * ⚠️ NOTHING DEPENDS ON THIS AND IT IS NOT ON THE WIRE CONTRACT. A client
   * that ignores it renders a correct thread.
   */
  readonly depthRepaired: boolean;
}
