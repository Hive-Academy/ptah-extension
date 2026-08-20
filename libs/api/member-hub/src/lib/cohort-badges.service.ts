import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';
import type { MemberCohortBadge } from '@ptah-contracts/community';

/**
 * CohortBadgesService — cohort KEYS (the authoritative thing) → cohort BADGES
 * (the thing a screen renders).
 *
 * ── WHY THIS IS NOT `CohortResolver`, AND NOT `MemberGroupsService` ────────
 * `MemberContext.cohortKeys`, produced once per request by `MemberGuard` via
 * `CohortResolver`, is the ONLY authority on WHICH cohorts a member belongs to
 * (R7.3, A-2). Both wire shapes that carry cohorts — `MemberEntitlementResponse`
 * and `MemberHubResponse.member` — need `{ key, name }` pairs, and a name is
 * pure presentation.
 *
 * `MemberGroupsService.getGroupsForUser(userId)` already returns exactly that
 * pair in one query, and using it here would have been the shorter path. It is
 * NOT used, because it re-reads `member_group_assignments` and therefore
 * re-derives cohort MEMBERSHIP — a second answer to a question `MemberContext`
 * has already answered. Two paths to "which cohorts is this member in" is how
 * the two drift, and it is the same mistake `isBuildersMember`-times-three made
 * one layer up. So this service is deliberately incapable of adding or removing
 * a cohort: it takes the keys it is given, and only looks up names.
 *
 * Consequence worth stating: a key with no matching `MemberGroup` row (a
 * renamed or deleted cohort) still appears, named after itself. It is a cohort
 * the member IS in — dropping it here would make the badge list disagree with
 * the visibility filtering that runs off the same keys (AD-10).
 */
@Injectable()
export class CohortBadgesService {
  private readonly logger = new Logger(CohortBadgesService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Name the given cohort keys, preserving their order.
   *
   * ⚠️ ZERO KEYS COSTS ZERO QUERIES, and that is the LIVE DEFAULT, not an edge
   * case: an entitled member with no `MemberGroupAssignment` is normal and must
   * never error (R7.8, A-2). The early return is what keeps the entitlement
   * probe genuinely cheap for the common case.
   *
   * A lookup failure degrades to key-as-name rather than throwing. Same
   * reasoning as `CohortResolver`'s degrade-to-`[]`: this decides how a badge
   * READS, never what a member may see, so failing it hard would turn a cosmetic
   * outage into a locked-out member.
   */
  async resolveBadges(
    cohortKeys: readonly string[],
  ): Promise<MemberCohortBadge[]> {
    if (cohortKeys.length === 0) {
      return [];
    }

    const names = await this.safeNames(cohortKeys);
    return cohortKeys.map((key) => ({ key, name: names.get(key) ?? key }));
  }

  private async safeNames(
    cohortKeys: readonly string[],
  ): Promise<Map<string, string>> {
    try {
      const groups = await this.prisma.memberGroup.findMany({
        where: { key: { in: [...cohortKeys] } },
        select: { key: true, name: true },
      });
      return new Map(groups.map((group) => [group.key, group.name]));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to resolve cohort names for [${cohortKeys.join(', ')}]: ${message} — ` +
          `falling back to the keys as labels`,
      );
      return new Map();
    }
  }
}
