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
  Query,
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
import type { AdminLiveSession } from '@ptah-contracts/community';

import {
  adminActor,
  auditHook,
  requireAdminUserId,
} from './common/admin-audit';
import {
  CreateLiveSessionDto,
  toCreateLiveSessionInput,
} from './dto/create-live-session.dto';
import {
  ListAdminLiveQueryDto,
  resolveAdminLiveQuery,
} from './dto/list-admin-live.query.dto';
import {
  UpdateLiveSessionDto,
  toUpdateLiveSessionInput,
} from './dto/update-live-session.dto';
import {
  LiveSessionsService,
  type RefreshLiveMetadataResult,
} from './live-sessions.service';

const ADMIN_WRITES = { default: { limit: 20, ttl: 60_000 } } as const;

/**
 * `AdminLiveSessionsController` — the §2.10 live-session authoring surface
 * (R3.1, R3.2, R3.4, R8, R8.5).
 *
 * ── 🔴 THE PREFIX IS `v1/admin/live-sessions`, NOT `v1/admin/sessions/live` ─
 * The nested form would be a proper SEGMENT-WISE path prefix of the existing
 * `v1/admin/sessions` (the Google Calendar admin surface), which RI-1 rejects —
 * the exact shape (RISK-J) that forced the forum's moderation surface into
 * three controllers in Batch 6 and made `v1/admin/course-modules` a hyphenated
 * sibling in Batch 9. `PREFIX_EXCEPTIONS` holds one pre-existing entry and
 * `KNOWN_PREFIX_DEBT` is `[]`; **that state is the invariant — if a prefix here
 * fails RI-1, the prefix is wrong.**
 *
 * Every depth-3 `v1/admin/*` literal is disjoint from every other:
 * `{sessions, live-sessions, session-requests, courses, course-modules,
 * lessons, packs, groups, community}`.
 *
 * ── 🔴 RI-3: `POST refresh-metadata` IS NOT DECLARED ─────────────────────────
 * There is no bulk refresh route, so nothing on this controller unifies with
 * anything else: `POST :id/refresh-metadata` has four segments and every other
 * `POST` here has three or four with a different literal tail. The single-target
 * form is deliberate (RK-6) — a batch refresh is the shape that grows into a
 * cron, and the authoring-time fetch exists precisely to have no cron.
 *
 * ── PRE-1 ──────────────────────────────────────────────────────────────────
 * Every `@Body()` and `@Query()` binds `dtoPipe(TheDto)`. The `@Query()` here is
 * a WHOLE-OBJECT DTO because `NAMED_PRIMITIVE_PARAM_COUNT` is an exact-equality
 * assertion at 6 (RISK-I) — `@Query('from') from: string` would fail the build.
 *
 * ── 🔴 PRE-6: THE AUDIT ROW RIDES THE MUTATION'S OWN TRANSACTION ────────────
 * Each mutation passes an `auditHook`, which `LiveSessionsService` calls with
 * the mutation's own `tx` from INSIDE its `$transaction`. `LiveSession` does
 * carry `deletedBy` (ASSUMPTION-14), so a tombstone names its own actor — but
 * the audit row is still what answers "from where, with what user agent, and in
 * what sequence", and it is written in the statement that would be rolled back.
 *
 * ── R8.5: RESTORE, AND THE READ IT DOES NOT HAVE ───────────────────────────
 * `POST :id/restore` honours the ≥30-day window INSIDE the `UPDATE`'s own
 * `WHERE`, which is what keeps this directory's `EXPECTED_EXEMPTIONS` at `[]`.
 * ⚠️ AND IT LEAVES A REAL GAP, RECORDED RATHER THAN PAPERED OVER (the same one
 * Batch 9B raised as its F-3 for courses): there is no `?includeDeleted` read,
 * so an admin has no API path to DISCOVER a restorable session — they must
 * already hold its id. Adding the read is a design event; see
 * `ListAdminLiveQueryDto`'s docblock for what it would cost.
 */
