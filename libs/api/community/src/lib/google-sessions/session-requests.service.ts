import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import {
  buildNotificationRoute,
  NotificationsService,
} from '@ptah-api/notifications';
import type {
  AdminSessionRequest,
  MemberSessionRequest,
  SessionRequestStatus,
} from '@ptah-contracts/community';

import type { AuditHook } from '../live-sessions/common/admin-audit';

import { GoogleCalendarProvider } from './google-calendar.provider';
import { resolveMeetLink } from './google-event.mapper';
import type {
  GoogleApiResult,
  GoogleCalendarEvent,
} from './google-sessions.types';

/**
 * `SessionRequestsService` — private-session requests, member and admin
 * (R4.1 – R4.10, plan §3.5, AD-2, PRE-5, PRE-6, RISK-U, RISK-X, RISK-Y).
 *
 * ── 🔴 RISK-U: THE ACCEPT PATH SPANS TWO SYSTEMS, AND THE WINDOW BETWEEN THEM
 *    IS THE REQUIREMENT ────────────────────────────────────────────────────
 *
 * §3.5 fixes the order — CALENDAR EVENT FIRST, DATABASE ROW SECOND — and
 * mandates that a database failure AFTER a successful create DELETES the event
 * before returning. Both of the natural implementations are wrong:
 *
 *   - a `$transaction` wrapped around both: the Calendar event SURVIVES a
 *     rollback, and the member is invited to a session the product has no
 *     record of. Nothing in the database can ever find it again, because the id
 *     that would have found it was in the rolled-back row.
 *   - the other order (row first, event second): the database says `scheduled`
 *     while no event exists, and `meetLink` is null on a row whose contract says
 *     it cannot be.
 *
 * ⚠️ NEITHER FAILURE IS VISIBLE TO A UNIT TEST THAT MOCKS ONE SIDE. That is why
 * the whole sequence is ONE named method ({@link accept}) with the compensating
 * delete in its `catch`, and why the spec asserts all four §3.5 rows INCLUDING
 * that the compensating `deleteEvent` was called with the id that was created.
 *
 * ── 🔴 RISK-Y: `calendar_event_id` IS `@unique`, AND `P2002` IS REACHABLE ───
 * Two admins accepting two requests that Google reconciles to one event, or a
 * retried accept, both land on that constraint. Unhandled it is a `500`
 * carrying a Prisma constraint name. Here it is a `409
 * { reason: 'calendar_event_already_claimed' }`, the raw error is logged and
 * dropped (NFR-S7) — and the orphaned event is deleted by the same compensating
 * path, because a `P2002` IS a database failure after a successful create.
 *
 * ── 🔴 RISK-X: `status` IS A BARE POSTGRES `String` ─────────────────────────
 * `@default("pending")` with an inline comment listing four values, and
 * `SESSION_REQUEST_STATUSES` in the contracts lib is the only other declaration.
 * Nothing connects them, so a typo'd `'sheduled'` writes cleanly and is invisible
 * until a member's request stops appearing anywhere. Every status literal in
 * this file is therefore pinned `satisfies SessionRequestStatus`, the way
 * `visibility.ts` pins its three, and NO bare string literal reaches a `status:`
 * field.
 *
 * ── ⚠️ R4.10: THE PAYMENT FIELDS ARE READ AND ECHOED, NEVER WRITTEN ─────────
 * `isFreeSession`, `paymentStatus` and `paddleTransactionId` keep their exact
 * current semantics. Nothing in this file assigns any of them. They reach the
 * ADMIN shape and are ABSENT from the member shape (NFR-S4) — see
 * {@link toMemberSessionRequest}, whose own-keys assertion is exit-gate
 * clause 4.
 *
 * ── ⚠️ PRE-5 IS DISCHARGED BY READING, NOT BY BUILDING ─────────────────────
 * `createEvent(input, sendUpdates)` already sends `conferenceDataVersion=1`,
 * which is what actually mints a Meet link, and `resolveMeetLink` already
 * resolves it from `hangoutLink` / `conferenceData`. NO MEET API IS CALLED AND
 * NONE IS BUILT. This file reuses both verbatim.
 *
 * ── ⚠️ ASSUMPTION-10: THE HAPPY PATH CANNOT BE VERIFIED LIVE HERE ──────────
 * `GOOGLE_OAUTH_*` is unset in this workspace, so `isEnabled()` is `false` and
 * every live request against accept / reschedule / decline exercises the
 * FEATURE-OFF branch and returns `503`. Every other row of §3.5 is asserted
 * against a `GoogleCalendarProvider` double returning the documented
 * `GoogleApiResult` shapes, with a real `events.insert` response body pasted
 * into the spec. No real Google request was made.
 *
 * ── 🔴 `session_request.status` IS PRODUCED HERE, ON THREE METHODS
 *    (TASK_2026_177 Phase 5, R10.1, R4.8, ASSUMPTION-21) ───────────────────
 *
 * `accept`, `reschedule` and `decline` each tell the request's OWNER what
 * happened to it. `submit` and `cancelOwn` produce nothing: in both, the actor
 * IS the recipient, and no producer is wired to either path — `create()`'s
 * suppression is not what keeps those rows out.
 *
 * 🔴 `actorId` IS `null` ON ALL THREE, AND THAT IS A PRIVACY DECISION RATHER
 * THAN A MISSING PARAMETER. These are admin transitions, and none of the three
 * signatures carries the acting admin's user id — the admin's identity reaches
 * only the `AuditHook`, which writes the internal ledger. Threading it into a
 * MEMBER-FACING row would put a specific staff member's name on a notification
 * (`actorName` is composed from the actor relation), which is exactly the class
 * of identity NFR-S4 keeps off member responses. `null` renders the contract's
 * system-generated case, which is what "your request was accepted" honestly is
 * from the member's side.
 *
 * ⚠️ THE ONE CONSEQUENCE, STATED: an admin who submits a request FOR THEMSELVES
 * and then accepts it receives a notification for their own action, because
 * R10.2's suppression compares `recipientId` to `actorId` and `actorId` is
 * `null`. That is a real gap and it is the right trade — the alternative puts a
 * staff identity on every member's notification to close a case that requires an
 * admin to be their own requester.
 *
 * ⚠️ `accept()` IS THE ONE PRODUCER THAT DOES NOT ENLIST IN THE TRANSACTION —
 * see its own docblock and RISK-U. `reschedule` and `decline` both do.
 */
