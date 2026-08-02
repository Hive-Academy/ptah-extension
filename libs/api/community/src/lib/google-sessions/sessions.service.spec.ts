/**
 * Unit tests for `SessionsService`.
 *
 * Focus:
 *   1. Read path mapping: Google events → the { id, title, startsAt, endsAt,
 *      meetLink, recurring } contract shape (hangoutLink + conferenceData +
 *      all-day + recurrence detection + cancelled filtering).
 *   2. Feature-off: Google disabled → [] with no calendar call (logged once).
 *   3. Write path: attendee add/remove read-modify-write, event-id gate, and
 *      non-fatal failure (never throws, audits the failure).
 *   4. COHORT AWARENESS: the event is resolved per user (cohort → env var →
 *      skip), the read path hides other cohorts' series, and every cohort
 *      lookup degrades to the pre-cohort behaviour instead of throwing.
 */

import { ConfigService } from '@nestjs/config';
import { SessionsService } from './sessions.service';
import type { GoogleCalendarProvider } from './google-calendar.provider';
import type { AuditLogService } from '@ptah-api/audit';
import type { MemberGroupsService } from '../member-groups/member-groups.service';

/** The caller every test resolves sessions/attendance for. */
const USER = 'usr_1';

interface CalendarMock {
  isEnabled: jest.Mock<boolean, []>;
  listEvents: jest.Mock;
  patchEventAttendees: jest.Mock;
}

interface AuditMock {
  write: jest.Mock;
}

interface GroupsMock {
  getSessionEventIdForUser: jest.Mock;
  listSessionEventIds: jest.Mock;
}

function createCalendarMock(enabled = true): CalendarMock {
  return {
    isEnabled: jest.fn().mockReturnValue(enabled),
    listEvents: jest.fn(),
    patchEventAttendees: jest.fn(),
  };
}

function createAuditMock(): AuditMock {
  return { write: jest.fn().mockResolvedValue('audit-id') };
}

/**
 * A bound `MemberGroupsService`. Omitting it from `build` models the
 * @Optional() collaborator being unbound, which is the pre-cohort world.
 */
function createGroupsMock(
  opts: { forUser?: string | null; all?: string[] } = {},
): GroupsMock {
  return {
    getSessionEventIdForUser: jest.fn().mockResolvedValue(opts.forUser ?? null),
    listSessionEventIds: jest.fn().mockResolvedValue(opts.all ?? []),
  };
}

function build(
  calendar: CalendarMock,
  audit: AuditMock,
  config: Record<string, unknown> = {},
  groups?: GroupsMock,
): SessionsService {
  const configService = {
    get: (key: string): unknown => config[key],
  } as unknown as ConfigService;
  return new SessionsService(
    configService,
    calendar as unknown as GoogleCalendarProvider,
    audit as unknown as AuditLogService,
    groups as unknown as MemberGroupsService | undefined,
  );
}

