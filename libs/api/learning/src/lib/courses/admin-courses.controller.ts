import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuditLogService } from '@ptah-api/audit';
import { dtoPipe } from '@ptah-api/core';
import {
  AdminGuard,
  AdminThrottlerGuard,
  JwtAuthGuard,
} from '@ptah-api/identity';
import type {
  AdminCourse,
  AdminCourseOutline,
} from '@ptah-contracts/community';

import {
  adminActor,
  auditHook,
  requireAdminUserId,
} from '../common/admin-audit';

import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { SetPublishedDto } from './dto/publish.dto';
import { ReorderCoursesDto } from './dto/reorder.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { ReorderService, type ReorderResult } from './reorder.service';

const ADMIN_WRITES = { default: { limit: 20, ttl: 60_000 } } as const;

/**
 * `AdminCoursesController` — the §3.4 course authoring surface (R2.1, R8.1,
 * R8.5, R8.8).
 *
 * ── 🔴 ONE OF THREE DISJOINT LITERAL DEPTH-3 ADMIN PREFIXES (RISK-N) ────────
 * `v1/admin/{courses,course-modules,lessons}`. **`v1/admin/course-modules` is
 * NOT a typo for `v1/admin/courses/modules` and must never be "simplified" into
 * one.** The nested form would be a strict path-prefix of THIS controller's
 * prefix, which RI-1 rejects — the exact shape (RISK-J) that broke the plan's
 * admin layout in Batch 6 and forced the forum's moderation surface into three
 * controllers. RI-1 compares SEGMENT-WISE proper path prefixes, so
 * `['v1','admin','courses']` is not a prefix of
 * `['v1','admin','course-modules']` even though one is a *string* prefix of the
 * other: segment 3 differs, and that is the whole reason the sibling form is
 * legal. `PREFIX_EXCEPTIONS` holds one pre-existing entry and
 * `KNOWN_PREFIX_DEBT` is `[]`; **that state is the invariant — if a prefix here
 * fails RI-1, the prefix is wrong.**
 *
 * ── 🔴 RI-3: `PATCH reorder` IS DECLARED BEFORE `PATCH :id` ─────────────────
 * Both are `PATCH` on `v1/admin/courses/<one segment>` and they GENUINELY
 * UNIFY. Reversed, Nest matches `:id === 'reorder'` and the bulk reorder
 * silently becomes "update the course called reorder" — a `404` at best and a
 * write to the wrong row at worst. The controller spec asserts both the ordering
 * AND that the two paths unify, because the ordering assertion is decoration
 * without the second half.
 *
 * ── PRE-1 ──────────────────────────────────────────────────────────────────
 * Every `@Body()` binds `dtoPipe(TheDto)`. There is no `@Query()` here — the
 * admin course list is unpaged and takes no filters, so nothing on this
 * controller can move `NAMED_PRIMITIVE_PARAM_COUNT` (exact equality at 6).
 *
 * ── 🔴 PRE-6: THE AUDIT ROW RIDES THE MUTATION'S OWN TRANSACTION ────────────
 * Each mutation passes an `auditHook`, which `CoursesService` / `ReorderService`
 * call with the mutation's own `tx` from INSIDE its `$transaction`. That matters
 * more here than it did in the forum: `Course` has **no `deletedBy` column**
 * (plan §1.4; Batch 9B's F-1), so `learning.course.delete` is the ONLY record of
 * who removed a course. A row written after the commit is a row that can be
 * missing for exactly the deletion somebody asks about, and there is no column
 * to fall back on.
 *
 * ── R8.5: RESTORE, AND THE READ IT DOES NOT HAVE ───────────────────────────
 * `POST :id/restore` honours the ≥30-day window, applied INSIDE the `UPDATE`'s
 * own `WHERE` so `updateMany().count` *is* the outcome and no tombstone is ever
 * read on a write path (forum's D-6.13d idiom). That is what keeps
 * `EXPECTED_EXEMPTIONS` at `[]` in this lib.
 *
 * ⚠️ AND IT LEAVES A REAL GAP, RECORDED RATHER THAN PAPERED OVER (Batch 9B's
 * F-3): plan §3.4 gives courses a restore route and NO `?includeDeleted` read,
 * so an admin has no API path to DISCOVER a restorable course — they must
 * already hold its id, from a screen that by construction never showed it.
 * Adding `GET ?includeDeleted` is a design event, not a patch: it would be this
 * lib's first AD-5 exemption, and it needs two entries rather than one (a paged
 * read is a page AND a total under the same `where` — Batch 6C's C-1). Read
 * `soft-delete-filter.spec.ts`'s census docblock before doing it.
 */
