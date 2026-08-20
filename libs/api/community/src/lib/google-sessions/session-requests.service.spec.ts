import { Prisma } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type { NotificationsService } from '@ptah-api/notifications';

import {
  asPrismaService,
  createMockPrisma,
  type MockCommunityPrisma,
} from '../../testing/mock-community-prisma';

import type { GoogleCalendarProvider } from './google-calendar.provider';
import {
  SCHEDULING_UNAVAILABLE,
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
  /** The Phase-5 producer's collaborator — see {@link wire}. */
  notify: jest.Mock;
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

  // TASK_2026_177 Phase 5 — `session_request.status`. A bare `jest.fn()`: R10.2
  // belongs to `NotificationsService.create` and is asserted in that lib. What
  // THIS file asserts is what the producer hands it, and — for B12's F-1 — that
  // it is not called at all on the `503` branch.
  const notify = jest.fn().mockResolvedValue('notif-1');

  return {
    prisma,
    calendar,
    notify,
    service: new SessionRequestsService(
      asPrismaService(prisma),
      calendar as unknown as GoogleCalendarProvider,
      { create: notify } as unknown as NotificationsService,
    ),
    auditCalls,
    audit: async (tx, targetId) => {
      auditCalls.push({ tx, targetId });
    },
  };
}

/**
 * Every write verb on `sessionRequest`, so "the DB row is untouched" can be
 * asserted as an ABSENCE OF ALL OF THEM rather than of the one the reader
 * happened to think of.
 *
 * ⚠️ THIS IS THE DIFFERENCE BETWEEN B12's F-1 AND ITS CLOSURE. Asserting
 * `update` was not called leaves `updateMany`, `upsert`, `delete` and
 * `deleteMany` unchecked — and `accept`'s real write IS an `updateMany`, so the
 * obvious assertion is the one that proves the least.
 */
const WRITE_VERBS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
] as const;

