import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { dtoPipe } from '@ptah-api/core';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard } from '@ptah-api/membership';
import type { MemberSessionRequest } from '@ptah-contracts/community';

import { requireMemberContext } from '../live-sessions/common/member-context';

import { CreateSessionRequestDto } from './dto/create-session-request.dto';
import { SessionRequestsService } from './session-requests.service';

/**
 * Throttle budget for a member-authored request — §3.1's `CONTENT_CREATION`
 * tier, the same 10/min `MemberCommunityController` applies to a new topic.
 *
 * ⚠️ APPLIED TO THE CREATE ONLY. The list is a read and inherits the global
 * 100/min; the cancel is bounded by the fact that a member can only cancel
 * requests they own and only while they are pending, so there is nothing to
 * enumerate by repeating it.
 */
const CONTENT_CREATION = { default: { limit: 10, ttl: 60_000 } } as const;

/**
 * `MemberSessionRequestsController` — a member's OWN private-session requests
 * (`/api/v1/members/session-requests`, R4.2, R4.3, plan §3.5).
 *
 * ── THE PREFIX IS A DEPTH-3 LITERAL (AD-12, RI-1) ──────────────────────────
 * `v1/members/session-requests` is a disjoint literal sibling of
 * `v1/members/sessions` — segment 3 differs, and neither is a string prefix of
 * the other. It is deliberately NOT `v1/members/sessions/requests`, which would
 * nest under the existing Calendar sessions prefix and reproduce RISK-J.
 *
 * ── 🔴 R4.3: OWN ONLY, ENFORCED IN THE `where` AND NOT HERE ────────────────
 * This controller passes `ctx` down; `SessionRequestsService.listOwn` puts
 * `ctx.userId` INTO the query. That is deliberate placement: a controller-level
 * filter would leave the service returning everything, one call site away from
 * a leak — and `MemberSessionRequest` has no requester field, so the leak would
 * render as the member's own list with no visible anomaly.
 *
 * ── GUARDS AT CLASS LEVEL, IN THAT ORDER ───────────────────────────────────
 * `JwtAuthGuard` then `MemberGuard`, so a handler added later is guarded by
 * default. `requireMemberContext` is the removed-guard tripwire — with `ctx`
 * undefined, `listOwn`'s `where` would carry `userId: undefined`, which Prisma
 * treats as NO CONSTRAINT: every member's requests, their notes and their Meet
 * links, on one response.
 *
 * ── NFR-S4 ────────────────────────────────────────────────────────────────
 * Every response here is built by `toMemberSessionRequest`, the field-absence
 * chokepoint whose own spec (`member-session-request-fields.spec.ts`) asserts
 * the returned object's OWN KEYS are exactly the nine contract fields. There is
 * no second mapper on this path.
 */
@Controller('v1/members/session-requests')
@UseGuards(JwtAuthGuard, MemberGuard)
export class MemberSessionRequestsController {
  private readonly logger = new Logger(MemberSessionRequestsController.name);

  constructor(
    @Inject(SessionRequestsService)
    private readonly requests: SessionRequestsService,
  ) {}

  /** `GET` — this member's own requests, newest first (R4.3). */
  @Get()
  async list(@Req() req: Request): Promise<MemberSessionRequest[]> {
    const ctx = requireMemberContext(
      req,
      MemberSessionRequestsController.name,
      this.logger,
    );
    return this.requests.listOwn(ctx);
  }

  /**
   * `POST` — submit a request. `201`, always `pending` (R4.2).
   *
   * 🔴 `@Body(dtoPipe(CreateSessionRequestDto))` (PRE-1). A bare `@Body()` is
   * SILENTLY UNVALIDATED — esbuild emits no `emitDecoratorMetadata` — which
   * would make `forbidNonWhitelisted` inert and let a member send `status`,
   * `scheduledAt` or `calendarEventId` straight through.
   */
  @Post()
  @Throttle(CONTENT_CREATION)
  async submit(
    @Req() req: Request,
    @Body(dtoPipe(CreateSessionRequestDto)) dto: CreateSessionRequestDto,
  ): Promise<MemberSessionRequest> {
    const ctx = requireMemberContext(
      req,
      MemberSessionRequestsController.name,
      this.logger,
    );

    const created = await this.requests.submit(ctx, {
      sessionTopicId: dto.sessionTopicId,
      additionalNotes: dto.additionalNotes,
    });

    this.logger.log(
      `Member submitted a session request: id=${created.id} topic=${created.sessionTopicId}`,
    );
    return created;
  }

  /**
   * `DELETE :id` — withdraw one's own PENDING request.
   *
   * ⚠️ `200 { canceled: true }`, NOT `204`. The member surface renders the
   * outcome, and a body is what lets a client update the row it just changed
   * without a second read.
   *
   * ⚠️ NOT YOURS, ALREADY SCHEDULED AND NONEXISTENT ALL ANSWER `403`. Splitting
   * them into `404`/`409` would let a member distinguish "this id does not
   * exist" from "this id is somebody else's" — an existence oracle over a table
   * keyed on other members. The service owns that decision; this handler simply
   * does not translate it.
   */
  @Delete(':id')
  @HttpCode(200)
  async cancel(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ canceled: boolean }> {
    const ctx = requireMemberContext(
      req,
      MemberSessionRequestsController.name,
      this.logger,
    );
    return this.requests.cancelOwn(ctx, id);
  }
}
