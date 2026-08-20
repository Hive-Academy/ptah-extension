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
import type { AdminTopicSummary, Paged } from '@ptah-contracts/community';

import {
  adminActor,
  moderationAuditHook,
  requireAdminUserId,
} from '../common/admin-audit';

import { AdminTopicsReadService } from './admin-topics-read.service';
import { ListAdminTopicsQueryDto } from './dto/list-admin-topics.query.dto';
import { ModerateTopicDto } from './dto/moderate-topic.dto';
import { TopicsService } from './topics.service';

const ADMIN_WRITES = { default: { limit: 20, ttl: 60_000 } } as const;

/**
 * `AdminCommunityTopicsController` — topic moderation (§3.3 admin table, R8.2,
 * R8.5).
 *
 * ── ONE OF THREE DISJOINT DEPTH-4 PREFIXES (RISK-J) ────────────────────────
 * `v1/admin/community/{categories,topics,posts}`. Nothing sits at bare
 * `v1/admin/community` — the plan's §2.5 shape put THIS controller there, which
 * makes it a strict path-prefix of the categories controller and fails RI-1.
 * `PREFIX_EXCEPTIONS` and `KNOWN_PREFIX_DEBT` are both empty arrays at HEAD and
 * that emptiness IS the invariant.
 *
 * ── THE ADMIN EDIT PATH IS ASSUMPTION-5's STRUCTURAL EXEMPTION ─────────────
 * `PATCH :id` reaches `TopicsService.moderate`, which does NOT consult the
 * 24-hour edit window and takes no `MemberContext` at all. That is how admins
 * are exempted — by routing, behind `AdminGuard`, with an audit row — rather
 * than by an `if (isAdmin)` on the member path. The member path therefore has no
 * escape hatch to get wrong, and no admin edit can happen unaudited.
 *
 * ── PRE-6 ───────────────────────────────────────────────────────────────────
 * Each mutation passes a `moderationAuditHook`, called with the mutation's own
 * `tx` from inside its `$transaction`. A multi-field `PATCH` writes one row per
 * INTENT (pin / lock / move / update) — all in that same transaction.
 *
 * ── R8.5 ────────────────────────────────────────────────────────────────────
 * `POST :id/restore` honours the ≥30-day window. The window is
 * `RESTORE_WINDOW_DAYS` in `common/soft-delete.ts`, applied as part of the
 * `UPDATE`'s `WHERE` — there is no literal `30` in this file and no read of a
 * tombstone on the write path.
 */
@Controller('v1/admin/community/topics')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCommunityTopicsController {
  private readonly logger = new Logger(AdminCommunityTopicsController.name);

  constructor(
    @Inject(TopicsService) private readonly topics: TopicsService,
    @Inject(AdminTopicsReadService)
    private readonly adminTopics: AdminTopicsReadService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * `GET` — the moderation list. `?includeDeleted&categoryId&search&page&pageSize`.
   *
   * ⚠️ `?includeDeleted` IS THE ONE SANCTIONED TOMBSTONE READ IN THIS LIB
   * (AD-5). It lives behind this class-level `AdminGuard`, its two queries carry
   * AD-5 exemption markers in `AdminTopicsReadService`, and both are enumerated
   * in `soft-delete-filter.spec.ts`'s `EXPECTED_EXEMPTIONS` — a list whose whole
   * purpose is that adding to it is a review event rather than a comment
   * somebody typed.
   *
   * (The marker token itself is deliberately NOT spelled out in this prose:
   * `grep -rn` for it is the review tool the census docblock names, and a prose
   * mention pollutes the result. Batch 6B made the same correction in
   * `posts.service.ts`.)
   */
  @Get()
  async list(
    @Query(dtoPipe(ListAdminTopicsQueryDto)) query: ListAdminTopicsQueryDto,
  ): Promise<Paged<AdminTopicSummary>> {
    return this.adminTopics.list(query);
  }

  /** `PATCH :id` — pin / lock / move / edit (R1.2.5, R1.2.6, R8.2). */
  @Patch(':id')
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async moderate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(ModerateTopicDto)) dto: ModerateTopicDto,
  ): Promise<{ id: string; changed: string[] }> {
    const actor = adminActor(req);
    const result = await this.topics.moderate(
      id,
      dto,
      new Date(),
      moderationAuditHook(this.audit, actor, 'Topic', 'community.topic.update'),
    );

    this.logger.log(
      `Admin moderated topic: actor=${actor.email ?? 'unknown'} id=${id} changed=[${result.changed.join(',')}]`,
    );
    return result;
  }

  /** `DELETE :id` — soft, audited, and the acting admin lands in `deletedBy`. */
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
      AdminCommunityTopicsController.name,
      this.logger,
    );

    const result = await this.topics.softDeleteAsAdmin(
      id,
      actorId,
      new Date(),
      moderationAuditHook(this.audit, actor, 'Topic', 'community.topic.delete'),
    );

    this.logger.log(
      `Admin soft-deleted topic: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return result;
  }

  /**
   * `POST :id/restore` — R8.5.
   *
   * Declared after `DELETE :id` but that is readability only: the two carry
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
    const actorId = requireAdminUserId(
      req,
      AdminCommunityTopicsController.name,
      this.logger,
    );

    const result = await this.topics.restore(
      id,
      actorId,
      new Date(),
      moderationAuditHook(
        this.audit,
        actor,
        'Topic',
        'community.topic.restore',
      ),
    );

    this.logger.log(
      `Admin restored topic: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return result;
  }
}
