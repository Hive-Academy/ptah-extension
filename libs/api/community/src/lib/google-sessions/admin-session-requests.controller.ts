import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuditLogService } from '@ptah-api/audit';
import { dtoPipe } from '@ptah-api/core';
import {
  AdminGuard,
  AdminThrottlerGuard,
  JwtAuthGuard,
} from '@ptah-api/identity';
import type { AdminSessionRequest } from '@ptah-contracts/community';

import { adminActor, auditHook } from '../live-sessions/common/admin-audit';

import {
  AcceptSessionRequestDto,
  toAcceptInput,
} from './dto/accept-session-request.dto';
import { DeclineSessionRequestDto } from './dto/decline-session-request.dto';
import {
  ListSessionRequestsQueryDto,
  resolveQueueFilter,
} from './dto/list-session-requests.query.dto';
import {
  RescheduleSessionRequestDto,
  toRescheduleInput,
} from './dto/reschedule-session-request.dto';
import { SessionRequestsService } from './session-requests.service';

const ADMIN_WRITES = { default: { limit: 20, ttl: 60_000 } } as const;

/**
 * `AdminSessionRequestsController` — the R4.4/R4.7 private-session queue
 * (`/api/v1/admin/session-requests`, plan §3.5).
 *
 * ── 🔴 THE PREFIX IS `v1/admin/session-requests`, NOT `v1/admin/sessions/requests` ─
 * The nested form would be a proper segment-wise path prefix of the existing
 * `v1/admin/sessions`, which RI-1 rejects (RISK-J). Segment 3 differs from every
 * other depth-3 admin literal, and `session-requests` is not a string prefix of
 * `sessions` in either direction.
 *
 * ── 🔴 THE THREE MUTATIONS TRANSLATE TYPED FAILURES, THEY DO NOT INVENT THEM ─
 * `SessionRequestsService` owns §3.5's outcome table and throws the typed
 * exception with its machine `reason`; these handlers pass it through. That is
 * the whole of NFR-S7 on this surface — no raw Google text and no raw Prisma
 * text reaches a client, because no handler here ever sees one.
 *
 * The vocabulary a client may receive, in full:
 *   `503 scheduling_unavailable`        — GOOGLE_OAUTH_* unset. Nothing written.
 *   `502 calendar_event_failed`         — Google refused the create/patch/delete.
 *   `502 meet_link_unresolved`          — event created without a Meet link; the
 *                                         orphan was deleted before returning.
 *   `409 calendar_event_already_claimed`— AD-2's unique (RISK-Y).
 *   `409 session_request_not_pending`   — someone else handled it first.
 *   `409 session_request_not_scheduled` — nothing to move.
 *   `409 calendar_event_missing`        — a data defect, named rather than
 *                                         papered over with a second event.
 *   `409 session_duration_unknown`      — refusing to guess a length.
 *   `409 session_request_already_closed`
 *
 * ── ⚠️ 503 IS THE DEFAULT ANSWER IN THIS WORKSPACE, AND THAT IS FINE ────────
 * `GOOGLE_OAUTH_*` is unset here (ASSUMPTION-10), so `accept` and `reschedule`
 * answer `503` and write nothing — exit-gate clause 2. **`decline` still
 * works**, deliberately: a pending request has no event and needs no Calendar
 * call, and refusing to decline would leave every request in this workspace
 * stuck pending for ever.
 *
 * ── PRE-1 / PRE-6 ──────────────────────────────────────────────────────────
 * Every `@Body()` and the one `@Query()` bind `dtoPipe(TheDto)`; the query is a
 * whole-object DTO because `NAMED_PRIMITIVE_PARAM_COUNT` is exact-equality at 6
 * (RISK-I). Every mutation passes an `auditHook` so the row commits inside the
 * mutation's own transaction.
 *
 * 🔴 AND PRE-6 MATTERS MORE HERE THAN ANYWHERE ELSE IN THIS BATCH.
 * `SessionRequest` has NO actor column of any kind — R4.10 froze its existing
 * columns and migration 4 added only the four scheduling ones — so the audit row
 * written here is the ONLY record of which admin scheduled, moved or refused a
 * member's private session, including the one where the member disputes the
 * decline reason.
 */