@Controller('v1/admin/live-sessions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminLiveSessionsController {
  private readonly logger = new Logger(AdminLiveSessionsController.name);

  constructor(
    @Inject(LiveSessionsService)
    private readonly sessions: LiveSessionsService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * `GET` — every LIVE session, optionally bounded by a `startsAt` range.
   *
   * ⚠️ TOMBSTONES ARE EXCLUDED AND NO AD-5 EXEMPTION IS TAKEN. See the class
   * docblock for the consequence.
   */
  @Get()
  async list(
    @Query(dtoPipe(ListAdminLiveQueryDto)) query: ListAdminLiveQueryDto,
  ): Promise<AdminLiveSession[]> {
    return this.sessions.listForAdmin(resolveAdminLiveQuery(query));
  }

  /**
   * `POST` — create a session. `201`.
   *
   * ⚠️ `createdBy` COMES FROM THE REQUEST, NEVER FROM THE BODY.
   * `requireAdminUserId` refuses rather than substituting a placeholder, and
   * `CreateLiveSessionDto` has no such field — so `forbidNonWhitelisted` turns
   * an attempt to supply one into a `400`.
   */
  @Post()
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async create(
    @Req() req: Request,
    @Body(dtoPipe(CreateLiveSessionDto)) dto: CreateLiveSessionDto,
  ): Promise<AdminLiveSession> {
    const actor = adminActor(req);
    const createdBy = requireAdminUserId(
      req,
      AdminLiveSessionsController.name,
      this.logger,
    );

    const created = await this.sessions.create(
      toCreateLiveSessionInput(dto, createdBy),
      auditHook(
        this.audit,
        actor,
        'community.live_session.create',
        'LiveSession',
        { title: dto.title, visibility: dto.visibility },
      ),
    );

    this.logger.log(
      `Admin created live session: actor=${actor.email ?? 'unknown'} id=${created.id}`,
    );
    return created;
  }

  /** `GET :id` — one live session in its admin shape. `404` for a tombstone. */
  @Get(':id')
  async get(@Param('id') id: string): Promise<AdminLiveSession> {
    return this.sessions.getForAdmin(id);
  }

  /**
   * `PATCH :id` — patch a session. Only supplied keys are written.
   *
   * ⚠️ THE VIDEO BLOCK MOVES AS A UNIT. Supplying either video id re-resolves
   * all seven columns together, from `{ ...stored, ...supplied }`, so attaching
   * a replay cannot clear the stream id.
   */
  @Patch(':id')
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(UpdateLiveSessionDto)) dto: UpdateLiveSessionDto,
  ): Promise<AdminLiveSession> {
    const actor = adminActor(req);
    const updated = await this.sessions.update(
      id,
      toUpdateLiveSessionInput(dto),
      auditHook(
        this.audit,
        actor,
        'community.live_session.update',
        'LiveSession',
        { changed: Object.keys(dto) },
      ),
    );

    this.logger.log(
      `Admin updated live session: actor=${actor.email ?? 'unknown'} id=${id} ` +
        `changed=[${Object.keys(dto).join(',')}]`,
    );
    return updated;
  }

  /** `DELETE :id` — soft delete (AD-5). Writes `deletedBy` (ASSUMPTION-14). */
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
      AdminLiveSessionsController.name,
      this.logger,
    );

    const result = await this.sessions.remove(
      id,
      actorId,
      auditHook(
        this.audit,
        actor,
        'community.live_session.delete',
        'LiveSession',
      ),
    );

    this.logger.log(
      `Admin soft-deleted live session: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return result;
  }

  /** `POST :id/restore` — R8.5, the ≥30-day window. */
  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async restore(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ restored: boolean }> {
    const actor = adminActor(req);
    const result = await this.sessions.restore(
      id,
      new Date(),
      auditHook(
        this.audit,
        actor,
        'community.live_session.restore',
        'LiveSession',
      ),
    );

    this.logger.log(
      `Admin restored live session: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return result;
  }

  /**
   * `POST :id/refresh-metadata` — R3.2, a MANUAL action (RK-6).
   *
   * ⚠️ NO BODY. The target is the path parameter and the video is resolved from
   * the row, so there is nothing for a DTO to validate — which is why this batch
   * lands nine DTO files rather than the ten `tasks.md` predicts.
   *
   * ⚠️ WITH `YOUTUBE_API_KEY` UNSET IT ANSWERS `200 { refreshed: false, reason }`
   * AND WRITES NOTHING. Rewriting the row to `manual` because the key is unset
   * would destroy previously-fetched metadata — a data-loss path with a `200` on
   * it.
   */
  @Post(':id/refresh-metadata')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async refreshMetadata(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<RefreshLiveMetadataResult> {
    const actor = adminActor(req);
    const result = await this.sessions.refreshMetadata(
      id,
      auditHook(
        this.audit,
        actor,
        'community.live_session.refresh_metadata',
        'LiveSession',
      ),
    );

    this.logger.log(
      `Admin refreshed live session metadata: actor=${actor.email ?? 'unknown'} ` +
        `id=${id} refreshed=${result.refreshed}`,
    );
    return result;
  }
}
