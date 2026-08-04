import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  isAdminEmail,
  JwtAuthGuard,
  type RequestUser,
} from '@ptah-api/identity';
import { CohortResolver, MembershipService } from '@ptah-api/membership';
import type { MemberEntitlementResponse } from '@ptah-contracts/community';
import { CohortBadgesService } from './cohort-badges.service';

/**
 * `GET /api/v1/members/entitlement` — THE FRONTEND GUARD'S PROBE (R7.6, R7.7).
 *
 * ── WHY `JwtAuthGuard` ONLY, AND DELIBERATELY NOT `MemberGuard` ────────────
 * `MemberGuard` answers a non-member with `403 { reason: 'membership_required' }`.
 * That is right for every surface that serves member CONTENT and wrong for the
 * probe, whose entire job is to report the answer rather than enforce it.
 *
 * The frontend guard must distinguish three states and route differently for
 * each:
 *
 *   401                            → not logged in      → /login?returnUrl=…
 *   200 { entitled: false }        → logged in, unpaid  → the upgrade surface
 *   200 { entitled: true, … }      → member             → render /members
 *
 * R7.7 forbids answering the middle case with an empty panel or a raw `403`.
 * Encoding it as a `200` body rather than an exception means the client never
 * has to parse an error body to make a NAVIGATION decision — the one place
 * where treating an expected outcome as an exception reliably produces the
 * wrong screen.
 *
 * ⚠️ `entitled` AND `isAdmin` ARE ORTHOGONAL (R7.4). An admin who never bought
 * Builders is `{ entitled: false, isAdmin: true }`. `isAdmin` is resolved AFTER
 * the entitlement answer and never influences it; `entitled || isAdmin` is not
 * merely discouraged here, it does not appear.
 *
 * ── COST: this endpoint is probed on every `/members/*` navigation ─────────
 * `admin-auth.guard.ts:31-33` warns against probing a heavy handler, and the
 * hub is exactly such a handler. So this composes nothing: at most
 * `isBuildersMember` (subscription, then license), one cohort-assignment read,
 * and one cohort-name read that is SKIPPED entirely when the member has no
 * cohorts — which is the current live default. A non-member costs the
 * entitlement lookup alone: cohorts are not read for someone who cannot see
 * cohort-gated content anyway.
 */
@Controller('v1/members/entitlement')
export class MemberEntitlementController {
  constructor(
    @Inject(MembershipService) private readonly membership: MembershipService,
    @Inject(CohortResolver) private readonly cohorts: CohortResolver,
    @Inject(CohortBadgesService)
    private readonly cohortBadges: CohortBadgesService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getEntitlement(
    @Req() req: Request,
  ): Promise<MemberEntitlementResponse> {
    // `JwtAuthGuard` has already 401'd an unauthenticated caller, so `req.user`
    // is present. Narrowed rather than asserted so a wiring mistake surfaces as
    // `{ entitled: false }` and not a TypeError-shaped 500.
    const user: RequestUser | undefined = req.user;
    // The informational admin flag, resolved through the ONE shared definition
    // in `@ptah-api/identity` (which reads `ADMIN_EMAILS` via `ConfigService`,
    // never `process.env`). It used to be a private copy of the parse here —
    // the fifth in the server. `isAdminEmail` answers `false` for an absent
    // email and for an unconfigured allowlist rather than throwing, which is
    // required: this endpoint runs for non-members and authorizes nothing.
    // `AdminGuard` composes the same parse with an explicit fail-closed check;
    // that difference in POLICY is intentional and lives at the guard.
    const isAdmin = isAdminEmail(this.config, user?.email);

    if (!user?.id) {
      return { entitled: false, cohorts: [], isAdmin };
    }

    const entitled = await this.membership.isBuildersMember(user.id);
    if (!entitled) {
      // No cohort read for a non-member: cohort keys only decide which gated
      // content an ENTITLED member sees, so there is nothing for them to label.
      return { entitled: false, cohorts: [], isAdmin };
    }

    const cohortKeys = await this.cohorts.resolveCohortKeys(user.id);
    const cohorts = await this.cohortBadges.resolveBadges(cohortKeys);

    // ⚠️ `cohorts: []` HERE IS A SUCCESS, NOT A DEGRADED ANSWER (R7.8, A-2).
    // An entitled member whom an admin has not placed in a cohort sees every
    // `member`-visibility surface and simply matches no `cohort`-gated content.
    // Every user in the live database is in exactly this state today.
    return { entitled: true, cohorts, isAdmin };
  }
}
