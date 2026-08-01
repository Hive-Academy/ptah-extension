import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AuditLogService } from '../audit/audit-log.service';
import type { GoogleCalendarProvider } from './google-calendar.provider';
import { AdminSessionsService } from './admin-sessions.service';
import { AdminSessionsController } from './admin-sessions.controller';

/**
 * Unit tests for the admin sessions surface (TASK_2026_169).
 *
 * Exercised through the CONTROLLER against a real `AdminSessionsService` with a
 * mocked calendar provider, so the guard chain's delegation and the service's
 * error mapping are covered together.
 *
 * Focus:
 *   - ⚠️ The recurring-master footgun guard (plan §4.4), BOTH halves:
 *       (a) deleting the master by its own id       → 409
 *       (b) deleting an EXPANDED INSTANCE of it     → 409  ← the load-bearing one
 *     `listEvents` uses `singleEvents=true`, so the admin UI lists instances
 *     whose ids differ from the master's. A guard comparing only `eventId`
 *     would let an admin destroy the series — and with it every provisioned
 *     member's standing invite — through any one of those rows.
 *   - Upstream 401/403 → 503 `calendar_write_unavailable`, never a 500 and
 *     never a forwarded Google body.
 *   - `calendarWritable` reflects the provider's scope verdict, with `undefined`
 *     collapsing to `false`.
 *   - Delete is idempotent: an already-gone event yields `{ deleted: false }`.
 */

const PROTECTED_ID = 'master_recurring_event';

function build(
  opts: {
    writable?: boolean | undefined;
    enabled?: boolean;
    protectedId?: string | undefined;
  } = {},
) {
  const calendar = {
    isEnabled: jest.fn().mockReturnValue(opts.enabled ?? true),
    isWritable: jest.fn().mockReturnValue(opts.writable),
    listEvents: jest.fn().mockResolvedValue({ ok: true, json: { items: [] } }),
    getEvent: jest.fn().mockResolvedValue({ ok: true, json: {} }),
    createEvent: jest.fn(),
    patchEvent: jest.fn(),
    deleteEvent: jest.fn().mockResolvedValue({ ok: true, status: 204 }),
  };
  const config = {
    get: (key: string): unknown =>
      key === 'BUILDERS_SESSION_EVENT_ID'
        ? 'protectedId' in opts
          ? opts.protectedId
          : PROTECTED_ID
        : undefined,
  } as unknown as ConfigService;
  const audit = { write: jest.fn().mockResolvedValue('audit-id') };

  const service = new AdminSessionsService(
    config,
    calendar as unknown as GoogleCalendarProvider,
    audit as unknown as AuditLogService,
  );
  const controller = new AdminSessionsController(service);
  return { controller, service, calendar, audit };
}

function req(): Request {
  return {
    user: { id: 'u1', email: 'admin@example.com' },
    ip: '203.0.113.7',
    get: () => 'jest-agent',
  } as unknown as Request;
}

const CREATE = {
  title: 'New session',
  startsAt: '2026-09-01T14:00:00.000Z',
  endsAt: '2026-09-01T15:00:00.000Z',
};