function writesAttempted(h: Harness): string[] {
  return WRITE_VERBS.filter(
    (verb) => h.prisma.sessionRequest[verb].mock.calls.length > 0,
  );
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

  /* ---------------------------------------------------------------------- */
  /* 🔴 B12's F-1 / B13's F-7 — CLOSED HERE (TASK_2026_177 Task 14.14)        */
  /* ---------------------------------------------------------------------- */

  /**
   * 🔴 THE FINDING, AND WHY IT SURVIVED TWO BATCHES.
   *
   * B12 recorded that the `503 scheduling_unavailable` branch was never
   * exercised. B13 tried to close it from the client with `page.route()` and
   * B13's own F-7 correctly recorded that this cannot work: a client stub
   * fabricates the RESPONSE, so it proves the browser handles a `503` and says
   * nothing whatever about whether the server produces one, or about what the
   * server did to the database on the way there. F-7 named the fix — "a
   * server-side test that stubs the provider", belonging to "whoever next
   * touches `session-requests.service.ts`". That is this change.
   *
   * ⚠️ GROUND TRUTH 7: `SCHEDULING_UNAVAILABLE` HAS **THREE** CALL SITES, AND
   * B12's F-1 NAMED ONLY `accept`. All three are exercised below, and
   * `decline`'s is the one that is easy to miss twice: it is nested inside
   * `if (request.calendarEventId !== null)`, AFTER `requireOpen`, so a PENDING
   * request declines perfectly well with Google off. A fixture that forgot the
   * event id would take the happy path and the test would pass having proved
   * the opposite of what it claims.
   *
   * FOUR THINGS ARE ASSERTED PER METHOD, and the third is the one B12 asked for:
   *   1. the reason is `SCHEDULING_UNAVAILABLE`;
   *   2. the status is `503`;
   *   3. 🔴 THE DB ROW IS UNTOUCHED — no `create`/`update`/`updateMany`/
   *      `upsert`/`delete`/`deleteMany`, and no `$transaction` at all;
   *   4. no notification was created.
   */
  describe("🔴 B12's F-1 — the 503 branch, SERVER-SIDE, on all three methods", () => {
    /**
     * A request row shaped so that EACH method reaches its own
     * `SCHEDULING_UNAVAILABLE` guard rather than an earlier refusal.
     *
     * - `accept` guards FIRST, before any read, so any row works;
     * - `reschedule` needs `status: 'scheduled'` with a non-null
     *   `calendarEventId`, or `requireScheduled` refuses with a `409` first;
     * - `decline` needs a non-null `calendarEventId`, or it takes the
     *   no-calendar-call path and SUCCEEDS.
     */
    const SCHEDULED_WITH_EVENT = request({
      status: 'scheduled',
      scheduledAt: START,
      durationMinutes: 60,
      calendarEventId: CREATED_EVENT_ID,
      meetLink: MEET_LINK,
    });

    const CASES = [
      {
        method: 'accept' as const,
        run: (h: Harness) =>
          h.service.accept(
            'req_1',
            { startsAt: START, durationMinutes: 60 },
            h.audit,
          ),
      },
      {
        method: 'reschedule' as const,
        run: (h: Harness) =>
          h.service.reschedule('req_1', { startsAt: START }, h.audit),
      },
      {
        method: 'decline' as const,
        run: (h: Harness) =>
          h.service.decline('req_1', { declineReason: 'no' }, h.audit),
      },
    ];

    it.each(CASES)(
      '$method — 503 { reason: scheduling_unavailable }, DB row UNTOUCHED, no notification',
      async ({ run }) => {
        // 🔴 THE DOUBLE B13's F-7 NAMED: `isEnabled()` returns `false`. This is
        // the real server branch, reached through the real method.
        const h = wire(false);
        h.prisma.sessionRequest.findUnique.mockResolvedValue(
          SCHEDULED_WITH_EVENT,
        );

        await expect(run(h)).rejects.toMatchObject({
          status: 503,
          response: { reason: SCHEDULING_UNAVAILABLE },
        });

        // (3) — the clause B12 asked for, over EVERY write verb.
        expect(writesAttempted(h)).toEqual([]);
        expect(h.prisma.$transaction).not.toHaveBeenCalled();

        // (4)
        expect(h.notify).not.toHaveBeenCalled();

        // …and nothing was said to Google either: the guard is BEFORE the
        // integration call in all three, which is why "nothing was written" is
        // true rather than merely untested.
        expect(h.calendar.createEvent).not.toHaveBeenCalled();
        expect(h.calendar.patchEvent).not.toHaveBeenCalled();
        expect(h.calendar.deleteEvent).not.toHaveBeenCalled();
      },
    );

    it('🔴 the machine reason is the exported constant, not a hand-typed string', () => {
      // The admin UI matches on this value. A test asserting the literal
      // 'scheduling_unavailable' would keep passing after a rename that broke
      // every screen reading it.
      expect(SCHEDULING_UNAVAILABLE).toBe('scheduling_unavailable');
    });

    it('🔴 decline of a PENDING request still WORKS with Google off — the branch is conditional', async () => {
      // THE CONTROL FOR THE `decline` CASE ABOVE, and the reason its fixture
      // carries an event id. Without this, a `decline` that refused
      // unconditionally would pass the `503` assertion and would have broken the
      // one thing `decline`'s docblock promises: that an admin can still run the
      // queue in a workspace where `GOOGLE_OAUTH_*` is unset.
      const h = wire(false);
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.prisma.sessionRequest.update.mockResolvedValue({});

      await expect(
        h.service.decline('req_1', { declineReason: 'not now' }, h.audit),
      ).resolves.toBeDefined();

      expect(h.calendar.deleteEvent).not.toHaveBeenCalled();
      // And the member IS told, even though Google is off.
      expect(h.notify).toHaveBeenCalledTimes(1);
    });

    it('🔴 the three happy paths still produce their transitions — paired, so one cannot be fixed by breaking the other', async () => {
      // Task 14.14's validation note: the `503` case and the happy path are
      // asserted as a PAIR per method. A service that threw
      // `SCHEDULING_UNAVAILABLE` unconditionally would pass every assertion in
      // the `it.each` above.
      const accepted = wire(true);
      stubAcceptReads(accepted);
      await expect(
        accepted.service.accept(
          'req_1',
          { startsAt: START, durationMinutes: 60 },
          accepted.audit,
        ),
      ).resolves.toBeDefined();

      const moved = wire(true);
      moved.prisma.sessionRequest.findUnique.mockResolvedValue(
        SCHEDULED_WITH_EVENT,
      );
      moved.prisma.sessionRequest.update.mockResolvedValue({});
      await expect(
        moved.service.reschedule('req_1', { startsAt: START }, moved.audit),
      ).resolves.toBeDefined();

      const declined = wire(true);
      declined.prisma.sessionRequest.findUnique.mockResolvedValue(
        SCHEDULED_WITH_EVENT,
      );
      declined.prisma.sessionRequest.update.mockResolvedValue({});
      await expect(
        declined.service.decline(
          'req_1',
          { declineReason: 'no' },
          declined.audit,
        ),
      ).resolves.toBeDefined();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* TASK_2026_177 Task 14.14 — the `session_request.status` producer          */
  /* ---------------------------------------------------------------------- */

  describe('🔴 R10.1 — session_request.status', () => {
    const SCHEDULED_WITH_EVENT = request({
      status: 'scheduled',
      scheduledAt: START,
      durationMinutes: 60,
      calendarEventId: CREATED_EVENT_ID,
      meetLink: MEET_LINK,
    });

    it('accept notifies the request OWNER, with a null actor', async () => {
      const h = wire();
      stubAcceptReads(h);

      await h.service.accept(
        'req_1',
        { startsAt: START, durationMinutes: 60 },
        h.audit,
      );

      expect(h.notify).toHaveBeenCalledTimes(1);
      expect(h.notify.mock.calls[0]?.[0]).toEqual({
        recipientId: 'user_1',
        // 🔴 `null`, NOT THE ACTING ADMIN. See the service docblock: the
        // admin's identity is internal, and `actorName` is member-facing.
        actorId: null,
        kind: 'session_request.status',
        targetType: 'SessionRequest',
        targetId: 'req_1',
        title: 'Your session request was scheduled',
        bodyPreview: null,
        route: '/members/live/request',
        // 🔴 NO `tx` — accept is the ONE producer that does not enlist.
        tx: undefined,
      });
    });

    it('🔴 accept does NOT enlist, and a failed notification does not undo the acceptance (RISK-U)', async () => {
      // THE ASSERTION THAT MATTERS MOST IN THIS FILE. A notification write
      // inside `accept`'s `try` would reach the compensating `deleteEvent` and
      // DELETE A REAL CALENDAR EVENT the member is already invited to.
      const h = wire();
      stubAcceptReads(h);
      h.notify.mockRejectedValue(new Error('notification exploded'));

      await expect(
        h.service.accept(
          'req_1',
          { startsAt: START, durationMinutes: 60 },
          h.audit,
        ),
      ).resolves.toBeDefined();

      // The event survives: no compensation ran.
      expect(h.calendar.deleteEvent).not.toHaveBeenCalled();
      // And the row was written.
      expect(h.prisma.sessionRequest.updateMany).toHaveBeenCalledTimes(1);
    });

    it('reschedule ENLISTS, and a failed notification rolls the move back', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(
        SCHEDULED_WITH_EVENT,
      );
      h.prisma.sessionRequest.update.mockResolvedValue({});

      await h.service.reschedule('req_1', { startsAt: START }, h.audit);
      expect(h.notify.mock.calls[0]?.[0]).toMatchObject({
        title: 'Your session was moved to a new time',
        // The SAME client the mutation used, so the two commit together.
        tx: h.prisma,
      });

      const failing = wire();
      failing.prisma.sessionRequest.findUnique.mockResolvedValue(
        SCHEDULED_WITH_EVENT,
      );
      failing.prisma.sessionRequest.update.mockResolvedValue({});
      failing.notify.mockRejectedValue(new Error('notification exploded'));
      await expect(
        failing.service.reschedule('req_1', { startsAt: START }, failing.audit),
      ).rejects.toThrow('notification exploded');
    });

    it('🔴 decline carries declineReason into bodyPreview (R4.8), enlisted', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(
        SCHEDULED_WITH_EVENT,
      );
      h.prisma.sessionRequest.update.mockResolvedValue({});

      await h.service.decline(
        'req_1',
        { declineReason: 'That week is fully booked — try the following one.' },
        h.audit,
      );

      expect(h.notify.mock.calls[0]?.[0]).toMatchObject({
        title: 'Your session request was declined',
        bodyPreview: 'That week is fully booked — try the following one.',
        tx: h.prisma,
      });
    });

    it('a decline with no reason carries a null preview, never the empty string', async () => {
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(
        SCHEDULED_WITH_EVENT,
      );
      h.prisma.sessionRequest.update.mockResolvedValue({});

      await h.service.decline('req_1', {}, h.audit);

      expect(h.notify.mock.calls[0]?.[0]).toMatchObject({ bodyPreview: null });
    });

    it('🔴 cancelOwn produces NOTHING — no producer is wired there at all', async () => {
      // R10.2 would suppress it anyway (the actor IS the recipient); the point
      // is that the suppression is not what is keeping the row out. A future
      // change to `create()` must not be able to make this path start writing.
      const h = wire();
      h.prisma.sessionRequest.findUnique.mockResolvedValue(PENDING_ROW);
      h.prisma.sessionRequest.update.mockResolvedValue({});

      await h.service.cancelOwn(CTX, 'req_1');

      expect(h.notify).not.toHaveBeenCalled();
    });

    it('submit produces NOTHING either', async () => {
      const h = wire();
      h.prisma.sessionRequest.create.mockResolvedValue(PENDING_ROW);

      await h.service.submit(CTX, {
        sessionTopicId: 'architecture-review',
      });

      expect(h.notify).not.toHaveBeenCalled();
    });

    it('🔴 all three routes come from buildNotificationRoute and start with /members/ (RISK-AJ)', async () => {
      const routes: string[] = [];
      for (const build of [
        async (h: Harness) => {
          stubAcceptReads(h);
          await h.service.accept(
            'req_1',
            { startsAt: START, durationMinutes: 60 },
            h.audit,
          );
        },
        async (h: Harness) => {
          h.prisma.sessionRequest.findUnique.mockResolvedValue(
            SCHEDULED_WITH_EVENT,
          );
          h.prisma.sessionRequest.update.mockResolvedValue({});
          await h.service.reschedule('req_1', { startsAt: START }, h.audit);
        },
        async (h: Harness) => {
          h.prisma.sessionRequest.findUnique.mockResolvedValue(
            SCHEDULED_WITH_EVENT,
          );
          h.prisma.sessionRequest.update.mockResolvedValue({});
          await h.service.decline('req_1', {}, h.audit);
        },
      ]) {
        const h = wire();
        await build(h);
        routes.push(h.notify.mock.calls[0]?.[0].route);
      }

      // One destination for all three, and it is a literal in the route table —
      // there is no member-supplied segment in a `SessionRequest` route to
      // encode, which is why this one cannot be made hostile.
      expect(routes).toEqual([
        '/members/live/request',
        '/members/live/request',
        '/members/live/request',
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
