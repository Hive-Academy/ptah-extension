import { Prisma } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';

import {
  asPrismaService,
  createMockPrisma,
  type MockCommunityPrisma,
} from '../../testing/mock-community-prisma';

import type { GoogleCalendarProvider } from './google-calendar.provider';
import {
  SessionRequestsService,
  type RequestWithRequester,
} from './session-requests.service';

/**
 * `SessionRequestsService` — R4.1 – R4.10, §3.5, AD-2, PRE-5, PRE-6,
 * RISK-U, RISK-X, RISK-Y, exit-gate clauses 1, 2 and 4.
 *
 * 🔴 EXIT-GATE CLAUSE 1 LIVES HERE: all four rows of §3.5's accept table,
 * INCLUDING that the compensating `deleteEvent` is called WITH THE ID THAT WAS
 * CREATED. Neither of the two natural implementations of accept can pass this
 * file — a `$transaction` around both systems leaves the event behind on
 * rollback, and the other order leaves a `scheduled` row with no event.
 *
 * ⚠️ THE GOOGLE PROVIDER IS A DOUBLE AND NO REAL REQUEST IS MADE
 * (ASSUMPTION-10). `GOOGLE_OAUTH_*` is unset in this workspace, so `isEnabled()`
 * is `false` live and every §3.5 row except the feature-off one is unreachable
 * against the real integration. The double returns the documented
 * `GoogleApiResult` shapes and {@link EVENTS_INSERT_RESPONSE} is a real
 * `events.insert` body, reduced to the fields the mapper reads.
 */

const NOW = new Date('2026-08-08T12:00:00.000Z');
const START = new Date('2026-08-12T15:00:00.000Z');

const CTX: MemberContext = {
  userId: 'user_1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

/**
 * A REAL Google `events.insert` response, reduced to the fields
 * `resolveMeetLink` and `eventIdOf` actually read.
 *
 * `hangoutLink` and the `conferenceData` video entry point are BOTH present,
 * because Google sends both — and the mapper prefers the former. A fixture with
 * only one would leave the other branch untested.
 */
const EVENTS_INSERT_RESPONSE = {
  kind: 'calendar#event',
  id: 'a1b2c3d4e5f6g7h8',
  status: 'confirmed',
  htmlLink: 'https://www.google.com/calendar/event?eid=a1b2',
  summary: 'Ptah private session — architecture-review',
  hangoutLink: 'https://meet.google.com/xyz-abcd-efg',
  conferenceData: {
    entryPoints: [
      { entryPointType: 'video', uri: 'https://meet.google.com/xyz-abcd-efg' },
      { entryPointType: 'phone', uri: 'tel:+1-000-000-0000' },
    ],
  },
  start: { dateTime: START.toISOString() },
  end: { dateTime: new Date(START.getTime() + 60 * 60 * 1000).toISOString() },
};

const CREATED_EVENT_ID = EVENTS_INSERT_RESPONSE.id;
const MEET_LINK = EVENTS_INSERT_RESPONSE.hangoutLink;

const REQUESTER = {
  id: 'user_1',
  email: 'Member@Example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
};

const PENDING_ROW: RequestWithRequester = {
  id: 'req_1',
  userId: 'user_1',
  sessionTopicId: 'architecture-review',
  additionalNotes: 'I want to talk about the module boundaries.',
  isFreeSession: false,
  status: 'pending',
  paymentStatus: 'completed',
  paddleTransactionId: 'txn_01hxyz',
  scheduledAt: null,
  calendarEventId: null,
  meetLink: null,
  durationMinutes: null,
  declineReason: null,
  createdAt: NOW,
  updatedAt: NOW,
  user: REQUESTER,
};

const request = (
  over: Partial<RequestWithRequester> = {},
): RequestWithRequester => ({ ...PENDING_ROW, ...over });

interface Harness {
  prisma: MockCommunityPrisma;
  calendar: {
    isEnabled: jest.Mock;
    createEvent: jest.Mock;
    patchEvent: jest.Mock;
    deleteEvent: jest.Mock;
  };
  service: SessionRequestsService;
  auditCalls: Array<{ tx: unknown; targetId: string | null }>;
  audit: (tx: unknown, targetId: string | null) => Promise<void>;
}

function wire(enabled = true): Harness {
  const prisma = createMockPrisma();
  const calendar = {
    isEnabled: jest.fn().mockReturnValue(enabled),
    createEvent: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: EVENTS_INSERT_RESPONSE,
    }),
    patchEvent: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: EVENTS_INSERT_RESPONSE,
    }),
    deleteEvent: jest.fn().mockResolvedValue({ ok: true, status: 204 }),
  };
  const auditCalls: Array<{ tx: unknown; targetId: string | null }> = [];

  return {
    prisma,
    calendar,
    service: new SessionRequestsService(
      asPrismaService(prisma),
      calendar as unknown as GoogleCalendarProvider,
    ),
    auditCalls,
    audit: async (tx, targetId) => {
      auditCalls.push({ tx, targetId });
    },
  };
}

