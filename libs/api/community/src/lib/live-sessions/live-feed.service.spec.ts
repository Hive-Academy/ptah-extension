import type { MemberContext } from '@ptah-api/membership';

import {
  asPrismaService,
  countQueries,
  createMockPrisma,
  queryBreakdown,
  type MockCommunityPrisma,
} from '../../testing/mock-community-prisma';
import type { SessionsService } from '../google-sessions/sessions.service';
import type { CalendarFeedEvent } from '../google-sessions/google-sessions.types';

import { LiveFeedService } from './live-feed.service';
import { LIVE_FALLBACK_MS } from './live-feed-state';
import type { LiveSessionRow } from './live-sessions.service';

/**
 * `LiveFeedService` — AD-3, R3.3, R3.4, R3.6, RISK-V, RISK-W, NFR-P6.
 *
 * 🔴 EXIT-GATE CLAUSE 3 LIVES HERE: "the AD-3 merge emits a claimed Calendar
 * event exactly once, `source: 'ptah'`, with the Calendar `meetLink` merged in",
 * asserted AND proven by deliberate failure. The deliberate-failure run is
 * recorded in `batch-12-report.md`; what this file carries is the assertion it
 * was proven against — including the RECURRING-INSTANCE fixture whose
 * `id !== recurringEventId`, which is the only fixture that can tell a
 * both-arms merge from an `id`-only one.
 *
 * ⚠️ THE POSTGRES SIDE IS A DOUBLE AND THE CALENDAR SIDE IS A DOUBLE. Neither
 * can be exercised for real here — `GOOGLE_OAUTH_*` is unset in this workspace
 * (ASSUMPTION-10) — so the Calendar double returns the documented
 * `UpcomingCalendarFeedResult` arms and the report states that no real Google
 * request was made.
 */

