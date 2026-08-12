import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { dtoPipe } from '@ptah-api/core';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard } from '@ptah-api/membership';
import type { MemberContext } from '@ptah-api/membership';
import type {
  HubNotificationSummary,
  MemberNotification,
  Paged,
} from '@ptah-contracts/community';

import {
  ListNotificationsQueryDto,
  resolveNotificationPage,
} from './dto/list-notifications.query.dto';
import { MarkNotificationsReadDto } from './dto/mark-notifications-read.dto';
import { NotificationsService } from './notifications.service';

/**
 * `MemberNotificationsController` — `/api/v1/members/notifications` (R10.3,
 * R10.4, R10.5, plan §3.6).
 *
 * ── ONE PREFIX, FIVE ROUTES, AND `unread-count` / `read` / `read-all` ARE NOT
 *    SIBLING CONTROLLERS (RI-1, ground truth 11) ─────────────────────────────
 * `v1/members/notifications` is a single depth-3 literal prefix joining the nine
 * that already exist (`entitlement`, `hub`, `sessions`, `session-requests`,
 * `live`, `community`, `courses`, `lesson-comments`, `search`); segment 3
 * differs in every pair. `unread-count`, `:id/read`, `read` and `read-all` are
 * METHOD PATHS INSIDE this controller, so RI-1 sees one prefix and has nothing
 * to arbitrate. `route-map.spec.ts`'s two excuse ledgers (`PREFIX_EXCEPTIONS`,
 * `KNOWN_PREFIX_DEBT`) gain nothing.
 *
 * ⚠️ RI-3 — `unread-count`, `read` and `read-all` ARE LITERALS AT THE SAME
 * DEPTH AS `:id/read`'s FIRST SEGMENT, and none of them contests it:
 * `GET unread-count` has no `@Post` twin, and `POST read` / `POST read-all` are
 * ONE segment where `POST :id/read` is TWO — different segment counts never
 * unify. `read` and `read-all` are two distinct literals and do not contest
 * each other. Nest also matches literals before parameters within a controller,
 * so even the near-miss resolves the way a reader expects.
 *
 * ── THE THREE WRITES ARE ONE / THESE / ALL, AND THERE IS NO UN-READ ────────
 * `POST :id/read` marks one, `POST read` marks exactly the ids in its body, and
 * `POST read-all` marks the member's whole inbox. Nothing on this surface can
 * mark a notification UNREAD, which is why the middle route exists: without it
 * a partial selection had to be served by `read-all`, destroying unread state
 * the member never selected, irreversibly.
 *
 * ── 🔴 NO NAMED PRIMITIVE `@Query`, ANYWHERE (ground truth 10) ────────────
 * `NAMED_PRIMITIVE_PARAM_COUNT` is asserted by EXACT EQUALITY at 6. `page` and
 * `pageSize` arrive inside {@link ListNotificationsQueryDto}, and `ids` inside
 * {@link MarkNotificationsReadDto}, both bound with `dtoPipe` (PRE-1).
 * `@Param('id')` is a PATH parameter, not a `@Query`, and it is the one named
 * primitive this surface has — the census counts route-arg `data` on payload
 * params, and a `:id` path segment is how every other member controller in this
 * task addresses a row.
 *
 * ── 🔴 NO SSE, NO WEBSOCKET, NO LONG-POLL, NO EMAIL (AD-14, R10.5, §5) ────
 * The badge is a plain `GET` on a ≥60 s client timer. `libs/api/licensing`
 * carries an `@Sse` endpoint and it is NOT imported, NOT extended and NOT
 * referenced here: R10.5 forbids those transports for notifications, and the
 * cheapest way to keep a forbidden transport out is to never take the
 * dependency.
 *
 * ── GUARDS AT CLASS LEVEL, IN THAT ORDER ─────────────────────────────────
 * `JwtAuthGuard` then `MemberGuard`. CLASS level so a route added later is
 * guarded by default — a per-handler `@UseGuards` leaves every FUTURE handler
 * open (leak risk L1). Every method below is scoped to `ctx.userId` INSIDE the
 * service's `where`, never by a check after the read (RISK-AH, NFR-S8).
 *
 * ── THROTTLING ───────────────────────────────────────────────────────────
 * The global 100/min applies and no tier is named. `unread-count` at one call
 * per tab per 60 s sits far under it, and lowering the ceiling for this
 * controller would throttle the poll before it throttled anything abusive.
 */
@Controller('v1/members/notifications')
@UseGuards(JwtAuthGuard, MemberGuard)
export class MemberNotificationsController {
  private readonly logger = new Logger(MemberNotificationsController.name);

