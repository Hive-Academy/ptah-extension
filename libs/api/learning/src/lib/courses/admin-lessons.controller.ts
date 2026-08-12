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
import type { AdminLesson } from '@ptah-contracts/community';

import {
  adminActor,
  auditHook,
  requireAdminUserId,
} from '../common/admin-audit';
import {
  LessonVideoService,
  type RefreshMetadataResult,
} from '../lessons/lesson-video.service';
import type { LessonVideoColumns } from '../lessons/lesson-video.types';

import { CoursesService } from './courses.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { RefreshMetadataDto } from './dto/refresh-metadata.dto';
import { ReorderLessonsDto } from './dto/reorder.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { ReorderService, type ReorderResult } from './reorder.service';

const ADMIN_WRITES = { default: { limit: 20, ttl: 60_000 } } as const;

/**
 * `AdminLessonsController` — the §3.4 lesson authoring surface (R2.1, R2.2,
 * R2.2.4 – R2.2.6, R8.1, R8.8, ASSUMPTION-6, ASSUMPTION-9).
 *
 * ── ONE OF THREE DISJOINT LITERAL DEPTH-3 ADMIN PREFIXES (RISK-N) ──────────
 * `v1/admin/{courses,course-modules,lessons}`. Segment 3 differs on all three,
 * so none is a segment-wise path-prefix of another and RI-1 passes with
 * `PREFIX_EXCEPTIONS` and `KNOWN_PREFIX_DEBT` untouched.
 *
 * ── 🔴 RI-3, AND THE ONE PAIR THAT ONLY *LOOKS* LIKE IT NEEDS IT ───────────
 * `PATCH reorder` is declared BEFORE `PATCH :id`, and the two genuinely unify —
 * reversed, Nest matches `:id === 'reorder'`.
 *
 * `POST refresh-metadata` (bulk) and `POST :id/refresh-metadata` (single) have
 * DIFFERENT SEGMENT COUNTS and therefore do **not** unify; RI-3 has nothing to
 * arbitrate between them. The bulk form is still declared first, because the
 * ordering costs nothing and the habit is what survives the next contributor
 * adding a route that does unify. The controller spec asserts both facts — that
 * the reorder pair unifies and that the refresh pair does not — so neither
 * assertion is decoration.
 *
 * ── 🔴 THE VIDEO PATH: FETCH FIRST, THEN ONE TRANSACTION (R2.2.4) ──────────
 * `POST` and `PATCH :id` both resolve the video columns BEFORE opening a
 * transaction, via `LessonVideoService.resolveVideoColumns`, and hand the
 * resolved block to `CoursesService`, which writes the lesson and all five
 * columns in ONE `create` / `update`. Two properties fall out of that ordering
 * and both matter:
 *
 *   1. **A fully-configured lesson or nothing.** The five video columns move
 *      together; a failed fetch (§4.4: `422` for not-found / private /
 *      not-embeddable, `502` for unavailable) means no transaction was opened
 *      at all and nothing was written.
 *   2. **No Postgres connection is held across a network call.** The fetch has a
 *      10-second abort budget. Running it inside `$transaction` would hold a
 *      pooled connection for that long per save, which is how a slow upstream
 *      becomes pool exhaustion. "Inside the same transaction boundary" in the
 *      requirement is about ATOMICITY OF THE WRITE, and that is what the single
 *      statement gives it.
 *
 * ── ⚠️ IN THIS WORKSPACE THE INTEGRATION IS OFF, AND THAT IS THE DEFAULT STATE
 *    (ASSUMPTION-6) ──────────────────────────────────────────────────────────
 * `YOUTUBE_API_KEY` is present and EMPTY in `.env`, so `isEnabled()` is `false`
 * and R2.2.6's feature-off branch is the live path here: a save proceeds,
 * storing whatever `videoTitle` / `videoDurationSeconds` the admin typed, with
 * `videoMetadataSource: 'manual'` and `videoMetadataFetchedAt: null`. **Nothing
 * `500`s** — that is exit-gate clause 3, and it is nearly free precisely because
 * it is the default state rather than a configuration that had to be arranged.
 *
 * ⚠️ THE VIDEO ID IS STILL EXTRACTED AND VALIDATED IN THAT BRANCH. A disabled
 * integration must not become a hole through which an unvalidated string reaches
 * the column the frontend builds a `youtube-nocookie` embed URL from (§4.6.3);
 * "the API key was unset that week" is not a defence.
 *
 * ── PRE-1 / PRE-6 ─────────────────────────────────────────────────────────
 * Every `@Body()` binds `dtoPipe(TheDto)`; no `@Query()` anywhere, so nothing
 * here moves `NAMED_PRIMITIVE_PARAM_COUNT` (exact equality at 6). Every mutation
 * passes an `auditHook` called with the mutation's own `tx`, and `Lesson` has no
 * `deletedBy` column (Batch 9B's F-1), so `learning.lesson.delete` is the only
 * record of who removed one.
 */
