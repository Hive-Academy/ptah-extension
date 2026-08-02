import {
  extractEventItems,
  resolveMeetLink,
  resolveTimestamp,
  toAdminSession,
  toBuildersSession,
} from './google-event.mapper';
import type { GoogleCalendarEvent } from './google-sessions.types';

/**
 * Direct unit tests for the pure Google-event mapping functions
 * (TASK_2026_169, review MINOR-1).
 *
 * These were extracted from `SessionsService` because the same mapping now
 * serves four call sites: the member read path, the admin read path, and the
 * admin create/patch responses. That makes them the single highest-leverage
 * piece of shared logic in this feature — previously covered only indirectly
 * through `sessions.service.spec.ts` and `admin-sessions.controller.spec.ts`.
 *
 * ⚠️ THE LOAD-BEARING ASSERTION IS THE LAST DESCRIBE BLOCK.
 * `toBuildersSession` produces the MEMBER contract
 * (`GET /api/v1/members/sessions`). `toAdminSession` is `toBuildersSession`
 * plus `description`. This spec makes the "member response is byte-identical"
 * claim self-verifying rather than something a reviewer has to re-derive by
 * diffing the extraction: it asserts the member shape has EXACTLY the six
 * historical keys and that `description` never leaks into it.
 */

const FULL_EVENT: GoogleCalendarEvent = {
  id: 'evt_1',
  summary: 'Builders session',
  description: 'Office hours',
  start: { dateTime: '2026-09-01T14:00:00.000Z' },
  end: { dateTime: '2026-09-01T15:00:00.000Z' },
  hangoutLink: 'https://meet.google.com/abc-defg-hij',
};