/** Make the accept path's terminal re-read return something coherent. */
function stubAcceptReads(h: Harness, row = PENDING_ROW): void {
  h.prisma.sessionRequest.findUnique
    .mockResolvedValueOnce(row)
    .mockResolvedValue(
      request({
        status: 'scheduled',
        scheduledAt: START,
        durationMinutes: 60,
        calendarEventId: CREATED_EVENT_ID,
        meetLink: MEET_LINK,
      }),
    );
  h.prisma.sessionRequest.updateMany.mockResolvedValue({ count: 1 });
}

describe('SessionRequestsService', () => {
  /* ---------------------------------------------------------------------- */
  /* Member surface — R4.2, R4.3                                             */
  /* ---------------------------------------------------------------------- */

  describe('listOwn — R4.3', () => {
    it('🔴 puts userId IN THE `where`, not in a filter after the read', async () => {
      // The shape returned has no requester field, so a leak here would look
      // exactly like the member's own list.
      const h = wire();
      h.prisma.sessionRequest.findMany.mockResolvedValue([PENDING_ROW]);

      await h.service.listOwn(CTX);

      expect(h.prisma.sessionRequest.findMany.mock.calls[0]?.[0]).toMatchObject(
        {
          where: { userId: 'user_1' },
        },
      );
    });

    it('never joins the requester on the member path', async () => {
      // `include: { user: … }` here would put an email address into a
      // member-facing serialisation path (NFR-S4).
      const h = wire();
      h.prisma.sessionRequest.findMany.mockResolvedValue([]);

      await h.service.listOwn(CTX);

      const call = h.prisma.sessionRequest.findMany.mock.calls[0]?.[0];
      expect(call.include).toBeUndefined();
    });
  });

  describe('submit — R4.2', () => {
    it('writes status `pending` and leaves all four scheduling columns null', async () => {
      const h = wire();
      h.prisma.sessionRequest.create.mockResolvedValue(PENDING_ROW);

      await h.service.submit(CTX, { sessionTopicId: 'architecture-review' });

      const data = h.prisma.sessionRequest.create.mock.calls[0]?.[0].data;
      expect(data).toEqual({
        userId: 'user_1',
        sessionTopicId: 'architecture-review',
        additionalNotes: null,
        status: 'pending',
      });
      // R4.10 — no payment column is written.
      expect(Object.keys(data)).not.toContain('paymentStatus');
      expect(Object.keys(data)).not.toContain('isFreeSession');
      expect(Object.keys(data)).not.toContain('paddleTransactionId');
    });
  });

  describe('cancelOwn — R4.3', () => {
    it('cancels an own PENDING request', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.prisma.sessionRequest.update.mockResolvedValue(PENDING_ROW);

      expect(await h.service.cancelOwn(CTX, 'req_1')).toEqual({
        canceled: true,
      });
      expect(h.prisma.sessionRequest.update.mock.calls[0]?.[0].data).toEqual({
        status: 'canceled',
      });
    });

    it.each([
      ["someone else's", request({ userId: 'user_2' })],
      ['already scheduled', request({ status: 'scheduled' })],
      ['nonexistent', null],
    ])('refuses %s with the SAME 403 and no write', async (_label, row) => {
      // 🔴 ONE ANSWER FOR ALL THREE. A `404` for "not found" and a `409` for
      // "already scheduled" would let a member distinguish a nonexistent id from
      // somebody else's — an existence oracle over a table keyed on other
      // members.
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(row);

      await expect(h.service.cancelOwn(CTX, 'req_1')).rejects.toMatchObject({
        status: 403,
      });
      expect(h.prisma.sessionRequest.update).not.toHaveBeenCalled();
    });

    it('leaves declineReason null, so a member cancel stays distinguishable from an admin decline', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.prisma.sessionRequest.update.mockResolvedValue(PENDING_ROW);

      await h.service.cancelOwn(CTX, 'req_1');

      const data = h.prisma.sessionRequest.update.mock.calls[0]?.[0].data;
      expect(Object.keys(data)).not.toContain('declineReason');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 §3.5 — the accept table, all five rows                                */
  /* ---------------------------------------------------------------------- */

  describe('🔴 accept — §3.5, RISK-U', () => {
    it('ROW 1 — Google unset ⇒ 503 scheduling_unavailable, and NOTHING is written', async () => {
      // ⚠️ THE LIVE PATH IN THIS WORKSPACE (ASSUMPTION-10), and exit-gate
      // clause 2. It must be a clean refusal, not a 500 and not a half-accept.
      const h = wire(false);

      await expect(
        h.service.accept(
          'req_1',
          { startsAt: START, durationMinutes: 60 },
          h.audit,
        ),
      ).rejects.toMatchObject({
        status: 503,
        response: { reason: 'scheduling_unavailable' },
      });

      expect(h.calendar.createEvent).not.toHaveBeenCalled();
      expect(h.prisma.sessionRequest.updateMany).not.toHaveBeenCalled();
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
      expect(h.auditCalls).toEqual([]);
    });

    it('ROW 2 — createEvent fails ⇒ 502 calendar_event_failed, nothing written, still pending', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.calendar.createEvent.mockResolvedValue({
        ok: false,
        status: 403,
        error: 'Google Calendar API returned status 403',
      });

      await expect(
        h.service.accept(
          'req_1',
          { startsAt: START, durationMinutes: 60 },
          h.audit,
        ),
      ).rejects.toMatchObject({
        status: 502,
        response: { reason: 'calendar_event_failed' },
      });

      expect(h.prisma.sessionRequest.updateMany).not.toHaveBeenCalled();
      // Nothing to compensate — no event was created.
      expect(h.calendar.deleteEvent).not.toHaveBeenCalled();
    });

    it('ROW 3 — event created but NO Meet link ⇒ deleteEvent FIRST, then 502', async () => {
      // 🔴 `MemberSessionRequest.meetLink`'s docblock states that a `scheduled`
      // request with a null meetLink is UNREPRESENTABLE. This branch is what
      // makes that true rather than aspirational.
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.calendar.createEvent.mockResolvedValue({
        ok: true,
        status: 200,
        json: {
          ...EVENTS_INSERT_RESPONSE,
          hangoutLink: undefined,
          conferenceData: undefined,
        },
      });

      await expect(
        h.service.accept(
          'req_1',
          { startsAt: START, durationMinutes: 60 },
          h.audit,
        ),
      ).rejects.toMatchObject({
        status: 502,
        response: { reason: 'meet_link_unresolved' },
      });

      // 🔴 WITH THE ID THAT WAS CREATED.
      expect(h.calendar.deleteEvent).toHaveBeenCalledWith(CREATED_EVENT_ID);
      expect(h.prisma.sessionRequest.updateMany).not.toHaveBeenCalled();
    });

    it('ROW 4 — the DB write throws AFTER a successful create ⇒ the event is DELETED, then rethrown', async () => {
      // 🔴 §3.5 calls this "the only sequence that satisfies *no partial state
      // SHALL be persisted*". Written with a `$transaction` around both systems
      // the event would SURVIVE the rollback and the member would be invited to
      // a session the product has no record of.
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.prisma.sessionRequest.updateMany.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        h.service.accept(
          'req_1',
          { startsAt: START, durationMinutes: 60 },
          h.audit,
        ),
      ).rejects.toThrow('connection terminated unexpectedly');

      expect(h.calendar.deleteEvent).toHaveBeenCalledTimes(1);
      expect(h.calendar.deleteEvent).toHaveBeenCalledWith(CREATED_EVENT_ID);
    });

    it('ROW 4b — a P2002 on calendar_event_id ⇒ 409, and the orphan is deleted too (RISK-Y)', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.prisma.sessionRequest.updateMany.mockRejectedValue(
        prismaError('P2002'),
      );

      const failure = await h.service
        .accept('req_1', { startsAt: START, durationMinutes: 60 }, h.audit)
        .catch((e: unknown) => e);

      expect(failure).toMatchObject({
        status: 409,
        response: { reason: 'calendar_event_already_claimed' },
      });
      // A P2002 IS a database failure after a successful create, so the same
      // compensation applies — otherwise the losing admin leaves an orphan.
      expect(h.calendar.deleteEvent).toHaveBeenCalledWith(CREATED_EVENT_ID);
      // NFR-S7 — the constraint name never reaches the client.
      expect(JSON.stringify(failure)).not.toContain('calendar_event_id');
    });

    it('ROW 4c — a CONCURRENT accept loses on the status guard and compensates', async () => {
      // The status guard is in the `where`, so `count === 0` IS the answer and
      // there is no gap between the check and the write.
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.prisma.sessionRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        h.service.accept(
          'req_1',
          { startsAt: START, durationMinutes: 60 },
          h.audit,
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { reason: 'session_request_not_pending' },
      });

      expect(h.calendar.deleteEvent).toHaveBeenCalledWith(CREATED_EVENT_ID);
    });

    it('ROW 5 — success writes all four columns in ONE transaction, with the audit row in it', async () => {
      const h = wire();
      stubAcceptReads(h);

      const accepted = await h.service.accept(
        'req_1',
        { startsAt: START, durationMinutes: 60 },
        h.audit,
      );

      const update = h.prisma.sessionRequest.updateMany.mock.calls[0]?.[0];
      expect(update.where).toEqual({ id: 'req_1', status: 'pending' });
      expect(update.data).toEqual({
        status: 'scheduled',
        scheduledAt: START,
        durationMinutes: 60,
        calendarEventId: CREATED_EVENT_ID,
        meetLink: MEET_LINK,
      });

      // PRE-6 — the audit row rides the mutation's own tx.
      expect(h.auditCalls).toHaveLength(1);
      expect(h.auditCalls[0]?.tx).toBe(h.prisma);
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(h.calendar.deleteEvent).not.toHaveBeenCalled();
      expect(accepted.status).toBe('scheduled');
    });

    it('creates the event with a Meet link, the requester as guest, and a derived endsAt', async () => {
      const h = wire();
      stubAcceptReads(h);

      await h.service.accept(
        'req_1',
        { startsAt: START, durationMinutes: 90 },
        h.audit,
      );

      const input = h.calendar.createEvent.mock.calls[0]?.[0];
      expect(input).toMatchObject({
        createMeetLink: true,
        startsAt: START.toISOString(),
        endsAt: new Date(START.getTime() + 90 * 60 * 1000).toISOString(),
        // Lowercased, matching the provisioning fan-out's normalisation.
        attendees: ['member@example.com'],
      });
      // ⚠️ `sendUpdates` is left at the provider default (`'none'`): accepting a
      // request must not email the member from Google under the founder's name.
      expect(h.calendar.createEvent.mock.calls[0]?.[1]).toBeUndefined();
    });

    it('refuses a request that is not pending BEFORE creating any event', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(
        request({ status: 'scheduled' }),
      );

      await expect(
        h.service.accept(
          'req_1',
          { startsAt: START, durationMinutes: 60 },
          h.audit,
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { reason: 'session_request_not_pending' },
      });
      expect(h.calendar.createEvent).not.toHaveBeenCalled();
    });

    it('a compensating delete that FAILS does not replace the honest 502 with a 500', async () => {
      // The compensation runs inside a failure path that is already going to
      // answer the client. A second failure must be LOGGED, not surfaced.
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.calendar.createEvent.mockResolvedValue({
        ok: true,
        json: {
          ...EVENTS_INSERT_RESPONSE,
          hangoutLink: undefined,
          conferenceData: undefined,
        },
      });
      h.calendar.deleteEvent.mockRejectedValue(new Error('network down'));

      await expect(
        h.service.accept(
          'req_1',
          { startsAt: START, durationMinutes: 60 },
          h.audit,
        ),
      ).rejects.toMatchObject({
        status: 502,
        response: { reason: 'meet_link_unresolved' },
      });
    });

    it('treats a create response with NO event id as a create failure', async () => {
      // Without an id there is nothing to delete and nothing to persist, so it
      // cannot be treated as a success with a missing link.
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.calendar.createEvent.mockResolvedValue({
        ok: true,
        json: { status: 'confirmed' },
      });

      await expect(
        h.service.accept(
          'req_1',
          { startsAt: START, durationMinutes: 60 },
          h.audit,
        ),
      ).rejects.toMatchObject({
        response: { reason: 'calendar_event_failed' },
      });
      expect(h.calendar.deleteEvent).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* reschedule — R4.6                                                       */
  /* ---------------------------------------------------------------------- */

  describe('reschedule — R4.6', () => {
    const SCHEDULED = request({
      status: 'scheduled',
      scheduledAt: START,
      durationMinutes: 60,
      calendarEventId: CREATED_EVENT_ID,
      meetLink: MEET_LINK,
    });
    const MOVED = new Date('2026-08-13T15:00:00.000Z');

    it('🔴 patches the event BY THE PERSISTED id, never by (title, startsAt)', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(SCHEDULED);
      h.prisma.sessionRequest.update.mockResolvedValue(SCHEDULED);

      await h.service.reschedule('req_1', { startsAt: MOVED }, h.audit);

      expect(h.calendar.patchEvent).toHaveBeenCalledWith(CREATED_EVENT_ID, {
        startsAt: MOVED.toISOString(),
        // …and `endsAt` is rebuilt from the PERSISTED duration, without
        // re-reading Google.
        endsAt: new Date(MOVED.getTime() + 60 * 60 * 1000).toISOString(),
      });
    });

    it('writes nothing when the patch fails', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(SCHEDULED);
      h.calendar.patchEvent.mockResolvedValue({ ok: false, status: 500 });

      await expect(
        h.service.reschedule('req_1', { startsAt: MOVED }, h.audit),
      ).rejects.toMatchObject({
        response: { reason: 'calendar_event_failed' },
      });
      expect(h.prisma.sessionRequest.update).not.toHaveBeenCalled();
    });

    it('does NOT clear a working meetLink when the patch response carries none', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(SCHEDULED);
      h.prisma.sessionRequest.update.mockResolvedValue(SCHEDULED);
      h.calendar.patchEvent.mockResolvedValue({
        ok: true,
        json: { id: CREATED_EVENT_ID },
      });

      await h.service.reschedule('req_1', { startsAt: MOVED }, h.audit);

      const data = h.prisma.sessionRequest.update.mock.calls[0]?.[0].data;
      expect(Object.keys(data)).not.toContain('meetLink');
    });

    it('🔴 a `scheduled` row with a NULL calendarEventId is a named refusal, not a silent no-op', async () => {
      // Unreachable through this service — accept writes both or neither — so
      // reaching it means the row was edited outside the API. A `createEvent`
      // fallback would mint a SECOND event for one request.
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(
        request({ status: 'scheduled', calendarEventId: null }),
      );

      await expect(
        h.service.reschedule('req_1', { startsAt: MOVED }, h.audit),
      ).rejects.toMatchObject({
        status: 409,
        response: { reason: 'calendar_event_missing' },
      });
      expect(h.calendar.createEvent).not.toHaveBeenCalled();
      expect(h.calendar.patchEvent).not.toHaveBeenCalled();
    });

    it('refuses to guess a length when none was recorded', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(
        request({
          status: 'scheduled',
          calendarEventId: CREATED_EVENT_ID,
          durationMinutes: null,
        }),
      );

      await expect(
        h.service.reschedule('req_1', { startsAt: MOVED }, h.audit),
      ).rejects.toMatchObject({
        response: { reason: 'session_duration_unknown' },
      });
    });

    it('feature-off ⇒ 503, nothing patched, nothing written', async () => {
      const h = wire(false);

      await expect(
        h.service.reschedule('req_1', { startsAt: MOVED }, h.audit),
      ).rejects.toMatchObject({
        status: 503,
        response: { reason: 'scheduling_unavailable' },
      });
      expect(h.prisma.sessionRequest.findUnique).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* decline — R4.7, R4.8                                                    */
  /* ---------------------------------------------------------------------- */

  describe('decline — R4.7, R4.8', () => {
    it('declines a PENDING request with NO calendar call at all — so it works with Google off', async () => {
      // 🔴 Exit-gate clause 2 requires an admin to be able to run the queue with
      // the integration off. Refusing to decline would leave every request in
      // this workspace stuck pending for ever.
      const h = wire(false);
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.prisma.sessionRequest.update.mockResolvedValue(PENDING_ROW);

      await h.service.decline(
        'req_1',
        { declineReason: 'Fully booked' },
        h.audit,
      );

      expect(h.calendar.deleteEvent).not.toHaveBeenCalled();
      expect(h.prisma.sessionRequest.update.mock.calls[0]?.[0].data).toEqual({
        status: 'canceled',
        declineReason: 'Fully booked',
        calendarEventId: null,
        meetLink: null,
      });
      expect(h.auditCalls[0]?.tx).toBe(h.prisma);
    });

    it('deletes the event when the request was already SCHEDULED', async () => {
      const h = wire();
      const scheduled = request({
        status: 'scheduled',
        calendarEventId: CREATED_EVENT_ID,
        meetLink: MEET_LINK,
      });
      h.prisma.sessionRequest.findUnique.mockResolvedValue(scheduled);
      h.prisma.sessionRequest.update.mockResolvedValue(scheduled);

      await h.service.decline('req_1', {}, h.audit);

      expect(h.calendar.deleteEvent).toHaveBeenCalledWith(CREATED_EVENT_ID);
      // 🔴 The claim is RELEASED, or AD-2's `@unique` would hold against an
      // event that no longer exists.
      expect(
        h.prisma.sessionRequest.update.mock.calls[0]?.[0].data,
      ).toMatchObject({ calendarEventId: null, meetLink: null });
    });

    it('treats 410 Gone as idempotent success, not a failure', async () => {
      const h = wire();
      const scheduled = request({
        status: 'scheduled',
        calendarEventId: CREATED_EVENT_ID,
      });
      h.prisma.sessionRequest.findUnique.mockResolvedValue(scheduled);
      h.prisma.sessionRequest.update.mockResolvedValue(scheduled);
      h.calendar.deleteEvent.mockResolvedValue({ ok: false, status: 410 });

      await h.service.decline('req_1', {}, h.audit);

      expect(h.prisma.sessionRequest.update).toHaveBeenCalledTimes(1);
    });

    it('writes nothing when the delete genuinely fails', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(
        request({ status: 'scheduled', calendarEventId: CREATED_EVENT_ID }),
      );
      h.calendar.deleteEvent.mockResolvedValue({ ok: false, status: 500 });

      await expect(
        h.service.decline('req_1', {}, h.audit),
      ).rejects.toMatchObject({
        response: { reason: 'calendar_event_failed' },
      });
      expect(h.prisma.sessionRequest.update).not.toHaveBeenCalled();
    });

    it('refuses to decline an already-canceled request', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(
        request({ status: 'canceled' }),
      );

      await expect(
        h.service.decline('req_1', {}, h.audit),
      ).rejects.toMatchObject({
        response: { reason: 'session_request_already_closed' },
      });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* listQueue — R4.4                                                        */
  /* ---------------------------------------------------------------------- */

  describe('listQueue — R4.4', () => {
    it('orders OLDEST FIRST and joins the requester in one query', async () => {
      const h = wire();
      h.prisma.sessionRequest.findMany.mockResolvedValue([PENDING_ROW]);

      await h.service.listQueue({ status: 'pending' });

      const call = h.prisma.sessionRequest.findMany.mock.calls[0]?.[0];
      expect(call).toMatchObject({
        where: { status: 'pending' },
        orderBy: [{ createdAt: 'asc' }],
      });
      expect(h.prisma.sessionRequest.findMany).toHaveBeenCalledTimes(1);
    });

    it('selects FOUR requester columns, not `user: true`', async () => {
      // `include: { user: true }` would pull `workosId`, `paddleCustomerId` and
      // `circleMemberId` into an object the admin surface serialises — and the
      // contract would not complain, because a wider object still satisfies a
      // narrower interface structurally.
      const h = wire();
      h.prisma.sessionRequest.findMany.mockResolvedValue([]);

      await h.service.listQueue();

      expect(
        h.prisma.sessionRequest.findMany.mock.calls[0]?.[0].include,
      ).toEqual({
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      });
    });

    it('an omitted status filter reads the whole queue', async () => {
      const h = wire();
      h.prisma.sessionRequest.findMany.mockResolvedValue([]);

      await h.service.listQueue();

      expect(h.prisma.sessionRequest.findMany.mock.calls[0]?.[0].where).toEqual(
        {},
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /* RISK-X                                                                  */
  /* ---------------------------------------------------------------------- */

  describe('RISK-X — every status literal is pinned to the shared vocabulary', () => {
    it('writes only values from SESSION_REQUEST_STATUSES', async () => {
      // `status` is a bare Postgres String, so a typo'd `'sheduled'` writes
      // cleanly and is invisible until a member's request stops appearing
      // anywhere. The compile-time pin is `satisfies SessionRequestStatus`;
      // this is the runtime half, over every write this service performs.
      const h = wire();
      stubAcceptReads(h);
      await h.service.accept(
        'req_1',
        { startsAt: START, durationMinutes: 60 },
        h.audit,
      );

      h.prisma.sessionRequest.findUnique.mockReset();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.prisma.sessionRequest.update.mockResolvedValue(PENDING_ROW);
      await h.service.cancelOwn(CTX, 'req_1');
      await h.service.decline('req_1', {}, h.audit);

      h.prisma.sessionRequest.create.mockResolvedValue(PENDING_ROW);
      await h.service.submit(CTX, { sessionTopicId: 't' });

      const written = [
        ...h.prisma.sessionRequest.updateMany.mock.calls,
        ...h.prisma.sessionRequest.update.mock.calls,
        ...h.prisma.sessionRequest.create.mock.calls,
      ]
        .map((call) => call[0]?.data?.status)
        .filter((status): status is string => typeof status === 'string');

      expect(written.length).toBeGreaterThanOrEqual(4);
      expect([...new Set(written)].sort()).toEqual([
        'canceled',
        'pending',
        'scheduled',
      ]);
    });
  });
});

/**
 * A `PrismaClientKnownRequestError` the service's `instanceof` check accepts.
 *
 * 🔴 `Prisma` IS A STATIC IMPORT, NOT A `require()` — see the identical note in
 * `live-sessions.service.spec.ts`. Batch 11's F-1 is twelve
 * `@nx/enforce-module-boundaries` errors caused by one `require('@ptah-api/core')`
 * in a sibling lib's spec.
 */
function prismaError(code: string): Error {
  const error = Object.assign(
    new Error(
      'Unique constraint failed on the fields: (`calendar_event_id`) on table `session_requests`',
    ),
    { code, clientVersion: '7.7.0' },
  );
  Object.setPrototypeOf(
    error,
    Prisma.PrismaClientKnownRequestError.prototype as object,
  );
  return error;
}
