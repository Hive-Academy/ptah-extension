import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
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
  AdminCourseModule,
  AdminModuleSchedule,
} from '@ptah-contracts/community';

import {
  adminActor,
  auditHook,
  requireAdminUserId,
} from '../common/admin-audit';

import { CourseScheduleService } from './course-schedule.service';
import { CoursesService } from './courses.service';
import { CreateModuleDto } from './dto/create-module.dto';
import { ReorderModulesDto } from './dto/reorder.dto';
import {
  ApplyModuleScheduleDto,
  PreviewModuleScheduleDto,
} from './dto/schedule-modules.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { ReorderService, type ReorderResult } from './reorder.service';

const ADMIN_WRITES = { default: { limit: 20, ttl: 60_000 } } as const;

/**
 * `AdminCourseModulesController` — the §3.4 module authoring surface (R2.1,
 * R2.4.1, R8.1, R8.8).
 *
 * ── 🔴 THE PREFIX IS `v1/admin/course-modules`, AND THAT IS A ROUTING
 *    REQUIREMENT (RISK-N / RISK-J) ────────────────────────────────────────────
 * **Do not "simplify" it to `v1/admin/courses/modules`.** That form is a strict
 * path-prefix relationship with `AdminCoursesController`'s prefix, which RI-1 in
 * `route-map.spec.ts` rejects — and both ledgers that could excuse it
 * (`PREFIX_EXCEPTIONS`, `KNOWN_PREFIX_DEBT`) are at their current contents
 * deliberately, so there would be nothing to excuse it with. RI-1 compares
 * SEGMENT-WISE proper path prefixes, so `['v1','admin','courses']` is not a
 * prefix of `['v1','admin','course-modules']` — segment 3 differs — which is why
 * this hyphenated sibling is legal even though one prefix is a *string* prefix
 * of the other. This is the exact shape that broke the plan's admin layout in
 * Batch 6, and it does not recur here.
 *
 * ── 🔴 RI-3: `PATCH reorder` BEFORE `PATCH :id` ────────────────────────────
 * Both are `PATCH` on `v1/admin/course-modules/<one segment>` and they genuinely
 * unify; reversed, Nest matches `:id === 'reorder'`. The spec asserts the
 * ordering AND the unification.
 *
 * ⚠️ `POST schedule/preview` IS ALSO DECLARED BEFORE `POST schedule`, AND THAT
 * PAIR DOES **NOT** UNIFY — five literal segments against four, so no concrete
 * request can match both and no new RI-3 obligation is created. The ordering is
 * kept anyway at zero cost, mirroring the
 * `POST v1/admin/lessons/refresh-metadata` precedent
 * (`route-map.spec.ts:333-335`). Neither contests `POST v1/admin/course-modules`
 * for the same segment-count reason, so `KNOWN_CONTESTED` stays empty.
 *
 * ── THERE IS NO `GET` ON THIS CONTROLLER, AND IT IS A DECISION ─────────────
 * §3.4's module row is `POST`, `PATCH/DELETE :id`, `PATCH reorder` — no list and
 * no single read. A module is always authored in the context of its course, and
 * `GET /v1/admin/courses/:id` already carries `moduleCount`; a standalone "every
 * module in the product" read would be a screen nobody asked for (RK-1) and a
 * second projection of the same rows to keep in step. If the admin UI needs the
 * modules of one course, that is a field on the course read, not a new prefix.
 *
 * ── PRE-1 / PRE-6 ─────────────────────────────────────────────────────────
 * Every `@Body()` binds `dtoPipe(TheDto)`; there is no `@Query()`, so nothing
 * here moves `NAMED_PRIMITIVE_PARAM_COUNT` (exact equality at 6). Every mutation
 * passes an `auditHook` that `CoursesService` / `ReorderService` call with the
 * mutation's own `tx` — and `CourseModule` has **no `deletedBy` column** (Batch
 * 9B's F-1), so `learning.module.delete` is the only record of who removed one.
 */
