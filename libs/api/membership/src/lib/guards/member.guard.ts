import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
// Type-only: `RequestUser` is the shape `JwtAuthGuard` attaches, and importing
// it is ALSO what loads the `Express.Request.user` global augmentation that
// lives beside it. Without this import `request.user` does not typecheck here.
import type { RequestUser } from '@ptah-api/identity';
import { CohortResolver } from '../cohort-resolver.service';
import { MembershipService } from '../membership.service';
import { MEMBERSHIP_REQUIRED, type MemberContext } from '../membership.types';

/**
 * MemberGuard — the single server-side enforcement point for the `/members`
 * surface (NFR-S8).
 *
 * Runs AFTER `JwtAuthGuard`, which populates `req.user` from the `ptah_auth`
 * cookie. Every member controller declares
 * `@UseGuards(JwtAuthGuard, MemberGuard)` at CLASS level — order matters, this
 * guard has nothing to check without an authenticated caller.
 *
 * ── WHY COHORT RESOLUTION HAPPENS HERE (R7.3) ──────────────────────────────
 * The guard resolves entitlement AND cohort keys once, then attaches a
 * `MemberContext` to the request. Doing it here rather than per-service means
 * no service can re-derive entitlement (and drift from this definition), and no
 * controller can forget to scope its query by cohort — forgetting the guard
 * costs you `req.memberContext` outright, which does not compile away quietly.
 *
 * ── THE 403 SHAPE IS A CONTRACT, NOT A DETAIL ──────────────────────────────
 * Every denial is `403 { reason: 'membership_required' }` — the exact body
 * `isMembershipRequiredError()` in
 * `libs/web/core/src/lib/services/members-api.service.ts` already parses in
 * order to route a logged-in non-member to the upgrade surface instead of an
 * error page. Inventing a second shape here would silently break that routing.
 *
 * ── ADMIN IS NOT A BACK DOOR ───────────────────────────────────────────────
 * `isAdmin` is resolved LAST, strictly after the entitlement decision has been
 * made and enforced by an early `throw`. `isBuildersMember || isAdmin` is
 * therefore not merely forbidden here, it is unreachable — an admin who is not
 * a paying member is denied exactly like any other non-member, and admin
 * surfaces keep their own separate authorized path (`AdminGuard`).
 */
@Injectable()
export class MemberGuard implements CanActivate {
  private readonly logger = new Logger(MemberGuard.name);

  constructor(
    @Inject(MembershipService) private readonly membership: MembershipService,
    @Inject(CohortResolver) private readonly cohorts: CohortResolver,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user: RequestUser | undefined = request.user;

    // No authenticated caller. This is reachable only if the guard is applied
    // without `JwtAuthGuard` in front of it, which is a wiring mistake — deny
    // rather than resolve a context for nobody.
    if (!user?.id) {
      this.logger.warn(
        `Member access denied: no authenticated user on ${request.method} ${request.path}. ` +
          `MemberGuard must be declared after JwtAuthGuard.`,
      );
      throw new ForbiddenException({ reason: MEMBERSHIP_REQUIRED });
    }

    // A-2, step 1 — ENTITLEMENT. Resolved from License/Subscription only.
    const entitled = await this.membership.isBuildersMember(user.id);
    if (!entitled) {
      this.logger.warn(
        `Member access denied for user ${user.id} on ${request.method} ${request.path}: ` +
          `no active Builders entitlement`,
      );
      throw new ForbiddenException({ reason: MEMBERSHIP_REQUIRED });
    }

    // A-2, step 2 — COHORT. Reached only once entitlement is already proven, so
    // it can never influence the access decision. An empty array is normal and
    // ALLOWS the request (R7.8): the member simply matches no cohort-gated
    // content.
    const cohortKeys = await this.cohorts.resolveCohortKeys(user.id);

    const memberContext: MemberContext = {
      userId: user.id,
      email: user.email,
      entitled: true,
      cohortKeys,
      isAdmin: this.resolveIsAdmin(user.email),
    };
    request.memberContext = memberContext;

    return true;
  }

  /**
   * Informational admin flag for the resolved context.
   *
   * Reads the same `ADMIN_EMAILS` allowlist `AdminGuard` uses, through
   * `ConfigService` (never `process.env`). It exists so a member-facing
   * response can render an admin affordance, and it is deliberately computed
   * AFTER the entitlement `throw` above.
   *
   * Unset/blank config yields `false` rather than throwing. `AdminGuard`
   * fail-closes loudly because it is AUTHORIZING; this flag authorizes nothing,
   * so the correct answer for "no allowlist configured" is simply "nobody is
   * flagged as an admin".
   */
  private resolveIsAdmin(email: string): boolean {
    const raw = this.config.get<string>('ADMIN_EMAILS');
    if (!raw || raw.trim().length === 0) {
      return false;
    }
    const allowlist = raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    return allowlist.includes(email.toLowerCase());
  }
}
