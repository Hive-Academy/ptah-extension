import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Logger,
  Optional,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MembershipService } from '@ptah-api/membership';
import { SessionsService } from './sessions.service';
import type { BuildersSession } from './google-sessions.types';
import {
  MemberGroupsService,
  type UserMemberGroup,
} from '../member-groups/member-groups.service';

/**
 * MembersController — the paid Builders members' area backend.
 *
 * GET /api/v1/members/sessions
 *  - JwtAuthGuard (ptah_auth cookie required — 401 otherwise).
 *  - 403 { reason: 'membership_required' } when the caller's active plan is not
 *    'builders' (resolved from the DB, not the JWT claim, so a stale token can
 *    never grant access).
 *  - 200 { sessions, memberGroups } otherwise. `sessions` is the next 60 days
 *    of Google Calendar events.
 *
 * ⚠️ `communityUrl` WAS REMOVED HERE, SECOND, AND THE ORDER WAS THE POINT
 * (TASK_2026_177 RISK-C). The field pointed at the external forum. Its Zod
 * schema in `libs/web/core/.../members-api.service.ts` dropped it FIRST
 * (`cdc1a1ef5`): `z.object()` STRIPS unknown keys, so a client that has already
 * stopped reading the field tolerates a server still sending it. The reverse —
 * server drops first — breaks a client that still requires it. Never invert
 * this for a required field.
 *
 * Feature-off (Google unconfigured): `sessions` is `[]` — the endpoint still
 * responds so the frontend has a stable contract.
 *
 * ── AD-12: WHY THE PREFIX IS THE FULL PATH AND THE @Get() IS BARE ──────────
 * This used to be `@Controller('v1/members')` + `@Get('sessions')`. The
 * resolved URL is byte-identical either way, so nothing on the wire changed —
 * but `v1/members` is a strict path-PREFIX of `v1/members/hub`,
 * `v1/members/entitlement` and every other member controller that follows,
 * which fails RI-1 in `apps/ptah-license-server/src/common/route-map.spec.ts`
 * and blocks the build.
 *
 * Re-declaring the controller at the full literal path makes every member
 * controller a disjoint sibling at a fixed depth-3 LITERAL segment. No member
 * controller may declare a route parameter at segment 3 — that is what keeps
 * the whole family RI-1/RI-2 clean without anyone having to reason about
 * module registration order.
 */
@Controller('v1/members/sessions')
export class MembersController {
  private readonly logger = new Logger(MembersController.name);

  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    // THE membership definition, extracted to `@ptah-api/membership` (R7.2).
    // This controller used to carry its own inline copy of the
    // subscription-then-license query; it was DELETED rather than merged, so
    // there is now exactly one implementation and it cannot drift from the one
    // every other member surface uses.
    @Inject(MembershipService) private readonly membership: MembershipService,
    // Optional: member-cohort lookup for the sessions response. Bound by the
    // @Global() MemberGroupsModule; @Optional + best-effort read means a
    // groups failure never fails the endpoint (empty-array fallback).
    @Optional()
    @Inject(MemberGroupsService)
    private readonly memberGroups?: MemberGroupsService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getSessions(@Req() req: Request): Promise<{
    sessions: BuildersSession[];
    memberGroups: UserMemberGroup[];
  }> {
    const user = req.user as { id: string; email: string };

    const isBuilders = await this.membership.isBuildersMember(user.id);
    if (!isBuilders) {
      throw new ForbiddenException({ reason: 'membership_required' });
    }

    // Cohort-scoped: a member sees generic sessions plus their OWN cohort's
    // series, never another cohort's. Collapses to "every session" until some
    // cohort configures a `sessionEventId`.
    const sessions = await this.sessions.listUpcomingSessions(user.id);
    const memberGroups = await this.safeMemberGroups(user.id);
    return { sessions, memberGroups };
  }

  /**
   * Best-effort member-group lookup. A failure or an unbound collaborator
   * yields an empty array — it must never fail the sessions endpoint.
   */
  private async safeMemberGroups(userId: string): Promise<UserMemberGroup[]> {
    if (!this.memberGroups) {
      return [];
    }
    try {
      return await this.memberGroups.getGroupsForUser(userId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to resolve member groups for user ${userId}: ${message}`,
      );
      return [];
    }
  }
}
