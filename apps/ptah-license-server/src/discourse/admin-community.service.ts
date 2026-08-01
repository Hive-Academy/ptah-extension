import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscourseAdminProvider } from './discourse-admin.provider';
import type { AdminCommunityTopics, AdminReviewQueue } from './discourse.types';

/**
 * AdminCommunityService — READ-ONLY Discourse visibility for the admin
 * dashboard (TASK_2026_169).
 *
 * ⚠️ THIS SERVICE PERFORMS ZERO WRITES, BY DESIGN.
 * All Discourse moderation (close/reopen, pin/unpin, list/unlist, delete,
 * suspend, approve/reject) stays in Discourse's own admin panel, which the
 * admin already reaches as a full Discourse admin. That panel shows the context
 * a correct moderation decision needs — post body, author history, prior flags,
 * trust level — and has undo. Proxying moderation through a thin license-server
 * shim would duplicate a better tool while stripping that context.
 *
 * What remains is a TRIAGE surface: it answers "is anything happening?" and
 * "does anything need me?", then hands off to Discourse for every action via
 * deep links.
 *
 * ⚠️ SEPARATE AUTHORIZED PATH. `community.controller.ts` in this directory
 * serves `GET /api/v1/community/summary` gated on `BuildersMembershipService.
 * isBuildersMember()`. That gate is NOT modified and NOT shared with this
 * service. Both read the same Discourse data through the same system-level
 * `Api-Key`; the difference is purely who is authorized — an active Builders
 * member there, an `ADMIN_EMAILS` admin here. Never `isBuildersMember || isAdmin`.
 *
 * Degradation contract, inherited from the never-throwing provider:
 * feature-off or any upstream failure yields empty collections and a 200 —
 * never a 500, and never a forwarded upstream body.
 */
@Injectable()
export class AdminCommunityService {
  private readonly logger = new Logger(AdminCommunityService.name);

  constructor(
    @Inject(DiscourseAdminProvider)
    private readonly discourse: DiscourseAdminProvider,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  /** Recent forum topics, each deep-linkable into Discourse by the UI. */
  async listTopics(limit: number): Promise<AdminCommunityTopics> {
    const enabled = this.discourse.isEnabled();
    if (!enabled) {
      this.logger.debug(
        'Discourse is not configured — admin community topics degrade to empty',
      );
      return { communityUrl: null, topics: [], enabled: false };
    }

    const topics = await this.discourse.getLatestTopics(limit);
    return { communityUrl: this.communityUrl(), topics, enabled: true };
  }

  /** Pending review-queue items, plus a deep link to Discourse's review panel. */
  async getReviewQueue(): Promise<AdminReviewQueue> {
    if (!this.discourse.isEnabled()) {
      return { items: [], count: 0, reviewUrl: null };
    }

    const items = await this.discourse.getReviewQueue();
    const base = this.communityUrl();
    return {
      items,
      count: items.length,
      reviewUrl: base ? `${base}/review` : null,
    };
  }

  /** DISCOURSE_URL (trimmed, no trailing slash) or null when unset. */
  private communityUrl(): string | null {
    const url = this.configService.get<string>('DISCOURSE_URL')?.trim();
    return url ? url.replace(/\/+$/, '') : null;
  }
}