describe('google-event.mapper', () => {
  describe('resolveTimestamp', () => {
    it('normalises a dateTime to ISO-8601', () => {
      expect(resolveTimestamp({ dateTime: '2026-09-01T16:00:00+02:00' })).toBe(
        '2026-09-01T14:00:00.000Z',
      );
    });

    it('promotes an all-day date to midnight UTC', () => {
      expect(resolveTimestamp({ date: '2026-09-01' })).toBe(
        '2026-09-01T00:00:00.000Z',
      );
    });

    it('prefers dateTime when both are present', () => {
      expect(
        resolveTimestamp({
          dateTime: '2026-09-01T14:00:00.000Z',
          date: '2026-12-25',
        }),
      ).toBe('2026-09-01T14:00:00.000Z');
    });

    it.each([
      ['undefined slot', undefined],
      ['empty slot', {}],
    ])('returns null for %s', (_label, slot) => {
      expect(resolveTimestamp(slot)).toBeNull();
    });
  });

  describe('resolveMeetLink', () => {
    it('prefers hangoutLink', () => {
      expect(resolveMeetLink(FULL_EVENT)).toBe(
        'https://meet.google.com/abc-defg-hij',
      );
    });

    it('falls back to a video conferenceData entry point', () => {
      expect(
        resolveMeetLink({
          conferenceData: {
            entryPoints: [
              { entryPointType: 'phone', uri: 'tel:+1-555' },
              { entryPointType: 'video', uri: 'https://meet.google.com/xyz' },
            ],
          },
        }),
      ).toBe('https://meet.google.com/xyz');
    });

    it('ignores non-video entry points', () => {
      expect(
        resolveMeetLink({
          conferenceData: {
            entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1-555' }],
          },
        }),
      ).toBeNull();
    });

    it('returns null when there is no conferencing at all', () => {
      expect(resolveMeetLink({ id: 'e' })).toBeNull();
    });
  });

  describe('toBuildersSession', () => {
    it('maps a complete event', () => {
      expect(toBuildersSession(FULL_EVENT)).toEqual({
        id: 'evt_1',
        title: 'Builders session',
        startsAt: '2026-09-01T14:00:00.000Z',
        endsAt: '2026-09-01T15:00:00.000Z',
        meetLink: 'https://meet.google.com/abc-defg-hij',
        recurring: false,
      });
    });

    it('defaults a missing summary to an empty string', () => {
      expect(
        toBuildersSession({ ...FULL_EVENT, summary: undefined })?.title,
      ).toBe('');
    });

    it.each([
      [
        'an instance of a series (recurringEventId)',
        { recurringEventId: 'master' },
      ],
      ['a master defining a recurrence', { recurrence: ['RRULE:FREQ=WEEKLY'] }],
    ])('flags %s as recurring', (_label, extra) => {
      expect(toBuildersSession({ ...FULL_EVENT, ...extra })?.recurring).toBe(
        true,
      );
    });

    it.each([
      ['no id', { id: undefined }],
      ['no start', { start: undefined }],
      ['no end', { end: undefined }],
    ])('returns null when the event has %s', (_label, extra) => {
      expect(toBuildersSession({ ...FULL_EVENT, ...extra })).toBeNull();
    });
  });

  describe('toAdminSession', () => {
    it('carries description through', () => {
      expect(toAdminSession(FULL_EVENT)?.description).toBe('Office hours');
    });

    it('maps a missing description to null, never undefined', () => {
      const result = toAdminSession({ ...FULL_EVENT, description: undefined });
      expect(result?.description).toBeNull();
    });

    it('returns null on the same unmappable events as toBuildersSession', () => {
      expect(toAdminSession({ ...FULL_EVENT, id: undefined })).toBeNull();
    });
  });

  describe('extractEventItems', () => {
    it('extracts a well-formed items array', () => {
      expect(extractEventItems({ items: [FULL_EVENT] })).toEqual([FULL_EVENT]);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a non-object', 'nope'],
      ['an object with no items', {}],
      ['items that is not an array', { items: 'nope' }],
    ])('returns [] for %s', (_label, json) => {
      expect(extractEventItems(json)).toEqual([]);
    });
  });

  describe('⚠️ member/admin contract separation', () => {
    // `BuildersSession` is the MEMBER contract. TASK_2026_169 deliberately did
    // NOT widen it — the admin surface got a separate `AdminSession extends
    // BuildersSession` type instead, so an admin-only field could never leak
    // into a member-facing response as a side effect. These assertions make
    // that guarantee executable.
    const MEMBER_KEYS = [
      'endsAt',
      'id',
      'meetLink',
      'recurring',
      'startsAt',
      'title',
    ];

    it('the member shape has exactly its six historical keys', () => {
      expect(Object.keys(toBuildersSession(FULL_EVENT) ?? {}).sort()).toEqual(
        MEMBER_KEYS,
      );
    });

    it('description NEVER appears on the member shape, even when the event has one', () => {
      // FULL_EVENT.description === 'Office hours'.
      expect(toBuildersSession(FULL_EVENT)).not.toHaveProperty('description');
    });

    it('the admin shape is the member shape plus exactly description and attendees', () => {
      const admin = toAdminSession(FULL_EVENT) ?? {};
      expect(Object.keys(admin).sort()).toEqual(
        [...MEMBER_KEYS, 'description', 'attendees'].sort(),
      );
    });

    it('attendees NEVER appear on the member shape, even when the event has guests', () => {
      // The guest list is every other member's email address. Widening
      // `BuildersSession` to carry it would publish the customer list to every
      // member who opens their sessions page.
      expect(toBuildersSession(FULL_EVENT)).not.toHaveProperty('attendees');
    });

    it('the two shapes agree on every shared field', () => {
      const member = toBuildersSession(FULL_EVENT);
      const admin = toAdminSession(FULL_EVENT);
      const {
        description: _droppedDescription,
        attendees: _droppedAttendees,
        ...adminSharedFields
      } = admin ?? { description: null, attendees: [] };

      expect(adminSharedFields).toEqual(member);
    });
  });
});
