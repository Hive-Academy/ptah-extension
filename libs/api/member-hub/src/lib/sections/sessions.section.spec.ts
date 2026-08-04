import type { MemberContext } from '@ptah-api/membership';
import type { BuildersSession, SessionsService } from '@ptah-api/community';
import { SessionsSection } from './sessions.section';

/**
 * Unit tests for the ONE section Phase 1 populates.
 *
 * The mandatory case (Task 3.4 / NFR-R1): with `GOOGLE_OAUTH_*` unset the
 * resolver must answer `{ status: 'unavailable', data: null }` — no throw, no
 * 500, and specifically NOT `'empty'`.
 */

function memberContext(): MemberContext {
  return {
    userId: 'user_1',
    email: 'member@example.com',
    entitled: true,
    cohortKeys: [],
    isAdmin: false,
  };
}

function session(overrides: Partial<BuildersSession> = {}): BuildersSession {
  return {
    id: 'evt_1',
    title: 'Builders session',
    startsAt: '2026-08-10T15:00:00.000Z',
    endsAt: '2026-08-10T16:00:00.000Z',
    meetLink: 'https://meet.google.com/abc-defg-hij',
    recurring: true,
    ...overrides,
  };
}

function createSection(opts: {
  enabled?: boolean;
  sessions?: BuildersSession[];
  listThrows?: boolean;
  unbound?: boolean;
}): { section: SessionsSection; list: jest.Mock } {
  const list = opts.listThrows
    ? jest.fn().mockRejectedValue(new Error('calendar quota exceeded'))
    : jest.fn().mockResolvedValue(opts.sessions ?? []);

  const service = {
    isEnabled: jest.fn().mockReturnValue(opts.enabled ?? true),
    listUpcomingSessions: list,
  };

  const section = new SessionsSection(
    opts.unbound ? undefined : (service as unknown as SessionsService),
  );
  jest
    .spyOn(
      (section as unknown as { logger: { warn: () => void } }).logger,
      'warn',
    )
    .mockImplementation(() => undefined);

  return { section, list };
}

describe('SessionsSection — the hub sessions card', () => {
  describe('NFR-R1 — feature-off is unavailable, not empty and not an error', () => {
    it('GOOGLE_OAUTH_* unset -> { status: unavailable, data: null }, no throw', async () => {
      const { section, list } = createSection({ enabled: false });

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'unavailable',
        data: null,
      });
      // The switch is read BEFORE the list. `listUpcomingSessions` returns []
      // when disabled, so reading it first would report "you have no upcoming
      // sessions" — a claim we cannot make, having never looked.
      expect(list).not.toHaveBeenCalled();
    });

    it('an UNBOUND SessionsService degrades this card, it does not fail the hub', async () => {
      const { section } = createSection({ unbound: true });

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'unavailable',
        data: null,
      });
    });
  });

  describe('the populated path', () => {
    it('returns the NEXT upcoming session, mapped to the wire contract', async () => {
      const { section, list } = createSection({
        sessions: [session()],
      });

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'ok',
        data: {
          id: 'evt_1',
          kind: 'calendar',
          title: 'Builders session',
          startsAt: '2026-08-10T15:00:00.000Z',
          endsAt: '2026-08-10T16:00:00.000Z',
          meetLink: 'https://meet.google.com/abc-defg-hij',
          youtubeVideoId: null,
        },
      });
      // Cohort scoping lives in SessionsService and keys off the user id.
      expect(list).toHaveBeenCalledWith('user_1');
    });

    it('picks the EARLIEST start, not the first element', async () => {
      const { section } = createSection({
        sessions: [
          session({ id: 'later', startsAt: '2026-08-20T15:00:00.000Z' }),
          session({ id: 'sooner', startsAt: '2026-08-11T15:00:00.000Z' }),
        ],
      });

      const result = await section.resolve(memberContext());

      expect(result.data?.id).toBe('sooner');
    });

    it('skips entries with an unparseable start rather than comparing NaN', async () => {
      const { section } = createSection({
        sessions: [
          session({ id: 'broken', startsAt: 'not-a-date' }),
          session({ id: 'good', startsAt: '2026-08-11T15:00:00.000Z' }),
        ],
      });

      const result = await section.resolve(memberContext());

      expect(result.data?.id).toBe('good');
    });

    it('emits kind "calendar" and a null youtubeVideoId in Phase 1', async () => {
      const { section } = createSection({ sessions: [session()] });

      const result = await section.resolve(memberContext());

      expect({
        kind: result.data?.kind,
        youtubeVideoId: result.data?.youtubeVideoId,
      }).toEqual({ kind: 'calendar', youtubeVideoId: null });
    });

    it('drops the Calendar-only `recurring` flag (NFR-S4/S5)', async () => {
      const { section } = createSection({ sessions: [session()] });

      const result = await section.resolve(memberContext());

      expect(result.data).not.toHaveProperty('recurring');
    });

    it('an enabled integration with no upcoming sessions is EMPTY, not unavailable', async () => {
      const { section } = createSection({ enabled: true, sessions: [] });

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'empty',
        data: null,
      });
    });
  });

  describe('fault isolation is the composer’s job, not this resolver’s', () => {
    it('lets a genuine failure PROPAGATE so allSettled can degrade it', async () => {
      // Swallowing here would report an outage as `'empty'` — "you have no
      // sessions" — and would make the R6.4 fault-injection test unwritable.
      const { section } = createSection({ listThrows: true });

      await expect(section.resolve(memberContext())).rejects.toThrow(
        'calendar quota exceeded',
      );
    });
  });
});