@Controller('v1/admin/courses')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCoursesController {
  private readonly logger = new Logger(AdminCoursesController.name);

  constructor(
    @Inject(CoursesService) private readonly courses: CoursesService,
    @Inject(ReorderService) private readonly reorderService: ReorderService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * `GET` — every LIVE course, with module and lesson counts.
   *
   * ⚠️ TOMBSTONES ARE EXCLUDED AND NO AD-5 EXEMPTION IS TAKEN. §3.4's admin
   * table has no `?includeDeleted` parameter for courses; see the class
   * docblock for the consequence and for what adding one would cost.
   *
   * ⚠️ THE COUNTS ARE DERIVED FROM ROWS, NOT FROM `_count`. Prisma's `_count`
   * counts soft-deleted rows and no call-expression scan sees it, so a deleted
   * module would inflate the number an admin uses to decide whether a course is
   * ready to publish.
   */
  @Get()
  async list(): Promise<AdminCourse[]> {
    return this.courses.listForAdmin();
  }

  /**
   * `POST` — create a course. `201`.
   *
   * ⚠️ IT IS CREATED AS A DRAFT WHATEVER THE CALLER SENDS (plan §1.4's
   * `@default(false)`), and `CreateCourseDto` has no `published` field, so
   * `forbidNonWhitelisted` turns an attempt to set one into a `400`. Publishing
   * is `PUT :id/published`, with its own audit action — creating something
   * member-visible in the same request that creates it removes the step where an
   * admin checks their work.
   *
   * ⚠️ THE RESPONSE IS THE ADMIN PROJECTION, BUILT BY THE SAME MAPPER AS THE
   * LIST (B6C's D-6.12d). `CoursesService.createCourse` returns
   * `toAdminCourse(...)`, so a freshly created course is byte-identical to a
   * re-fetched one — and **the slug in it is the one the SERVICE allocated**,
   * which may carry a `-2` suffix if it resolved a collision. Re-deriving a slug
   * in the controller is exactly how a stable-URL guarantee breaks.
   */
  @Post()
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async create(
    @Req() req: Request,
    @Body(dtoPipe(CreateCourseDto)) dto: CreateCourseDto,
  ): Promise<AdminCourse> {
    const actor = adminActor(req);
    const createdBy = requireAdminUserId(
      req,
      AdminCoursesController.name,
      this.logger,
    );

    const created = await this.courses.createCourse(
      {
        title: dto.title,
        description: dto.description,
        coverImageUrl: dto.coverImageUrl,
        visibility: dto.visibility,
        cohortKeys: dto.cohortKeys,
        sequential: dto.sequential,
        sortOrder: dto.sortOrder,
        createdBy,
      },
      auditHook(this.audit, actor, 'learning.course.create', 'Course', {
        title: dto.title,
        visibility: dto.visibility,
      }),
    );

    this.logger.log(
      `Admin created course: actor=${actor.email ?? 'unknown'} id=${created.id} slug=${created.slug}`,
    );
    return created;
  }

  /**
   * 🔴 `PATCH reorder` — R8.8. **DECLARED BEFORE `PATCH :id`, AND THE ORDER IS
   * THE CONTRACT.** See the class docblock.
   *
   * ⚠️ THE SUBMITTED `ids` MUST BE EXACTLY THE CURRENT LIVE SIBLING SET, checked
   * INSIDE the transaction. A partial list, a duplicate and a foreign id are all
   * `400` with no writes — and the refusal reports a COUNT, never which ids were
   * real, because echoing that turns a reorder into an existence probe.
   *
   * ⚠️ ONE AUDIT ROW WITH NO `targetId`. A reorder has no single target; the
   * hook passes `null`, which `AuditLogService.write` turns into `undefined` so
   * Postgres applies the column default rather than storing a literal null.
   */
  @Patch('reorder')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async reorder(
    @Req() req: Request,
    @Body(dtoPipe(ReorderCoursesDto)) dto: ReorderCoursesDto,
  ): Promise<ReorderResult> {
    const actor = adminActor(req);
    const result = await this.reorderService.reorderCourses(
      dto.ids,
      auditHook(this.audit, actor, 'learning.course.reorder', 'Course', {
        count: dto.ids.length,
      }),
    );

    this.logger.log(
      `Admin reordered courses: actor=${actor.email ?? 'unknown'} count=${result.reordered}`,
    );
    return result;
  }

  /** `GET :id` — one live course in its admin shape. `404` for a tombstone. */
  @Get(':id')
  async get(@Param('id') id: string): Promise<AdminCourse> {
    return this.courses.getForAdmin(id);
  }

  // Two path segments after the prefix: cannot unify with GET root or PATCH :id.
  @Get(':id/modules')
  async getModules(@Param('id') id: string): Promise<AdminCourseOutline> {
    return this.courses.getOutlineForAdmin(id);
  }

  /**
   * `PATCH :id` — patch a course. Only supplied keys are written.
   *
   * ⚠️ NO `slug` AND NO `published` ON THE DTO. The slug is the public URL and
   * there is no redirect table; `published` has its own endpoint and its own
   * audit action.
   *
   * ⚠️ `coverImageUrl: null` GENUINELY CLEARS IT — one of this lib's three
   * `EXPECTED_NULLABLE_OPTIONALS` census entries. See `UpdateCourseDto`.
   */
  @Patch(':id')
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(UpdateCourseDto)) dto: UpdateCourseDto,
  ): Promise<AdminCourse> {
    const actor = adminActor(req);
    const updated = await this.courses.updateCourse(
      id,
      dto,
      auditHook(this.audit, actor, 'learning.course.update', 'Course', {
        changed: Object.keys(dto),
      }),
    );

    this.logger.log(
      `Admin updated course: actor=${actor.email ?? 'unknown'} id=${id} changed=[${Object.keys(dto).join(',')}]`,
    );
    return updated;
  }

  /**
   * `DELETE :id` — soft delete (AD-5).
   *
   * ⚠️ THE TOMBSTONE DOES NOT CASCADE DOWN THE TREE, and that is a decision.
   * Every member read composes the course's visibility through `module.course`,
   * so one write takes the whole subtree out of every member response; cascading
   * downward would be N writes for the same effect and would make a later
   * restore ambiguous ("was this lesson deleted with the course, or before it?").
   *
   * ⚠️ `Course` HAS NO `deletedBy` COLUMN (Batch 9B's F-1), so the audit row
   * written in this same transaction is the only record of the actor — which is
   * why `requireAdminUserId` refuses rather than substituting a placeholder.
   * Recommendation for migration 4: add `deletedBy String? @map("deleted_by")`
   * to `Course`, `CourseModule` and `Lesson`. Do NOT add it here; no schema
   * change is in this dispatch's scope.
   */
  @Delete(':id')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ deleted: boolean }> {
    const actor = adminActor(req);
    const actorId = requireAdminUserId(
      req,
      AdminCoursesController.name,
      this.logger,
    );

    const result = await this.courses.deleteCourse(
      id,
      actorId,
      auditHook(this.audit, actor, 'learning.course.delete', 'Course'),
    );

    this.logger.log(
      `Admin soft-deleted course: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return result;
  }

  /**
   * `POST :id/restore` — R8.5, the ≥30-day window.
   *
   * Declared after `DELETE :id`, which is readability only: the two carry
   * different verbs and different segment counts, so neither RI-3 nor RI-2 has
   * anything to arbitrate.
   */
  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async restore(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ restored: boolean }> {
    const actor = adminActor(req);
    const result = await this.courses.restoreCourse(
      id,
      new Date(),
      auditHook(this.audit, actor, 'learning.course.restore', 'Course'),
    );

    this.logger.log(
      `Admin restored course: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return result;
  }

  /**
   * `PUT :id/published` — R2.1.2.
   *
   * ⚠️ `PUT` AND A BOOLEAN, NOT TWO VERBS. The request expresses a desired end
   * state, so a retry converges. One audit action for both directions, with the
   * direction in `metadata.published` — see `SetPublishedDto`.
   */
  @Put(':id/published')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async setPublished(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(SetPublishedDto)) dto: SetPublishedDto,
  ): Promise<AdminCourse> {
    const actor = adminActor(req);
    const updated = await this.courses.setPublished(
      id,
      dto.published,
      auditHook(this.audit, actor, 'learning.course.publish', 'Course', {
        published: dto.published,
      }),
    );

    this.logger.log(
      `Admin set course published=${dto.published}: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return updated;
  }
}
