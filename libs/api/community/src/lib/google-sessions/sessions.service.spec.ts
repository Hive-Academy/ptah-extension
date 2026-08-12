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
import type { EmailService } from '@ptah-api/email';
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
  email?: { sendBuildersSessionWelcome: jest.Mock },
): SessionsService {
  const configService = {
    get: (key: string): unknown => config[key],
  } as unknown as ConfigService;
  return new SessionsService(
    configService,
    calendar as unknown as GoogleCalendarProvider,
    audit as unknown as AuditLogService,
    groups as unknown as MemberGroupsService | undefined,
    email as unknown as EmailService | undefined,
  );
}

function createEmailMock(): { sendBuildersSessionWelcome: jest.Mock } {
  return { sendBuildersSessionWelcome: jest.fn().mockResolvedValue(undefined) };
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

  /**
   * ⚠️ THE SIGNUP-NOTIFICATION BLAST RADIUS.
   *
   * The obvious way to tell a new member about their sessions is to let Google
   * do it (`sendUpdates=all` on the attendee patch). Google treats an attendee
   * addition as an event UPDATE and mails an "Updated Invitation" to EVERY
   * existing guest, with no parameter to narrow it. On a cohort of N that is N
   * emails per signup, growing with the cohort.
   *
   * So the calendar write stays silent and the welcome is ours. These tests
   * pin both halves: the patch never asks Google to notify, and exactly one
   * message goes to exactly the new member.
   */
  describe('⚠️ new-member welcome — one email, one recipient', () => {
    const CONFIG = { BUILDERS_SESSION_EVENT_ID: 'evt_master' };

    function calendarWithAttendees(existing: string[]): CalendarMock {
      const calendar = createCalendarMock(true);
      calendar.patchEventAttendees.mockImplementation(
        async (_id: string, mutate: (a: unknown[]) => unknown[]) => {
          mutate(existing.map((email) => ({ email })));
          return { ok: true, status: 200 };
        },
      );
      calendar.listEvents.mockResolvedValue({
        ok: true,
        json: {
          items: [
            {
              id: 'evt_1',
              summary: 'Builders Office Hours',
              hangoutLink: 'https://meet.google.com/abc-defg-hij',
              start: { dateTime: '2026-09-01T17:00:00Z' },
              end: { dateTime: '2026-09-01T18:00:00Z' },
            },
          ],
        },
      });
      return calendar;
    }

    it('never asks Google to notify anyone', async () => {
      const calendar = calendarWithAttendees([]);
      const email = createEmailMock();

      await build(
        calendar,
        createAuditMock(),
        CONFIG,
        undefined,
        email,
      ).addMemberToSessions('new@example.com', USER);

      // `patchEventAttendees` takes no sendUpdates argument at all — the
      // provider hardcodes `none`. If that ever becomes a parameter, this
      // assertion is the reminder that passing 'all' mails the whole cohort.
      expect(calendar.patchEventAttendees).toHaveBeenCalledTimes(1);
      expect(calendar.patchEventAttendees.mock.calls[0]).toHaveLength(2);
    });

    it('sends exactly one welcome, to the new member, listing their sessions', async () => {
      const email = createEmailMock();

      await build(
        calendarWithAttendees(['existing@example.com']),
        createAuditMock(),
        CONFIG,
        undefined,
        email,
      ).addMemberToSessions('New@Example.com', USER);

      expect(email.sendBuildersSessionWelcome).toHaveBeenCalledTimes(1);
      const arg = email.sendBuildersSessionWelcome.mock.calls[0][0];
      expect(arg.email).toBe('new@example.com');
      // The existing guest is not a recipient, and never appears in the payload.
      expect(JSON.stringify(arg)).not.toContain('existing@example.com');
      expect(arg.sessions[0]).toEqual(
        expect.objectContaining({
          title: 'Builders Office Hours',
          meetLink: 'https://meet.google.com/abc-defg-hij',
        }),
      );
    });

    it('stays silent for someone already on the event', async () => {
      const email = createEmailMock();

      // A re-delivered Paddle webhook, or a plan change that re-runs the
      // fan-out, both land here for an existing member.
      await build(
        calendarWithAttendees(['dup@example.com']),
        createAuditMock(),
        CONFIG,
        undefined,
        email,
      ).addMemberToSessions('DUP@example.com', USER);

      expect(email.sendBuildersSessionWelcome).not.toHaveBeenCalled();
    });

    it('never welcomes anyone on a removal', async () => {
      const email = createEmailMock();

      await build(
        calendarWithAttendees(['leaving@example.com']),
        createAuditMock(),
        CONFIG,
        undefined,
        email,
      ).removeMemberFromSessions('leaving@example.com', USER);

      expect(email.sendBuildersSessionWelcome).not.toHaveBeenCalled();
    });

    it('still reports attendance succeeded when the mail fails', async () => {
      const email = createEmailMock();
      email.sendBuildersSessionWelcome.mockRejectedValue(
        new Error('resend down'),
      );

      // This runs inside the Paddle webhook. A mail failure must never surface
      // as a failed provisioning — the member IS on the event either way.
      await expect(
        build(
          calendarWithAttendees([]),
          createAuditMock(),
          CONFIG,
          undefined,
          email,
        ).addMemberToSessions('new@example.com', USER),
      ).resolves.toEqual(expect.objectContaining({ ok: true }));
    });

    it('degrades to no welcome when EmailService is unbound', async () => {
      await expect(
        build(
          calendarWithAttendees([]),
          createAuditMock(),
          CONFIG,
        ).addMemberToSessions('new@example.com', USER),
      ).resolves.toEqual(expect.objectContaining({ ok: true }));
    });

    it('does not welcome when the attendee add itself failed', async () => {
      const calendar = calendarWithAttendees([]);
      calendar.patchEventAttendees.mockResolvedValue({
        ok: false,
        status: 403,
      });
      const email = createEmailMock();

      await build(
        calendar,
        createAuditMock(),
        CONFIG,
        undefined,
        email,
      ).addMemberToSessions('new@example.com', USER);

      expect(email.sendBuildersSessionWelcome).not.toHaveBeenCalled();
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
   * `readUpcomingSessions` is the reporting variant that `listUpcomingSessions`
   * is now a lossy view of. Its entire reason to exist is that the two `[]`
   * cases above — disabled, and failed — are DIFFERENT ANSWERS, and a caller
   * that renders "you have no upcoming sessions" must be able to tell them
   * apart from a genuinely empty calendar.
   */
  describe('readUpcomingSessions — the reporting variant', () => {
    it('reports { ok: false, reason: "disabled" } when Google is unconfigured', async () => {
      const calendar = createCalendarMock(false);

      const result = await build(
        calendar,
        createAuditMock(),
      ).readUpcomingSessions(USER);

      expect(result).toEqual({ ok: false, reason: 'disabled' });
      expect(calendar.listEvents).not.toHaveBeenCalled();
    });

    it('reports { ok: false, reason: "fetch_failed" } when the calendar call fails', async () => {
      const calendar = createCalendarMock(true);
      calendar.listEvents.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Google Calendar API returned status 500',
      });

      const result = await build(
        calendar,
        createAuditMock(),
      ).readUpcomingSessions(USER);

      expect(result).toEqual({ ok: false, reason: 'fetch_failed' });
    });

    it('does NOT throw on a failed read — the failure is a value', async () => {
      // The hub composes sections with allSettled and must stay 200. A throw
      // here would still be contained, but the Paddle fan-out also reaches this
      // path via the welcome email and must never see an exception.
      const calendar = createCalendarMock(true);
      calendar.listEvents.mockResolvedValue({ ok: false, status: 503 });

      await expect(
        build(calendar, createAuditMock()).readUpcomingSessions(USER),
      ).resolves.toMatchObject({ ok: false });
    });

    it('reports { ok: true, sessions: [] } for an ENABLED calendar with nothing scheduled', async () => {
      // The case that must stay distinguishable from both failures above.
      const calendar = createCalendarMock(true);
      calendar.listEvents.mockResolvedValue({ ok: true, json: { items: [] } });

      const result = await build(
        calendar,
        createAuditMock(),
      ).readUpcomingSessions(USER);

      expect(result).toEqual({ ok: true, sessions: [] });
    });

    it('reports { ok: true, sessions } with the same mapping listUpcomingSessions returns', async () => {
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
            },
          ],
        },
      });
      const service = build(calendar, createAuditMock());

      const result = await service.readUpcomingSessions(USER);
      const flattened = await service.listUpcomingSessions(USER);

      expect(result).toEqual({ ok: true, sessions: flattened });
      expect(flattened.map((s) => s.id)).toEqual(['evt_1']);
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
