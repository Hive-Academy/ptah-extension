import 'reflect-metadata';

import type { MemberContext } from '@ptah-api/membership';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  asPrismaService,
  countQueries,
  createMockPrisma,
  queryBreakdown,
  type MockForumPrisma,
} from '../../testing/mock-forum-prisma';
import { handlersOf, routeOf } from '../../testing/controller-reflection';
import { CategoriesService } from '../categories/categories.service';
import { ReactionsService } from '../reactions/reactions.service';
import { ReadStateService } from '../read-state/read-state.service';

import {
  ListTopicsQueryDto,
  resolveTopicQuery,
} from './dto/list-topics.query.dto';
import { MemberCommunityController } from './member-community.controller';
import { TopicsReadService } from './topics-read.service';

/**
 * R9.2 — "MY THREADS" IS THE FEED WITH `?mine=true`, AND NOTHING ELSE
 * (TASK_2026_177 F-3).
 *
 * ── THE GAP ────────────────────────────────────────────────────────────────
 * `implementation-plan.md:350` provisions `@@index([authorId])` "for My Threads
 * (R9.2)". The index shipped; the query parameter never did. With the app's
 * global `ValidationPipe({ forbidNonWhitelisted: true })`, an invented
 * `?authorId=me` is a `400 {"message":["property mine should not exist"]}` —
 * measured live before this fix — and `MemberSessionStore` carries no user id,
 * so the panel cannot filter client-side either. Batch 7's Task 7.6 was blocked
 * outright.
 *
 * ── WHY `mine=true` AND NOT `authorId=<id>` ────────────────────────────────
 * The server already knows who is asking: `MemberGuard` resolved
 * `req.memberContext.userId` before the handler ran (R7.3). A parameter that
 * NAMED an author would let any entitled member enumerate any other member's
 * threads — an authorisation hole wearing a filter's clothes, and one that no
 * amount of visibility filtering downstream would close, because the topics
 * genuinely are visible to them. `mine` is a boolean precisely so there is no
 * identity in it to forge. The last assertion block below is what keeps it that
 * way.
 *
 * ── AND IT IS A `where` CLAUSE, NOT A ROUTE AND NOT A QUERY ────────────────
 * No route was added: `EXPECTED_ROUTES` in `route-map.spec.ts` is unchanged, and
 * the block at the bottom asserts that from the controller's own metadata. No
 * named primitive was added either — `NAMED_PRIMITIVE_PARAM_COUNT = 6` is an
 * exact-equality assertion (RISK-I), so `mine` had to arrive as a property of
 * the existing whole-object `ListTopicsQueryDto`. And it costs no query: NFR-P4's
 * five-query budget is asserted below with the filter applied.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

const OTHER: MemberContext = { ...CTX, userId: 'user-2', email: 'b@x.com' };

const NOW = new Date('2026-08-05T12:00:00.000Z');

function feedQuery(
  overrides: Partial<ListTopicsQueryDto> = {},
): ListTopicsQueryDto {
  return Object.assign(new ListTopicsQueryDto(), overrides);
}

function topicRows(n: number, authorId: string) {
  return Array.from({ length: n }, (_, i) => ({
    id: `topic-${i}`,
    slug: `topic-${i}`,
    title: `Topic ${i}`,
    categoryId: 'cat-1',
    authorId,
    postCount: 0,
    pinned: false,
    locked: false,
    acceptedPostId: null,
    lastPostedAt: NOW,
    createdAt: NOW,
  }));
}

function build(prisma: MockForumPrisma): TopicsReadService {
  const categories = new CategoriesService(asPrismaService(prisma));
  return new TopicsReadService(
    asPrismaService(prisma),
    new ReadStateService(asPrismaService(prisma), categories),
    new ReactionsService(asPrismaService(prisma)),
  );
}

describe('R9.2 — the member feed accepts ?mine=true', () => {
  let prisma: MockForumPrisma;
  let service: TopicsReadService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = build(prisma);

    prisma.category.findMany.mockResolvedValue([
      { id: 'cat-1', name: 'General' },
      { id: 'cat-2', name: 'Help' },
    ]);
    prisma.topic.findMany.mockResolvedValue(topicRows(25, CTX.userId));
    prisma.topic.count.mockResolvedValue(25);
    prisma.topicReadState.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([
      { id: CTX.userId, firstName: 'Ada', lastName: 'Lovelace' },
    ]);
  });

  const whereOf = () =>
    prisma.topic.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;

  /* ------------------------------------------------------------------------ */
  /* The DTO                                                                   */
  /* ------------------------------------------------------------------------ */

  describe('ListTopicsQueryDto.mine', () => {
    it('accepts the affirmative spellings a query string can carry', () => {
      // Express hands query values over as STRINGS, and `'false'` is a truthy
      // string — so a bare `@Type(() => Boolean)` would turn `?mine=false` into
      // `true`. This is the same transform `ListAdminTopicsQueryDto.includeDeleted`
      // uses, for the same reason.
      for (const raw of ['true', '1', true]) {
        expect(plainToInstance(ListTopicsQueryDto, { mine: raw }).mine).toBe(
          true,
        );
      }
    });

    it('resolves every other spelling — including "false" — to false', () => {
      for (const raw of ['false', '0', '', 'yes', ['a', 'b'], false]) {
        expect(plainToInstance(ListTopicsQueryDto, { mine: raw }).mine).toBe(
          false,
        );
      }
    });

    it('validates cleanly when supplied and when omitted', async () => {
      expect(
        (await validate(plainToInstance(ListTopicsQueryDto, { mine: 'true' })))
          .length,
      ).toBe(0);
      expect(
        (await validate(plainToInstance(ListTopicsQueryDto, {}))).length,
      ).toBe(0);
    });

    it('resolveTopicQuery defaults it to false, outside the class', () => {
      // Same rule as `page` / `pageSize` / `sort`: a class-field initialiser
      // would make "omitted" and "sent false" indistinguishable after validation.
      expect(resolveTopicQuery(feedQuery()).mine).toBe(false);
      expect(resolveTopicQuery(feedQuery({ mine: true })).mine).toBe(true);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* The where clause                                                          */
  /* ------------------------------------------------------------------------ */

  describe('the filter is a where clause on the EXISTING query', () => {
    it('adds authorId = the CALLER, taken from MemberContext', async () => {
      await service.listFeed(CTX, feedQuery({ mine: true }));

      expect(whereOf()['authorId']).toBe(CTX.userId);
    });

    it('a different caller gets a different clause — the id is never client-supplied', async () => {
      await service.listFeed(OTHER, feedQuery({ mine: true }));

      expect(whereOf()['authorId']).toBe(OTHER.userId);
    });

    it('omitting it leaves NO authorId key at all, not `authorId: undefined`', async () => {
      await service.listFeed(CTX, feedQuery());

      expect('authorId' in whereOf()).toBe(false);
    });

    it('mine=false is the same as omitting it', async () => {
      await service.listFeed(CTX, feedQuery({ mine: false }));

      expect('authorId' in whereOf()).toBe(false);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Composition — the part that decides whether this is safe                  */
  /* ------------------------------------------------------------------------ */

  describe('it COMPOSES with visibility and NOT_DELETED, never replaces them', () => {
    it('carries the soft-delete filter and the visible-category restriction too', async () => {
      await service.listFeed(CTX, feedQuery({ mine: true }));

      expect(whereOf()).toEqual({
        deletedAt: null,
        categoryId: { in: ['cat-1', 'cat-2'] },
        authorId: CTX.userId,
      });
    });

    it('a member does NOT see their own topic in a category they can no longer see', async () => {
      // The scenario: the member wrote a thread in `cat-2`, an admin then
      // narrowed `cat-2` to `staff`. The thread is still THEIRS, so an author
      // filter applied INSTEAD of the visibility clause would hand it back.
      prisma.category.findMany.mockResolvedValue([
        { id: 'cat-1', name: 'General' },
      ]);

      await service.listFeed(CTX, feedQuery({ mine: true }));

      const where = whereOf();
      expect(where['categoryId']).toEqual({ in: ['cat-1'] });
      expect(where['authorId']).toBe(CTX.userId);
      // Both clauses are in ONE `where`, so Postgres ANDs them. There is no
      // branch that could apply the author filter alone.
      expect(where['deletedAt']).toBeNull();
    });

    it('a member who can see NO category gets an empty page even with mine=true', async () => {
      prisma.category.findMany.mockResolvedValue([]);

      const page = await service.listFeed(CTX, feedQuery({ mine: true }));

      expect(page.items).toEqual([]);
      expect(prisma.topic.findMany).not.toHaveBeenCalled();
    });

    it('an invisible ?categoryId is still a 404, mine or not', async () => {
      await expect(
        service.listFeed(CTX, feedQuery({ mine: true, categoryId: 'staff' })),
      ).rejects.toThrow();
    });

    it('composes with sort=unread rather than displacing it', async () => {
      prisma.topicReadState.findMany.mockResolvedValue([
        { topicId: 'topic-0', lastReadPostNumber: 3 },
      ]);

      await service.listFeed(CTX, feedQuery({ mine: true, sort: 'unread' }));

      const where = whereOf();
      expect(where['authorId']).toBe(CTX.userId);
      expect(where['OR']).toBeDefined();
      expect(where['deletedAt']).toBeNull();
    });

    it('the count runs under the SAME where as the page (R1.1.2)', async () => {
      await service.listFeed(CTX, feedQuery({ mine: true }));

      expect(prisma.topic.count.mock.calls[0]?.[0]?.where).toEqual(whereOf());
    });

    it('the ordering is unchanged — pinned first, then lastPostedAt', async () => {
      await service.listFeed(CTX, feedQuery({ mine: true }));

      expect(prisma.topic.findMany.mock.calls[0]?.[0]?.orderBy).toEqual([
        { pinned: 'desc' },
        { lastPostedAt: 'desc' },
      ]);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* NFR-P4 — it is a clause, not a second query                               */
  /* ------------------------------------------------------------------------ */

  describe('NFR-P4 — the five-query budget still holds', () => {
    it('a 25-topic mine=true feed costs exactly the same five queries', async () => {
      const page = await service.listFeed(
        CTX,
        feedQuery({ mine: true, pageSize: 25 }),
      );

      expect(page.items).toHaveLength(25);
      expect(countQueries(prisma)).toBeLessThanOrEqual(5);
      expect(queryBreakdown(prisma)).toEqual([
        'category.findMany x1',
        'topic.count x1',
        'topic.findMany x1',
        'topicReadState.findMany x1',
        'user.findMany x1',
      ]);
    });

    it('mine=true costs no more queries than mine omitted', async () => {
      await service.listFeed(CTX, feedQuery({ pageSize: 25 }));
      const without = countQueries(prisma);

      prisma = createMockPrisma();
      service = build(prisma);
      prisma.category.findMany.mockResolvedValue([
        { id: 'cat-1', name: 'General' },
      ]);
      prisma.topic.findMany.mockResolvedValue(topicRows(25, CTX.userId));
      prisma.topic.count.mockResolvedValue(25);
      prisma.topicReadState.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      await service.listFeed(CTX, feedQuery({ mine: true, pageSize: 25 }));

      expect(countQueries(prisma)).toBe(without);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* The authorisation property, and the shape of the surface                  */
  /* ------------------------------------------------------------------------ */

  describe('it is not an author-enumeration parameter', () => {
    it('the DTO declares no authorId / userId / authorEmail field', () => {
      // A client-supplied author id would let any entitled member read any other
      // member's thread list. There is nothing to forge because there is nothing
      // to send. Asserted against the CLASS, not against a `plainToInstance`
      // result — that helper copies unknown keys onto the instance by design;
      // rejecting them is `forbidNonWhitelisted`'s job, and the next case proves
      // that even a key which survived cannot reach the query.
      for (const forbidden of ['authorId', 'userId', 'authorEmail']) {
        expect({
          forbidden,
          declared: forbidden in new ListTopicsQueryDto(),
        }).toEqual({ forbidden, declared: false });
      }

      // The declared surface, pinned whole: a field added here later is a diff.
      expect(
        Object.keys(
          plainToInstance(ListTopicsQueryDto, {
            categoryId: 'c',
            mine: 'true',
            sort: 'recent',
            page: '1',
            pageSize: '25',
          }),
        ).sort(),
      ).toEqual(['categoryId', 'mine', 'page', 'pageSize', 'sort']);
    });

    it('sending an authorId cannot influence the where clause', async () => {
      const query = feedQuery({ mine: true }) as ListTopicsQueryDto &
        Record<string, unknown>;
      query['authorId'] = 'user-2';

      await service.listFeed(CTX, query);

      expect(whereOf()['authorId']).toBe(CTX.userId);
    });
  });

  describe('no new route — this is a parameter on GET topics', () => {
    it('the controller still declares exactly one topics-feed route', () => {
      // `POST v1/members/community/topics` (create) shares the path, so the
      // filter is on the VERB too — the feed is the one GET.
      const routes = handlersOf(MemberCommunityController).map((handler) =>
        routeOf(MemberCommunityController, handler),
      );

      expect(
        routes.filter(
          (r) => r.path === 'v1/members/community/topics' && r.verb === 'GET',
        ),
      ).toEqual([{ verb: 'GET', path: 'v1/members/community/topics' }]);
    });

    it('declares no my-threads / mine route anywhere', () => {
      // A new route would need `EXPECTED_ROUTES` in `route-map.spec.ts` and
      // `controller-registry.ts` updated in the same change. It does not.
      const paths = handlersOf(MemberCommunityController).map(
        (handler) => routeOf(MemberCommunityController, handler).path,
      );

      expect(
        paths.filter((p) => /my-threads|\bmine\b|authors?/.test(p)),
      ).toEqual([]);
    });
  });
});