@Controller('v1/admin/lessons')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminLessonsController {
  private readonly logger = new Logger(AdminLessonsController.name);

  constructor(
    @Inject(CoursesService) private readonly courses: CoursesService,
    @Inject(ReorderService) private readonly reorderService: ReorderService,
    @Inject(LessonVideoService) private readonly video: LessonVideoService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * `POST` — create a lesson, with its video resolved first. `201`.
   *
   * ⚠️ `resolveVideoColumns` TOUCHES NO DATABASE. It extracts and validates the
   * id, fetches when the integration is on, and maps §4.4's outcome table to an
   * HTTP error — all before `createLesson` opens its transaction. A malformed id
   * is `400 { reason: 'youtube_video_id_invalid' }` before any fetch.
   */
  @Post()
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async create(
    @Req() req: Request,
    @Body(dtoPipe(CreateLessonDto)) dto: CreateLessonDto,
  ): Promise<AdminLesson> {
    const actor = adminActor(req);

    // 🔴 BEFORE THE TRANSACTION. See the class docblock.
    const video = await this.video.resolveVideoColumns({
      youtubeVideoIdOrUrl: dto.youtubeVideoIdOrUrl,
      videoTitle: dto.videoTitle,
      videoDurationSeconds: dto.videoDurationSeconds,
    });

    const created = await this.courses.createLesson(
      {
        moduleId: dto.moduleId,
        title: dto.title,
        bodyMarkdown: dto.bodyMarkdown,
        sortOrder: dto.sortOrder,
      },
      video,
      auditHook(this.audit, actor, 'learning.lesson.create', 'Lesson', {
        moduleId: dto.moduleId,
        title: dto.title,
        videoMetadataSource: video.videoMetadataSource,
      }),
    );

    this.logger.log(
      `Admin created lesson: actor=${actor.email ?? 'unknown'} id=${created.id} ` +
        `moduleId=${dto.moduleId} videoSource=${video.videoMetadataSource ?? 'none'}`,
    );
    return created;
  }

  /** 🔴 `PATCH reorder` — R8.8. **DECLARED BEFORE `PATCH :id`.** */
  @Patch('reorder')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async reorder(
    @Req() req: Request,
    @Body(dtoPipe(ReorderLessonsDto)) dto: ReorderLessonsDto,
  ): Promise<ReorderResult> {
    const actor = adminActor(req);
    const result = await this.reorderService.reorderLessons(
      dto.moduleId,
      dto.ids,
      auditHook(this.audit, actor, 'learning.lesson.reorder', 'Lesson', {
        moduleId: dto.moduleId,
        count: dto.ids.length,
      }),
    );

    this.logger.log(
      `Admin reordered lessons: actor=${actor.email ?? 'unknown'} moduleId=${dto.moduleId} count=${result.reordered}`,
    );
    return result;
  }

  /**
   * `POST refresh-metadata` — the BULK form (R2.2.5, ASSUMPTION-9). Declared
   * before `POST :id/refresh-metadata`; see the class docblock for why the two
   * do not unify and why the order is kept anyway.
   *
   * ⚠️ PER-LESSON ATOMIC AND BATCH-TOLERANT. One dead video id does not roll
   * back the lessons that refreshed; the response is
   * `{ refreshed, skipped, failed: [{ lessonId, reason }] }` and each `reason`
   * is a machine value from a fixed vocabulary, never upstream text (NFR-S7).
   * A lesson with no video is SKIPPED, not failed — an admin selecting a whole
   * module includes text-only lessons, and reporting those as errors buries the
   * ones that matter.
   *
   * 🔴 WITH THE INTEGRATION OFF IT WRITES NOTHING AT ALL, returning §4.1's exact
   * shape with `reason: 'youtube_disabled'`. That short-circuit is the whole
   * safety of this endpoint in THIS workspace (ASSUMPTION-6 — it is the only
   * path this route can currently take): without it, the natural implementation
   * would run every lesson through the feature-off branch and rewrite each one to
   * `videoMetadataSource: 'manual'` with a null title, duration and thumbnail —
   * destroying every previously-fetched value in the batch, with a `200` on it.
   */
  @Post('refresh-metadata')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async refreshMetadataBulk(
    @Req() req: Request,
    @Body(dtoPipe(RefreshMetadataDto)) dto: RefreshMetadataDto,
  ): Promise<RefreshMetadataResult> {
    const actor = adminActor(req);
    const result = await this.video.refreshMetadata(
      dto.lessonIds,
      auditHook(
        this.audit,
        actor,
        'learning.lesson.refresh_metadata',
        'Lesson',
        { requested: dto.lessonIds.length },
      ),
    );

    this.logger.log(
      `Admin refreshed lesson metadata: actor=${actor.email ?? 'unknown'} ` +
        `requested=${dto.lessonIds.length} refreshed=${result.refreshed} ` +
        `skipped=${result.skipped} failed=${result.failed.length}` +
        (result.reason === undefined ? '' : ` reason=${result.reason}`),
    );
    return result;
  }

  /**
   * `PATCH :id` — patch a lesson's text fields and, optionally, its video.
   *
   * 🔴 THE TWO HALVES LAND IN **ONE** TRANSACTION. The video columns are
   * resolved first (no database), then handed to `CoursesService.updateLesson`
   * as a complete block, which writes them alongside the text in a single
   * `update`. Calling `LessonVideoService.resolveAndPersist` separately would
   * have been two transactions and a window in which the title landed and the
   * video did not — which is exactly what R2.2.4 forbids.
   *
   * ⚠️ THE VIDEO IS TOUCHED ONLY IF THE REQUEST MENTIONED IT. `undefined` for
   * all three video fields means "leave all five columns alone";
   * `youtubeVideoIdOrUrl: ""` DETACHES the video, clearing all five. See
   * `UpdateLessonDto` for why that tri-state needs no `null` and therefore no
   * census entry.
   */
  @Patch(':id')
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(UpdateLessonDto)) dto: UpdateLessonDto,
  ): Promise<AdminLesson> {
    const actor = adminActor(req);

    const mentionsVideo =
      dto.youtubeVideoIdOrUrl !== undefined ||
      dto.videoTitle !== undefined ||
      dto.videoDurationSeconds !== undefined;

    // 🔴 BEFORE THE TRANSACTION, and only when the request asked for it.
    const video: LessonVideoColumns | undefined = mentionsVideo
      ? await this.video.resolveVideoColumns({
          youtubeVideoIdOrUrl: dto.youtubeVideoIdOrUrl,
          videoTitle: dto.videoTitle,
          videoDurationSeconds: dto.videoDurationSeconds,
        })
      : undefined;

    const updated = await this.courses.updateLesson(
      id,
      {
        title: dto.title,
        bodyMarkdown: dto.bodyMarkdown,
        sortOrder: dto.sortOrder,
        video,
      },
      auditHook(this.audit, actor, 'learning.lesson.update', 'Lesson', {
        changed: Object.keys(dto),
      }),
    );

    this.logger.log(
      `Admin updated lesson: actor=${actor.email ?? 'unknown'} id=${id} changed=[${Object.keys(dto).join(',')}]`,
    );
    return updated;
  }

  /**
   * `DELETE :id` — soft delete (AD-5).
   *
   * ⚠️ `Lesson` HAS NO `deletedBy` COLUMN (Batch 9B's F-1); the audit row
   * written in this same transaction is the only record of the actor.
   *
   * ⚠️ AND A DELETED LESSON MUST NEVER REACH `ModuleLockService`: it can never
   * be completed, so leaving it in the chain would lock the next module for
   * everybody, forever. Every member read filters it at the nested `where`.
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
      AdminLessonsController.name,
      this.logger,
    );

    const result = await this.courses.deleteLesson(
      id,
      actorId,
      auditHook(this.audit, actor, 'learning.lesson.delete', 'Lesson'),
    );

    this.logger.log(
      `Admin soft-deleted lesson: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return result;
  }

  /**
   * `POST :id/refresh-metadata` — the SINGLE form (R2.2.5).
   *
   * ⚠️ IT IS THE BULK IMPLEMENTATION WITH A ONE-ELEMENT LIST, DELIBERATELY. Two
   * implementations of "re-fetch and persist" would be two places for the
   * feature-off short-circuit, the skip rule and the per-lesson transaction to
   * drift; the response shape is the same for the same reason, so an admin UI
   * renders one outcome type.
   *
   * ⚠️ NO BODY, SO NO DTO. The id is a `@Param`, which is not a payload param
   * and does not touch either census.
   */
  @Post(':id/refresh-metadata')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async refreshMetadataOne(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<RefreshMetadataResult> {
    const actor = adminActor(req);
    const result = await this.video.refreshMetadata(
      [id],
      auditHook(
        this.audit,
        actor,
        'learning.lesson.refresh_metadata',
        'Lesson',
        { requested: 1 },
      ),
    );

    this.logger.log(
      `Admin refreshed lesson metadata: actor=${actor.email ?? 'unknown'} id=${id} ` +
        `refreshed=${result.refreshed} skipped=${result.skipped} failed=${result.failed.length}`,
    );
    return result;
  }
}
