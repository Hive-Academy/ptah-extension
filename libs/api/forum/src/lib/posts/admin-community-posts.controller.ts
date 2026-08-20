import {
  Controller,
  Delete,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuditLogService } from '@ptah-api/audit';
import {
  AdminGuard,
  AdminThrottlerGuard,
  JwtAuthGuard,
} from '@ptah-api/identity';

import {
  adminActor,
  moderationAuditHook,
  requireAdminUserId,
} from '../common/admin-audit';

import { PostsService } from './posts.service';

const ADMIN_WRITES = { default: { limit: 20, ttl: 60_000 } } as const;

/**
 * `AdminCommunityPostsController` — post removal and restore (§3.3 admin table,
 * R8.2, R8.5).
 *
 * ── THE THIRD OF THREE DISJOINT DEPTH-4 PREFIXES (RISK-J) ──────────────────
 * `v1/admin/community/posts`, a literal sibling of `…/categories` and
 * `…/topics`. Nothing sits at bare `v1/admin/community`, which is the shape RI-1
 * rejects and which the plan's §2.5 split would have produced.
 *
 * ── WHY IT HAS NO `GET` ────────────────────────────────────────────────────
 * §3.3's admin table gives posts two operations and no list, and that is right
 * rather than an omission: moderating a post is something an admin does FROM a
 * thread, and the thread is where the post's context lives. A standalone
 * "every post in the forum" list would be a second, unpaged read of the largest
 * table in the schema serving a screen nobody asked for (RK-1). If a moderation
 * queue is ever wanted, it is a queue of FLAGS — which RK-1 explicitly defers.
 *
 * ── NO MEMBER SURFACE MAY EVER LAND HERE ───────────────────────────────────
 * `@UseGuards(JwtAuthGuard, AdminGuard)` at CLASS level, so a handler added
 * later is guarded by default; `admin-guards.spec.ts` G1 asserts it, and G6's
 * sibling assertion ("every controller in the module is mounted under
 * `v1/admin/`") is what would catch a member route being added to this class by
 * mistake.
 *
 * ── PRE-6 ───────────────────────────────────────────────────────────────────
 * Both mutations pass a `moderationAuditHook` that `PostsService` calls with the
 * transaction it is already inside — the same transaction that also maintains
 * `Topic.postCount` (AD-11). The audit row, the tombstone and the counter
 * commit together or not at all.
 */
@Controller('v1/admin/community/posts')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCommunityPostsController {
  private readonly logger = new Logger(AdminCommunityPostsController.name);

  constructor(
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * `DELETE :id` — tombstone a reply (R1.3.5, R8.2).
   *
   * Post #1 is refused with a `400`: it IS the topic body (AD-9), and
   * tombstoning it would leave a topic that renders nothing while still
   * appearing in the feed with a title and a reply count. The admin route for
   * that is `DELETE v1/admin/community/topics/:id`.
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
      AdminCommunityPostsController.name,
      this.logger,
    );

    const result = await this.posts.softDeleteAsAdmin(
      id,
      actorId,
      new Date(),
      // The hook's `targetId` is the TOPIC id (that is what `PostsService`
      // passes), so `targetType` is `Topic`: an audit row must name a row that
      // can actually be looked up by `targetType` + `targetId`, and claiming
      // `Post` while carrying a topic id would make the log unresolvable. The
      // ACTION is what says a post was removed.
      moderationAuditHook(this.audit, actor, 'Topic', 'community.post.delete'),
    );

    this.logger.log(
      `Admin soft-deleted post: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return result;
  }

  /**
   * `POST :id/restore` — R8.5, the ≥30-day window.
   *
   * ⚠️ IT ALSO RE-INCREMENTS `Topic.postCount`. See `PostsService.restore`: the
   * delete decremented it, and a restore that only cleared `deletedAt` would
   * leave the counter permanently one below the truth with no reconciliation
   * job (RK-1) to ever notice.
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
      AdminCommunityPostsController.name,
      this.logger,
    );

    const result = await this.posts.restore(
      id,
      actorId,
      new Date(),
      moderationAuditHook(this.audit, actor, 'Topic', 'community.post.restore'),
    );

    this.logger.log(
      `Admin restored post: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return result;
  }
}
