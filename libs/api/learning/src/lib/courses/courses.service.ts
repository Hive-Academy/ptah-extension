import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import type {
  AdminCourse,
  AdminCourseModule,
  AdminLesson,
  Visibility,
} from '@ptah-contracts/community';

import type {
  LessonVideoColumns,
  LessonVideoMetadataSource,
} from '../lessons/lesson-video.types';
import { NO_VIDEO } from '../lessons/lesson-video.types';
import {
  FALLBACK_COURSE_SLUG_STEM,
  FALLBACK_LESSON_SLUG_STEM,
  FALLBACK_MODULE_SLUG_STEM,
  buildSlug,
} from '../common/slug';
import {
  NOT_DELETED,
  assertRestored,
  restorableWhere,
} from '../common/soft-delete';
import { appendSortOrder } from '../common/sort-order';

/**
 * CoursesService — R2.1.1 – R2.1.3, R8.1, AD-10, AD-15, plan §3.4, PRE-6.
 *
 * The admin authoring path for courses, modules and lessons. Every method here
 * is reachable ONLY from `AdminGuard`-gated routes (9C's controllers); nothing
 * in this file takes a `MemberContext` and nothing applies a visibility filter,
 * which is the strongest available statement that it grants no member-side
 * authority. The member read model is `CourseReadService`.
 *
 * 🔴 THERE IS NO HARD DELETE IN THIS API AND THERE MUST NOT BE ONE.
 * `CourseModule.course` and `Lesson.module` are `onDelete: Cascade` (plan
 * §1.4), so a hard delete of a course would take its modules, its lessons AND
 * EVERY MEMBER'S PROGRESS with it — `LessonProgress.lesson` cascades too. The
 * cascade is a schema-level statement about what WOULD happen; its absence from
 * this API is the control. Delete is soft, everywhere, and the only `delete`
 * verb in this file is the one Prisma does not have.
 *
 * 🔴 `Course`, `CourseModule` AND `Lesson` HAVE NO `deletedBy` COLUMN. Plan
 * §1.4 gives one only to `LessonComment` among the five course models — so
 * Task 9.9's instruction to soft-delete with "`deletedAt`/`deletedBy`" is not
 * implementable for three of the four soft-deletable models here, and adding
 * the column would need migration 4's slot. WHAT IS PRESERVED IS THE PROPERTY
 * THE INSTRUCTION EXISTS FOR (Batch 6C, D-6.13i): every delete method takes a
 * `deletedBy` and it is a REAL admin id or the request never reaches here —
 * 9C's `requireAdminUserId` refuses rather than substituting `'unknown'` —
 * and the actor is recorded on the audit row, which commits inside the SAME
 * transaction as the tombstone (PRE-6) and therefore cannot go missing for the
 * one deletion anybody will ever ask about. The value is also logged. What is
 * lost is only the ability to answer "who deleted this" by reading the row
 * alone; the audit trail answers it.
 *
 * ⚠️ PRE-6 — EVERY MUTATION TAKES AN OPTIONAL {@link AuditHook} AND CALLS IT
 * WITH ITS OWN `tx`, FROM INSIDE ITS OWN `$transaction`. See the type's
 * docblock for why it is a seam rather than an injected `AuditLogService`.
 *
 * ⚠️ A PRISMA ERROR NEVER ESCAPES RAW (NFR-S7). `P2002` → a typed `409`,
 * `P2003`/`P2025` → a typed `404`, everything else → the error unchanged only
 * if it is already an `HttpException`. A `P2003` message names the constraint,
 * the table and the column — a schema disclosure on an endpoint that already
 * told the caller it refused.
 *
 * ⚠️ THIS FILE MUST NOT IMPORT `@ptah-api/youtube` (NFR-P6). Lesson video
 * metadata arrives as an already-resolved {@link LessonVideoColumns} value,
 * whose TYPE comes from a zero-dependency module. See `createLesson`.
 */
