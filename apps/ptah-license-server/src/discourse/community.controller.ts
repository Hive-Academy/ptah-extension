import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
import { DiscourseAdminProvider } from './discourse-admin.provider';
import { BuildersMembershipService } from './builders-membership.service';
import type { CommunitySummary } from './discourse.types';

/**
 * CommunityController — read-only, server-proxied view of the Builders forum.
 *
 * GET /api/v1/community/summary
 *  - JwtAuthGuard (ptah_auth cookie required — 401 otherwise), mirroring the
 *    other authenticated members routes.
 *  - AUTHORIZATION: gated to active Builders members via a DB-backed check
 *    (BuildersMembershipService). This is load-bearing: the underlying fetch
 *    uses the admin Api-Key (system-level Discourse visibility), so a
 *    non-Builders account must NOT be able to read gated Builders-category
 *    topic titles. A non-Builders caller degrades to an empty summary.
 *  - 200 { communityUrl, topics } where `topics` is the latest ≤5 forum topics
 *    fetched through the license server's admin Discourse key. The browser
 *    NEVER sees that key.
 *
 * Feature-off (DISCOURSE_* unset), a non-Builders caller, or ANY Discourse
 * error → `{ communityUrl: null, topics: [] }`. The provider is fully
 * non-throwing and non-members degrade rather than 403 — this route never 500s
 * and always hands the frontend a stable contract.
 *
 * Throttled at 30/min (below the global 100).
 */
@Controller('v1/community')
export class CommunityController {
  constructor(
    @Inject(DiscourseAdminProvider)
    private readonly discourse: DiscourseAdminProvider,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(BuildersMembershipService)
    private readonly membership: BuildersMembershipService,
  ) {}

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getSummary(@Req() req: Request): Promise<CommunitySummary> {
    const user = req.user as { id: string; email: string };

    // Gate on active Builders membership (DB-backed, not a JWT claim). A
    // non-member degrades to an empty summary rather than a 403 — consistent
    // with this endpoint's never-fail philosophy.
    const isBuilders = await this.membership.isBuildersMember(user.id);
    if (!isBuilders) {
      return { communityUrl: null, topics: [] };
    }

    const topics = await this.discourse.getLatestTopics();
    return { communityUrl: this.communityUrl(), topics };
  }

  /** DISCOURSE_URL (trimmed, no trailing slash) or null when unset. */
  private communityUrl(): string | null {
    const url = this.configService.get<string>('DISCOURSE_URL')?.trim();
    return url ? url.replace(/\/+$/, '') : null;
  }
}