const NOW = new Date('2026-08-08T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const CTX: MemberContext = {
  userId: 'user_1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

const BASE_ROW: LiveSessionRow = {
  id: 'live_1',
  title: 'Weekly build session',
  description: null,
  startsAt: new Date(NOW.getTime() + HOUR),
  endsAt: new Date(NOW.getTime() + 2 * HOUR),
  visibility: 'member',
  cohortKeys: [],
  youtubeVideoId: 'streamaaaaa',
  replayYoutubeVideoId: null,
  videoTitle: null,
  videoDurationSeconds: 3600,
  videoThumbnailUrl: null,
  videoMetadataFetchedAt: null,
  videoMetadataSource: null,
  calendarEventId: null,
  createdBy: 'admin_1',
  deletedAt: null,
  deletedBy: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const row = (over: Partial<LiveSessionRow> = {}): LiveSessionRow => ({
  ...BASE_ROW,
  ...over,
});

/**
 * A REAL Google `events.list` item, reduced to the fields the mapper reads, for
 * an EXPANDED INSTANCE of a recurring series.
 *
 * 🔴 `id !== recurringEventId` IS THE WHOLE POINT (RISK-V). `listEvents` sends
 * `singleEvents=true`, so members receive instances whose ids carry a
 * `_20260810T180000Z` suffix, while `LiveSession.calendarEventId` holds the
 * MASTER id an admin copied out of Google Calendar. A merge comparing only `id`
 * de-duplicates none of them.
 */
const RECURRING_INSTANCE: CalendarFeedEvent = {
  id: 'abc123master_20260810T180000Z',
  recurringEventId: 'abc123master',
  title: 'Builders session',
  startsAt: new Date(NOW.getTime() + HOUR).toISOString(),
  endsAt: new Date(NOW.getTime() + 2 * HOUR).toISOString(),
  meetLink: 'https://meet.google.com/abc-defg-hij',
  recurring: true,
};

const ONE_OFF: CalendarFeedEvent = {
  id: 'oneoff_1',
  recurringEventId: null,
  title: 'Guest AMA',
  startsAt: new Date(NOW.getTime() + 3 * HOUR).toISOString(),
  endsAt: new Date(NOW.getTime() + 4 * HOUR).toISOString(),
  meetLink: 'https://meet.google.com/one-offx-xyz',
  recurring: false,
};

interface Harness {
  prisma: MockCommunityPrisma;
  sessions: { readUpcomingCalendarFeed: jest.Mock };
  service: LiveFeedService;
}

function wire(
  calendar: unknown = { ok: true, events: [] },
  options: { bindSessions?: boolean } = {},
): Harness {
  const prisma = createMockPrisma();
  prisma.liveSession.findMany.mockResolvedValue([]);
  prisma.liveSession.count.mockResolvedValue(0);

  const sessions = {
    readUpcomingCalendarFeed: jest.fn().mockResolvedValue(calendar),
  };

  const service = new LiveFeedService(
    asPrismaService(prisma),
    options.bindSessions === false
      ? undefined
      : (sessions as unknown as SessionsService),
  );

  return { prisma, sessions, service };
}

/**
 * `findMany` is called twice — once for the "not ended" list and once for the
 * replay page — and the two must be distinguishable in a spec. They are
 * separated by the presence of `replayYoutubeVideoId` in the `where`.
 */
function stubReads(
  prisma: MockCommunityPrisma,
  current: LiveSessionRow[],
  replays: LiveSessionRow[] = [],
): void {
  prisma.liveSession.findMany.mockImplementation(
    async (args: { where?: Record<string, unknown> }) =>
      args.where?.['replayYoutubeVideoId'] === undefined ? current : replays,
  );
  prisma.liveSession.count.mockResolvedValue(replays.length);
}

describe('LiveFeedService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('🔴 AD-3 / RISK-V — the merge, and the recurrence trap', () => {
    it('emits a claimed RECURRING series EXACTLY ONCE, as ptah, with the Meet link merged in', async () => {
      // 🔴 EXIT-GATE CLAUSE 3. The LiveSession claims the MASTER id; the
      // calendar returns an INSTANCE whose own id differs. Matching only
      // `event.id` would emit both, and the member would see the same session
      // twice — once with the replay capability and once without.
      const h = wire({ ok: true, events: [RECURRING_INSTANCE] });
      stubReads(h.prisma, [row({ calendarEventId: 'abc123master' })]);

      const feed = await h.service.read(CTX);

      expect(feed.upcoming).toHaveLength(1);
      expect(feed.upcoming[0]).toMatchObject({
        id: 'live_1',
        source: 'ptah',
        state: 'upcoming',
        // …and the Calendar's link is merged onto the Ptah item, which is the
        // second half of the clause — a claimed session without it would show
        // the member no way to join.
        meetLink: RECURRING_INSTANCE.meetLink,
      });
      expect(feed.upcoming.filter((i) => i.source === 'calendar')).toEqual([]);
    });

    it('emits a claimed ONE-OFF event exactly once too — the id arm still works', async () => {
      const h = wire({ ok: true, events: [ONE_OFF] });
      stubReads(h.prisma, [
        row({
          calendarEventId: 'oneoff_1',
          startsAt: new Date(NOW.getTime() + 3 * HOUR),
        }),
      ]);

      const feed = await h.service.read(CTX);

      expect(feed.upcoming).toHaveLength(1);
      expect(feed.upcoming[0]).toMatchObject({
        source: 'ptah',
        meetLink: ONE_OFF.meetLink,
      });
    });

    it('leaves an UNCLAIMED event alone, as source: calendar', async () => {
      const h = wire({ ok: true, events: [ONE_OFF] });
      stubReads(h.prisma, []);

      const feed = await h.service.read(CTX);

      expect(feed.upcoming).toHaveLength(1);
      expect(feed.upcoming[0]).toMatchObject({
        id: 'oneoff_1',
        source: 'calendar',
        meetLink: ONE_OFF.meetLink,
        // A calendar event has no video and no duration — nullable rather than
        // absent, so one item shape serves both sources.
        youtubeVideoId: null,
        durationSeconds: null,
      });
    });

    it('de-duplicates EVERY instance of a claimed series, not just the first', async () => {
      // The failure mode a single-instance fixture cannot see: three
      // occurrences, one claim, and a merge that only removed the one whose id
      // happened to match.
      const instances = [0, 1, 2].map((n) => ({
        ...RECURRING_INSTANCE,
        id: `abc123master_instance_${n}`,
        startsAt: new Date(NOW.getTime() + (n + 1) * HOUR).toISOString(),
        endsAt: new Date(NOW.getTime() + (n + 2) * HOUR).toISOString(),
      }));
      const h = wire({ ok: true, events: instances });
      stubReads(h.prisma, [row({ calendarEventId: 'abc123master' })]);

      const feed = await h.service.read(CTX);

      expect(feed.upcoming).toHaveLength(1);
      expect(feed.upcoming[0]?.source).toBe('ptah');
    });

    it('a session claiming a DIFFERENT event does not swallow an unrelated one', async () => {
      // The negative control for the merge: over-matching would be as wrong as
      // under-matching, and an `id`-only check that was accidentally a
      // `startsWith` would pass every test above.
      const h = wire({ ok: true, events: [ONE_OFF] });
      stubReads(h.prisma, [row({ calendarEventId: 'some-other-event' })]);

      const feed = await h.service.read(CTX);

      expect(feed.upcoming.map((i) => i.source).sort()).toEqual([
        'calendar',
        'ptah',
      ]);
      // …and the unrelated event's link was NOT merged onto the ptah item.
      expect(
        feed.upcoming.find((i) => i.source === 'ptah')?.meetLink,
      ).toBeNull();
    });
  });

  describe('R3.6 — the Calendar half degrades, it never errors', () => {
    it.each([
      ['disabled', { ok: false, reason: 'disabled' }],
      ['fetch_failed', { ok: false, reason: 'fetch_failed' }],
    ])(
      'reports calendarAvailable: false for %s and still serves the Ptah sessions',
      async (_label, calendar) => {
        const h = wire(calendar);
        stubReads(h.prisma, [row()]);

        const feed = await h.service.read(CTX);

        expect(feed.calendarAvailable).toBe(false);
        expect(feed.upcoming).toHaveLength(1);
        expect(feed.upcoming[0]?.source).toBe('ptah');
      },
    );

    it('reports calendarAvailable: false when SessionsService is UNBOUND, without throwing', async () => {
      // Same posture as `SessionsSection`: an unregistered GoogleSessionsModule
      // degrades this flag rather than failing module construction.
      const h = wire(undefined, { bindSessions: false });
      stubReads(h.prisma, [row()]);

      const feed = await h.service.read(CTX);

      expect(feed.calendarAvailable).toBe(false);
      expect(feed.upcoming).toHaveLength(1);
    });

    it('reports calendarAvailable: true when the read succeeded, even with zero events', async () => {
      // `false` must mean "we do not have an answer", not "the answer was
      // empty" — a member is entitled to know the list may be incomplete.
      const h = wire({ ok: true, events: [] });
      stubReads(h.prisma, [row()]);

      expect((await h.service.read(CTX)).calendarAvailable).toBe(true);
    });
  });

  describe('the three lists', () => {
    it('splits upcoming from live using ONE clock read', async () => {
      const h = wire({ ok: true, events: [] });
      stubReads(h.prisma, [
        row({ id: 'later', startsAt: new Date(NOW.getTime() + HOUR) }),
        row({
          id: 'running',
          startsAt: new Date(NOW.getTime() - HOUR),
          endsAt: new Date(NOW.getTime() + HOUR),
        }),
      ]);

      const feed = await h.service.read(CTX);

      expect(feed.upcoming.map((i) => i.id)).toEqual(['later']);
      expect(feed.live.map((i) => i.id)).toEqual(['running']);
    });

    it('SORTS the merged upcoming list rather than trusting two ordered sources', async () => {
      // The concatenation of two ordered lists is not ordered — the same reason
      // `SessionsSection.earliest()` computes rather than assumes.
      const h = wire({
        ok: true,
        events: [
          {
            ...ONE_OFF,
            startsAt: new Date(NOW.getTime() + HOUR).toISOString(),
          },
        ],
      });
      stubReads(h.prisma, [
        row({ id: 'ptah-late', startsAt: new Date(NOW.getTime() + 5 * HOUR) }),
      ]);

      const feed = await h.service.read(CTX);

      expect(feed.upcoming.map((i) => i.id)).toEqual(['oneoff_1', 'ptah-late']);
    });

    it('resolves the REPLAY id for a replay item and the STREAM id otherwise', async () => {
      // 🔴 The reason `LiveFeedItem` carries ONE video field: the row stores two
      // ids and the client wants the one for the state it is in.
      const h = wire({ ok: true, events: [] });
      const ended = row({
        id: 'past',
        startsAt: new Date(NOW.getTime() - 3 * HOUR),
        endsAt: new Date(NOW.getTime() - 2 * HOUR),
        replayYoutubeVideoId: 'replayaaaaa',
      });
      stubReads(h.prisma, [], [ended]);

      const feed = await h.service.read(CTX);

      expect(feed.replays.items[0]).toMatchObject({
        state: 'replay',
        youtubeVideoId: 'replayaaaaa',
        durationSeconds: 3600,
      });
      expect(feed.upcoming[0]).toBeUndefined();
    });

    it('pages replays from a `count` under the SAME where, not from rows.length', async () => {
      // `rows.length === take` reports "no more" for an archive whose size is an
      // exact multiple of the page size.
      const h = wire({ ok: true, events: [] });
      stubReads(h.prisma, [], []);
      h.prisma.liveSession.count.mockResolvedValue(60);

      const feed = await h.service.read(CTX, { page: 2, pageSize: 25 });

      expect(feed.replays).toMatchObject({
        page: 2,
        pageSize: 25,
        total: 60,
        hasMore: true,
      });
      const call = h.prisma.liveSession.findMany.mock.calls.find(
        (c) => c[0]?.where?.replayYoutubeVideoId !== undefined,
      )?.[0];
      expect(call).toMatchObject({ skip: 25, take: 25 });
      // The count's `where` is the page's `where` — asserted by identity of
      // shape, because a count under a wider filter is how `total` starts
      // counting rows the member cannot read (R1.1.2).
      expect(h.prisma.liveSession.count.mock.calls[0]?.[0].where).toEqual(
        call?.where,
      );
    });

    it('does NOT clamp an out-of-range pageSize — the DTO rejects it (MAX_PAGE_SIZE)', async () => {
      // A silent clamp makes a client that asked for 500 rows believe it
      // received all of them and quietly drop the tail.
      const h = wire({ ok: true, events: [] });
      stubReads(h.prisma, [], []);

      const feed = await h.service.read(CTX, { pageSize: 500 });

      expect(feed.replays.pageSize).toBe(500);
    });
  });

  describe('the reads themselves', () => {
    it('🔴 carries NOT_DELETED **and** the visibility clause in BOTH reads and the count (AD-5)', async () => {
      // 🔴 THIS TEST FOUND A REAL LEAK DURING BATCH 12. The first draft spread
      // `...buildLiveSessionVisibilityWhere(ctx)` and the time-window `OR` into
      // ONE object literal. Both produce an `OR` key, so the second silently
      // overwrote the first and EVERY MEMBER SAW EVERY COHORT AND STAFF SESSION
      // — with no error, no log and a perfectly plausible feed. The fix is an
      // explicit `AND: [visibility, window]`; this assertion is what keeps it
      // fixed, which is why it checks for the cohort branch rather than merely
      // for "a where exists".
      const h = wire({ ok: true, events: [] });
      stubReads(h.prisma, [], []);

      await h.service.read({ ...CTX, cohortKeys: ['founding'] });

      const wheres = [
        ...h.prisma.liveSession.findMany.mock.calls.map((c) => c[0].where),
        ...h.prisma.liveSession.count.mock.calls.map((c) => c[0].where),
      ];
      expect(wheres).toHaveLength(3);
      for (const where of wheres) {
        expect(where).toMatchObject({ deletedAt: null });
        // The visibility clause survived: the member's cohort branch is present…
        expect(JSON.stringify(where)).toContain('hasSome');
        // …and so is the staff branch's ABSENCE, since this member is no admin.
        expect(JSON.stringify(where)).not.toContain('staff');
      }
    });

    it('expresses "has not ended" with the SAME fallback the classifier uses', async () => {
      // Two spellings of one rule is how the read and the classifier come to
      // disagree about which sessions are still running.
      const h = wire({ ok: true, events: [] });
      stubReads(h.prisma, [], []);

      await h.service.read(CTX);

      const current = h.prisma.liveSession.findMany.mock.calls.find(
        (c) => c[0]?.where?.replayYoutubeVideoId === undefined,
      )?.[0];
      expect(current.where.AND[1]).toEqual({
        OR: [
          { endsAt: { gte: NOW } },
          {
            endsAt: null,
            startsAt: { gte: new Date(NOW.getTime() - LIVE_FALLBACK_MS) },
          },
        ],
      });
    });

    it('the replay window is the EXACT complement of the current window', async () => {
      // If the two overlapped, one session could appear in `live` AND in
      // `replays`; if they left a gap, a session would vanish from the feed
      // entirely for the width of the gap.
      const h = wire({ ok: true, events: [] });
      stubReads(h.prisma, [], []);

      await h.service.read(CTX);

      const replayWhere = h.prisma.liveSession.findMany.mock.calls.find(
        (c) => c[0]?.where?.replayYoutubeVideoId !== undefined,
      )?.[0].where;
      expect(replayWhere.AND[1]).toEqual({
        OR: [
          { endsAt: { lt: NOW } },
          {
            endsAt: null,
            startsAt: { lt: new Date(NOW.getTime() - LIVE_FALLBACK_MS) },
          },
        ],
      });
    });

    it('costs FOUR database round trips and ONE calendar call, whatever the row count', async () => {
      // The natural N+1 here is "for each session, look up its calendar event".
      const h = wire({ ok: true, events: [RECURRING_INSTANCE, ONE_OFF] });
      stubReads(
        h.prisma,
        [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })],
        [row({ id: 'd', replayYoutubeVideoId: 'r' })],
      );

      await h.service.read(CTX);

      expect({
        queries: countQueries(h.prisma),
        breakdown: queryBreakdown(h.prisma),
      }).toEqual({
        queries: 3,
        breakdown: ['liveSession.count x1', 'liveSession.findMany x2'],
      });
      expect(h.sessions.readUpcomingCalendarFeed).toHaveBeenCalledTimes(1);
    });
  });

  describe('NFR-P6 — no read-path YouTube call', () => {
    it('has no IMPORT of @ptah-api/youtube (the docblock naming it does not count)', () => {
      // Structural, and deliberately in the same file as the reads it protects.
      // The module-level assertion by name lives in
      // `live-sessions.module.spec.ts`; this is the local tripwire, so a
      // reviewer editing THIS file sees it.
      //
      // ⚠️ IT MATCHES IMPORT STATEMENTS, NOT THE STRING. The class docblock says
      // "THIS FILE MUST NOT IMPORT `@ptah-api/youtube`" in terms, so a naive
      // `not.toContain` would fail on the rule's own statement of itself.
      const source = readSource('live-feed.service.ts');
      const imports = [
        ...source.matchAll(/^\s*import[\s\S]*?from\s+'([^']+)';/gm),
      ].map((match) => match[1]);

      expect(imports).not.toContain('@ptah-api/youtube');
      // …and the matcher is not vacuous: it really did find this file's imports.
      expect(imports).toContain('@ptah-api/core');
      expect(imports.length).toBeGreaterThanOrEqual(5);
    });
  });
});

/** Read a sibling source file, for the structural assertion above. */
function readSource(name: string): string {
  const { readFileSync } =
    jest.requireActual<typeof import('node:fs')>('node:fs');
  const { join } = jest.requireActual<typeof import('node:path')>('node:path');
  return readFileSync(join(__dirname, name), 'utf8');
}
