import type { MemberContext } from '@ptah-api/membership';
import type {
  MemberHubResponse,
  MemberTopicSummary,
} from '@ptah-contracts/community';
import type { TopicsReadService } from '@ptah-api/forum';
import type { PrismaService } from '@ptah-api/core';

import type { CohortBadgesService } from '../cohort-badges.service';
import { MemberHubService } from '../member-hub.service';
import { CommunitySection } from './community.section';
import { LearningSection } from './learning.section';
import { NotificationsSection } from './notifications.section';
import { PacksSection } from './packs.section';
import type { SessionsSection } from './sessions.section';

/**
 * The hub's `community` section — Phase 2's `'empty'` → `'ok'` transition
 * (R6.1, R6.3, R6.4, R6.6, AD-4).
 *
 * Three things are asserted here and nowhere else:
 *
 *   1. The ENVELOPE is unchanged. R6.6's claim is that a phase changes which
 *      sections report `'ok'`, never the shape — so a Phase-1 client parsing the
 *      hub must still parse it after Batch 6.
 *   2. `'unavailable'` is reached by a FAILING forum and by nothing else, and
 *      the hub still answers (AD-4). The composer has a generic case for this;
 *      this section is the first one with real work behind it, so it is the
 *      first that can actually fail.
 *   3. R6.2 — still ONE request. The card carries `slug`, which is what it links
 *      to; nothing about the payload makes a client want a second call.
 */

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

