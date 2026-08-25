import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { AdminGuard } from '@ptah-api/identity';
import { AdminThrottlerGuard } from '@ptah-api/identity';
import {
  AdminSessionsService,
  type SessionActor,
} from './admin-sessions.service';
import {
  CreateSessionDto,
  ListSessionsQueryDto,
  SendInvitationsDto,
  UpdateSessionDto,
} from './dto/admin-session.dto';
import { dtoPipe } from '@ptah-api/core';
import type { AdminSession } from './google-sessions.types';

/**
 * AdminSessionsController — admin management of Builders session events
 * (TASK_2026_169).
 *
 * Mounted at `/api/v1/admin/sessions/*`. Guard chain: `JwtAuthGuard` →
 * `AdminGuard` at CLASS level (never method-only, so a future handler cannot
 * land unguarded — leak risk L1, asserted by structural test G1). Write routes
 * add `AdminThrottlerGuard` for a per-admin-email rate budget.
 *
 * ⚠️ SIBLING FILE, DIFFERENT GATE — READ BOTH TOGETHER.
 * `members.controller.ts` in THIS directory serves `GET /api/v1/members/sessions`
 * and is gated on an ACTIVE BUILDERS MEMBERSHIP (an inline DB check at
 * `members.controller.ts:103`). That gate is NOT modified, NOT weakened, and NOT
 * shared with this controller. The two controllers are co-located precisely so
 * a reviewer verifying the invariant sees both gates in one directory.
 *
 * Admin access is a SEPARATE AUTHORIZED PATH, never `isBuildersMember || isAdmin`.
 * The same account can be served here and refused there — that is the intended
 * behaviour and the entire premise of this feature: a platform admin manages
 * Builders content without holding a paid Builders membership.
 */
@Controller('v1/admin/sessions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminSessionsController {
  constructor(
    @Inject(AdminSessionsService)
    private readonly adminSessions: AdminSessionsService,
  ) {}

  /**
   * Upcoming sessions plus a `calendarWritable` hint. When false the admin UI
   * renders read-only rather than showing controls that would 503.
   */
  @Get()
  async list(
    @Query(dtoPipe(ListSessionsQueryDto)) query: ListSessionsQueryDto,
  ): Promise<{
    sessions: AdminSession[];
    calendarWritable: boolean;
  }> {
    return this.adminSessions.listSessions(query.daysAhead ?? 60);
  }

  @Post()
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @Req() req: Request,
    @Body(dtoPipe(CreateSessionDto)) dto: CreateSessionDto,
  ): Promise<AdminSession> {
    return this.adminSessions.createSession(
      {
        title: dto.title,
        description: dto.description,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
        createMeetLink: dto.createMeetLink,
        attendees: dto.attendees,
      },
      this.actor(req),
    );
  }

  @Patch(':eventId')
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  /**
   * ⚠️ SENDS EMAIL when `notifyGuests` is true — the one case where a patch
   * does. A real time change is precisely when Google's "updated invitation"
   * is what everyone wants; every other edit, and every rescheduling drag,
   * leaves the flag unset and stays silent.
   */
  async update(
    @Req() req: Request,
    @Param('eventId') eventId: string,
    @Body(dtoPipe(UpdateSessionDto)) dto: UpdateSessionDto,
  ): Promise<AdminSession> {
    const { notifyGuests, ...fields } = dto;
    return this.adminSessions.updateSession(
      eventId,
      fields,
      this.actor(req),
      notifyGuests ?? false,
    );
  }

  /**
   * ⚠️ THE ONLY ROUTE IN THIS CONTROLLER THAT SENDS EMAIL. Merges `attendees`
   * into the event's guest list and patches with `sendUpdates=all`, so Google
   * mails everyone on the resulting list — including guests already invited.
   *
   * Deliberately not a flag on POST/PATCH: as a flag it could ride along on a
   * rescheduling drag, and "I moved an event by an hour" would silently become
   * "I emailed the entire cohort". A separate route makes sending its own
   * request, its own throttle bucket, and its own audit action.
   *
   * The rate limit is the tightest in the module for the same reason.
   *
   * 400 `no_recipients` when the event has no guests and none were supplied;
   * 409 `protected_recurring_event` for the provisioning-owned series.
   */
  @Post(':eventId/invitations')
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async invite(
    @Req() req: Request,
    @Param('eventId') eventId: string,
    @Body(dtoPipe(SendInvitationsDto)) dto: SendInvitationsDto,
  ): Promise<AdminSession> {
    return this.adminSessions.sendInvitations(
      eventId,
      dto.attendees,
      this.actor(req),
    );
  }

  /** 409 `protected_recurring_event` when the target is the protected series. */
  @Delete(':eventId')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async remove(
    @Req() req: Request,
    @Param('eventId') eventId: string,
  ): Promise<{ deleted: boolean }> {
    return this.adminSessions.deleteSession(eventId, this.actor(req));
  }

  /** Audit actor context; `req.user` is guaranteed by the class-level guards. */
  private actor(req: Request): SessionActor {
    return {
      email: req.user?.email ?? null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    };
  }
}