@Injectable()
export class SessionRequestsService {
  private readonly logger = new Logger(SessionRequestsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GoogleCalendarProvider)
    private readonly calendar: GoogleCalendarProvider,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Member surface                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * This member's own requests — `GET /v1/members/session-requests` (R4.3).
   *
   * 🔴 `userId` IS IN THE `where`. It is NOT a filter applied after the read,
   * and that is the whole of R4.3. A read that fetched the queue and then
   * filtered in JavaScript would return every member's request the moment
   * somebody added a `.slice()` above the filter, or forgot it in a second code
   * path — and the shape it returns has no requester field, so the leak would
   * look like the member's own list.
   */
  async listOwn(ctx: MemberContext): Promise<MemberSessionRequest[]> {
    const rows = await this.prisma.sessionRequest.findMany({
      where: { userId: ctx.userId },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((row) => toMemberSessionRequest(row));
  }

  /**
   * Submit a request — `POST /v1/members/session-requests` (R4.2).
   *
   * ⚠️ IT WRITES `status: 'pending'` AND NOTHING ELSE OF CONSEQUENCE. No
   * scheduling column, no payment column. The four migration-4 columns stay null
   * until an admin accepts, which is exactly what makes `calendar_event_id`'s
   * `@unique` free for pending rows (Postgres treats NULLs as distinct).
   */
  async submit(
    ctx: MemberContext,
    input: SubmitSessionRequestInput,
  ): Promise<MemberSessionRequest> {
    const row = await this.withMappedPrismaErrors(async () =>
      this.prisma.sessionRequest.create({
        data: {
          userId: ctx.userId,
          sessionTopicId: input.sessionTopicId,
          additionalNotes: input.additionalNotes ?? null,
          status: PENDING,
        },
      }),
    );

    this.logger.log(
      `Session request submitted: id=${row.id} topic=${row.sessionTopicId}`,
    );
    return toMemberSessionRequest(row);
  }

  /**
   * Cancel one's own PENDING request — `DELETE /v1/members/session-requests/:id`.
   *
   * ⚠️ `403` FOR SOMEONE ELSE'S REQUEST **AND** FOR ONE THAT IS NO LONGER
   * PENDING, AND THE TWO ARE DELIBERATELY THE SAME ANSWER FROM ONE READ. The
   * read is by id alone, then both conditions are checked — and the refusal does
   * not say which failed. Answering `404` for "not yours" and `409` for "already
   * scheduled" would let a member distinguish "this id does not exist" from
   * "this id is somebody else's", which is an existence oracle over a table
   * keyed on other members.
   *
   * ⚠️ A CANCEL LEAVES `declineReason` NULL, and that is how the two ways of
   * reaching `'canceled'` stay distinguishable. An admin decline sets a reason
   * (R4.8); a member cancel does not. The status vocabulary has four values and
   * inventing a fifth for this would change a shipped contract to record
   * something the existing columns already say.
   */
  async cancelOwn(
    ctx: MemberContext,
    id: string,
  ): Promise<{ canceled: boolean }> {
    const row = await this.prisma.sessionRequest.findUnique({ where: { id } });

    if (!row || row.userId !== ctx.userId || row.status !== PENDING) {
      this.logger.warn(
        `Refused session-request cancel: id=${id} by=${ctx.userId} ` +
          `(exists=${Boolean(row)} own=${row?.userId === ctx.userId} ` +
          `status=${row?.status ?? 'n/a'})`,
      );
      throw new ForbiddenException(
        'That request cannot be canceled. Only your own pending requests can ' +
          'be withdrawn.',
      );
    }

    await this.prisma.sessionRequest.update({
      where: { id },
      data: { status: CANCELED },
    });

    this.logger.log(`Session request canceled by member: id=${id}`);
    return { canceled: true };
  }

  /* ---------------------------------------------------------------------- */
  /* Admin surface                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * The admin queue — `GET /v1/admin/session-requests` (R4.4).
   *
   * ⚠️ OLDEST FIRST. R4.4's queue is a work list, not a feed: the request that
   * has been waiting longest is the one that needs a decision. The composite
   * index `@@index([status, createdAt])` migration 4 replaced `@@index([status])`
   * with is what serves the filter and the ordering in one seek.
   *
   * ⚠️ THE REQUESTER IS JOINED, ONE QUERY, NO N+1 — and it is ADMIN-ONLY data.
   * `AdminSessionRequest.requester` is the field whose member-side equivalent
   * would leak another member's email address.
   */
  async listQueue(filter: QueueFilter = {}): Promise<AdminSessionRequest[]> {
    const rows = await this.prisma.sessionRequest.findMany({
      where: filter.status === undefined ? {} : { status: filter.status },
      orderBy: [{ createdAt: 'asc' }],
      include: { user: REQUESTER_SELECT },
    });
    return rows.map((row) => toAdminSessionRequest(row));
  }

  /**
   * 🔴 ACCEPT — §3.5, VERBATIM, INCLUDING THE COMPENSATING DELETE (RISK-U).
   *
   * The five outcomes, in the order they are decided:
   *
   *  1. Google unset ⇒ `503 { reason: 'scheduling_unavailable' }`, NOTHING
   *     WRITTEN. This is the DEFAULT state of this workspace (ASSUMPTION-10) and
   *     it must be a clean refusal, not a `500` and not a half-accepted request.
   *  2. `createEvent` fails ⇒ `502 { reason: 'calendar_event_failed' }`, NOTHING
   *     WRITTEN, the request stays `pending` so it can simply be retried.
   *  3. Event created but no Meet link resolves ⇒ **`deleteEvent(createdId)`
   *     FIRST**, then `502 { reason: 'meet_link_unresolved' }`, nothing written.
   *     `MemberSessionRequest.meetLink`'s docblock states that a `scheduled`
   *     request with a null `meetLink` is UNREPRESENTABLE; this is the branch
   *     that makes that true rather than aspirational.
   *  4. The database write throws after a successful create ⇒
   *     **`deleteEvent(createdId)` IN THE `catch`**, then the mapped failure.
   *     §3.5 calls this "the only sequence that satisfies *no partial state
   *     SHALL be persisted*".
   *  5. Success ⇒ all four columns in ONE transaction, with the audit row
   *     enlisted in it (PRE-6).
   *
   * ⚠️ THE PRE-FLIGHT READ IS OUTSIDE THE TRANSACTION AND IS RE-CHECKED INSIDE
   * IT. Outside, because refusing a non-pending request must not cost a Calendar
   * event; inside, because two admins accepting the same request concurrently
   * would otherwise both pass the outside check. The inner check is an
   * `updateMany` guarded on `status: 'pending'`, so `count === 0` IS the answer
   * and there is no gap between the check and the write.
   *
   * ⚠️ `sendUpdates` IS LEFT AT THE PROVIDER DEFAULT (`'none'`). Accepting a
   * request should not email the member from Google under the founder's name;
   * the member sees the accepted request, with its Meet link, in the members'
   * area — and, since Phase 5, an in-app notification (R10.1). Still no email:
   * AD-14 is poll-only, and the notification is a row, not a message.
   *
   * ── 🔴 THE NOTIFICATION GOES AFTER THE COMMIT, BEST-EFFORT, AND THIS IS THE
   *    ONE PRODUCER THAT DOES NOT ENLIST IN A TRANSACTION (ASSUMPTION-21) ───
   * Every other Phase-5 producer passes `tx` so the notification commits with
   * the event that caused it. Here it MUST NOT, and RISK-U is why: this method's
   * `catch` runs a compensating `deleteEvent` on ANY failure past a successful
   * create. A notification write inside that `try` would make a failed
   * notification DELETE A REAL CALENDAR EVENT the member has already been
   * invited to, and roll back an acceptance that had otherwise succeeded. A
   * notification is not worth that. So it runs after the transaction has
   * committed and the compensation window has closed, inside its own `catch`
   * that logs and swallows — the one place in this batch where a lost
   * notification is the correct outcome.
   */
  async accept(
    id: string,
    input: AcceptSessionRequestInput,
    audit?: AuditHook,
  ): Promise<AdminSessionRequest> {
    // ── (1) feature-off ──────────────────────────────────────────────────
    if (!this.calendar.isEnabled()) {
      this.logger.warn(
        `Refusing to accept session request ${id}: GOOGLE_OAUTH_* is unset, ` +
          `so no Calendar event can be created and nothing will be written`,
      );
      throw new ServiceUnavailableException({
        reason: SCHEDULING_UNAVAILABLE,
        message:
          'Scheduling is unavailable: the Google Calendar integration is not ' +
          'configured. The request has been left pending.',
      });
    }

    const request = await this.requirePending(id);
    const endsAt = new Date(
      input.startsAt.getTime() + input.durationMinutes * 60 * 1000,
    );

    // ── (2) the Calendar event, FIRST ────────────────────────────────────
    const created = await this.calendar.createEvent({
      title: `Ptah private session — ${request.sessionTopicId}`,
      description: request.additionalNotes ?? undefined,
      startsAt: input.startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      createMeetLink: true,
      attendees: [request.user.email.toLowerCase()],
    });

    const eventId = eventIdOf(created);
    if (!created.ok || eventId === null) {
      this.logger.warn(
        `Calendar event creation failed for session request ${id} ` +
          `(status: ${created.status ?? 'n/a'}) — nothing written, request ` +
          `stays pending`,
      );
      throw new BadGatewayException({
        reason: CALENDAR_EVENT_FAILED,
        message:
          'The calendar event could not be created. The request is still ' +
          'pending — please try again.',
      });
    }

    // ── (3) no Meet link ⇒ DELETE THE EVENT, THEN refuse ─────────────────
    const meetLink = resolveMeetLink(eventBodyOf(created));
    if (meetLink === null) {
      this.logger.warn(
        `Calendar event ${eventId} for session request ${id} carries no Meet ` +
          `link — deleting the orphan and refusing`,
      );
      await this.compensate(eventId, id);
      throw new BadGatewayException({
        reason: MEET_LINK_UNRESOLVED,
        message:
          'The calendar event was created without a Meet link, so it was ' +
          'removed again. The request is still pending — please try again.',
      });
    }

    // ── (4)/(5) the row, SECOND, with the event deleted on any failure ───
    //
    // ⚠️ `row` IS DECLARED OUTSIDE THE `try` SO THE NOTIFICATION CAN BE OUTSIDE
    // IT TOO. Keeping the notify call inside and relying on `notifyOwner` never
    // throwing would put the RISK-U compensation one refactor away from being
    // triggered by a notification failure. The scope is the guarantee.
    let row: AdminSessionRequest;
    try {
      row = await this.withMappedPrismaErrors(async () =>
        this.prisma.$transaction(async (tx) => {
          // ⚠️ THE STATUS GUARD IS IN THE `where`, so a concurrent accept
          // loses here rather than overwriting the winner's event id.
          const { count } = await tx.sessionRequest.updateMany({
            where: { id, status: PENDING },
            data: {
              status: SCHEDULED,
              scheduledAt: input.startsAt,
              durationMinutes: input.durationMinutes,
              calendarEventId: eventId,
              meetLink,
            },
          });
          if (count === 0) {
            throw new ConflictException({
              reason: REQUEST_NOT_PENDING,
              message:
                'That request is no longer pending — someone else may have ' +
                'just handled it. Reload the queue.',
            });
          }

          await audit?.(tx, id);
          return this.readWithRequester(tx, id);
        }),
      );
    } catch (error: unknown) {
      // 🔴 THE COMPENSATING DELETE. Every failure past a successful create
      // reaches here — including the `P2002` RISK-Y describes and the
      // concurrent-accept `409` above — and every one of them leaves an event
      // nothing references.
      await this.compensate(eventId, id);
      throw error;
    }

    this.logger.log(
      `Session request accepted: id=${id} event=${eventId} ` +
        `startsAt=${input.startsAt.toISOString()}`,
    );

    // 🔴 AFTER THE COMMIT AND OUTSIDE THE COMPENSATION WINDOW — structurally.
    // `notifyOwner` also never throws, but that is the second line of defence,
    // not the first: nothing reachable from here can delete the Calendar event.
    await this.notifyOwner(request.userId, id, ACCEPTED_TITLE, null);

    return row;
  }

  /**
   * Reschedule an accepted request — `POST …/:id/reschedule` (R4.6).
   *
   * 🔴 THE EVENT IS LOCATED BY THE PERSISTED `calendarEventId`, NEVER BY A
   * `(title, startsAt)` MATCH. That column plus its `@unique` is the whole of
   * AD-2: a fuzzy match reschedules whichever event happens to look similar, and
   * two requests reconciled to one event is the defect R4.6 names.
   *
   * ⚠️ A `scheduled` REQUEST WITH A NULL `calendarEventId` IS A DEFECT, AND THE
   * CODE SAYS SO. It is unreachable through this service — accept writes both or
   * neither — so reaching it means the row was edited outside the API. A named
   * refusal (`500`, logged, with the id) is the honest answer; a silent no-op
   * would report success for a reschedule that moved nothing, and a
   * `createEvent` fallback would mint a SECOND event for one request.
   *
   * ⚠️ THE MEET LINK IS RE-RESOLVED BUT ONLY OVERWRITTEN WHEN THE PATCH
   * RESPONSE ACTUALLY CARRIES ONE. Google's patch response normally echoes
   * `conferenceData`, but a partial response with the link absent must not clear
   * a link that still works.
   */
  async reschedule(
    id: string,
    input: RescheduleSessionRequestInput,
    audit?: AuditHook,
  ): Promise<AdminSessionRequest> {
    if (!this.calendar.isEnabled()) {
      throw new ServiceUnavailableException({
        reason: SCHEDULING_UNAVAILABLE,
        message:
          'Scheduling is unavailable: the Google Calendar integration is not ' +
          'configured. Nothing was changed.',
      });
    }

    const request = await this.requireScheduled(id);
    const durationMinutes = input.durationMinutes ?? request.durationMinutes;
    if (durationMinutes === null) {
      // Unreachable through accept, which always persists a duration. Refused
      // rather than defaulted: guessing a length would move somebody's session
      // to an end time nobody chose.
      this.logger.error(
        `Session request ${id} is scheduled with a null durationMinutes — ` +
          `refusing to reschedule rather than inventing a length`,
      );
      throw new ConflictException({
        reason: DURATION_UNKNOWN,
        message:
          'This session has no recorded length, so it cannot be moved ' +
          'automatically. Supply a duration with the new time.',
      });
    }

    const endsAt = new Date(
      input.startsAt.getTime() + durationMinutes * 60 * 1000,
    );

    const patched = await this.calendar.patchEvent(request.calendarEventId, {
      startsAt: input.startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });

    if (!patched.ok) {
      this.logger.warn(
        `Calendar patch failed for session request ${id} ` +
          `(status: ${patched.status ?? 'n/a'}) — nothing written`,
      );
      throw new BadGatewayException({
        reason: CALENDAR_EVENT_FAILED,
        message:
          'The calendar event could not be moved, so nothing was changed. ' +
          'Please try again.',
      });
    }

    const meetLink = resolveMeetLink(eventBodyOf(patched));

    const row = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        await tx.sessionRequest.update({
          where: { id },
          data: {
            scheduledAt: input.startsAt,
            durationMinutes,
            // Only when the response actually carried one — see the docblock.
            ...(meetLink === null ? {} : { meetLink }),
          },
        });
        await audit?.(tx, id);

        // R10.1 — ENLISTED (ASSUMPTION-21). Unlike `accept`, this method has no
        // compensating Calendar delete to trigger: the patch already happened
        // and a rollback here leaves the row unchanged, which is the honest
        // outcome for "the reschedule did not complete".
        await this.notifyOwner(request.userId, id, RESCHEDULED_TITLE, null, tx);

        return this.readWithRequester(tx, id);
      }),
    );