@Injectable()
export class CoursesService {
  private readonly logger = new Logger(CoursesService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /* ---------------------------------------------------------------------- */
  /* Admin reads                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Every LIVE course, for the authoring surface — `GET /v1/admin/courses`.
   *
   * ⚠️ NO VISIBILITY FILTER, AND THAT IS THE POINT OF A SEPARATE METHOD FROM
   * `CourseReadService.listCourses`. An admin managing courses must see the
   * `cohort` ones they are not in, the `staff` ones nobody else can reach, and
   * — critically — THE DRAFTS, which no member endpoint may return (R2.1.2).
   * Reusing one method with an `isAdmin` branch would put a write-surface
   * concern inside the member visibility path, and would give a draft course
   * two ways to become visible.
   *
   * ⚠️ IT EXCLUDES TOMBSTONES AND TAKES NO AD-5 EXEMPTION. Plan §3.4's admin
   * table has no `?includeDeleted` parameter for courses, so this is a list of
   * live courses. See the note on {@link restoreCourse} for the consequence.
   *
   * FOUR QUERIES, NO N+1: courses · their live modules projected to
   * `{ id, courseId }` · the live lessons of those modules projected to
   * `{ moduleId }` · the member groups named by the union of all `cohortKeys`.
   * A `_count: { select: { modules: true } }` would be shorter and WRONG — it
   * counts soft-deleted rows, and `soft-delete-filter.spec.ts` rejects it.
   */
  async listForAdmin(): Promise<AdminCourse[]> {
    const courses = await this.prisma.course.findMany({
      where: { ...NOT_DELETED },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });

    if (courses.length === 0) return [];

    const modules = await this.prisma.courseModule.findMany({
      where: { ...NOT_DELETED, courseId: { in: courses.map((c) => c.id) } },
      select: { id: true, courseId: true },
    });

    const lessons =
      modules.length === 0
        ? []
        : await this.prisma.lesson.findMany({
            where: {
              ...NOT_DELETED,
              moduleId: { in: modules.map((m) => m.id) },
            },
            select: { moduleId: true },
          });

    const moduleCourse = new Map(modules.map((m) => [m.id, m.courseId]));

    const moduleCounts = new Map<string, number>();
    for (const m of modules) {
      moduleCounts.set(m.courseId, (moduleCounts.get(m.courseId) ?? 0) + 1);
    }

    const lessonCounts = new Map<string, number>();
    for (const lesson of lessons) {
      const courseId = moduleCourse.get(lesson.moduleId);
      if (courseId === undefined) continue;
      lessonCounts.set(courseId, (lessonCounts.get(courseId) ?? 0) + 1);
    }

    const cohortNames = await this.resolveCohortNames(
      courses.flatMap((c) => c.cohortKeys),
    );

    return courses.map((course) =>
      toAdminCourse(
        course,
        moduleCounts.get(course.id) ?? 0,
        lessonCounts.get(course.id) ?? 0,
        cohortNames,
      ),
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Courses                                                                 */
  /* ---------------------------------------------------------------------- */

  /** Create a course. Unknown `cohortKey` → `400`; slug collision → `409`. */
  async createCourse(
    input: CreateCourseInput,
    audit?: AuditHook,
  ): Promise<AdminCourse> {
    const cohortKeys = input.cohortKeys ?? [];
    await this.assertCohortKeysExist(cohortKeys);

    const created = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        const taken = await tx.course.findMany({
          // ⚠️ The taken-set is read through NOT_DELETED (AD-5 binds every read
          // in this lib), so a SOFT-DELETED course's slug is invisible here
          // while still occupying the unique index. That is a deterministic
          // P2002, not an occasional one — see `withMappedPrismaErrors`.
          where: { ...NOT_DELETED },
          select: { slug: true },
        });

        const highest = await tx.course.aggregate({
          where: { ...NOT_DELETED },
          _max: { sortOrder: true },
        });

        const row = await tx.course.create({
          data: {
            slug: buildSlug(
              input.title,
              FALLBACK_COURSE_SLUG_STEM,
              new Set(taken.map((c) => c.slug)),
            ),
            title: input.title,
            description: input.description,
            coverImageUrl: input.coverImageUrl ?? null,
            visibility: input.visibility,
            cohortKeys: [...cohortKeys],
            // ⚠️ A COURSE IS CREATED AS A DRAFT (plan §1.4's `@default(false)`),
            // and publishing is a separate endpoint. Creating something
            // member-visible in the same request that creates it removes the
            // step where an admin checks their work.
            published: false,
            sequential: input.sequential ?? false,
            sortOrder:
              input.sortOrder ?? appendSortOrder(highest._max.sortOrder),
            createdBy: input.createdBy,
          },
        });

        await audit?.(tx, row.id);
        return row;
      }),
    );

    this.logger.log(
      `Course created: id=${created.id} slug=${created.slug} visibility=${created.visibility}`,
    );
    return toAdminCourse(
      created,
      0,
      0,
      await this.resolveCohortNames(cohortKeys),
    );
  }

