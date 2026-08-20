import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';

/**
 * CohortResolver — `MemberGroupAssignment` → the member's cohort keys.
 *
 * Read-only, one query, no writes, and it NEVER derives entitlement. That
 * separation is A-2 and it is structural rather than a convention: entitlement
 * lives in `MembershipService` and comes from `License`/`Subscription`; cohort
 * membership lives here and comes from `MemberGroupAssignment`. Neither can
 * reach the other's tables.
 *
 * ── WHY AN EMPTY RESULT IS NORMAL (R7.8) ───────────────────────────────────
 * A paid member whom an admin has not yet placed in a cohort resolves to `[]`.
 * That is a valid answer, not an error, and it must never throw: cohort keys
 * decide WHICH gated content a member sees, not WHETHER they may enter. A
 * data-entry omission therefore degrades to "missing some content" instead of
 * "denied access", which is the whole reasoning behind A-2.
 *
 * ── AD-10: NOTHING HERE RECONCILES ─────────────────────────────────────────
 * Downstream matching is `hasSome` against a `String[]` column, so both an
 * empty list and a stale key match nobody. The failure direction is restrictive
 * by construction, which is why this resolver does not need to validate the
 * keys it returns against anything.
 *
 * Provided by the `@Global()` MembershipModule.
 */
@Injectable()
export class CohortResolver {
  private readonly logger = new Logger(CohortResolver.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The stable `MemberGroup.key` values this user is assigned to, in assignment
   * order. Empty for an unassigned or unknown user.
   *
   * ── WHY A LOOKUP FAILURE DEGRADES TO `[]` INSTEAD OF THROWING ─────────────
   * Unlike entitlement, failing this lookup is safe in only one direction and
   * that is the direction it fails in: `[]` matches no cohort-gated content, so
   * a member sees LESS, never more. Throwing instead would take a member who is
   * provably entitled and lock them out of the whole panel over a table they do
   * not even need to read `member`-visibility content — turning a partial
   * outage into a total one, which is precisely what R7.8 and A-2 forbid.
   *
   * This mirrors the established `safeMemberGroups` posture in
   * `google-sessions/members.controller.ts:80-93`: best-effort, empty on
   * failure, and LOGGED — the reason is recorded server-side, never swallowed.
   */
  async resolveCohortKeys(userId: string): Promise<readonly string[]> {
    try {
      const rows = await this.prisma.memberGroupAssignment.findMany({
        where: { userId },
        orderBy: { assignedAt: 'asc' },
        include: { group: { select: { key: true } } },
      });
      return rows.map((row) => row.group.key);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to resolve cohort keys for user ${userId}: ${message} — ` +
          `degrading to no cohorts (member keeps member-visibility access)`,
      );
      return [];
    }
  }
}