    this.logger.log(
      `Session request rescheduled: id=${id} event=${request.calendarEventId} ` +
        `startsAt=${input.startsAt.toISOString()}`,
    );
    return row;
  }

  /**
   * Decline a request — `POST …/:id/decline` (R4.7, R4.8).
   *
   * ⚠️ IT RECONCILES THE EVENT TOO, BY THE PERSISTED ID (R4.6). Declining an
   * already-ACCEPTED request that has an event must delete that event, or the
   * member keeps a calendar entry for a session that is not happening — which is
   * worse than never having been scheduled, because they will show up.
   *
   * ⚠️ `410 Gone` IS IDEMPOTENT SUCCESS, NOT A FAILURE. The provider's own
   * docblock says so: an already-deleted event is the state the caller wanted.
   * Treating it as fatal would make a retried decline permanently unable to
   * complete.
   *
   * ⚠️ A PENDING REQUEST HAS NO EVENT AND NEEDS NO CALENDAR CALL AT ALL — which
   * is why declining one WORKS WITH `GOOGLE_OAUTH_*` UNSET. That is deliberate:
   * exit-gate clause 2 requires that an admin can still run the queue with the
   * integration off, and refusing to decline would leave every request in this
   * workspace stuck pending for ever.
   *
   * ⚠️ `declineReason` IS MEMBER-VISIBLE BY DESIGN (R4.8) — it is the one column
   * migration 4 added that appears on `MemberSessionRequest`.
   */
  async decline(
    id: string,
    input: DeclineSessionRequestInput,
    audit?: AuditHook,
  ): Promise<AdminSessionRequest> {
    const request = await this.requireOpen(id);

    if (request.calendarEventId !== null) {
      if (!this.calendar.isEnabled()) {
        throw new ServiceUnavailableException({
          reason: SCHEDULING_UNAVAILABLE,
          message:
            'This session already has a calendar event, and the Google ' +
            'integration is not configured, so the event cannot be removed. ' +
            'Nothing was changed.',
        });
      }

      const deleted = await this.calendar.deleteEvent(request.calendarEventId);
      if (!isDeleteSettled(deleted)) {
        this.logger.warn(
          `Calendar delete failed for session request ${id} ` +
            `(status: ${deleted.status ?? 'n/a'}) — nothing written`,
        );
        throw new BadGatewayException({
          reason: CALENDAR_EVENT_FAILED,
          message:
            'The calendar event could not be removed, so nothing was ' +
            'changed. Please try again.',
        });
      }
    }

    const row = await this.withMappedPrismaErrors(async () =>
      this.prisma.$transaction(async (tx) => {
        await tx.sessionRequest.update({
          where: { id },
          data: {
            status: CANCELED,
            declineReason: input.declineReason ?? null,
            // 🔴 THE CLAIM IS RELEASED. Leaving the id on a canceled row would
            // hold AD-2's `@unique` against an event that no longer exists, so
            // a later request that Google reconciles to a new event with the
            // same id could never be accepted. `meetLink` goes with it — a link
            // to a deleted conference is worse than none.
            calendarEventId: null,
            meetLink: null,
          },
        });
        await audit?.(tx, id);

        // R10.1 + R4.8 — ENLISTED, and the decline reason travels as the
        // preview. It is ADMIN-AUTHORED PLAIN PROSE, stored unrendered exactly
        // like a reply excerpt (ground truth 4), and it is already
        // member-visible: `declineReason` is the one migration-4 column that
        // appears on `MemberSessionRequest`, so this puts nothing new in front
        // of the member — it puts it in front of them SOONER.
        await this.notifyOwner(
          request.userId,
          id,
          DECLINED_TITLE,
          input.declineReason ?? null,
          tx,
        );

        return this.readWithRequester(tx, id);
      }),
    );

    this.logger.log(
      `Session request declined: id=${id} hadEvent=${request.calendarEventId !== null}`,
    );
    return row;
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Delete an event we created but could not record — RISK-U's compensation.
   *
   * ⚠️ IT NEVER THROWS, AND THAT IS DELIBERATE. It runs inside a failure path
   * that is already going to answer the client; a second failure here must not
   * replace the honest `502`/`409` with a `500` about the cleanup. What it does
   * instead is LOG LOUDLY with the event id, because an orphan that could not be
   * deleted is the one state an operator has to fix by hand.
   */
  private async compensate(eventId: string, requestId: string): Promise<void> {
    try {
      const deleted = await this.calendar.deleteEvent(eventId);
      if (isDeleteSettled(deleted)) {
        this.logger.log(
          `Compensating delete succeeded: event=${eventId} (session request ${requestId})`,
        );
        return;
      }
      this.logger.error(
        `ORPHANED CALENDAR EVENT ${eventId}: created for session request ` +
          `${requestId}, the write failed, and the compensating delete ` +
          `returned status ${deleted.status ?? 'n/a'}. Delete it by hand.`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `ORPHANED CALENDAR EVENT ${eventId}: created for session request ` +
          `${requestId}, the write failed, and the compensating delete threw ` +
          `(${message}). Delete it by hand.`,
      );
    }
  }

  /**
   * Tell the request's OWNER what an admin just did — R10.1, `session_request.status`.
   *
   * 🔴 ONE CALL SHAPE FOR ALL THREE TRANSITIONS. `kind`, `targetType` and the
   * route are identical across accept / reschedule / decline; only the title and
   * the preview differ. Three inline `create` calls would be three chances for
   * one of them to drift onto a different `targetType` — and `targetType` is
   * what `buildNotificationRoute` switches on, so a drifted one would store a
   * permanently wrong deep link (RISK-AJ).
   *
   * ⚠️ IT NEVER THROWS WHEN IT IS NOT ENLISTED, AND ALWAYS THROWS WHEN IT IS.
   * That asymmetry is the point:
   *
   *   - with a `tx` (reschedule, decline) the caller WANTS a failure to roll the
   *     transition back, so the error propagates untouched (ASSUMPTION-21);
   *   - without one (accept) the transition has already committed and a real
   *     Calendar event exists, so a failure is logged loudly and swallowed —
   *     throwing would report a `500` for a request that WAS accepted, and the
   *     admin would retry it into a `409`.
   *
   * ⚠️ `actorId: null`. See the class docblock: the acting admin's identity is
   * an internal fact, and this row is member-facing.
   */
  private async notifyOwner(
    recipientId: string,
    requestId: string,
    title: string,
    bodyPreview: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      await this.notifications.create({
        recipientId,
        actorId: null,
        kind: 'session_request.status',
        targetType: 'SessionRequest',
        targetId: requestId,
        title,
        bodyPreview,
        route: buildNotificationRoute('SessionRequest'),
        tx,
      });
    } catch (error: unknown) {
      if (tx !== undefined) {
        // Enlisted: the caller's transaction must see this and roll back.
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Session request ${requestId} was accepted and committed, but the ` +
          `member notification could not be written (${message}). The ` +
          `acceptance and its Calendar event STAND — the member will see the ` +
          `scheduled request in the members' area without an inbox entry.`,
      );
    }
  }

  /** A `pending` request with its requester, or a typed refusal. */
  private async requirePending(id: string): Promise<RequestWithRequester> {
    const row = await this.prisma.sessionRequest.findUnique({
      where: { id },
      include: { user: REQUESTER_SELECT },
    });
    if (!row) throw new NotFoundException('Session request not found');
    if (row.status !== PENDING) {
      throw new ConflictException({
        reason: REQUEST_NOT_PENDING,
        message: `That request is ${row.status}, not pending, so it cannot be accepted.`,
      });
    }
    return row;
  }

  /** A `scheduled` request that really does carry an event id. */
  private async requireScheduled(
    id: string,
  ): Promise<RequestWithRequester & { calendarEventId: string }> {
    const row = await this.prisma.sessionRequest.findUnique({
      where: { id },
      include: { user: REQUESTER_SELECT },
    });
    if (!row) throw new NotFoundException('Session request not found');
    if (row.status !== SCHEDULED) {
      throw new ConflictException({
        reason: REQUEST_NOT_SCHEDULED,
        message: `That request is ${row.status}, not scheduled, so there is nothing to move.`,
      });
    }
    if (row.calendarEventId === null) {
      // See `reschedule`'s docblock: unreachable through this service, and a
      // named refusal rather than a silent no-op or a second event.
      this.logger.error(
        `DATA DEFECT: session request ${id} is scheduled with a null ` +
          `calendarEventId. It cannot have been accepted through this API. ` +
          `Refusing to reschedule rather than creating a second event.`,
      );
      throw new ConflictException({
        reason: CALENDAR_EVENT_MISSING,
        message:
          'This session is not linked to a calendar event, so it cannot be ' +
          'moved. Decline it and ask the member to request a new time.',
      });
    }
    return { ...row, calendarEventId: row.calendarEventId };
  }

  /** A request an admin may still act on — anything not already `canceled`. */
  private async requireOpen(id: string): Promise<RequestWithRequester> {
    const row = await this.prisma.sessionRequest.findUnique({
      where: { id },
      include: { user: REQUESTER_SELECT },
    });
    if (!row) throw new NotFoundException('Session request not found');
    if (row.status === CANCELED) {
      throw new ConflictException({
        reason: REQUEST_ALREADY_CLOSED,
        message: 'That request is already canceled.',
      });
    }
    return row;
  }

  /** Re-read inside the mutation's own transaction, so the response is the row that committed. */
  private async readWithRequester(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<AdminSessionRequest> {
    const row = await tx.sessionRequest.findUnique({
      where: { id },
      include: { user: REQUESTER_SELECT },
    });
    if (!row) throw new NotFoundException('Session request not found');
    return toAdminSessionRequest(row);
  }

  /**
   * Run a write and translate any Prisma failure into a typed Nest exception
   * (NFR-S7).
   *
   * ⚠️ AN `HttpException` THROWN FROM INSIDE THE TRANSACTION PASSES THROUGH
   * UNTOUCHED — re-wrapping a deliberate `409` would turn it into a `500`.
   */
  private async withMappedPrismaErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      throw mapPrismaError(error);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Status literals — RISK-X                                                    */
/* -------------------------------------------------------------------------- */

/*
 * 🔴 EVERY STATUS THIS FILE WRITES, PINNED TO THE SHARED UNION.
 *
 * `SessionRequest.status` is a bare Postgres `String` with a `@default("pending")`
 * and an inline comment listing four values. `SESSION_REQUEST_STATUSES` in the
 * contracts lib is the only other declaration and nothing connects them, so a
 * typo'd `'sheduled'` writes cleanly and is invisible until a member's request
 * stops appearing anywhere. `satisfies` is what connects them: rename or remove
 * a member of the union and this file stops compiling.
 */
const PENDING = 'pending' satisfies SessionRequestStatus;
const SCHEDULED = 'scheduled' satisfies SessionRequestStatus;
const CANCELED = 'canceled' satisfies SessionRequestStatus;

/* -------------------------------------------------------------------------- */
/* Notification titles — R10.1                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 🔴 NONE OF THESE NAMES THE ADMIN WHO ACTED, and none interpolates a time.
 *
 * The name is a privacy decision argued in the class docblock. The TIME is left
 * out for a different reason: `title` is frozen in the row, and the request's
 * `scheduledAt` is not — a member who is rescheduled twice would otherwise have
 * two inbox entries each confidently stating a different, and one of them wrong,
 * hour. The notification's job is to say "this changed, look"; the current time
 * lives on the request the deep link opens.
 */
const ACCEPTED_TITLE = 'Your session request was scheduled';
const RESCHEDULED_TITLE = 'Your session was moved to a new time';
const DECLINED_TITLE = 'Your session request was declined';

/* -------------------------------------------------------------------------- */
/* The refusal vocabulary — NFR-S7                                             */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ MACHINE VALUES, NOT SENTENCES. The admin UI matches on these; the `message`
 * beside them is for a human and may be reworded without breaking a screen. No
 * raw Google text and no raw Prisma text reaches any of them.
 */
export const SCHEDULING_UNAVAILABLE = 'scheduling_unavailable';
export const CALENDAR_EVENT_FAILED = 'calendar_event_failed';
export const MEET_LINK_UNRESOLVED = 'meet_link_unresolved';
export const CALENDAR_EVENT_ALREADY_CLAIMED = 'calendar_event_already_claimed';
export const CALENDAR_EVENT_MISSING = 'calendar_event_missing';
export const REQUEST_NOT_PENDING = 'session_request_not_pending';
export const REQUEST_NOT_SCHEDULED = 'session_request_not_scheduled';
export const REQUEST_ALREADY_CLOSED = 'session_request_already_closed';
export const DURATION_UNKNOWN = 'session_duration_unknown';

/* -------------------------------------------------------------------------- */
/* Google helpers                                                              */
/* -------------------------------------------------------------------------- */

/** The event body a `GoogleApiResult` carries, or an empty event. */
function eventBodyOf(result: GoogleApiResult): GoogleCalendarEvent {
  return (result.json ?? {}) as GoogleCalendarEvent;
}

/** The created event's id, or `null` when the response carried none. */
function eventIdOf(result: GoogleApiResult): string | null {
  const id = eventBodyOf(result).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Did a delete reach the state the caller wanted?
 *
 * ⚠️ `410 Gone` COUNTS AS SUCCESS. The provider's docblock says so in terms: an
 * already-deleted event is exactly the outcome a delete asks for, and treating
 * it as fatal makes a retried decline permanently unable to complete.
 */
function isDeleteSettled(result: GoogleApiResult): boolean {
  return result.ok || result.status === 410;
}

/* -------------------------------------------------------------------------- */
/* Error mapping                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Prisma failure → a typed, sanitized exception.
 *
 * 🔴 `P2002` HERE IS AD-2's `calendar_event_id` UNIQUE (RISK-Y). It is the only
 * unique on this table a caller can collide with, and it is reachable in
 * production: two admins accepting two requests that Google reconciles to one
 * event, or a retried accept. The refusal is a `409` with a machine reason; the
 * raw error — which names the constraint, the table and the column — is logged
 * by the caller and dropped.
 */
export function mapPrismaError(error: unknown): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new ConflictException({
        reason: CALENDAR_EVENT_ALREADY_CLAIMED,
        message:
          'That calendar event is already linked to another request. Reload ' +
          'the queue — someone may have just scheduled it.',
      });
    }
    if (error.code === 'P2003') {
      return new BadRequestException(
        'That reference does not exist, or is still referenced by other rows.',
      );
    }
    if (error.code === 'P2025') {
      return new NotFoundException('Session request not found');
    }
  }
  return error instanceof Error
    ? error
    : new Error('Unknown session request persistence error');
}

