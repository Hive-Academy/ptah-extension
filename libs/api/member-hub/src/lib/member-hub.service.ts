import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type {
  ContinueLearning,
  HubNotificationSummary,
  HubSection,
  HubSessionSummary,
  HubTopicSummary,
  MemberHubResponse,
  MemberPack,
} from '@ptah-contracts/community';
import { CohortBadgesService } from './cohort-badges.service';
import { CommunitySection } from './sections/community.section';
import { EMPTY_NOTIFICATIONS } from './sections/hub-section';
import { LearningSection } from './sections/learning.section';
import { NotificationsSection } from './sections/notifications.section';
import { PacksSection } from './sections/packs.section';
import { SessionsSection } from './sections/sessions.section';

/**
 * MemberHubService — THE `Promise.allSettled` COMPOSER (AD-4, R6).
 *
 * One request, five sections, one round of concurrency. `compose(ctx)` reads
 * the entitlement and cohort keys ALREADY on the context (`MemberGuard`
 * resolved them once — R7.3 forbids re-deriving them) and fans out to the
 * section resolvers.
 *
 * ── `Promise.allSettled`, NOT `Promise.all`. THIS IS THE WHOLE OF R6.4 ─────
 * `Promise.all` rejects on the FIRST rejection and discards the four results
 * that succeeded. On this endpoint that means one broken section blanks the
 * entire home screen — the exact outcome R6.4 forbids, and the reason plan
 * AD-4 rejected the single-denormalised-query alternative outright.
 *
 * `allSettled` instead lets every resolver finish, and a rejected one becomes
 * `{ status: 'unavailable', data: <empty shape> }` inside a `200` response. The
 * fault is CONTAINED and REPORTED: the member sees four working cards and one
 * that says it is unavailable, and the reason is logged server-side.
 *
 * ⚠️ This is asserted, not asserted-in-a-comment: `member-hub.service.spec.ts`
 * forces one resolver to reject and requires the other four to come back
 * intact. `Promise.all` cannot pass that test.
 *
 * ── SANITISED FAILURE (NFR-S7) ────────────────────────────────────────────
 * A rejection's `reason` may be a Prisma error naming tables and connection
 * strings, or an upstream HTTP body. It is logged and DROPPED. The client
 * learns only the section's status — the wire contract carries no error field
 * for exactly this reason.
 *
 * ── ADDING A PHASE-N SECTION ──────────────────────────────────────────────
 * One new `*.section.ts`, one constructor parameter, one entry in the
 * `allSettled` tuple and one `unwrap` line. The envelope does not change, the
 * controller does not change, and the client still issues one request (R6.6).
 */
@Injectable()
export class MemberHubService {
  private readonly logger = new Logger(MemberHubService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CohortBadgesService)
    private readonly cohortBadges: CohortBadgesService,
    @Inject(LearningSection) private readonly learning: LearningSection,
    @Inject(CommunitySection) private readonly community: CommunitySection,
    @Inject(SessionsSection) private readonly sessions: SessionsSection,
    @Inject(PacksSection) private readonly packs: PacksSection,
    @Inject(NotificationsSection)
    private readonly notifications: NotificationsSection,
  ) {}

  /**
   * Compose the hub for an already-entitled caller.
   *
   * The `member` block and the five sections are resolved in ONE concurrent
   * round. Per AD-4 the section budget is seven DB round-trips issued in
   * parallel, none of them N+1; Phase 1 issues far fewer because four sections
   * are constant and answer without touching the database.
   */
  async compose(ctx: MemberContext): Promise<MemberHubResponse> {
    const [member, learning, community, sessions, packs, notifications] =
      await Promise.allSettled([
        this.resolveMember(ctx),
        this.learning.resolve(ctx),
        this.community.resolve(ctx),
        this.sessions.resolve(ctx),
        this.packs.resolve(ctx),
        this.notifications.resolve(ctx),
      ]);

    return {
      // ⚠️ The `member` block is INSIDE the same allSettled round but is NOT a
      // section — it has no status of its own. `resolveMember` already degrades
      // internally, so this fallback is the belt to that braces: the greeting
      // block can never be the reason a hub fails to render.
      member:
        member.status === 'fulfilled'
          ? member.value
          : this.degradedMember(member.reason),
      sections: {
        learning: this.unwrap<ContinueLearning | null>(
          'learning',
          learning,
          null,
        ),
        community: this.unwrap<HubTopicSummary[]>('community', community, []),
        sessions: this.unwrap<HubSessionSummary | null>(
          'sessions',
          sessions,
          null,
        ),
        packs: this.unwrap<MemberPack[]>('packs', packs, []),
        notifications: this.unwrap<HubNotificationSummary>(
          'notifications',
          notifications,
          { ...EMPTY_NOTIFICATIONS },
        ),
      },
    };
  }

  /**
   * A settled section → the section that ships.
   *
   * Fulfilled: passed through exactly as the resolver built it, including its
   * own `'empty'` / `'unavailable'` judgement.
   *
   * Rejected: `{ status: 'unavailable', data: empty }`. `empty` is the SECTION'S
   * empty shape — `[]` for array sections, `null` for the two nullable ones —
   * because the contract requires `data` to be renderable in every status so
   * one client code path handles all three (R6.3).
   */
  private unwrap<T>(
    section: string,
    result: PromiseSettledResult<HubSection<T>>,
    empty: T,
  ): HubSection<T> {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    const message =
      result.reason instanceof Error ? result.reason.message : 'Unknown error';
    this.logger.error(
      `Hub section "${section}" failed and was degraded to unavailable: ${message}`,
    );
    return { status: 'unavailable', data: empty };
  }

  /**
   * The greeting block: the member's first name plus their cohort badges.
   *
   * `firstName` is nullable in the schema and nullable on the wire — a member
   * who never supplied one gets a generic greeting rather than "Welcome back,
   * null". A missing user row yields `null` too: `MemberGuard` has already
   * proven this caller is entitled, so a read that cannot find them is a
   * consistency problem to log, never a reason to deny a paid member their
   * home screen.
   *
   * Cohorts come from `ctx.cohortKeys` — named, never re-derived (see
   * {@link CohortBadgesService}). `[]` is the live default and is not an error.
   */
  private async resolveMember(
    ctx: MemberContext,
  ): Promise<MemberHubResponse['member']> {
    const [firstName, cohorts] = await Promise.all([
      this.safeFirstName(ctx.userId),
      this.cohortBadges.resolveBadges(ctx.cohortKeys),
    ]);
    return { firstName, cohorts };
  }

  private async safeFirstName(userId: string): Promise<string | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true },
      });
      if (!user) {
        this.logger.warn(
          `Hub composed for user ${userId} who has no users row — ` +
            `greeting falls back to no first name`,
        );
        return null;
      }
      return user.firstName;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to read the first name for user ${userId}: ${message} — ` +
          `greeting falls back to no first name`,
      );
      return null;
    }
  }

  private degradedMember(reason: unknown): MemberHubResponse['member'] {
    const message = reason instanceof Error ? reason.message : 'Unknown error';
    this.logger.error(`Hub member block failed and was degraded: ${message}`);
    return { firstName: null, cohorts: [] };
  }
}
