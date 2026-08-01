import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@ptah-api/identity';
import { AdminGuard } from '@ptah-api/identity';
import { AdminCommunityService } from './admin-community.service';
import { ListTopicsQueryDto } from './dto/admin-community.dto';
import { dtoPipe } from '@ptah-api/core';
import type { AdminCommunityTopics, AdminReviewQueue } from './discourse.types';

/**
 * AdminCommunityController — READ-ONLY admin visibility into the Builders
 * Discourse forum (TASK_2026_169).
 *
 * Mounted at `/api/v1/admin/community/*`. Guard chain: `JwtAuthGuard` →
 * `AdminGuard` at CLASS level (never method-only — leak risk L1, asserted by
 * structural test G1).
 *
 * ⚠️ THIS CONTROLLER CONTAINS ONLY `@Get` HANDLERS, AND MUST CONTINUE TO.
 * All Discourse moderation stays in Discourse's own admin panel (Checkpoint-1
 * Decision 1). Every row the UI renders carries an "Open in Discourse" deep
 * link, and the review-queue response carries a link to `{DISCOURSE_URL}/review`
 * — those links are the ONLY path from this surface to any action.
 * Structural test G5 enumerates this controller's handlers and fails the build
 * if any of them is not a GET, so the write surface cannot be quietly reopened.
 *
 * ⚠️ SIBLING FILE, DIFFERENT GATE — READ BOTH TOGETHER.
 * `community.controller.ts` in THIS directory serves
 * `GET /api/v1/community/summary` gated on `BuildersMembershipService.
 * isBuildersMember()`. That gate is NOT modified, NOT weakened, and NOT shared
 * with this controller. Both surfaces read the same Discourse data through the
 * same system-level `Api-Key` (leak risk L2) — that is intended: this is the
 * separate authorized path, `AdminGuard`-gated and read-only, so the blast
 * radius is bounded to disclosure to an already-authorized admin.
 */
@Controller('v1/admin/community')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCommunityController {
  constructor(
    @Inject(AdminCommunityService)
    private readonly community: AdminCommunityService,
  ) {}

  /** Recent forum topics. Degrades to `{ topics: [], enabled: false }`. */
  @Get('topics')
  async topics(
    @Query(dtoPipe(ListTopicsQueryDto)) query: ListTopicsQueryDto,
  ): Promise<AdminCommunityTopics> {
    return this.community.listTopics(query.limit ?? 20);
  }

  /** Pending moderation items + a deep link into Discourse's review panel. */
  @Get('review-queue')
  async reviewQueue(): Promise<AdminReviewQueue> {
    return this.community.getReviewQueue();
  }
}
