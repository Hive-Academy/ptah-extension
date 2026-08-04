import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';

/**
 * MembershipService — the single source of truth for "does this user currently
 * hold an active Builders membership?", resolved from the database (never a
 * JWT claim, so a stale token can never grant access).
 *
 * Rule: an active/trialing subscription OR an active, non-expired `builders`
 * license.
 *
 * ── WHY THIS LIVES IN ITS OWN NX PROJECT (RK-4) ────────────────────────────
 * This method was MOVED VERBATIM out of the forum-integration tree that
 * TASK_2026_177 P1b then deleted (`BuildersMembershipService.isBuildersMember`,
 * at the time 21 lines). The query bodies below are byte-for-byte the ones that
 * shipped; the only additions are the error boundary and this docblock.
 *
 * That verbatimness is the point. `isBuildersMember` existed THREE times before
 * this lib — that service, an inline private copy in
 * `google-sessions/members.controller.ts`, and a third inline copy in the SSO
 * controller beside it. When one predicate is written three times, "paid
 * member" drifts, and a drift in an access predicate is a security bug that
 * looks like a refactor. Rewriting the query while consolidating it would make
 * that drift indistinguishable from the consolidation, so it was not rewritten.
 *
 * The other two implementations are now GONE — deleted with their directory in
 * P1b, which is what makes R7.2's unqualified gate (`rg 'isBuildersMember'`
 * finds exactly one implementation) hold. Living in a DIFFERENT Nx project is
 * what makes this definition's survival structural rather than a step someone
 * has to remember.
 *
 * ── THIS GATE IS NOT STAFF-AWARE, AND THE FILE PROVES IT ───────────────────
 * Staff access is a SEPARATE authorized path — it is never an alternative
 * branch of this predicate, because fusing the two would silently hand every
 * platform operator a paid member's entitlement.
 *
 * That separation is asserted on this file's SOURCE TEXT, not merely reviewed:
 * `membership.service.spec.ts` (and G4 in
 * `apps/ptah-license-server/src/admin/admin-guards.spec.ts`, which asserts the
 * same property against this file's predecessor) greps for the operator
 * allowlist env var, the operator guard class and the operator boolean, and
 * fails if any of the three appears here. So this docblock cannot name them
 * either — deliberately. If you came here to add one, that is the invariant
 * telling you no.
 *
 * Provided by the `@Global()` MembershipModule, so it is injectable app-wide.
 */
@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * True when the user currently holds an active Builders membership.
   * Subscription first (active/trialing), then a non-expired active builders
   * license.
   *
   * Throws a sanitized `503` when the lookup itself cannot be performed. It
   * deliberately does NOT degrade to `false`: "the database is unreachable" and
   * "this person has not paid" are different answers, and collapsing the first
   * into the second would tell a paying member they are not a member.
   */
  async isBuildersMember(userId: string): Promise<boolean> {
    try {
      const subscription = await this.prisma.subscription.findFirst({
        where: { userId, status: { in: ['active', 'trialing'] } },
        orderBy: { updatedAt: 'desc' },
      });
      if (subscription) {
        return true;
      }

      const license = await this.prisma.license.findFirst({
        where: { userId, status: 'active', plan: 'builders' },
        orderBy: { createdAt: 'desc' },
      });
      if (!license) {
        return false;
      }
      if (license.expiresAt && license.expiresAt < new Date()) {
        return false;
      }
      return true;
    } catch (error: unknown) {
      throw this.lookupFailed(error, userId);
    }
  }

  /**
   * Translate a persistence failure into a typed Nest exception carrying a
   * FIXED sentence.
   *
   * Prisma's own messages name tables, columns and connection strings. Under
   * NFR-S7 none of that may reach a client, so the raw text is logged
   * server-side and the caller receives a message built from nothing but this
   * constant.
   */
  private lookupFailed(error: unknown, userId: string): Error {
    const message = error instanceof Error ? error.message : 'Unknown error';
    this.logger.error(
      `Builders membership lookup failed for user ${userId}: ${message}`,
    );
    return new ServiceUnavailableException(
      'Membership could not be verified right now. Please try again.',
    );
  }
}