@Controller('v1/admin/session-requests')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminSessionRequestsController {
  private readonly logger = new Logger(AdminSessionRequestsController.name);

  constructor(
    @Inject(SessionRequestsService)
    private readonly requests: SessionRequestsService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * `GET` — the queue, OLDEST FIRST (R4.4), with the requester joined.
   *
   * ⚠️ AN OMITTED `?status` READS EVERYTHING. Defaulting to `pending` would make
   * this a different endpoint from what its path says, and an admin looking for
   * a request they declined last week would get an empty list with no clue why.
   */
  @Get()
  async list(
    @Query(dtoPipe(ListSessionRequestsQueryDto))
    query: ListSessionRequestsQueryDto,
  ): Promise<AdminSessionRequest[]> {
    return this.requests.listQueue(resolveQueueFilter(query));
  }

  /**
   * 🔴 `POST :id/accept` — §3.5, including the compensating delete (RISK-U).
   *
   * The service owns the whole two-system sequence in ONE method: Calendar event
   * first, database row second, and `deleteEvent(createdId)` in the `catch` of
   * every failure past a successful create. This handler adds only the audit
   * seam and the actor.
   */
  @Post(':id/accept')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async accept(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(AcceptSessionRequestDto)) dto: AcceptSessionRequestDto,
  ): Promise<AdminSessionRequest> {
    const actor = adminActor(req);
    const accepted = await this.requests.accept(
      id,
      toAcceptInput(dto),
      auditHook(
        this.audit,
        actor,
        'community.session_request.accept',
        'SessionRequest',
        // ⚠️ ONLY VALUES THE ADMIN SUPPLIED. No Google response body, no row
        // dump — `targetSnapshot` exists for a snapshot and is not used by
        // default (NFR-S7).
        { startsAt: dto.startsAt, durationMinutes: dto.durationMinutes },
      ),
    );

    this.logger.log(
      `Admin accepted session request: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return accepted;
  }

  /**
   * `POST :id/reschedule` — R4.6.
   *
   * ⚠️ THE EVENT IS LOCATED BY THE PERSISTED `calendarEventId`, and the DTO has
   * no field for one — a body-supplied event id would let a caller point a
   * reschedule at any event on the founder's calendar.
   */
  @Post(':id/reschedule')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async reschedule(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(RescheduleSessionRequestDto))
    dto: RescheduleSessionRequestDto,
  ): Promise<AdminSessionRequest> {
    const actor = adminActor(req);
    const moved = await this.requests.reschedule(
      id,
      toRescheduleInput(dto),
      auditHook(
        this.audit,
        actor,
        'community.session_request.reschedule',
        'SessionRequest',
        { startsAt: dto.startsAt, durationMinutes: dto.durationMinutes },
      ),
    );

    this.logger.log(
      `Admin rescheduled session request: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return moved;
  }

  /**
   * `POST :id/decline` — R4.7, R4.8.
   *
   * ⚠️ `declineReason` IS MEMBER-VISIBLE (R4.8), so it is recorded on the audit
   * row too — it is the one piece of admin-supplied text a member can quote back.
   */
  @Post(':id/decline')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle(ADMIN_WRITES)
  async decline(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(DeclineSessionRequestDto)) dto: DeclineSessionRequestDto,
  ): Promise<AdminSessionRequest> {
    const actor = adminActor(req);
    const declined = await this.requests.decline(
      id,
      { declineReason: dto.declineReason },
      auditHook(
        this.audit,
        actor,
        'community.session_request.decline',
        'SessionRequest',
        { declineReason: dto.declineReason ?? null },
      ),
    );

    this.logger.log(
      `Admin declined session request: actor=${actor.email ?? 'unknown'} id=${id}`,
    );
    return declined;
  }
}
