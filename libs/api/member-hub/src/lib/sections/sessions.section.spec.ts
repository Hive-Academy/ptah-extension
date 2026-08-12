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
  /** Google is configured and enabled, but the Calendar call did not succeed. */
  fetchFailed?: boolean;
  listThrows?: boolean;
  unbound?: boolean;
}): { section: SessionsSection; list: jest.Mock } {
  const list = opts.listThrows
    ? jest.fn().mockRejectedValue(new Error('calendar quota exceeded'))
    : jest
        .fn()
        .mockResolvedValue(
          opts.fetchFailed
            ? { ok: false, reason: 'fetch_failed' }
            : { ok: true, sessions: opts.sessions ?? [] },
        );

  const service = {
    isEnabled: jest.fn().mockReturnValue(opts.enabled ?? true),
    // The section reads the REPORTING variant, never the flattening one — that
    // choice is the whole of the empty-vs-unavailable distinction below.
    readUpcomingSessions: list,
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
      // The switch is read BEFORE the list, so feature-off is answered without
      // a Calendar round-trip at all.
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

  describe('a FAILED Calendar read is unavailable, not empty', () => {
    // The third state, and the one a naive `[]` cannot express: Google is
    // configured, we asked, and we did not get an answer. Reporting `'empty'`
    // would tell a paying member "you have no upcoming sessions" during an
    // outage — a false statement, not a degraded one.
    it('enabled + fetch failure -> { status: unavailable, data: null }', async () => {
      const { section } = createSection({ enabled: true, fetchFailed: true });

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'unavailable',
        data: null,
      });
    });

    it('does not become a 500 — the failure stays a value, so the hub stays 200', async () => {
      // R6.4 / NFR-R3: an upstream outage degrades ONE card. If this rejected,
      // `MemberHubService`'s allSettled would still contain it, but the section
      // would lose the ability to distinguish its own reason.
      const { section } = createSection({ enabled: true, fetchFailed: true });

      await expect(section.resolve(memberContext())).resolves.toBeDefined();
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

/* -------------------------------------------------------------------------- */
/* TASK_2026_177 Phase 4 — the THREE-WAY merge (R6.6, Task 12.15)             */
/* -------------------------------------------------------------------------- */

/**
 * 🔴 THE PROPERTY THIS BLOCK EXISTS FOR: **Calendar being down must not hide a
 * `LiveSession` that is genuinely next.**
 *
 * With one source, "we could not look" and "there is nothing" were the only two
 * answers and the two-state logic above was sufficient. With three it is not,
 * and the truth table in `sessions.section.ts`'s docblock is what replaces it:
 *
 *   no source answered            -> 'unavailable'
 *   at least one, produced a hit  -> 'ok'
 *   at least one, produced none   -> 'empty'
 *
 * ⚠️ EVERY ASSERTION HERE IS A DATA CHANGE, NOT A CONTRACT CHANGE (R6.6).
 * `HUB_SESSION_KINDS` has declared all three kinds since Phase 1; the envelope,
 * the composer and the client are untouched, and Batch 3's one-request
 * assertion must still pass four phases later.
 */

const LIVE_ITEM = {
  id: 'live_1',
  source: 'ptah' as const,
  state: 'upcoming' as const,
  title: 'Weekly build session',
  startsAt: '2026-08-09T18:00:00.000Z',
  endsAt: '2026-08-09T19:00:00.000Z',
  youtubeVideoId: 'streamaaaaa',
  meetLink: null,
  durationSeconds: 3600,
};

const PRIVATE_REQUEST = {
  id: 'req_1',
  sessionTopicId: 'architecture-review',
  additionalNotes: null,
  status: 'scheduled',
  scheduledAt: '2026-08-11T15:00:00.000Z',
  durationMinutes: 60,
  meetLink: 'https://meet.google.com/priv-atex-yzw',
  declineReason: null,
  createdAt: '2026-08-08T12:00:00.000Z',
};

interface ThreeWayOptions {
  calendar?: 'ok' | 'empty' | 'disabled' | 'failed' | 'unbound';
  live?: 'ok' | 'empty' | 'throws' | 'unbound';
  privateSessions?: 'ok' | 'empty' | 'throws' | 'unbound';
  liveItems?: Array<Record<string, unknown>>;
  requests?: Array<Record<string, unknown>>;
}

function createThreeWaySection(opts: ThreeWayOptions): {
  section: SessionsSection;
  read: jest.Mock;
  listOwn: jest.Mock;
} {
  const calendarMode = opts.calendar ?? 'empty';
  const sessionsService = {
    isEnabled: jest.fn().mockReturnValue(calendarMode !== 'disabled'),
    readUpcomingSessions: jest
      .fn()
      .mockResolvedValue(
        calendarMode === 'failed'
          ? { ok: false, reason: 'fetch_failed' }
          : { ok: true, sessions: calendarMode === 'ok' ? [session()] : [] },
      ),
  };

  const read = jest.fn();
  if (opts.live === 'throws') {
    read.mockRejectedValue(new Error('postgres connection lost'));
  } else {
    read.mockResolvedValue({
      upcoming: opts.live === 'ok' ? (opts.liveItems ?? [LIVE_ITEM]) : [],
      live: [],
      replays: { items: [], page: 1, pageSize: 1, total: 0, hasMore: false },
      calendarAvailable: false,
    });
  }

  const listOwn = jest.fn();
  if (opts.privateSessions === 'throws') {
    listOwn.mockRejectedValue(new Error('postgres connection lost'));
  } else {
    listOwn.mockResolvedValue(
      opts.privateSessions === 'ok' ? (opts.requests ?? [PRIVATE_REQUEST]) : [],
    );
  }

  const section = new SessionsSection(
    calendarMode === 'unbound'
      ? undefined
      : (sessionsService as unknown as SessionsService),
    opts.live === 'unbound' ? undefined : ({ read } as never),
    opts.privateSessions === 'unbound' ? undefined : ({ listOwn } as never),
  );
  jest
    .spyOn(
      (section as unknown as { logger: { warn: () => void } }).logger,
      'warn',
    )
    .mockImplementation(() => undefined);

  return { section, read, listOwn };
}

describe('SessionsSection — the Phase-4 three-way merge', () => {
  describe('the per-source truth table', () => {
    it('Calendar FAILS but a LiveSession exists -> ok, NOT unavailable', async () => {
      // 🔴 TASK 12.15's NAMED CASE, and the whole reason the two-state logic had
      // to change. Reporting `unavailable` here would blank a card that has a
      // true answer in it, every time Google hiccups.
      const { section } = createThreeWaySection({
        calendar: 'failed',
        live: 'ok',
      });

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'ok',
        data: expect.objectContaining({ kind: 'live', id: 'live_1' }),
      });
    });

    it('Calendar DISABLED but a private session exists -> ok', async () => {
      // The live path in this workspace (ASSUMPTION-10): GOOGLE_OAUTH_* is
      // unset, so the calendar source never answers — and a member with an
      // accepted private session must still see it.
      const { section } = createThreeWaySection({
        calendar: 'disabled',
        privateSessions: 'ok',
      });

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'ok',
        data: expect.objectContaining({ kind: 'private', id: 'req_1' }),
      });
    });

    it('EVERY source down -> unavailable', async () => {
      // NFR-R1, unchanged: we looked at nothing and may not tell the member
      // they have nothing scheduled.
      const { section } = createThreeWaySection({
        calendar: 'failed',
        live: 'throws',
        privateSessions: 'throws',
      });

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'unavailable',
        data: null,
      });
    });

    it('every source UNBOUND -> unavailable, and the hub still answers', async () => {
      const { section } = createThreeWaySection({
        calendar: 'unbound',
        live: 'unbound',
        privateSessions: 'unbound',
      });

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'unavailable',
        data: null,
      });
    });

    it('one source answered EMPTY and the others are down -> empty', async () => {
      // ⚠️ THE ONE ARGUABLY LOSSY ROW, and it is deliberate. The alternative —
      // `unavailable` whenever ANY source is down — makes the card permanently
      // unavailable in this workspace, where GOOGLE_OAUTH_* is unset by default.
      const { section } = createThreeWaySection({
        calendar: 'disabled',
        live: 'throws',
        privateSessions: 'empty',
      });

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'empty',
        data: null,
      });
    });

    it('all three answer empty -> empty', async () => {
      const { section } = createThreeWaySection({
        calendar: 'empty',
        live: 'empty',
        privateSessions: 'empty',
      });

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'empty',
        data: null,
      });
    });
  });

  describe('earliest() across three ordered lists', () => {
    it('picks the earliest regardless of which source produced it', async () => {
      // Phase 1's docblock predicted exactly this: a future merge would
      // concatenate ordered lists into an unordered one. It is now three. The
      // calendar fixture starts 2026-08-10, live 2026-08-09, private
      // 2026-08-11 — so the MIDDLE source wins and neither concatenation order
      // would have produced it by luck.
      const { section } = createThreeWaySection({
        calendar: 'ok',
        live: 'ok',
        privateSessions: 'ok',
      });

      const resolved = await section.resolve(memberContext());

      expect(resolved.status).toBe('ok');
      expect(resolved.data).toMatchObject({
        kind: 'live',
        startsAt: '2026-08-09T18:00:00.000Z',
      });
    });

    it('a calendar session that is genuinely earliest still wins', async () => {
      // The negative control: if `kind: live` always won, the assertion above
      // would pass against a merge that ignored ordering entirely.
      const { section } = createThreeWaySection({
        calendar: 'ok',
        live: 'ok',
        liveItems: [{ ...LIVE_ITEM, startsAt: '2026-08-20T18:00:00.000Z' }],
      });

      const resolved = await section.resolve(memberContext());

      expect(resolved.data).toMatchObject({
        kind: 'calendar',
        startsAt: '2026-08-10T15:00:00.000Z',
      });
    });
  });

  describe('the private source — R4, and what it refuses to show', () => {
    it.each([['pending'], ['canceled'], ['completed']])(
      'ignores a %s request',
      async (status) => {
        // A pending request has no agreed time and no Meet link; putting it on
        // a card that says "your next session" would promise something no admin
        // has agreed to.
        const { section } = createThreeWaySection({
          privateSessions: 'ok',
          requests: [{ ...PRIVATE_REQUEST, status }],
        });

        await expect(section.resolve(memberContext())).resolves.toEqual({
          status: 'empty',
          data: null,
        });
      },
    );

    it('ignores a scheduled session that is already in the PAST', async () => {
      // `earliest()` would otherwise pin the card to a call from last month,
      // because a past instant is earlier than every future one.
      const { section } = createThreeWaySection({
        privateSessions: 'ok',
        requests: [
          { ...PRIVATE_REQUEST, scheduledAt: '2020-01-01T00:00:00.000Z' },
        ],
      });

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'empty',
        data: null,
      });
    });

    it('reconstructs endsAt from durationMinutes, since the row has no end column', async () => {
      const { section } = createThreeWaySection({ privateSessions: 'ok' });

      const resolved = await section.resolve(memberContext());

      expect(resolved.data).toMatchObject({
        kind: 'private',
        startsAt: '2026-08-11T15:00:00.000Z',
        endsAt: '2026-08-11T16:00:00.000Z',
        meetLink: 'https://meet.google.com/priv-atex-yzw',
        youtubeVideoId: null,
      });
    });

    it('reads the MEMBER-facing list, so no requester identity can reach the card', async () => {
      // `listOwn` returns `MemberSessionRequest`, whose own keys are asserted by
      // `member-session-request-fields.spec.ts`. There is no `userId` on its
      // output for this mapper to leak, which is why the section reads that
      // method rather than the admin queue.
      const { section, listOwn } = createThreeWaySection({
        privateSessions: 'ok',
      });

      const resolved = await section.resolve(memberContext());

      expect(listOwn).toHaveBeenCalledWith(memberContext());
      expect(JSON.stringify(resolved.data)).not.toContain('userId');
      expect(JSON.stringify(resolved.data)).not.toContain('paymentStatus');
    });
  });

  describe('the live source — R3.1, R6.6', () => {
    it('maps a LiveFeedItem to kind: live, dropping state and durationSeconds', async () => {
      // A card is not a player. `state` and `durationSeconds` have no analogue
      // on the other two kinds, and NFR-S4 says a member-facing response
      // carries what the surface renders and nothing else.
      const { section } = createThreeWaySection({ live: 'ok' });

      const resolved = await section.resolve(memberContext());

      expect(resolved.data).toEqual({
        id: 'live_1',
        kind: 'live',
        title: 'Weekly build session',
        startsAt: '2026-08-09T18:00:00.000Z',
        endsAt: '2026-08-09T19:00:00.000Z',
        meetLink: null,
        youtubeVideoId: 'streamaaaaa',
      });
    });

    it('asks the feed for the SMALLEST replay page, since it renders none of them', async () => {
      // A card needs one session; paging the whole archive to answer it would
      // be a read that grows with the product for a value nothing uses.
      const { section, read } = createThreeWaySection({ live: 'ok' });

      await section.resolve(memberContext());

      expect(read).toHaveBeenCalledWith(memberContext(), { pageSize: 1 });
    });

    it('counts a RUNNING session as next, not only an upcoming one', async () => {
      // A session that started ten minutes ago is more relevant to a member
      // opening the hub than one starting tomorrow.
      const { section, read } = createThreeWaySection({ live: 'ok' });
      read.mockResolvedValue({
        upcoming: [
          { ...LIVE_ITEM, id: 'later', startsAt: '2026-08-20T18:00:00.000Z' },
        ],
        live: [
          { ...LIVE_ITEM, id: 'running', startsAt: '2026-08-01T18:00:00.000Z' },
        ],
        replays: { items: [], page: 1, pageSize: 1, total: 0, hasMore: false },
        calendarAvailable: false,
      });

      const resolved = await section.resolve(memberContext());

      expect(resolved.data).toMatchObject({ id: 'running' });
    });
  });

  describe('R6.6 — the envelope did not change', () => {
    it('still answers the same three statuses and the same nullable data shape', async () => {
      // The whole point of declaring HUB_SESSION_KINDS in Phase 1: Phase 4 adds
      // DATA. If this batch had needed a new status or a new field, the client
      // and the composer would both have had to change four phases later.
      const cases = await Promise.all([
        createThreeWaySection({ calendar: 'ok' }).section.resolve(
          memberContext(),
        ),
        createThreeWaySection({}).section.resolve(memberContext()),
        createThreeWaySection({
          calendar: 'unbound',
          live: 'unbound',
          privateSessions: 'unbound',
        }).section.resolve(memberContext()),
      ]);

      expect(cases.map((c) => c.status)).toEqual([
        'ok',
        'empty',
        'unavailable',
      ]);
      for (const resolved of cases) {
        expect(Object.keys(resolved).sort()).toEqual(['data', 'status']);
      }
      expect(Object.keys(cases[0]?.data ?? {}).sort()).toEqual([
        'endsAt',
        'id',
        'kind',
        'meetLink',
        'startsAt',
        'title',
        'youtubeVideoId',
      ]);
    });
  });
});
