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
 */

import { ConfigService } from '@nestjs/config';
import { SessionsService } from './sessions.service';
import type { GoogleCalendarProvider } from './google-calendar.provider';
import type { AuditLogService } from '../audit/audit-log.service';

interface CalendarMock {
  isEnabled: jest.Mock<boolean, []>;
  listEvents: jest.Mock;
  patchEventAttendees: jest.Mock;
}

interface AuditMock {
  write: jest.Mock;
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

function build(
  calendar: CalendarMock,
  audit: AuditMock,
  config: Record<string, unknown> = {},
): SessionsService {
  const configService = {
    get: (key: string): unknown => config[key],
  } as unknown as ConfigService;
  return new SessionsService(
    configService,
    calendar as unknown as GoogleCalendarProvider,
    audit as unknown as AuditLogService,
  );
}

describe('SessionsService', () => {
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

      const sessions = await build(calendar, audit).listUpcomingSessions();

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
      ).listUpcomingSessions();

      expect(sessions.map((s) => s.id)).toEqual(['ok']);
    });

    it('returns [] and does not call the calendar when Google is disabled', async () => {
      const calendar = createCalendarMock(false);
      const audit = createAuditMock();

      const sessions = await build(calendar, audit).listUpcomingSessions();

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
      ).listUpcomingSessions();

      expect(sessions).toEqual([]);
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
          metadata: expect.objectContaining({ ok: true }),
        }),
      );
    });

    it('removes the member from the attendee list', async () => {
      const calendar = createCalendarMock(true);
      calendar.patchEventAttendees.mockResolvedValue({ ok: true, status: 200 });

      await build(calendar, createAuditMock(), EVENT).removeMemberFromSessions(
        'buyer@example.com',
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
      ).addMemberToSessions('x@e.com');

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
        ),
      ).resolves.toEqual(expect.objectContaining({ ok: false }));
    });
  });
});