describe('SessionsService', () => {
  /**
   * ⚠️ The customer-list guard, asserted at the METHOD THE MEMBER ENDPOINT
   * ACTUALLY CALLS rather than at the mapper it happens to delegate to.
   *
   * The Google events this service reads carry the full guest list — every
   * paying member's email address is on the recurring series, put there by the
   * provisioning fan-out. `GET /api/v1/members/sessions` returns whatever this
   * method returns, straight onto the wire, to any Builders member. A mapper
   * test proves the mapper is safe; this proves the PATH is, and would still
   * fail if someone swapped in a different mapper or spread the raw event.
   */
  describe('⚠️ the member path never returns anyone’s email address', () => {
    it('drops the guest list from a heavily-attended session', async () => {
      const calendar = createCalendarMock(true);
      calendar.listEvents.mockResolvedValue({
        ok: true,
        json: {
          items: [
            {
              id: 'evt_1',
              summary: 'Builders Office Hours',
              start: { dateTime: '2026-07-20T17:00:00Z' },
              end: { dateTime: '2026-07-20T18:00:00Z' },
              attendees: [
                { email: 'paying.customer@example.com' },
                { email: 'another.customer@example.com' },
                { email: 'founder@ptah.live', organizer: true },
              ],
            },
          ],
        },
      });

      const sessions = await build(
        calendar,
        createAuditMock(),
      ).listUpcomingSessions(USER);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).not.toHaveProperty('attendees');
      // Substring, not key-shape: an address smuggled into `title` or
      // `description` would be the same leak through a different door.
      expect(JSON.stringify(sessions)).not.toContain('@example.com');
      expect(JSON.stringify(sessions)).not.toContain('@ptah.live');
    });
  });

  describe('listUpcomingSessions', () => {
    it('maps Google events to the members contract shape', async () => {
      const calendar = createCalendarMock(true);
      calendar.listEvents.mockResolvedValue({
        ok: true,
        json: {
          items: [
            {
              id: 'evt_recurring_instance',
              summary: 'Builders Office Hours',
              status: 'confirmed',
              hangoutLink: 'https://meet.google.com/abc-defg-hij',
              recurringEventId: 'evt_master',
              start: { dateTime: '2026-07-20T17:00:00Z' },
              end: { dateTime: '2026-07-20T18:00:00Z' },
            },
            {
              id: 'evt_oneoff_conf',
              summary: 'Special AMA',
              start: { dateTime: '2026-07-25T15:00:00Z' },
              end: { dateTime: '2026-07-25T16:00:00Z' },
              conferenceData: {
                entryPoints: [
                  { entryPointType: 'phone', uri: 'tel:+123' },
                  {
                    entryPointType: 'video',
                    uri: 'https://meet.google.com/xyz-1234-abc',
                  },
                ],
              },
            },
            {
              id: 'evt_allday_norecur',
              summary: 'All Day Thing',
              start: { date: '2026-08-01' },
              end: { date: '2026-08-02' },
            },
          ],
        },
      });
      const audit = createAuditMock();

      const sessions = await build(calendar, audit).listUpcomingSessions(USER);

      expect(sessions).toEqual([
        {
          id: 'evt_recurring_instance',
          title: 'Builders Office Hours',
          startsAt: '2026-07-20T17:00:00.000Z',
          endsAt: '2026-07-20T18:00:00.000Z',
          meetLink: 'https://meet.google.com/abc-defg-hij',
          recurring: true,
        },
        {
          id: 'evt_oneoff_conf',
          title: 'Special AMA',
          startsAt: '2026-07-25T15:00:00.000Z',
          endsAt: '2026-07-25T16:00:00.000Z',
          meetLink: 'https://meet.google.com/xyz-1234-abc',
          recurring: false,
        },
        {
          id: 'evt_allday_norecur',
          title: 'All Day Thing',
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2026-08-02T00:00:00.000Z',
          meetLink: null,
          recurring: false,
        },
      ]);

      // 60-day lookahead window is passed to the provider.
      const [timeMin, timeMax] = calendar.listEvents.mock.calls[0] as [
        Date,
        Date,
      ];
      const spanDays =
        (timeMax.getTime() - timeMin.getTime()) / (24 * 60 * 60 * 1000);
      expect(Math.round(spanDays)).toBe(60);
    });

    it('filters out cancelled events and events without a resolvable time', async () => {
      const calendar = createCalendarMock(true);
      calendar.listEvents.mockResolvedValue({
        ok: true,
        json: {
          items: [
            { id: 'cancelled', status: 'cancelled', start: {}, end: {} },
            { id: 'no-times', summary: 'x' },
            {
              id: 'ok',
              summary: 'Keep',
              start: { dateTime: '2026-07-20T17:00:00Z' },
              end: { dateTime: '2026-07-20T18:00:00Z' },
            },
          ],
        },
      });

      const sessions = await build(
        calendar,
        createAuditMock(),
      ).listUpcomingSessions(USER);

      expect(sessions.map((s) => s.id)).toEqual(['ok']);
    });

    it('returns [] and does not call the calendar when Google is disabled', async () => {
      const calendar = createCalendarMock(false);
      const audit = createAuditMock();

      const sessions = await build(calendar, audit).listUpcomingSessions(USER);

      expect(sessions).toEqual([]);
      expect(calendar.listEvents).not.toHaveBeenCalled();
    });

    it('returns [] (non-fatal) when the calendar list call fails', async () => {
      const calendar = createCalendarMock(true);
      calendar.listEvents.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Google Calendar API returned status 500',
      });

      const sessions = await build(
        calendar,
        createAuditMock(),
      ).listUpcomingSessions(USER);

      expect(sessions).toEqual([]);
    });
  });

  /**
   * The two-cohort read path. Fixture models a calendar carrying an English
   * series, an Arabic series (each expanded into instances by singleEvents) and
   * a generic AMA belonging to no cohort.
   */
  describe('listUpcomingSessions — cohort scoping', () => {
    const EN_MASTER = 'evt_english_master';
    const AR_MASTER = 'evt_arabic_master';

    function calendarWithBothCohorts(): CalendarMock {
      const calendar = createCalendarMock(true);
      calendar.listEvents.mockResolvedValue({
        ok: true,
        json: {
          items: [
            {
              id: `${EN_MASTER}_20260805T140000Z`,
              summary: 'English session',
              recurringEventId: EN_MASTER,
              start: { dateTime: '2026-08-05T14:00:00Z' },
              end: { dateTime: '2026-08-05T15:00:00Z' },
            },
            {
              id: `${AR_MASTER}_20260806T140000Z`,
              summary: 'Arabic session',
              recurringEventId: AR_MASTER,
              start: { dateTime: '2026-08-06T14:00:00Z' },
              end: { dateTime: '2026-08-06T15:00:00Z' },
            },
            {
              id: 'evt_generic_ama',
              summary: 'Guest AMA',
              start: { dateTime: '2026-08-07T14:00:00Z' },
              end: { dateTime: '2026-08-07T15:00:00Z' },
            },
          ],
        },
      });
      return calendar;
    }

    it("hides another cohort's EXPANDED INSTANCES while keeping generic events", async () => {
      const calendar = calendarWithBothCohorts();
      const groups = createGroupsMock({
        forUser: AR_MASTER,
        all: [EN_MASTER, AR_MASTER],
      });

      const sessions = await build(
        calendar,
        createAuditMock(),
        {},
        groups,
      ).listUpcomingSessions(USER);

      // The Arabic member keeps their own series and the un-cohorted AMA, and
      // never sees the English one — matched via recurringEventId, since the
      // listed ids are instance ids that never equal the stored master id.
      expect(sessions.map((s) => s.id)).toEqual([
        `${AR_MASTER}_20260806T140000Z`,
        'evt_generic_ama',
      ]);
    });

    it("hides another cohort's MASTER row when the calendar returns one", async () => {
      const calendar = createCalendarMock(true);
      calendar.listEvents.mockResolvedValue({
        ok: true,
        json: {
          items: [
            {
              id: EN_MASTER,
              summary: 'English master',
              recurrence: ['RRULE:FREQ=WEEKLY'],
              start: { dateTime: '2026-08-05T14:00:00Z' },
              end: { dateTime: '2026-08-05T15:00:00Z' },
            },
            {
              id: AR_MASTER,
              summary: 'Arabic master',
              recurrence: ['RRULE:FREQ=WEEKLY'],
              start: { dateTime: '2026-08-06T14:00:00Z' },
              end: { dateTime: '2026-08-06T15:00:00Z' },
            },
          ],
        },
      });
      const groups = createGroupsMock({
        forUser: EN_MASTER,
        all: [EN_MASTER, AR_MASTER],
      });

      const sessions = await build(
        calendar,
        createAuditMock(),
        {},
        groups,
      ).listUpcomingSessions(USER);

      expect(sessions.map((s) => s.id)).toEqual([EN_MASTER]);
    });

    it('leaves the listing untouched when NO cohort configures an event (back-compat)', async () => {
      const calendar = calendarWithBothCohorts();
      const groups = createGroupsMock({ forUser: null, all: [] });

      const sessions = await build(
        calendar,
        createAuditMock(),
        { BUILDERS_SESSION_EVENT_ID: EN_MASTER },
        groups,
      ).listUpcomingSessions(USER);

      // Every event, exactly as before cohorts existed — including the series
      // the env var names, which was never used to filter this list.
      expect(sessions).toHaveLength(3);
      // Short-circuits before it needs to know whose cohort the caller is in.
      expect(groups.getSessionEventIdForUser).not.toHaveBeenCalled();
    });

    it('falls back to the env var to decide which cohort series is "own"', async () => {
      const calendar = calendarWithBothCohorts();
      // The caller belongs to no cohort with an event; BUILDERS_SESSION_EVENT_ID
      // names the English series, so English stays and Arabic is hidden.
      const groups = createGroupsMock({
        forUser: null,
        all: [EN_MASTER, AR_MASTER],
      });

      const sessions = await build(
        calendar,
        createAuditMock(),
        { BUILDERS_SESSION_EVENT_ID: EN_MASTER },
        groups,
      ).listUpcomingSessions(USER);

      expect(sessions.map((s) => s.id)).toEqual([
        `${EN_MASTER}_20260805T140000Z`,
        'evt_generic_ama',
      ]);
    });

    it('lists unscoped (never throws) when the cohort lookup fails', async () => {
      const calendar = calendarWithBothCohorts();
      const groups = createGroupsMock();
      groups.listSessionEventIds.mockRejectedValue(new Error('db down'));

      const sessions = await build(
        calendar,
        createAuditMock(),
        {},
        groups,
      ).listUpcomingSessions(USER);

      // Degrades towards SHOWING sessions, not towards hiding them.
      expect(sessions).toHaveLength(3);
    });

    it('lists unscoped when MemberGroupsService is unbound', async () => {
      const calendar = calendarWithBothCohorts();

      const sessions = await build(
        calendar,
        createAuditMock(),
      ).listUpcomingSessions(USER);

      expect(sessions).toHaveLength(3);
    });
  });

  describe('addMemberToSessions / removeMemberFromSessions', () => {
    const EVENT = { BUILDERS_SESSION_EVENT_ID: 'evt_master' };

    it('adds the member as a (deduped, lowercased) attendee', async () => {
      const calendar = createCalendarMock(true);
      calendar.patchEventAttendees.mockResolvedValue({ ok: true, status: 200 });
      const audit = createAuditMock();

      const result = await build(calendar, audit, EVENT).addMemberToSessions(
        'Buyer@Example.com',
        USER,
      );

      expect(result).toEqual({ ok: true, status: 200 });
      expect(calendar.patchEventAttendees).toHaveBeenCalledWith(
        'evt_master',
        expect.any(Function),
      );

      // Exercise the mutator: existing attendee preserved, member added once.
      const mutator = calendar.patchEventAttendees.mock.calls[0][1] as (
        a: Array<{ email?: string }>,
      ) => Array<{ email?: string }>;
      const next = mutator([
        { email: 'someone@else.com' },
        { email: 'BUYER@example.com' }, // pre-existing, different case
      ]);
      expect(next).toEqual([
        { email: 'someone@else.com' },
        { email: 'buyer@example.com' },
      ]);

      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'sessions.attendee.add',
          metadata: expect.objectContaining({
            ok: true,
            eventId: 'evt_master',
          }),
        }),
      );
    });

    it('removes the member from the attendee list', async () => {
      const calendar = createCalendarMock(true);
      calendar.patchEventAttendees.mockResolvedValue({ ok: true, status: 200 });

      await build(calendar, createAuditMock(), EVENT).removeMemberFromSessions(
        'buyer@example.com',
        USER,
      );

      const mutator = calendar.patchEventAttendees.mock.calls[0][1] as (
        a: Array<{ email?: string }>,
      ) => Array<{ email?: string }>;
      const next = mutator([
        { email: 'buyer@example.com' },
        { email: 'keep@x.com' },
      ]);
      expect(next).toEqual([{ email: 'keep@x.com' }]);
    });

    it('skips (no patch) when BUILDERS_SESSION_EVENT_ID is unset', async () => {
      const calendar = createCalendarMock(true);
      const audit = createAuditMock();

      const result = await build(calendar, audit, {}).addMemberToSessions(
        'x@e.com',
        USER,
      );

      expect(result).toEqual({ ok: false, skipped: true });
      expect(calendar.patchEventAttendees).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('skips cleanly when Google is disabled', async () => {
      const calendar = createCalendarMock(false);
      const result = await build(
        calendar,
        createAuditMock(),
        EVENT,
      ).addMemberToSessions('x@e.com', USER);

      expect(result).toEqual({ ok: false, skipped: true });
      expect(calendar.patchEventAttendees).not.toHaveBeenCalled();
    });

    it('is non-fatal when the patch fails: audits the failure, never throws', async () => {
      const calendar = createCalendarMock(true);
      calendar.patchEventAttendees.mockResolvedValue({
        ok: false,
        status: 412,
        error: 'Google Calendar API returned status 412',
      });
      const audit = createAuditMock();

      const result = await build(calendar, audit, EVENT).addMemberToSessions(
        'x@e.com',
        USER,
      );

      expect(result.ok).toBe(false);
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'sessions.attendee.add',
          metadata: expect.objectContaining({ ok: false, status: 412 }),
        }),
      );
    });

    it('swallows a thrown provider error (never rethrows into the webhook path)', async () => {
      const calendar = createCalendarMock(true);
      calendar.patchEventAttendees.mockRejectedValue(new Error('boom'));

      await expect(
        build(calendar, createAuditMock(), EVENT).addMemberToSessions(
          'x@e.com',
          USER,
        ),
      ).resolves.toEqual(expect.objectContaining({ ok: false }));
    });
  });

  /** Per-user event resolution: cohort → BUILDERS_SESSION_EVENT_ID → skip. */
  describe('attendee event resolution', () => {
    const ENV = { BUILDERS_SESSION_EVENT_ID: 'evt_env_default' };

    it("patches the member's COHORT event in preference to the env var", async () => {
      const calendar = createCalendarMock(true);
      calendar.patchEventAttendees.mockResolvedValue({ ok: true, status: 200 });
      const groups = createGroupsMock({ forUser: 'evt_arabic_master' });

      await build(calendar, createAuditMock(), ENV, groups).addMemberToSessions(
        'member@example.com',
        USER,
      );

      expect(groups.getSessionEventIdForUser).toHaveBeenCalledWith(USER);
      expect(calendar.patchEventAttendees).toHaveBeenCalledWith(
        'evt_arabic_master',
        expect.any(Function),
      );
    });

    it('falls back to the env var when the cohort configures no event', async () => {
      const calendar = createCalendarMock(true);
      calendar.patchEventAttendees.mockResolvedValue({ ok: true, status: 200 });
      const groups = createGroupsMock({ forUser: null });

      await build(calendar, createAuditMock(), ENV, groups).addMemberToSessions(
        'member@example.com',
        USER,
      );

      expect(calendar.patchEventAttendees).toHaveBeenCalledWith(
        'evt_env_default',
        expect.any(Function),
      );
    });

    it('falls back to the env var when the cohort lookup throws', async () => {
      const calendar = createCalendarMock(true);
      calendar.patchEventAttendees.mockResolvedValue({ ok: true, status: 200 });
      const groups = createGroupsMock();
      groups.getSessionEventIdForUser.mockRejectedValue(new Error('db down'));

      const result = await build(
        calendar,
        createAuditMock(),
        ENV,
        groups,
      ).addMemberToSessions('member@example.com', USER);

      // Non-fatal: a groups outage must not cost a paying member their invite.
      expect(result).toEqual({ ok: true, status: 200 });
      expect(calendar.patchEventAttendees).toHaveBeenCalledWith(
        'evt_env_default',
        expect.any(Function),
      );
    });

    it('still patches the cohort event when the env var is unset entirely', async () => {
      const calendar = createCalendarMock(true);
      calendar.patchEventAttendees.mockResolvedValue({ ok: true, status: 200 });
      const groups = createGroupsMock({ forUser: 'evt_arabic_master' });

      await build(calendar, createAuditMock(), {}, groups).addMemberToSessions(
        'member@example.com',
        USER,
      );

      expect(calendar.patchEventAttendees).toHaveBeenCalledWith(
        'evt_arabic_master',
        expect.any(Function),
      );
    });

    it('removes from the cohort event too (assignments survive churn)', async () => {
      const calendar = createCalendarMock(true);
      calendar.patchEventAttendees.mockResolvedValue({ ok: true, status: 200 });
      const groups = createGroupsMock({ forUser: 'evt_arabic_master' });

      await build(
        calendar,
        createAuditMock(),
        ENV,
        groups,
      ).removeMemberFromSessions('member@example.com', USER);

      expect(calendar.patchEventAttendees).toHaveBeenCalledWith(
        'evt_arabic_master',
        expect.any(Function),
      );
    });

    it('skips when neither a cohort event nor the env var resolves', async () => {
      const calendar = createCalendarMock(true);
      const groups = createGroupsMock({ forUser: null });

      const result = await build(
        calendar,
        createAuditMock(),
        {},
        groups,
      ).addMemberToSessions('member@example.com', USER);

      expect(result).toEqual({ ok: false, skipped: true });
      expect(calendar.patchEventAttendees).not.toHaveBeenCalled();
    });
  });
});
