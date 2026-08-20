import type { PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type { HubSessionSummary } from '@ptah-contracts/community';
import { CohortBadgesService } from './cohort-badges.service';
import { MemberHubService } from './member-hub.service';
import type { CommunitySection } from './sections/community.section';
import type { LearningSection } from './sections/learning.section';
import type { NotificationsSection } from './sections/notifications.section';
import type { PacksSection } from './sections/packs.section';
import type { SessionsSection } from './sections/sessions.section';

/**
 * Unit tests for the AD-4 composer.
 *
 * ⚠️ THE R6.4 FAULT-INJECTION CASE IS THE REASON THIS FILE EXISTS. Every other
 * assertion here would pass just as well against `Promise.all`. The one that
 * forces a resolver to reject and then demands the other four come back intact
 * would not — it is the executable difference between the two, and it is why
 * the choice cannot silently regress into `Promise.all` during a later phase.
 *
 * Strategy: hand-rolled resolvers over the real service, so the assertions are
 * about composition and degradation rather than Nest DI.
 */

const SECTION_NAMES = [
  'learning',
  'community',
  'sessions',
  'packs',
  'notifications',
] as const;

function memberContext(overrides: Partial<MemberContext> = {}): MemberContext {
  return {
    userId: 'user_1',
    email: 'member@example.com',
    entitled: true,
    cohortKeys: [],
    isAdmin: false,
    ...overrides,
  };
}

const A_SESSION: HubSessionSummary = {
  id: 'evt_1',
  kind: 'calendar',
  title: 'Builders session',
  startsAt: '2026-08-10T15:00:00.000Z',
  endsAt: '2026-08-10T16:00:00.000Z',
  meetLink: 'https://meet.google.com/abc-defg-hij',
  youtubeVideoId: null,
};

interface Harness {
  service: MemberHubService;
  sections: Record<(typeof SECTION_NAMES)[number], { resolve: jest.Mock }>;
  prisma: { user: { findUnique: jest.Mock } };
  cohortBadges: { resolveBadges: jest.Mock };
}

function createService(
  opts: {
    firstName?: string | null;
    userMissing?: boolean;
    prismaThrows?: boolean;
    cohorts?: { key: string; name: string }[];
  } = {},
): Harness {
  const sections = {
    learning: {
      resolve: jest.fn().mockResolvedValue({ status: 'empty', data: null }),
    },
    community: {
      resolve: jest.fn().mockResolvedValue({ status: 'empty', data: [] }),
    },
    sessions: {
      resolve: jest.fn().mockResolvedValue({ status: 'ok', data: A_SESSION }),
    },
    packs: {
      resolve: jest.fn().mockResolvedValue({ status: 'empty', data: [] }),
    },
    notifications: {
      resolve: jest.fn().mockResolvedValue({
        status: 'empty',
        data: { unreadCount: 0 },
      }),
    },
  };

  const findUnique = opts.prismaThrows
    ? jest
        .fn()
        .mockRejectedValue(new Error('connection to db "ptah_db" failed'))
    : jest
        .fn()
        .mockResolvedValue(
          opts.userMissing ? null : { firstName: opts.firstName ?? 'Abdallah' },
        );
  const prisma = { user: { findUnique } };

  const cohortBadges = {
    resolveBadges: jest.fn().mockResolvedValue(opts.cohorts ?? []),
  };

  const service = new MemberHubService(
    prisma as unknown as PrismaService,
    cohortBadges as unknown as CohortBadgesService,
    sections.learning as unknown as LearningSection,
    sections.community as unknown as CommunitySection,
    sections.sessions as unknown as SessionsSection,
    sections.packs as unknown as PacksSection,
    sections.notifications as unknown as NotificationsSection,
  );

  for (const level of ['error', 'warn'] as const) {
    jest
      .spyOn(
        (service as unknown as { logger: Record<string, () => void> }).logger,
        level,
      )
      .mockImplementation(() => undefined);
  }

  return { service, sections, prisma, cohortBadges };
}

describe('MemberHubService — the AD-4 Promise.allSettled composer', () => {
  describe('the envelope (R6.6)', () => {
    it('returns all five sections, always, in the frozen shape', async () => {
      const { service } = createService();

      const hub = await service.compose(memberContext());

      expect(Object.keys(hub.sections).sort()).toEqual(
        [...SECTION_NAMES].sort(),
      );
      expect(Object.keys(hub).sort()).toEqual(['member', 'sections']);
    });

    it('every section carries both a status and a data key', async () => {
      const { service } = createService();

      const hub = await service.compose(memberContext());

      for (const name of SECTION_NAMES) {
        expect(Object.keys(hub.sections[name]).sort()).toEqual([
          'data',
          'status',
        ]);
      }
    });

    it('Phase 1 populates sessions and reports the other four as empty', async () => {
      const { service } = createService();

      const hub = await service.compose(memberContext());

      expect({
        learning: hub.sections.learning,
        community: hub.sections.community,
        sessions: hub.sections.sessions,
        packs: hub.sections.packs,
        notifications: hub.sections.notifications,
      }).toEqual({
        learning: { status: 'empty', data: null },
        community: { status: 'empty', data: [] },
        sessions: { status: 'ok', data: A_SESSION },
        packs: { status: 'empty', data: [] },
        notifications: { status: 'empty', data: { unreadCount: 0 } },
      });
    });
  });

  describe('R6.4 — fault isolation (the reason it is allSettled, not all)', () => {
    // ⚠️ `Promise.all` CANNOT PASS THIS BLOCK. It rejects on the first
    // rejection and discards the four results that succeeded, which is exactly
    // the blank home screen R6.4 forbids.
    it.each(SECTION_NAMES)(
      'a rejected %s section degrades to unavailable and the other four survive',
      async (failing) => {
        const { service, sections } = createService();
        sections[failing].resolve.mockRejectedValue(
          new Error('upstream exploded'),
        );

        const hub = await service.compose(memberContext());

        expect(hub.sections[failing].status).toBe('unavailable');

        const survivors = SECTION_NAMES.filter((n) => n !== failing);
        expect(survivors.map((n) => [n, hub.sections[n].status])).toEqual(
          survivors.map((n) => [n, n === 'sessions' ? 'ok' : 'empty']),
        );
      },
    );

    it('a rejected section still carries its EMPTY SHAPE, never null, for array sections', async () => {
      const { service, sections } = createService();
      sections.community.resolve.mockRejectedValue(new Error('forum down'));
      sections.packs.resolve.mockRejectedValue(new Error('packs down'));
      sections.notifications.resolve.mockRejectedValue(new Error('notif down'));
      sections.learning.resolve.mockRejectedValue(new Error('learning down'));
      sections.sessions.resolve.mockRejectedValue(new Error('calendar down'));

      const hub = await service.compose(memberContext());

      expect(hub.sections).toEqual({
        learning: { status: 'unavailable', data: null },
        community: { status: 'unavailable', data: [] },
        sessions: { status: 'unavailable', data: null },
        packs: { status: 'unavailable', data: [] },
        notifications: { status: 'unavailable', data: { unreadCount: 0 } },
      });
    });

    it('never leaks a dependency message onto the response (NFR-S7)', async () => {
      const { service, sections } = createService();
      sections.community.resolve.mockRejectedValue(
        new Error(
          'relation "topics" does not exist at postgres://ptah:hunter2@db',
        ),
      );

      const hub = await service.compose(memberContext());

      expect(JSON.stringify(hub)).not.toMatch(/hunter2|relation|postgres:/);
    });

    it('runs the resolvers CONCURRENTLY, not in sequence', async () => {
      // AD-4 sizes the section budget as parallel round-trips (NFR-P1). If a
      // later edit turned the fan-out into an await-per-section loop the
      // response would still be correct and the latency budget would be gone,
      // so the concurrency is asserted rather than assumed.
      const { service, sections } = createService();
      const started: string[] = [];
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      for (const name of SECTION_NAMES) {
        sections[name].resolve.mockImplementation(async () => {
          started.push(name);
          await gate;
          return { status: 'empty', data: null };
        });
      }

      const pending = service.compose(memberContext());
      await Promise.resolve();
      // All five must have STARTED before any of them is allowed to finish.
      expect(started.sort()).toEqual([...SECTION_NAMES].sort());

      release?.();
      await pending;
    });
  });

  describe('the member block', () => {
    it('carries the first name and the named cohorts', async () => {
      const { service, cohortBadges } = createService({
        firstName: 'Abdallah',
        cohorts: [{ key: 'founding', name: 'Founding Members' }],
      });

      const hub = await service.compose(
        memberContext({ cohortKeys: ['founding'] }),
      );

      expect(hub.member).toEqual({
        firstName: 'Abdallah',
        cohorts: [{ key: 'founding', name: 'Founding Members' }],
      });
      // Names the keys the GUARD resolved — it never re-derives membership.
      expect(cohortBadges.resolveBadges).toHaveBeenCalledWith(['founding']);
    });

    it('an entitled member with ZERO cohorts composes normally (R7.8, A-2)', async () => {
      // This is the LIVE DEFAULT: member_group_assignments is empty, so every
      // real user hits this path on their first request.
      const { service } = createService({ cohorts: [] });

      const hub = await service.compose(memberContext({ cohortKeys: [] }));

      expect(hub.member.cohorts).toEqual([]);
      expect(hub.sections.sessions.status).toBe('ok');
    });

    it('falls back to a null first name rather than failing the hub', async () => {
      const { service } = createService({ userMissing: true });

      const hub = await service.compose(memberContext());

      expect(hub.member.firstName).toBeNull();
      expect(hub.sections.sessions.status).toBe('ok');
    });

    it('a first-name lookup failure degrades the greeting, not the hub', async () => {
      const { service } = createService({ prismaThrows: true });

      const hub = await service.compose(memberContext());

      expect(hub.member).toEqual({ firstName: null, cohorts: [] });
      expect(hub.sections.sessions.status).toBe('ok');
    });
  });

  describe('R7.3 — the context is consumed, never re-derived', () => {
    it('passes the guard-resolved context straight to every resolver', async () => {
      const { service, sections } = createService();
      const ctx = memberContext({ cohortKeys: ['founding'] });

      await service.compose(ctx);

      for (const name of SECTION_NAMES) {
        expect(sections[name].resolve).toHaveBeenCalledWith(ctx);
      }
    });
  });
});