  constructor(
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * `GET` — this member's inbox, newest first (R10.3).
   *
   * 🔴 `@Query(dtoPipe(ListNotificationsQueryDto))` — A WHOLE-OBJECT DTO. See
   * the class docblock and the DTO's own: a bare `@Query()` is silently
   * unvalidated, and a named primitive fails the build.
   */
  @Get()
  async list(
    @Req() req: Request,
    @Query(dtoPipe(ListNotificationsQueryDto)) query: ListNotificationsQueryDto,
  ): Promise<Paged<MemberNotification>> {
    return this.notifications.list(
      this.context(req),
      resolveNotificationPage(query),
    );
  }

  /**
   * `GET unread-count` — the badge (R10.4, R10.5, AD-14, RISK-AI).
   *
   * ⚠️ THE MOST-CALLED ENDPOINT IN THE PRODUCT. Every open member tab issues it
   * every 60 seconds. It is a `count` behind
   * `@@index([userId, readAt, createdAt])` and it returns an OBJECT rather than
   * a bare number so a later per-kind breakdown does not change the envelope
   * (R6.6) — the same shape the hub's `notifications` section emits.
   *
   * ⚠️ IT IS DECLARED BEFORE `:id/read` FOR READERS, NOT FOR NEST. Nest matches
   * literal segments ahead of parameterised ones regardless of declaration
   * order; putting the literals first means a reader does not have to know that.
   */
  @Get('unread-count')
  async unreadCount(@Req() req: Request): Promise<HubNotificationSummary> {
    return this.notifications.unreadCount(this.context(req));
  }

  /**
   * `POST :id/read` — mark one notification read (R10.4).
   *
   * 🔴 `200`, NOT `201`, AND `@HttpCode(200)` IS WHAT MAKES IT SO. Nest's
   * default for `@Post` is `201 Created`, and nothing is created here: this is
   * idempotent state on a row that already exists. A client branching on the
   * status would be reading a lie, and the lie would be Nest's default rather
   * than anyone's decision.
   *
   * ⚠️ AN UNKNOWN ID AND ANOTHER MEMBER'S ID BOTH ANSWER `{ readAt: null }`,
   * AND NEITHER IS A `404`. A distinguishable answer is an existence oracle over
   * guessable cuids (RISK-AH). Re-reading an ALREADY-read notification returns
   * its ORIGINAL `readAt` rather than moving it.
   */
  @Post(':id/read')
  @HttpCode(200)
  async markRead(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ readAt: string | null }> {
    return this.notifications.markRead(this.context(req), id);
  }

  /**
   * `POST read` — mark EXACTLY the notifications named in the body (R10.4).
   *
   * ── 🔴 WHY IT IS NOT SERVED BY `read-all` ────────────────────────────────
   * A selection toolbar means "act on the N things I selected". Before this
   * route the surface offered ONE row or THE WHOLE INBOX and nothing between,
   * so a partial selection had to choose between N round trips and `read-all`
   * — which marks rows the member never selected, INCLUDING ROWS ON PAGES THEY
   * HAVE NEVER SEEN. There is deliberately no un-read endpoint anywhere here,
   * so that over-reach cannot be undone. This route is the honest middle.
   *
   * 🔴 `POST read` DOES NOT CONTEST `POST :id/read` (RI-3). It is FOUR path
   * segments where `:id/read` is FIVE, and different segment counts never
   * unify — so `route-map.spec.ts`'s `KNOWN_CONTESTED` ledger gains nothing.
   * It does not contest `read-all` either: two distinct literals at the same
   * depth. The trio now reads one / these / all.
   *
   * ⚠️ THE IDS ARRIVE IN A `@Body()` RATHER THAN A `?ids=` QUERY, AND THAT IS
   * NOT A STYLE CHOICE. A query string is bounded by the server's URL limit
   * rather than by anything this code controls, it is logged by every proxy in
   * the path, and `NAMED_PRIMITIVE_PARAM_COUNT` is an EXACT equality at 6 —
   * `@Query('ids')` would make it 7 and fail the build, deliberately.
   *
   * `200` for the same reason as the other two writes: nothing is created.
   * `marked` is how many rows this call ACTUALLY moved — the identical field
   * and meaning `read-all` returns, so the three writes stay consistent. Ids
   * that do not exist, are already read, or belong to another member each
   * contribute zero and are not reported individually (RISK-AH: a per-id
   * result is an existence oracle over guessable cuids).
   */
  @Post('read')
  @HttpCode(200)
  async markManyRead(
    @Req() req: Request,
    @Body(dtoPipe(MarkNotificationsReadDto)) body: MarkNotificationsReadDto,
  ): Promise<{ marked: number }> {
    return this.notifications.markManyRead(this.context(req), body.ids);
  }

  /**
   * `POST read-all` — clear the badge (R10.4).
   *
   * `200` for the same reason as `:id/read`. `marked` is how many rows actually
   * moved; already-read rows keep their original timestamps.
   */
  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@Req() req: Request): Promise<{ marked: number }> {
    return this.notifications.markAllRead(this.context(req));
  }

  /* ---------------------------------------------------------------------- */

  /**
   * Read `req.memberContext`, or REFUSE LOUDLY.
   *
   * ⚠️ A TRIPWIRE FOR A REMOVED GUARD, NOT A NULL CHECK. `MemberGuard` attaches
   * the context and is declared at CLASS level, so the `undefined` branch is
   * unreachable while the chain is intact. It is CHECKED rather than asserted
   * with `!` because of what the degraded state would be: every `where` on this
   * surface carries `userId: ctx.userId`, and Prisma treats an `undefined`
   * filter as NO CONSTRAINT. `list` would return every member's notifications,
   * `markAllRead` would mark every member's notifications read, and both would
   * return `200`. There is no version of that which is safe to let through.
   *
   * ⚠️ IT IS DECLARED HERE RATHER THAN COPIED FROM A `common/` DIRECTORY.
   * ASSUMPTION-19: this lib carries no `common/` helpers, because a notification
   * has no visibility rule, no soft delete and no admin mutation. One private
   * method on the one controller is not a fourth copy of a shared module — it is
   * the absence of one.
   *
   * The message the CLIENT sees names nothing (NFR-S7); the reason goes to the
   * server log with the route on it.
   */
  private context(req: Request): MemberContext {
    const ctx = req.memberContext;
    if (!ctx) {
      this.logger.error(
        `No memberContext on ${req.method} ${req.path} — MemberGuard is not ` +
          `applied to ${MemberNotificationsController.name}. Refusing to serve ` +
          `an unscoped notification query rather than reading an undefined ` +
          `user id, which Prisma would treat as no constraint at all.`,
      );
      throw new InternalServerErrorException(
        'Notifications are not available right now. Please try again.',
      );
    }
    return ctx;
  }
}