@Controller('v1/admin/course-modules')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCourseModulesController {
  private readonly logger = new Logger(AdminCourseModulesController.name);

  constructor(
    @Inject(CoursesService) private readonly courses: CoursesService,
    @Inject(ReorderService) private readonly reorderService: ReorderService,
    @Inject(CourseScheduleService)
    private readonly scheduleService: CourseScheduleService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * `POST` — create a module under a live course. `201`.
   *
   * ⚠️ A SOFT-DELETED OR MISSING COURSE IS A `404`, decided by a query carrying
   * `NOT_DELETED` rather than by a check here.
   *
   * ⚠️ `releaseAt` ARRIVES AS AN ISO STRING AND IS CONVERTED HERE. The DTO
   * validates the FORMAT (`@IsISO8601`) so an unparseable value is a `400` at
   * the boundary; `new Date(...)` then produces the `Date` the service and the
   * column want. `@Type(() => Date)` was the alternative and is rejected: it
   * turns a bad string into `Invalid Date`, which surfaces as a Prisma error
   * four layers down instead of a `400`.
   */
  @Post()
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async create(
    @Req() req: Request,
    @Body(dtoPipe(CreateModuleDto)) dto: CreateModuleDto,
  ): Promise<AdminCourseModule> {
    const actor = adminActor(req);
    const created = await this.courses.createModule(
      {
        courseId: dto.courseId,
        title: dto.title,
        description: dto.description,
        releaseAt:
          dto.releaseAt === undefined ? undefined : new Date(dto.releaseAt),
        sortOrder: dto.sortOrder,
      },
      auditHook(this.audit, actor, 'learning.module.create', 'CourseModule', {
        courseId: dto.courseId,
        title: dto.title,
      }),
    );

    this.logger.log(
      `Admin created module: actor=${actor.email ?? 'unknown'} id=${created.id} courseId=${dto.courseId}`,
    );
    return created;
  }

  /**
   * `POST schedule/preview` — C4's REHEARSAL. `200`, writes nothing, audits
   * nothing.
   *
   * 🔴 THE PREVIEW IS THE GUARD, NOT A CONVENIENCE. The failure this action is
   * designed against is *a mis-typed start date silently shifting ten
   * member-visible dates*, and there is no admin course UI in `libs/web/admin` —
   * this is driven by `curl`. The apply refuses to run unless the caller echoes
   * back `confirmModuleCount` and `confirmLastReleaseDate`, and those two values
   * cannot be produced without having read this response (or having done the
   * weekday arithmetic by hand). Apply-directly was rejected, and so was a
   * single route with a `dryRun` flag: a required flag makes the caller type a
   * word, not look at a date, so it defends nothing.
   *
   * ⚠️ `POST`, NOT `GET`, AND THAT IS DELIBERATE. The rehearsal must accept the
   * SAME input shape as the apply. A `GET` forces a second, query-shaped DTO,
   * and the two would drift the first time either changed — at which point the
   * preview would stop describing the apply and the guard would be worthless.
   * A `POST` that writes nothing is the smaller cost.
   *
   * ⚠️ NO AUDIT HOOK IS PASSED. The preview exists to be run repeatedly until
   * the dates look right; a log full of rehearsals is a log nobody reads.
   */
  @Post('schedule/preview')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async previewSchedule(
    @Req() req: Request,
    @Body(dtoPipe(PreviewModuleScheduleDto)) dto: PreviewModuleScheduleDto,
  ): Promise<AdminModuleSchedule> {
    const actor = adminActor(req);
    const schedule = await this.scheduleService.schedule(dto, false);

    this.logger.log(
      `Admin previewed cohort schedule: actor=${actor.email ?? 'unknown'} ` +
        `courseId=${dto.courseId} start=${dto.startDate} tz=${dto.timeZone} ` +
        `changed=${schedule.changedCount}/${schedule.moduleCount}`,
    );
    return schedule;
  }

  /**
   * 🔴 `POST schedule` — C4's APPLY. `200`, one audit row.
   *
   * Sets `releaseAt` on every live module of the course, in day order, on
   * weekday offsets with the weekend skipped — ten dates from one input, and
   * twelve from one input for a twelve-module cohort 2, because the count comes
   * from the rows.
   *
   * ⚠️ IT IS A TOTAL RE-SCHEDULE AND IT OVERWRITES MANUAL DATES. Only the rows
   * whose date actually moves are written, so a second identical apply reports
   * `changedCount: 0` and issues zero updates; and the audit metadata carries
   * `{ slug, from, to }` per changed module, which is the only record of the
   * previous dates. `CourseScheduleService`'s docblock has the full argument.
   *
   * ⚠️ `ApplyModuleScheduleDto` EXTENDS the preview DTO, so this endpoint and
   * `…/preview` are genuinely distinct on the wire: an apply payload sent to the
   * preview is a `400` for two non-whitelisted keys, and a preview payload sent
   * here is a `400` for two missing required keys. Both are spec cases.
   */
  @Post('schedule')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async applySchedule(
    @Req() req: Request,
    @Body(dtoPipe(ApplyModuleScheduleDto)) dto: ApplyModuleScheduleDto,
  ): Promise<AdminModuleSchedule> {
    const actor = adminActor(req);
    const schedule = await this.scheduleService.schedule(dto, true, (tx, changed) =>
      // ⚠️ THE HOOK IS BUILT PER CALL BECAUSE ITS METADATA IS NOT KNOWN UNTIL
      // THE SERVICE HAS COMPUTED THE SCHEDULE. `changed` carries the PREVIOUS
      // dates, per module: `CourseModule` has no column holding a former
      // `releaseAt`, so this list is the only thing that makes a wrong
      // re-schedule recoverable. It is bounded by the course's live module
      // count — the same set the response renders in full — and carries no row
      // dump beyond the three fields (NFR-S7).
      auditHook(this.audit, actor, 'learning.module.schedule', 'CourseModule', {
        courseId: dto.courseId,
        startDate: dto.startDate,
        timeOfDay: dto.timeOfDay,
        timeZone: dto.timeZone,
        changedCount: changed.length,
        changed,
      })(tx, null),
    );

    this.logger.log(
      `Admin applied cohort schedule: actor=${actor.email ?? 'unknown'} ` +
        `courseId=${dto.courseId} start=${dto.startDate} tz=${dto.timeZone} ` +
        `changed=${schedule.changedCount}/${schedule.moduleCount} ` +
        `last=${schedule.lastReleaseDate}`,
    );
    return schedule;
  }

  /**
   * 🔴 `PATCH reorder` — R8.8. **DECLARED BEFORE `PATCH :id`.**
   *
   * ⚠️ `courseId` IS IN THE BODY RATHER THAN INFERRED FROM THE FIRST ID.
   * `ReorderService.reorderModules` says why: inferring it would make a request
   * that mixes two courses' modules look valid for whichever course the first id
   * happened to belong to, and would silently renumber a course the admin was
   * not editing.
   */
  @Patch('reorder')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async reorder(
    @Req() req: Request,
    @Body(dtoPipe(ReorderModulesDto)) dto: ReorderModulesDto,
  ): Promise<ReorderResult> {
    const actor = adminActor(req);
    const result = await this.reorderService.reorderModules(
      dto.courseId,
      dto.ids,
      auditHook(this.audit, actor, 'learning.module.reorder', 'CourseModule', {
        courseId: dto.courseId,
        count: dto.ids.length,
      }),
    );

    this.logger.log(
      `Admin reordered modules: actor=${actor.email ?? 'unknown'} courseId=${dto.courseId} count=${result.reordered}`,
    );
    return result;
  }

  /**
   * `PATCH :id` — patch a module.
   *
   * ⚠️ NO `courseId`. Moving a module between courses would renumber two courses
   * at once, change the sequential chain it sits in (R2.4.2) and change the URL
   * of every lesson under it.
   *
   * 🔴 `description: null` AND `releaseAt: null` ARE REAL VALUES, and they are
   * two of this lib's three `EXPECTED_NULLABLE_OPTIONALS` census entries.
   * `releaseAt: null` means "unschedule this module — open it now" (R2.4.1);
   * omitting the key means "leave the schedule alone". The distinction is the
   * whole reason `UpdateModuleDto` uses `@IsOptional()` on exactly those two
   * fields and `@IsOptionalNotNull()` on the rest.
   */
  @Patch(':id')
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(UpdateModuleDto)) dto: UpdateModuleDto,
  ): Promise<AdminCourseModule> {
    const actor = adminActor(req);
    const updated = await this.courses.updateModule(
      id,
      {
        title: dto.title,
        description: dto.description,
        // `undefined` = leave alone · `null` = unschedule · a string = reschedule.
        // The tri-state survives the conversion, which is the point of doing it
        // explicitly rather than with a transform.
        releaseAt:
          dto.releaseAt === undefined
            ? undefined
            : dto.releaseAt === null
              ? null
              : new Date(dto.releaseAt),
        sortOrder: dto.sortOrder,
      },
      auditHook(this.audit, actor, 'learning.module.update', 'CourseModule', {
        changed: Object.keys(dto),
      }),
    );

    this.logger.log(
      `Admin updated module: actor=${actor.email ?? 'unknown'} id=${id} changed=[${Object.keys(dto).join(',')}]`,
    );
    return updated;
  }

  /**
   * `DELETE :id` — soft delete (AD-5).
   *
   * ⚠️ `CourseModule` HAS NO `deletedBy` COLUMN (Batch 9B's F-1). The audit row
   * written inside this same transaction is the whole answer to "who removed
   * it", which is why `requireAdminUserId` refuses rather than substituting a
   * placeholder.
   *
   * ⚠️ AND A DELETED MODULE MUST NEVER REACH `ModuleLockService`. Its lessons can
   * never be completed, so a tombstoned module left in the lock chain would make
   * the NEXT module permanently locked for everybody — the silent-brick failure
   * the empty-module rule also guards against. Every member read filters it out
   * at the nested `where`, which is what `soft-delete-filter.spec.ts`'s
   * `RULE-NESTED` exists to keep true.
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
      AdminCourseModulesController.name,
      this.logger,
    );

    const result = await this.courses.deleteModule(
      id,
      actorId,
      auditHook(this.audit, actor, 'learning.module.delete', 'CourseModule'),
    );

    this.logger.log(
      `Admin soft-deleted module: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return result;
  }
}