/* -------------------------------------------------------------------------- */
/* Rows and mappers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The requester projection, declared ONCE.
 *
 * ⚠️ FOUR COLUMNS, NOT `true`. `include: { user: true }` would pull
 * `workosId`, `paddleCustomerId`, `circleMemberId` and every other column of
 * `User` into an object the admin surface serialises — and `AdminSessionRequest`
 * would not complain, because a wider object still satisfies a narrower
 * interface structurally. An explicit `select` is what keeps the response equal
 * to the contract rather than merely assignable to it.
 */
const REQUESTER_SELECT = {
  select: { id: true, email: true, firstName: true, lastName: true },
} as const;

/** A `SessionRequest` row as this service reads it. */
export type SessionRequestRow = Prisma.SessionRequestModel;

/** …with the joined requester projection. */
export interface RequestWithRequester extends SessionRequestRow {
  readonly user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

/**
 * 🔴 THE NFR-S4 CHOKEPOINT — exit-gate clause 4.
 *
 * The ONLY construction site for a member-facing session request. Its spec
 * asserts, over a FULLY-POPULATED row, that the returned object's OWN KEYS are
 * exactly the nine `MemberSessionRequest` fields — so `calendarEventId`,
 * `userId`, `paymentStatus`, `paddleTransactionId` and `isFreeSession` are
 * ABSENT, not merely `undefined`. Same shape as `MemberPack`'s `notes`
 * assertion.
 *
 * ⚠️ IT IS AN EXPLICIT OBJECT LITERAL AND MUST STAY ONE. A spread of the row
 * minus a few keys (`const { userId, ...rest } = row`) would ADD every column a
 * future migration introduces to the member response automatically, which is the
 * opposite of what a field-absence contract means. Nine keys, written out, so
 * adding a tenth is a decision somebody makes.
 *
 * ⚠️ `status` IS CAST, AND THE CAST ASSERTS A PROPERTY THE WRITE PATH ENFORCES.
 * The column is a Postgres `String` (RISK-X); every literal this service writes
 * is pinned `satisfies SessionRequestStatus`, so this is an assertion about the
 * write path rather than a hope about the data.
 */
export function toMemberSessionRequest(
  row: SessionRequestRow,
): MemberSessionRequest {
  return {
    id: row.id,
    sessionTopicId: row.sessionTopicId,
    additionalNotes: row.additionalNotes,
    status: row.status as SessionRequestStatus,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    durationMinutes: row.durationMinutes,
    meetLink: row.meetLink,
    declineReason: row.declineReason,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A row as the ADMIN wire type — R4.4, R4.7.
 *
 * ⚠️ THIS ONE CARRIES THE BILLING INTERNALS AND THE REQUESTER, AND THAT IS THE
 * POINT OF THE RK-8 PAIR. `MemberSessionRequest` and `AdminSessionRequest` are
 * adjacent, independent declarations with no `extends` in either direction
 * precisely so widening this one cannot widen that one.
 *
 * ⚠️ R4.10 — the three payment fields are READ AND ECHOED HERE AND WRITTEN
 * NOWHERE IN THIS FILE.
 */
export function toAdminSessionRequest(
  row: RequestWithRequester,
): AdminSessionRequest {
  return {
    id: row.id,
    userId: row.userId,
    requester: {
      id: row.user.id,
      email: row.user.email,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
    },
    sessionTopicId: row.sessionTopicId,
    additionalNotes: row.additionalNotes,
    isFreeSession: row.isFreeSession,
    status: row.status as SessionRequestStatus,
    paymentStatus: row.paymentStatus,
    paddleTransactionId: row.paddleTransactionId,
    calendarEventId: row.calendarEventId,
    meetLink: row.meetLink,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    durationMinutes: row.durationMinutes,
    declineReason: row.declineReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

/** @see SessionRequestsService.listQueue */
export interface QueueFilter {
  readonly status?: SessionRequestStatus;
}

/** @see SessionRequestsService.submit */
export interface SubmitSessionRequestInput {
  readonly sessionTopicId: string;
  readonly additionalNotes?: string;
}

/**
 * @see SessionRequestsService.accept
 *
 * ⚠️ `durationMinutes` IS PERSISTED, NOT DERIVED. `endsAt` must be
 * reconstructible on reschedule without re-reading Google, and the DTO bounds it
 * (15–240) so a typo cannot book a four-day session.
 */
export interface AcceptSessionRequestInput {
  readonly startsAt: Date;
  readonly durationMinutes: number;
}

/** @see SessionRequestsService.reschedule */
export interface RescheduleSessionRequestInput {
  readonly startsAt: Date;
  /** Omit to keep the length the accept recorded. */
  readonly durationMinutes?: number;
}

/** @see SessionRequestsService.decline */
export interface DeclineSessionRequestInput {
  /** R4.8 — MEMBER-VISIBLE. Omit for a decline with no stated reason. */
  readonly declineReason?: string;
}