  /**
   * Patch a course. Only supplied keys are written.
   *
   * ⚠️ THERE IS NO `slug` HERE. A course slug is its public URL and there is no
   * redirect table in this design; changing it breaks every shared link and
   * every browser history entry at once. Deleting and recreating is the honest
   * route, and it makes the consequence visible.
   *
   * ⚠️ AND NO `published` EITHER — see {@link setPublished}.
   */
  async updateCourse(
    id: string,
    input: UpdateCourseInput,
    audit?: AuditHook,
  ): Promise<AdminCourse> {
    if (input.cohortKeys !== undefined) {
      await this.assertCohortKeysExist(input.cohortKeys);
    }

    const updated = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.requireLiveCourse(tx, id);

        const data: Prisma.CourseUpdateInput = {};
        if (input.title !== undefined) data.title = input.title;
        if (input.description !== undefined)
          data.description = input.description;
        if (input.coverImageUrl !== undefined) {
          data.coverImageUrl = input.coverImageUrl;
        }
        if (input.visibility !== undefined) data.visibility = input.visibility;
        if (input.cohortKeys !== undefined) {
          data.cohortKeys = [...input.cohortKeys];
        }
        if (input.sequential !== undefined) data.sequential = input.sequential;
        if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

        const row = await tx.course.update({ where: { id }, data });
        await audit?.(tx, row.id);
        return row;
      }),
    );

    this.logger.log(`Course updated: id=${id}`);
    return this.hydrateCourse(updated);
  }

  /**
   * Publish or unpublish — `PUT /v1/admin/courses/:id/published` (R2.1.2).
   *
   * 🔴 A SEPARATE ENDPOINT FROM `update`, DELIBERATELY (plan §3.4). Publishing
   * is the one write with a member-visible blast radius: it moves a course from
   * "invisible to everyone" to "visible to a cohort", in one boolean. A
   * distinct audit action (`learning.course.publish`) answers "who made this
   * live, and when" directly; the same information buried in a `metadata` diff
   * on a generic update row is reconstruction rather than record.
   */
  async setPublished(
    id: string,
    published: boolean,
    audit?: AuditHook,
  ): Promise<AdminCourse> {
    const updated = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.requireLiveCourse(tx, id);
        const row = await tx.course.update({
          where: { id },
          data: { published },
        });
        await audit?.(tx, row.id);
        return row;
      }),
    );

    this.logger.log(`Course published=${published}: id=${id}`);
    return this.hydrateCourse(updated);
  }

  /**
   * Soft-delete a course — AD-5.
   *
   * ⚠️ ITS MODULES AND LESSONS ARE NOT INDIVIDUALLY TOMBSTONED, and they do not
   * need to be: every member read composes `buildCourseVisibilityWhere` through
   * `module.course`, and `buildLessonCourseVisibilityWhere` additionally
   * filters the module — so a deleted course takes its whole subtree out of
   * every member response in one write. Cascading the tombstone downward would
   * be N writes for the same effect, and would make the restore ambiguous (was
   * this lesson deleted with the course, or before it?).
   */
  async deleteCourse(
    id: string,
    deletedBy: string,
    audit?: AuditHook,
  ): Promise<{ deleted: boolean }> {
    await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.requireLiveCourse(tx, id);
        // ⚠️ `Course` HAS NO `deletedBy` COLUMN (plan §1.4 — only
        // `LessonComment` carries one among the five course models). The actor
        // is recorded on the audit row, which commits in THIS transaction, and
        // the caller still had to produce a real id to get here (9C's
        // `requireAdminUserId` refuses rather than writing a placeholder).
        await tx.course.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        await audit?.(tx, id);
      }),
    );

    this.logger.log(`Course soft-deleted: id=${id} by=${deletedBy}`);
    return { deleted: true };
  }

  /**
   * Restore a soft-deleted course — R8.5, `POST /v1/admin/courses/:id/restore`.
   *
   * 🔴 THE WINDOW IS INSIDE THE `UPDATE`'s OWN `WHERE`, AND THAT IS WHY THIS
   * LIB TAKES NO AD-5 EXEMPTION. Written as read-the-tombstone /
   * check-the-window / update, the pre-flight read would be an unfiltered read
   * of a soft-deletable model — an AD-5 exemption comment and a census entry,
   * on a WRITE path, which is exactly where such an exemption should be refused
   * in review. Here `updateMany().count` IS the outcome: `1` restorable and
   * restored, `0` not, with no gap and no tombstone read. Batch 6C's D-6.13d.
   *
   * ⚠️ AND A CAVEAT WORTH STATING: plan §3.4 gives courses a restore route but
   * NO read that surfaces tombstones. An admin therefore has no API path to
   * DISCOVER a restorable course — they must already hold its id. Flagged
   * rather than fixed here, because the fix is an `?includeDeleted` admin list,
   * which is a route and a census entry and belongs to whoever adds it.
   */
  async restoreCourse(
    id: string,
    now: Date,
    audit?: AuditHook,
  ): Promise<{ restored: boolean }> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.course.updateMany({
        where: { id, ...restorableWhere(now) },
        data: { deletedAt: null },
      });

      assertRestored(count);
      await audit?.(tx, id);
    });

    this.logger.log(`Course restored: id=${id}`);
    return { restored: true };
  }

  /* ---------------------------------------------------------------------- */
  /* Modules                                                                 */
  /* ---------------------------------------------------------------------- */

  /** Create a module under a live course. Unknown course → `404`. */
  async createModule(
    input: CreateModuleInput,
    audit?: AuditHook,
  ): Promise<AdminCourseModule> {
    const created = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.requireLiveCourse(tx, input.courseId);

        const siblings = await tx.courseModule.findMany({
          where: { ...NOT_DELETED, courseId: input.courseId },
          select: { slug: true },
        });
        const highest = await tx.courseModule.aggregate({
          where: { ...NOT_DELETED, courseId: input.courseId },
          _max: { sortOrder: true },
        });

        const row = await tx.courseModule.create({
          data: {
            courseId: input.courseId,
            // ⚠️ SCOPED TO THE COURSE, because `@@unique([courseId, slug])` is.
            // A resolver scoped to the wrong parent produces a P2002 the retry
            // cannot clear.
            slug: buildSlug(
              input.title,
              FALLBACK_MODULE_SLUG_STEM,
              new Set(siblings.map((m) => m.slug)),
            ),
            title: input.title,
            description: input.description ?? null,
            releaseAt: input.releaseAt ?? null,
            sortOrder:
              input.sortOrder ?? appendSortOrder(highest._max.sortOrder),
          },
        });

        await audit?.(tx, row.id);
        return row;
      }),
    );

    this.logger.log(
      `Module created: id=${created.id} courseId=${created.courseId}`,
    );
    return toAdminCourseModule(created, 0);
  }

  /**
   * Patch a module.
   *
   * ⚠️ `releaseAt` IS THE ONE FIELD WHERE AN EXPLICIT `null` IS A REAL VALUE:
   * it means "unschedule this module, open it now" (R2.4.1). That is why the
   * input type declares it `Date | null | undefined` and why 9C's DTO will need
   * a census entry in `nullable-dto.spec.ts` rather than
   * `@IsOptionalNotNull()`. `undefined` still means "do not touch".
   */
  async updateModule(
    id: string,
    input: UpdateModuleInput,
    audit?: AuditHook,
  ): Promise<AdminCourseModule> {
    const updated = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.requireLiveModule(tx, id);

        const data: Prisma.CourseModuleUpdateInput = {};
        if (input.title !== undefined) data.title = input.title;
        if (input.description !== undefined)
          data.description = input.description;
        if (input.releaseAt !== undefined) data.releaseAt = input.releaseAt;
        if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

        const row = await tx.courseModule.update({ where: { id }, data });
        await audit?.(tx, row.id);
        return row;
      }),
    );

    this.logger.log(`Module updated: id=${id}`);
    return toAdminCourseModule(updated, await this.countLessons(id));
  }

  /** Soft-delete a module. */
  async deleteModule(
    id: string,
    deletedBy: string,
    audit?: AuditHook,
  ): Promise<{ deleted: boolean }> {
    await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.requireLiveModule(tx, id);
        await tx.courseModule.update({
          where: { id },
          // `CourseModule` has no `deletedBy` column (plan §1.4) — only
          // `Course` and `LessonComment` do. The actor is recorded in the audit
          // row instead, which is why that row commits in this transaction.
          data: { deletedAt: new Date() },
        });
        await audit?.(tx, id);
      }),
    );

    this.logger.log(`Module soft-deleted: id=${id} by=${deletedBy}`);
    return { deleted: true };
  }

  /* ---------------------------------------------------------------------- */
  /* Lessons                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Create a lesson under a live module — R2.2.4.
   *
   * 🔴 `video` ARRIVES ALREADY RESOLVED, AND THE FETCH HAPPENED BEFORE THIS
   * TRANSACTION OPENED. That is R2.2.4's "fetch before the write, inside the
   * transaction boundary — either a fully-configured lesson or nothing", and
   * the two halves are deliberately in two files:
   *
   *   - `LessonVideoService.resolveVideoColumns(input)` does the network call
   *     and the §4.4 outcome→HTTP mapping. It touches no database and it is
   *     awaited BEFORE any `$transaction` — doing it inside one would hold a
   *     Postgres connection open for up to the provider's 10-second abort
   *     budget per save, which is how a slow upstream becomes pool exhaustion.
   *   - this method writes the row and all five metadata columns TOGETHER, so
   *     a fetch failure means no lesson at all rather than a half-configured
   *     one.
   *
   * The split is also what keeps NFR-P6 true by construction: this file imports
   * a TYPE from a zero-dependency module and has no path to `@ptah-api/youtube`
   * at all.
   */
  async createLesson(
    input: CreateLessonInput,
    video: LessonVideoColumns = NO_VIDEO,
    audit?: AuditHook,
  ): Promise<AdminLesson> {
    const created = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        const module = await this.requireLiveModule(tx, input.moduleId);

        // 🔴 THE TAKEN-SET IS COURSE-WIDE, NOT MODULE-WIDE, AND THE UNIQUE
        // INDEX IS MODULE-WIDE. `@@unique([moduleId, slug])` allows two modules
        // in one course to hold the same lesson slug — legal in the database
        // and AMBIGUOUS in `courses/:slug/lessons/:lessonSlug`, which is
        // course-scoped (plan §3.4). A course-wide set is a superset of the
        // module-wide one, so every slug it yields is free in the module too:
        // the unique index still decides and the P2002 mapping is unchanged.
        const siblings = await tx.lesson.findMany({
          where: {
            ...NOT_DELETED,
            // The nested `module` carries the filter too: a lesson in a
            // soft-deleted module is unreachable, so its slug is not competing
            // for the URL — and `RULE-NESTED` is right to insist, because the
            // same shape written for a COUNT would silently include tombstones.
            module: { ...NOT_DELETED, courseId: module.courseId },
          },
          select: { slug: true },
        });
        const highest = await tx.lesson.aggregate({
          where: { ...NOT_DELETED, moduleId: input.moduleId },
          _max: { sortOrder: true },
        });

        const row = await tx.lesson.create({
          data: {
            moduleId: input.moduleId,
            slug: buildSlug(
              input.title,
              FALLBACK_LESSON_SLUG_STEM,
              new Set(siblings.map((l) => l.slug)),
            ),
            title: input.title,
            bodyMarkdown: input.bodyMarkdown,
            sortOrder:
              input.sortOrder ?? appendSortOrder(highest._max.sortOrder),
            ...video,
          },
        });

        await audit?.(tx, row.id);
        return row;
      }),
    );

    this.logger.log(
      `Lesson created: id=${created.id} moduleId=${created.moduleId} ` +
        `videoSource=${created.videoMetadataSource ?? 'none'}`,
    );
    return toAdminLesson(created, 0);
  }

  /**
   * Patch a lesson's non-video fields.
   *
   * ⚠️ THE VIDEO COLUMNS ARE NOT PATCHABLE FROM HERE. They move together or not
   * at all (R2.2.4) and they are `LessonVideoService`'s to write —
   * `resolveAndPersist` owns the fetch, the §4.4 mapping and the five-column
   * write. Accepting a loose `videoTitle` here would let an admin type a title
   * onto an `'api'`-sourced row and leave `videoMetadataFetchedAt` claiming it
   * came from YouTube.
   */
  async updateLesson(
    id: string,
    input: UpdateLessonInput,
    audit?: AuditHook,
  ): Promise<AdminLesson> {
    const updated = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.requireLiveLesson(tx, id);

        const data: Prisma.LessonUpdateInput = {};
        if (input.title !== undefined) data.title = input.title;
        if (input.bodyMarkdown !== undefined) {
          data.bodyMarkdown = input.bodyMarkdown;
        }
        if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

        const row = await tx.lesson.update({ where: { id }, data });
        await audit?.(tx, row.id);
        return row;
      }),
    );

    this.logger.log(`Lesson updated: id=${id}`);
    return toAdminLesson(updated, await this.countComments(id));
  }

  /** Soft-delete a lesson. */
  async deleteLesson(
    id: string,
    deletedBy: string,
    audit?: AuditHook,
  ): Promise<{ deleted: boolean }> {
    await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.requireLiveLesson(tx, id);
        // `Lesson` has no `deletedBy` column (plan §1.4); the actor is on the
        // audit row, which commits in this same transaction.
        await tx.lesson.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        await audit?.(tx, id);
      }),
    );

    this.logger.log(`Lesson soft-deleted: id=${id} by=${deletedBy}`);
    return { deleted: true };
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Every `cohortKey` must name a real `MemberGroup.key` — AD-10.
   *
   * ⚠️ AN UNKNOWN KEY IS A `400`, NOT A SILENTLY UNREACHABLE COURSE. AD-10
   * stores cohort keys as a `String[]` column rather than a join table, so there
   * is NO foreign key to catch a typo: a course with `cohortKeys: ['foundng']`
   * saves cleanly, matches `hasSome` for nobody, and is invisible to every
   * member INCLUDING the admin who created it — with no error anywhere. The
   * array column is the right call (it keeps the visibility check to one
   * operator on one row); this check is the price of it.
   */
  private async assertCohortKeysExist(
    cohortKeys: readonly string[],
  ): Promise<void> {
    if (cohortKeys.length === 0) return;

    const groups = await this.prisma.memberGroup.findMany({
      where: { key: { in: [...cohortKeys] } },
      select: { key: true },
    });

    const found = new Set(groups.map((group) => group.key));
    const unknown = cohortKeys.filter((key) => !found.has(key));

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown cohort key(s): ${unknown.join(', ')} — create the member group first`,
      );
    }
  }

  /**
   * `MemberGroup.name` per key.
   *
   * ⚠️ RESOLVED, NOT ECHOED (Batch 6C, D-6.13g). A key naming a group that has
   * since been renamed or deleted stays in the array and matches nobody; the
   * admin table is the only surface that can show that, and it can only show it
   * if a missing name renders as `"<key> (unknown group)"` rather than being
   * dropped. A silently shorter array would make a stale key look like a key
   * that was never there.
   */
  private async resolveCohortNames(
    keys: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return new Map();

    const groups = await this.prisma.memberGroup.findMany({
      where: { key: { in: unique } },
      select: { key: true, name: true },
    });
    return new Map(groups.map((group) => [group.key, group.name]));
  }

  /** A course row plus the counts and names its admin shape needs. */
  private async hydrateCourse(course: CourseRow): Promise<AdminCourse> {
    const modules = await this.prisma.courseModule.findMany({
      where: { ...NOT_DELETED, courseId: course.id },
      select: { id: true },
    });
    const lessonCount =
      modules.length === 0
        ? 0
        : await this.prisma.lesson.count({
            where: {
              ...NOT_DELETED,
              moduleId: { in: modules.map((m) => m.id) },
            },
          });

    return toAdminCourse(
      course,
      modules.length,
      lessonCount,
      await this.resolveCohortNames(course.cohortKeys),
    );
  }

  private async countLessons(moduleId: string): Promise<number> {
    return this.prisma.lesson.count({ where: { ...NOT_DELETED, moduleId } });
  }

  private async countComments(lessonId: string): Promise<number> {
    // R2.5.5 — the displayed comment count EXCLUDES tombstones.
    return this.prisma.lessonComment.count({
      where: { ...NOT_DELETED, lessonId },
    });
  }

  /**
   * Resolve a live course inside a transaction, or `404`.
   *
   * ⚠️ `findFirst`, NOT `findUnique`. `Course` is soft-deletable and
   * `findUnique`'s `where` accepts unique fields only, so `{ id, ...NOT_DELETED }`
   * would not compile — it is the one read shape that can look filtered and not
   * be. Without the filter, an admin could "update" a course they had already
   * deleted and get a `200` for a write nobody can see.
   */
  private async requireLiveCourse(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ id: string }> {
    const course = await tx.course.findFirst({
      where: { id, ...NOT_DELETED },
      select: { id: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  /**
   * Resolve a live module whose COURSE is also live, or `404`.
   *
   * ⚠️ THE PARENT IS CHECKED IN THE SAME `where`, not in a second query. A
   * module inside a soft-deleted course is not an editable module — writing to
   * it would produce a `200` for a change no member can ever see, and the
   * two-query form additionally has a window where the two disagree.
   */
  private async requireLiveModule(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ id: string; courseId: string }> {
    const module = await tx.courseModule.findFirst({
      where: { id, ...NOT_DELETED, course: { ...NOT_DELETED } },
      select: { id: true, courseId: true },
    });
    if (!module) throw new NotFoundException('Module not found');
    return module;
  }

  /** Resolve a live lesson whose module and course are also live, or `404`. */
  private async requireLiveLesson(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ id: string; moduleId: string }> {
    const lesson = await tx.lesson.findFirst({
      where: {
        id,
        ...NOT_DELETED,
        module: { ...NOT_DELETED, course: { ...NOT_DELETED } },
      },
      select: { id: true, moduleId: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    return lesson;
  }

  /**
   * Run a write and translate any Prisma failure into a typed Nest exception
   * (NFR-S7).
   *
   * ⚠️ RAW PRISMA MESSAGES ARE NEVER FORWARDED. A `P2003` message names the
   * constraint, the table and the column — a schema disclosure on an endpoint
   * that already told the caller it refused.
   *
   * ⚠️ AN `HttpException` THROWN FROM INSIDE THE TRANSACTION PASSES THROUGH
   * UNTOUCHED. It is already typed and sanitized, and re-wrapping a deliberate
   * `404` would turn it into a `500`.
   */
  private async withMappedPrismaErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      throw mapPrismaError(error);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Error mapping                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Prisma failure → a typed, sanitized exception.
 *
 * Exported so `ReorderService` uses the SAME mapping: one documented error must
 * have one response body, or the admin panel has to recognise two sentences for
 * one rule.
 */
export function mapPrismaError(error: unknown): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      // The slug uniques are the only ones a caller can collide with. The
      // taken-set that produced the candidate is read through NOT_DELETED, so a
      // soft-deleted row's slug is invisible to the resolver while still
      // occupying the index — this is reachable deterministically, not only in
      // a race.
      return new BadRequestException(
        'That title collides with an existing item that was deleted. Choose a ' +
          'slightly different title.',
      );
    }
    if (error.code === 'P2003') {
      return new BadRequestException(
        'That parent does not exist, or is still referenced by other rows.',
      );
    }
    if (error.code === 'P2025') {
      return new NotFoundException('Not found');
    }
  }
  return error instanceof Error
    ? error
    : new Error('Unknown course persistence error');
}

/* -------------------------------------------------------------------------- */
/* Mappers                                                                     */
/* -------------------------------------------------------------------------- */

/** The `Course` row shape these writes return. */
export type CourseRow = Prisma.CourseModel;
/** The `CourseModule` row shape these writes return. */
export type CourseModuleRow = Prisma.CourseModuleModel;
/** The `Lesson` row shape these writes return. */
export type LessonRow = Prisma.LessonModel;

/**
 * A `Course` row as the admin wire type.
 *
 * ⚠️ `visibility` IS CAST, AND THE CAST ASSERTS A PROPERTY THE WRITE PATH
 * ENFORCES. The column is a Postgres `String`, not an enum (plan §1.4); it was
 * written through a DTO carrying `@IsIn(VISIBILITIES)`, so this is an assertion
 * about the write path rather than a hope about the data.
 */
export function toAdminCourse(
  course: CourseRow,
  moduleCount: number,
  lessonCount: number,
  cohortNames: ReadonlyMap<string, string>,
): AdminCourse {
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    description: course.description,
    coverImageUrl: course.coverImageUrl,
    visibility: course.visibility as Visibility,
    cohortKeys: [...course.cohortKeys],
    cohortNames: course.cohortKeys.map(
      (key) => cohortNames.get(key) ?? `${key} (unknown group)`,
    ),
    published: course.published,
    sequential: course.sequential,
    sortOrder: course.sortOrder,
    createdBy: course.createdBy,
    moduleCount,
    lessonCount,
    deletedAt: course.deletedAt?.toISOString() ?? null,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
  };
}

/** A `CourseModule` row as the admin wire type. */
export function toAdminCourseModule(
  module: CourseModuleRow,
  lessonCount: number,
): AdminCourseModule {
  return {
    id: module.id,
    courseId: module.courseId,
    slug: module.slug,
    title: module.title,
    description: module.description,
    sortOrder: module.sortOrder,
    releaseAt: module.releaseAt?.toISOString() ?? null,
    lessonCount,
    deletedAt: module.deletedAt?.toISOString() ?? null,
    createdAt: module.createdAt.toISOString(),
    updatedAt: module.updatedAt.toISOString(),
  };
}

/** A `Lesson` row as the admin wire type. */
export function toAdminLesson(
  lesson: LessonRow,
  commentCount: number,
): AdminLesson {
  return {
    id: lesson.id,
    moduleId: lesson.moduleId,
    slug: lesson.slug,
    title: lesson.title,
    bodyMarkdown: lesson.bodyMarkdown,
    sortOrder: lesson.sortOrder,
    youtubeVideoId: lesson.youtubeVideoId,
    videoTitle: lesson.videoTitle,
    videoDurationSeconds: lesson.videoDurationSeconds,
    videoThumbnailUrl: lesson.videoThumbnailUrl,
    videoMetadataFetchedAt:
      lesson.videoMetadataFetchedAt?.toISOString() ?? null,
    // Narrowed rather than cast blindly: a value outside the two this lib
    // writes is data corruption, and reporting it as `null` is safer than
    // handing an admin UI a source it does not switch on.
    videoMetadataSource:
      lesson.videoMetadataSource === 'api' ||
      lesson.videoMetadataSource === 'manual'
        ? (lesson.videoMetadataSource as LessonVideoMetadataSource)
        : null,
    commentCount,
    deletedAt: lesson.deletedAt?.toISOString() ?? null,
    createdAt: lesson.createdAt.toISOString(),
    updatedAt: lesson.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ THESE ARE THE SERVICE'S INPUT TYPES, NOT THE DTOs. 9C declares the
 * `class-validator` DTOs the controllers bind to and they structurally satisfy
 * these. Keeping the service's contract as a plain interface is what lets this
 * dispatch land the write path without owning the controller surface — and it
 * is what keeps `nullable-dto.spec.ts`'s census about DECORATED classes rather
 * than about every optional field in the lib.
 */
export interface CreateCourseInput {
  readonly title: string;
  readonly description: string;
  readonly coverImageUrl?: string | null;
  readonly visibility: Visibility;
  readonly cohortKeys?: readonly string[];
  readonly sequential?: boolean;
  readonly sortOrder?: number;
  /** The acting admin's user id — never a placeholder. */
  readonly createdBy: string;
}

/** @see CreateCourseInput */
export interface UpdateCourseInput {
  readonly title?: string;
  readonly description?: string;
  readonly coverImageUrl?: string | null;
  readonly visibility?: Visibility;
  readonly cohortKeys?: readonly string[];
  readonly sequential?: boolean;
  readonly sortOrder?: number;
}

/** @see CreateCourseInput */
export interface CreateModuleInput {
  readonly courseId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly releaseAt?: Date | null;
  readonly sortOrder?: number;
}

/** @see CreateCourseInput */
export interface UpdateModuleInput {
  readonly title?: string;
  readonly description?: string | null;
  /** `null` means "unschedule this module" — a real value, not an omission. */
  readonly releaseAt?: Date | null;
  readonly sortOrder?: number;
}

/** @see CreateCourseInput */
export interface CreateLessonInput {
  readonly moduleId: string;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly sortOrder?: number;
}

/** @see CreateCourseInput */
export interface UpdateLessonInput {
  readonly title?: string;
  readonly bodyMarkdown?: string;
  readonly sortOrder?: number;
}

/**
 * A caller-supplied audit write, enlisted in the mutation's OWN transaction.
 *
 * ⚠️ WHY A HOOK RATHER THAN AN INJECTED `AuditLogService`. PRE-6 requires every
 * admin mutation's audit row to commit or roll back WITH the mutation. The
 * `learning.*` values that row needs (`learning.course.create`, …) do not exist
 * in `AdminAuditAction` yet — `libs/api/audit` is outside this dispatch's
 * territory, and referencing a value that is not in the union would not
 * compile. `libs/api/forum/src/lib/categories/categories.service.ts` made
 * exactly this call one phase earlier and Task 6.13 supplied the other half.
 *
 * A hook keeps atomicity AVAILABLE without this dispatch guessing the action
 * names: 9C passes `(tx, id) => this.audit.write({ …, tx })` and the property
 * PRE-6 asks for holds. The alternative — 9C opening its own transaction around
 * this one — is exactly the non-atomic shape PRE-6 exists to forbid.
 *
 * `targetId` is `null` for a mutation with no single target row.
 */
export type AuditHook = (
  tx: Prisma.TransactionClient,
  targetId: string | null,
) => Promise<void>;