describe('AdminSessionsController', () => {
  describe('⚠️ recurring-master guard (plan §4.4)', () => {
    it('refuses to delete the master by its own id (409)', async () => {
      const { controller, calendar } = build();

      const promise = controller.remove(req(), PROTECTED_ID);

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: { reason: 'protected_recurring_event' },
      });
      expect(calendar.deleteEvent).not.toHaveBeenCalled();
    });

    it('refuses to delete an EXPANDED INSTANCE whose recurringEventId is the master', async () => {
      const { controller, calendar } = build();
      // What the admin UI actually lists: an instance id that does NOT equal
      // the master id, but which points back at it.
      const instanceId = `${PROTECTED_ID}_20260805T140000Z`;
      calendar.getEvent.mockResolvedValue({
        ok: true,
        json: { id: instanceId, recurringEventId: PROTECTED_ID },
      });

      const promise = controller.remove(req(), instanceId);

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: { reason: 'protected_recurring_event' },
      });
      expect(calendar.deleteEvent).not.toHaveBeenCalled();
    });

    it('allows deleting an unrelated one-off event', async () => {
      const { controller, calendar } = build();
      calendar.getEvent.mockResolvedValue({
        ok: true,
        json: { id: 'evt_other', summary: 'Ad-hoc' },
      });

      await expect(controller.remove(req(), 'evt_other')).resolves.toEqual({
        deleted: true,
      });
      expect(calendar.deleteEvent).toHaveBeenCalledWith('evt_other');
    });

    it('allows deleting an instance of a DIFFERENT recurring series', async () => {
      const { controller, calendar } = build();
      calendar.getEvent.mockResolvedValue({
        ok: true,
        json: { id: 'other_20260805', recurringEventId: 'some_other_master' },
      });

      await expect(controller.remove(req(), 'other_20260805')).resolves.toEqual(
        { deleted: true },
      );
    });

    it('refuses to patch the master directly (409)', async () => {
      const { controller, calendar } = build();

      await expect(
        controller.update(req(), PROTECTED_ID, { title: 'Renamed' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(calendar.patchEvent).not.toHaveBeenCalled();
    });

    it('does not guard anything when BUILDERS_SESSION_EVENT_ID is unset', async () => {
      const { controller, calendar } = build({ protectedId: undefined });
      calendar.getEvent.mockResolvedValue({ ok: true, json: { id: 'x' } });

      await expect(controller.remove(req(), 'anything')).resolves.toEqual({
        deleted: true,
      });
    });
  });

  describe('upstream failure mapping', () => {
    it('maps a 403 on create to 503 calendar_write_unavailable', async () => {
      const { controller, calendar } = build();
      calendar.createEvent.mockResolvedValue({
        ok: false,
        status: 403,
        error: 'Google Calendar API returned status 403',
      });

      const promise = controller.create(req(), CREATE);

      await expect(promise).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(promise).rejects.toMatchObject({
        response: { reason: 'calendar_write_unavailable' },
      });
    });

    it('maps a 401 on patch to 503 calendar_write_unavailable', async () => {
      const { controller, calendar } = build();
      calendar.patchEvent.mockResolvedValue({ ok: false, status: 401 });

      await expect(
        controller.update(req(), 'evt_1', { title: 'x' }),
      ).rejects.toMatchObject({
        response: { reason: 'calendar_write_unavailable' },
      });
    });

    it('maps feature-off to 503 calendar_unconfigured', async () => {
      const { controller, calendar } = build();
      calendar.createEvent.mockResolvedValue({ ok: false, skipped: true });

      await expect(controller.create(req(), CREATE)).rejects.toMatchObject({
        response: { reason: 'calendar_unconfigured' },
      });
    });

    it('maps a 404 on patch to 404 calendar_event_not_found', async () => {
      const { controller, calendar } = build();
      calendar.patchEvent.mockResolvedValue({ ok: false, status: 404 });

      await expect(
        controller.update(req(), 'evt_gone', { title: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('never forwards a raw upstream body to the client', async () => {
      const { controller, calendar } = build();
      calendar.createEvent.mockResolvedValue({
        ok: false,
        status: 403,
        error: 'Request had insufficient authentication scopes.',
      });

      await expect(controller.create(req(), CREATE)).rejects.not.toThrow(
        /insufficient authentication scopes/,
      );
    });
  });

  describe('delete idempotency', () => {
    it.each([404, 410])(
      'returns { deleted: false } when Google answers %s',
      async (status) => {
        const { controller, calendar } = build();
        calendar.getEvent.mockResolvedValue({ ok: true, json: { id: 'e' } });
        calendar.deleteEvent.mockResolvedValue({ ok: false, status });

        await expect(controller.remove(req(), 'evt_gone')).resolves.toEqual({
          deleted: false,
        });
      },
    );
  });

  describe('list', () => {
    it.each([
      [true, true],
      [false, false],
      [undefined, false],
    ])('reports calendarWritable=%s as %s', async (verdict, expected) => {
      const { controller } = build({ writable: verdict });

      const result = await controller.list({ daysAhead: 60 });

      expect(result.calendarWritable).toBe(expected);
    });

    it('honours the requested window', async () => {
      const { controller, calendar } = build();

      await controller.list({ daysAhead: 30 });

      const [timeMin, timeMax] = calendar.listEvents.mock.calls[0];
      const days = (timeMax.getTime() - timeMin.getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(30);
    });

    it('drops cancelled events and surfaces description on the admin shape', async () => {
      const { controller, calendar } = build();
      calendar.listEvents.mockResolvedValue({
        ok: true,
        json: {
          items: [
            {
              id: 'evt_1',
              summary: 'Live',
              description: 'Notes here',
              start: { dateTime: '2026-09-01T14:00:00.000Z' },
              end: { dateTime: '2026-09-01T15:00:00.000Z' },
            },
            { id: 'evt_2', status: 'cancelled', summary: 'Gone' },
          ],
        },
      });

      const result = await controller.list({ daysAhead: 60 });

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].description).toBe('Notes here');
    });

    it('degrades to an empty list (not a 500) when the upstream read fails', async () => {
      const { controller, calendar } = build();
      calendar.listEvents.mockResolvedValue({ ok: false, status: 500 });

      await expect(controller.list({ daysAhead: 60 })).resolves.toEqual({
        sessions: [],
        calendarWritable: false,
      });
    });
  });

  describe('validation + audit', () => {
    it('rejects a time range that does not advance', async () => {
      const { controller } = build();

      await expect(
        controller.create(req(), {
          title: 'x',
          startsAt: '2026-09-01T15:00:00.000Z',
          endsAt: '2026-09-01T14:00:00.000Z',
        }),
      ).rejects.toMatchObject({ response: { reason: 'invalid_time_range' } });
    });

    it('audits a successful create with the actor context', async () => {
      const { controller, calendar, audit } = build();
      calendar.createEvent.mockResolvedValue({
        ok: true,
        status: 200,
        json: {
          id: 'evt_new',
          summary: 'New session',
          start: { dateTime: CREATE.startsAt },
          end: { dateTime: CREATE.endsAt },
        },
      });

      await controller.create(req(), CREATE);

      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'sessions.event.create',
          targetType: 'CalendarEvent',
          targetId: 'evt_new',
          actorEmail: 'admin@example.com',
          ipAddress: '203.0.113.7',
        }),
      );
    });
  });
});
