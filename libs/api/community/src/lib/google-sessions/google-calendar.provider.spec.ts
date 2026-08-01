import type { ConfigService } from '@nestjs/config';
import type { GoogleAuthProvider } from './google-auth.provider';
import { GoogleCalendarProvider } from './google-calendar.provider';

/**
 * Unit tests for the `GoogleCalendarProvider` WRITE path added by TASK_2026_169.
 *
 * Focus:
 *   - `createEvent` issues POST with `conferenceDataVersion=1` — without that
 *     query param Google SILENTLY DROPS `conferenceData.createRequest` and the
 *     event is created with no Meet link.
 *   - `deleteEvent` issues DELETE and folds Google's `204 No Content` (empty
 *     body) into `{ ok: true }` rather than choking on the unparseable body.
 *   - An upstream 403 folds to `{ ok:false, status:403 }` and the sanitized
 *     message NEVER carries the raw Google body (the provider's core contract).
 *   - Feature-off short-circuits without a network round-trip.
 */

function buildProvider(opts: {
  token?: { ok: boolean; accessToken?: string; skipped?: boolean };
  writeScope?: boolean | undefined;
  calendarId?: string;
}) {
  const auth = {
    isEnabled: jest.fn().mockReturnValue(true),
    getAccessToken: jest
      .fn()
      .mockResolvedValue(opts.token ?? { ok: true, accessToken: 'tok_123' }),
    hasCalendarWriteScope: jest.fn().mockReturnValue(opts.writeScope),
  };
  const config = {
    get: (key: string): unknown =>
      key === 'GOOGLE_CALENDAR_ID' ? opts.calendarId : undefined,
  } as unknown as ConfigService;

  const provider = new GoogleCalendarProvider(
    config,
    auth as unknown as GoogleAuthProvider,
  );
  return { provider, auth };
}

function mockFetch(response: {
  ok: boolean;
  status: number;
  body?: string;
  etag?: string;
}) {
  const fn = jest.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    text: async () => response.body ?? '',
    headers: { get: () => response.etag ?? null },
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const INPUT = {
  title: 'Builders session',
  description: 'Office hours',
  startsAt: '2026-09-01T14:00:00.000Z',
  endsAt: '2026-09-01T15:00:00.000Z',
};

describe('GoogleCalendarProvider (write path)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('createEvent', () => {
    it('issues a POST carrying conferenceDataVersion=1 and sendUpdates=none', async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 'evt_1' }),
      });
      const { provider } = buildProvider({});

      const result = await provider.createEvent({
        ...INPUT,
        createMeetLink: true,
      });

      expect(result.ok).toBe(true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(url).toContain('conferenceDataVersion=1');
      expect(url).toContain('sendUpdates=none');
      expect(url).toContain('/calendars/primary/events');
    });

    it('maps the internal input onto Google event fields', async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 'evt_1' }),
      });
      const { provider } = buildProvider({});

      await provider.createEvent({ ...INPUT, createMeetLink: true });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.summary).toBe('Builders session');
      expect(body.description).toBe('Office hours');
      expect(body.start).toEqual({ dateTime: '2026-09-01T14:00:00.000Z' });
      expect(body.end).toEqual({ dateTime: '2026-09-01T15:00:00.000Z' });
      expect(body.conferenceData.createRequest.conferenceSolutionKey).toEqual({
        type: 'hangoutsMeet',
      });
      expect(typeof body.conferenceData.createRequest.requestId).toBe('string');
    });

    it('omits conferenceData when a Meet link was not requested', async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 'evt_1' }),
      });
      const { provider } = buildProvider({});

      await provider.createEvent({ ...INPUT, createMeetLink: false });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.conferenceData).toBeUndefined();
    });

    it('url-encodes a non-default calendar id', async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 'evt_1' }),
      });
      const { provider } = buildProvider({ calendarId: 'a b@group.calendar' });

      await provider.createEvent(INPUT);

      expect(fetchMock.mock.calls[0][0]).toContain('a%20b%40group.calendar');
    });
  });

  describe('patchEvent', () => {
    it('sends only the supplied fields', async () => {
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 'evt_1' }),
      });
      const { provider } = buildProvider({});

      await provider.patchEvent('evt_1', { title: 'Renamed' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('PATCH');
      expect(url).toContain('/events/evt_1');
      expect(JSON.parse(init.body)).toEqual({ summary: 'Renamed' });
    });
  });

  describe('deleteEvent', () => {
    it('issues DELETE and folds a 204 empty body into ok:true', async () => {
      const fetchMock = mockFetch({ ok: true, status: 204, body: '' });
      const { provider } = buildProvider({});

      const result = await provider.deleteEvent('evt_1');

      expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
      expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
      expect(result).toEqual(
        expect.objectContaining({ ok: true, status: 204, json: undefined }),
      );
    });

    it('surfaces an already-deleted event as 410 rather than throwing', async () => {
      mockFetch({ ok: false, status: 410, body: '{"error":"Gone"}' });
      const { provider } = buildProvider({});

      const result = await provider.deleteEvent('evt_1');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(410);
    });
  });

  describe('error sanitization', () => {
    it('folds an upstream 403 to { ok:false, status:403 } with no upstream body', async () => {
      const upstreamBody = JSON.stringify({
        error: {
          message: 'Request had insufficient authentication scopes.',
          status: 'PERMISSION_DENIED',
        },
      });
      mockFetch({ ok: false, status: 403, body: upstreamBody });
      const { provider } = buildProvider({});

      const result = await provider.createEvent(INPUT);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toBe('Google Calendar API returned status 403');
      expect(result.error).not.toContain('insufficient authentication scopes');
      expect(result.error).not.toContain('PERMISSION_DENIED');
    });

    it('short-circuits in feature-off mode without a network call', async () => {
      const fetchMock = mockFetch({ ok: true, status: 200, body: '{}' });
      const { provider } = buildProvider({
        token: { ok: false, skipped: true },
      });

      const result = await provider.deleteEvent('evt_1');

      expect(result).toEqual({ ok: false, skipped: true });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('isWritable', () => {
    it.each([
      [true, true],
      [false, false],
      [undefined, undefined],
    ])('surfaces the auth scope verdict %s', (verdict, expected) => {
      const { provider } = buildProvider({ writeScope: verdict });
      expect(provider.isWritable()).toBe(expected);
    });
  });
});