function feedRow(
  overrides: Partial<MemberTopicSummary> = {},
): MemberTopicSummary {
  return {
    id: 't-1',
    slug: 'a-topic',
    title: 'A topic',
    categoryId: 'c-1',
    categoryName: 'General',
    authorName: 'Ada L',
    replyCount: 4,
    unreadCount: 2,
    pinned: false,
    locked: false,
    hasAcceptedAnswer: true,
    lastPostedAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function forumReturning(items: MemberTopicSummary[]): {
  service: TopicsReadService;
  listFeed: jest.Mock;
} {
  const listFeed = jest.fn().mockResolvedValue({
    items,
    page: 1,
    pageSize: 5,
    total: items.length,
    hasMore: false,
  });
  return { service: { listFeed } as unknown as TopicsReadService, listFeed };
}

function failingForum(error: Error): TopicsReadService {
  return {
    listFeed: jest.fn().mockRejectedValue(error),
  } as unknown as TopicsReadService;
}

describe('CommunitySection', () => {
  describe('status', () => {
    it('reports "ok" with the topics when there are any', async () => {
      const { service } = forumReturning([feedRow()]);

      const section = await new CommunitySection(service).resolve(
        memberContext(),
      );

      expect(section.status).toBe('ok');
      expect(section.data).toHaveLength(1);
    });

    it('reports "empty" — not "unavailable" — when the query ran and found nothing', async () => {
      const { service } = forumReturning([]);

      // R6.4: `'empty'` means there is no data; `'unavailable'` means a source
      // failed. Collapsing them is how a broken forum ships looking healthy.
      await expect(
        new CommunitySection(service).resolve(memberContext()),
      ).resolves.toEqual({ status: 'empty', data: [] });
    });

    it('does NOT catch a forum failure — it lets the composer degrade it', async () => {
      const section = new CommunitySection(
        failingForum(new Error('relation "community_topics" does not exist')),
      );

      // Catching here and returning `'empty'` would read as defensive and would
      // tell the member "no community activity" on the strength of a query that
      // failed — with nothing logged.
      await expect(section.resolve(memberContext())).rejects.toThrow(
        'community_topics',
      );
    });
  });

  describe('the query it issues', () => {
    it('asks for recent topics, capped at the card size', async () => {
      const { service, listFeed } = forumReturning([]);

      await new CommunitySection(service).resolve(memberContext());

      expect(listFeed).toHaveBeenCalledTimes(1);
      expect(listFeed.mock.calls[0][1]).toEqual({
        sort: 'recent',
        pageSize: 5,
      });
    });

    it('does NOT use sort=unread, which would empty the card for a caught-up member', async () => {
      const { service, listFeed } = forumReturning([]);

      await new CommunitySection(service).resolve(memberContext());

      // `sort: 'unread'` FILTERS to topics with unread activity. A fully
      // caught-up member would then get `'empty'`, i.e. "there is no
      // community" — which is a different claim from "you are up to date".
      expect(listFeed.mock.calls[0][1].sort).not.toBe('unread');
    });

    it('passes the guard-resolved context straight through (R7.3)', async () => {
      const { service, listFeed } = forumReturning([]);
      const ctx = memberContext({ cohortKeys: ['founding'], isAdmin: true });

      await new CommunitySection(service).resolve(ctx);

      // Visibility is built from this object inside `listFeed`'s SQL. Nothing
      // here re-derives entitlement or cohorts, and nothing filters afterwards.
      expect(listFeed.mock.calls[0][0]).toBe(ctx);
    });
  });

  describe('the card row (NFR-S4/S5) — it DROPS fields rather than spreading', () => {
    it('carries exactly the eight HubTopicSummary keys', async () => {
      const { service } = forumReturning([feedRow()]);

      const section = await new CommunitySection(service).resolve(
        memberContext(),
      );

      expect(Object.keys(section.data[0]).sort()).toEqual(
        [
          'id',
          'slug',
          'title',
          'categoryName',
          'replyCount',
          'unreadCount',
          'lastPostedAt',
          'pinned',
        ].sort(),
      );
    });

    it('omits the feed-only fields, so a wider feed row cannot leak into the hub', async () => {
      const { service } = forumReturning([feedRow()]);

      const section = await new CommunitySection(service).resolve(
        memberContext(),
      );
      const serialized = JSON.stringify(section.data[0]);

      // A `{ ...row }` would put all of these in the hub the moment
      // `MemberTopicSummary` grows a field — which is exactly why
      // `HubTopicSummary` is a distinct type rather than an alias.
      for (const absent of [
        'authorName',
        'categoryId',
        'locked',
        'hasAcceptedAnswer',
        'createdAt',
      ]) {
        expect({ absent, present: serialized.includes(absent) }).toEqual({
          absent,
          present: false,
        });
      }
    });

    it('preserves each row unread count from the feed rather than recomputing it', async () => {
      const { service } = forumReturning([
        feedRow({ id: 't-1', unreadCount: 0 }),
        feedRow({ id: 't-2', unreadCount: 7 }),
      ]);

      const section = await new CommunitySection(service).resolve(
        memberContext(),
      );

      // `listFeed` computes this inside its five-query budget from the same
      // read-state markers `ReadStateService` would return. Deriving it a second
      // time here would let the card and the feed disagree.
      expect(section.data.map((row) => row.unreadCount)).toEqual([0, 7]);
    });

    it('carries slug — the card is a LAUNCHER, and slug is what it links to', async () => {
      const { service } = forumReturning([feedRow({ slug: 'how-to-ptah' })]);

      const section = await new CommunitySection(service).resolve(
        memberContext(),
      );

      // R6.2: the detail request happens on NAVIGATION. If the card lacked the
      // link target, the client would need a second call for the initial render.
      expect(section.data[0].slug).toBe('how-to-ptah');
    });
  });

  describe('R6.6 / AD-4 — through the real composer', () => {
    function composer(topics: TopicsReadService): MemberHubService {
      return new MemberHubService(
        {
          user: {
            findUnique: jest.fn().mockResolvedValue({ firstName: 'Ada' }),
          },
        } as unknown as PrismaService,
        {
          resolveBadges: jest.fn().mockResolvedValue([]),
        } as unknown as CohortBadgesService,
        // TASK_2026_177 P3 — `LearningSection` now takes `CourseReadService`.
        // A curriculum that genuinely returns nothing, so this composer's
        // `learning` section stays `'empty'` and does not perturb the community
        // assertions below.
        new LearningSection({
          listCourses: jest.fn().mockResolvedValue([]),
          getCourse: jest.fn(),
        } as never),
        new CommunitySection(topics),
        {
          resolve: jest
            .fn()
            .mockResolvedValue({ status: 'unavailable', data: null }),
        } as unknown as SessionsSection,
        // TASK_2026_177 P5 — both Phase-5 sections now take a collaborator.
        // Each is given one that genuinely ANSWERS WITH NOTHING, so both stay
        // `'empty'` and do not perturb the community assertions below. A
        // throwing double would be a second fault injected into a file whose
        // subject is exactly one.
        new PacksSection({ list: jest.fn().mockResolvedValue([]) } as never),
        new NotificationsSection({
          unreadCount: jest.fn().mockResolvedValue({ unreadCount: 0 }),
        } as never),
      );
    }

    async function compose(
      topics: TopicsReadService,
    ): Promise<MemberHubResponse> {
      return composer(topics).compose(memberContext());
    }

    it('a FAILING forum degrades ONLY this section — the hub still answers', async () => {
      const hub = await compose(failingForum(new Error('connection refused')));

      // AD-4's whole point: one broken source is one degraded card inside a 200,
      // never a 500 for the home screen.
      expect(hub.sections.community).toEqual({
        status: 'unavailable',
        data: [],
      });
      expect(hub.member.firstName).toBe('Ada');
      expect(hub.sections.packs.status).toBe('empty');
      expect(hub.sections.notifications.status).toBe('empty');
    });

    it('the ENVELOPE is byte-identical whether the forum works or fails (R6.6)', async () => {
      const ok = await compose(forumReturning([feedRow()]).service);
      const broken = await compose(failingForum(new Error('boom')));

      const shape = (hub: MemberHubResponse) => ({
        top: Object.keys(hub).sort(),
        sections: Object.keys(hub.sections).sort(),
        community: Object.keys(hub.sections.community).sort(),
      });

      // A phase changes WHICH sections report `'ok'` — never the shape, and
      // never the number of requests.
      expect(shape(ok)).toEqual(shape(broken));
      expect(shape(ok).sections).toEqual([
        'community',
        'learning',
        'notifications',
        'packs',
        'sessions',
      ]);
    });

    it('reports "ok" through the composer once the forum has topics', async () => {
      const hub = await compose(forumReturning([feedRow()]).service);

      expect(hub.sections.community.status).toBe('ok');
      expect(hub.sections.community.data).toHaveLength(1);
    });

    it('resolves every section in ONE concurrent round (R6.2)', async () => {
      const { service, listFeed } = forumReturning([feedRow()]);

      await compose(service);

      // One hub request, one forum query. A section that issued a query per card
      // row would show up here as more than one call.
      expect(listFeed).toHaveBeenCalledTimes(1);
    });
  });
});
