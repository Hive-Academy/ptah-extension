import 'reflect-metadata';

import { NotFoundException } from '@nestjs/common';
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
import { CategoriesService } from '../categories/categories.service';
import { ReactionsService } from '../reactions/reactions.service';
import { ReadStateService } from '../read-state/read-state.service';

import { ListTopicsQueryDto } from './dto/list-topics.query.dto';
import { TopicsReadService } from './topics-read.service';

/**
 * `TopicsReadService` — R1.2.5, R1.6.2, R1.6.3, NFR-P4, NFR-P5.
 *
 * ONE OF THE FOUR §8.2 P2 BACKEND EXIT-GATE ITEMS IS ASSERTED HERE: a 25-topic
 * feed executes AT MOST FIVE database queries ("NFR-P4" describe block).
 *
 * ⚠️ THE SERVICE UNDER TEST IS WIRED TO REAL COLLABORATORS, NOT TO STUBS.
 * `ReadStateService` and `ReactionsService` are constructed against the SAME
 * mock client, so every query they issue is counted too. Stubbing them would
 * make the budget assertion measure only this file's own queries and would
 * score a per-topic lookup hidden inside a collaborator as zero — which is
 * exactly the N+1 the budget exists to catch.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

const NOW = new Date('2026-08-04T12:00:00.000Z');

function build(prisma: MockForumPrisma): TopicsReadService {
  const categories = new CategoriesService(asPrismaService(prisma));
  return new TopicsReadService(
    asPrismaService(prisma),
    new ReadStateService(asPrismaService(prisma), categories),
    new ReactionsService(asPrismaService(prisma)),
  );
}

function feedQuery(
  overrides: Partial<ListTopicsQueryDto> = {},
): ListTopicsQueryDto {
  return Object.assign(new ListTopicsQueryDto(), overrides);
}

/** `n` topic rows in the projection `listFeed` selects. */
function topicRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `topic-${i}`,
    slug: `topic-${i}`,
    title: `Topic ${i}`,
    categoryId: 'cat-1',
    authorId: `author-${i % 3}`,
    postCount: i,
    pinned: false,
    locked: false,
    acceptedPostId: null,
    lastPostedAt: NOW,
    createdAt: NOW,
  }));
}

describe('TopicsReadService', () => {
  let prisma: MockForumPrisma;
  let service: TopicsReadService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = build(prisma);

    prisma.category.findMany.mockResolvedValue([
      { id: 'cat-1', name: 'General' },
    ]);
    prisma.topic.findMany.mockResolvedValue(topicRows(25));
    prisma.topic.count.mockResolvedValue(120);
    prisma.topicReadState.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'author-0', firstName: 'Ada', lastName: 'Lovelace' },
      { id: 'author-1', firstName: 'Alan', lastName: null },
      { id: 'author-2', firstName: null, lastName: null },
    ]);
  });

  /* ---------------------------------------------------------------------- */
  /* NFR-P4 — the §8.2 exit-gate item                                        */
  /* ---------------------------------------------------------------------- */

  describe('NFR-P4 — a 25-topic feed executes at most 5 queries', () => {
    it('sort=recent: a 25-topic feed costs exactly 5 queries and no more', async () => {
      const page = await service.listFeed(CTX, feedQuery({ pageSize: 25 }));

      expect(page.items).toHaveLength(25);
      expect(countQueries(prisma)).toBeLessThanOrEqual(5);
      // Pinned to the exact number so a SIXTH query is a failing test rather
      // than a silent regression toward the ceiling.
      expect(queryBreakdown(prisma)).toEqual([
        'category.findMany x1',
        'topic.count x1',
        'topic.findMany x1',
        'topicReadState.findMany x1',
        'user.findMany x1',
      ]);
    });

    it('sort=unread: still at most 5 queries', async () => {
      const page = await service.listFeed(
        CTX,
        feedQuery({ pageSize: 25, sort: 'unread' }),
      );

      expect(page.items).toHaveLength(25);
      expect(countQueries(prisma)).toBeLessThanOrEqual(5);
    });

    it('the read-state join is ONE findMany over topicId: { in: [...] }, never one per topic', async () => {
      await service.listFeed(CTX, feedQuery({ pageSize: 25 }));

      expect(prisma.topicReadState.findMany).toHaveBeenCalledTimes(1);
      const where = prisma.topicReadState.findMany.mock.calls[0]?.[0]?.where;

      expect(where.userId).toBe(CTX.userId);
      expect(where.topicId.in).toHaveLength(25);
      // The composite PK leads with `userId`, which is exactly this query.
      expect(prisma.topicReadState.findUnique).not.toHaveBeenCalled();
    });

    it('the author lookup is ONE findMany over deduplicated ids, never one per row', async () => {
      await service.listFeed(CTX, feedQuery({ pageSize: 25 }));

      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      // 25 rows, 3 distinct authors.
      expect(prisma.user.findMany.mock.calls[0]?.[0]?.where.id.in).toHaveLength(
        3,
      );
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('the query count does NOT grow with the page size — the N+1 signature', async () => {
      await service.listFeed(CTX, feedQuery({ pageSize: 25 }));
      const at25 = countQueries(prisma);

      prisma = createMockPrisma();
      service = build(prisma);
      prisma.category.findMany.mockResolvedValue([
        { id: 'cat-1', name: 'General' },
      ]);
      prisma.topic.findMany.mockResolvedValue(topicRows(50));
      prisma.topic.count.mockResolvedValue(120);
      prisma.topicReadState.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      await service.listFeed(CTX, feedQuery({ pageSize: 50 }));

      expect(countQueries(prisma)).toBe(at25);
    });

    it('the author lookup NEVER selects email (NFR-S4)', async () => {
      await service.listFeed(CTX, feedQuery({ pageSize: 25 }));

      const select = prisma.user.findMany.mock.calls[0]?.[0]?.select;
      expect(select).toEqual({ id: true, firstName: true, lastName: true });
      expect(select).not.toHaveProperty('email');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.2.5 — ordering                                                       */
  /* ---------------------------------------------------------------------- */

  describe('R1.2.5 — pinned first, then lastPostedAt descending', () => {
    it('orders in the QUERY, not in JavaScript', async () => {
      await service.listFeed(CTX, feedQuery());

      // Hoisting pinned rows after the fact would be wrong across page
      // boundaries: a pinned topic on page 3 would never reach page 1.
      expect(prisma.topic.findMany.mock.calls[0]?.[0]?.orderBy).toEqual([
        { pinned: 'desc' },
        { lastPostedAt: 'desc' },
      ]);
    });

    it('spreads NOT_DELETED and restricts to visible categories', async () => {
      await service.listFeed(CTX, feedQuery());

      const where = prisma.topic.findMany.mock.calls[0]?.[0]?.where;
      expect(where.deletedAt).toBeNull();
      expect(where.categoryId).toEqual({ in: ['cat-1'] });
    });

    it('the count runs under the SAME where as the page (R1.1.2)', async () => {
      await service.listFeed(CTX, feedQuery());

      expect(prisma.topic.count.mock.calls[0]?.[0]?.where).toEqual(
        prisma.topic.findMany.mock.calls[0]?.[0]?.where,
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.1.3 — invisible is 404                                               */
  /* ---------------------------------------------------------------------- */

  describe('R1.1.3 — invisible content is 404, never 403', () => {
    it('a categoryId the member cannot see is a 404', async () => {
      await expect(
        service.listFeed(CTX, feedQuery({ categoryId: 'staff-only' })),
      ).rejects.toBeInstanceOf(NotFoundException);
      // It never reached the topics table.
      expect(prisma.topic.findMany).not.toHaveBeenCalled();
    });

    it('a member who can see no category gets an empty page, not an error', async () => {
      prisma.category.findMany.mockResolvedValue([]);

      const page = await service.listFeed(CTX, feedQuery());

      expect(page).toEqual({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
        hasMore: false,
      });
      expect(countQueries(prisma)).toBe(1);
    });

    it('an admin sees the staff branch; a plain member does not', async () => {
      await service.listFeed(CTX, feedQuery());
      expect(
        prisma.category.findMany.mock.calls[0]?.[0]?.where.OR,
      ).toHaveLength(1);

      prisma.category.findMany.mockClear();
      await service.listFeed({ ...CTX, isAdmin: true }, feedQuery());
      expect(
        prisma.category.findMany.mock.calls[0]?.[0]?.where.OR,
      ).toHaveLength(2);
    });

    it('a topic whose category is invisible is not found by slug', async () => {
      prisma.topic.findFirst.mockResolvedValue(null);

      await expect(
        service.getThread(CTX, 'secret-thread'),
      ).rejects.toBeInstanceOf(NotFoundException);
      // The visibility clause was nested into the topic's own where.
      expect(
        prisma.topic.findFirst.mock.calls[0]?.[0]?.where.category,
      ).toBeDefined();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.6.2 / R1.6.3 — unread                                                */
  /* ---------------------------------------------------------------------- */

  describe('R1.6.2 / R1.6.3 — unread counts', () => {
    it('a never-opened topic reports its WHOLE reply count', async () => {
      prisma.topic.findMany.mockResolvedValue([
        { ...topicRows(1)[0], id: 't1', postCount: 12 },
      ]);
      prisma.topicReadState.findMany.mockResolvedValue([]); // no row at all

      const page = await service.listFeed(CTX, feedQuery());

      expect(page.items[0]?.unreadCount).toBe(12);
      expect(page.items[0]?.replyCount).toBe(12);
    });

    it('the absence of a row IS the signal — no read-state row is written by a read', async () => {
      await service.listFeed(CTX, feedQuery());

      expect(prisma.topicReadState.create).not.toHaveBeenCalled();
      expect(prisma.topicReadState.upsert).not.toHaveBeenCalled();
      expect(prisma.topicReadState.createMany).not.toHaveBeenCalled();
    });

    it('unread is postCount - lastReadPostNumber', async () => {
      prisma.topic.findMany.mockResolvedValue([
        { ...topicRows(1)[0], id: 't1', postCount: 10 },
      ]);
      prisma.topicReadState.findMany.mockResolvedValue([
        { topicId: 't1', lastReadPostNumber: 4 },
      ]);

      const page = await service.listFeed(CTX, feedQuery());

      expect(page.items[0]?.unreadCount).toBe(6);
    });

    it('unread is CLAMPED at 0 when lastReadPostNumber exceeds postCount', async () => {
      // Real, not defensive: `postCount` DECREASES when a reply is soft-deleted
      // while the marker only increases. Without the clamp the feed renders a
      // negative badge.
      prisma.topic.findMany.mockResolvedValue([
        { ...topicRows(1)[0], id: 't1', postCount: 3 },
      ]);
      prisma.topicReadState.findMany.mockResolvedValue([
        { topicId: 't1', lastReadPostNumber: 9 },
      ]);

      const page = await service.listFeed(CTX, feedQuery());

      expect(page.items[0]?.unreadCount).toBe(0);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The thread read model                                                   */
  /* ---------------------------------------------------------------------- */

  describe('getThread', () => {
    const TOPIC = {
      id: 'topic-1',
      slug: 'hello',
      title: 'Hello',
      categoryId: 'cat-1',
      authorId: 'author-0',
      pinned: false,
      locked: false,
      acceptedPostId: null as string | null,
      createdAt: NOW,
      lastPostedAt: NOW,
      editedAt: null,
      category: { name: 'General' },
    };

    const post = (over: Record<string, unknown> = {}) => ({
      id: 'p1',
      postNumber: 1,
      parentId: null,
      bodyMarkdown: 'the body',
      deletedAt: null,
      createdAt: NOW,
      editedAt: null,
      authorId: 'author-0',
      ...over,
    });

    beforeEach(() => {
      prisma.topic.findFirst.mockResolvedValue({ ...TOPIC });
      prisma.post.findMany.mockResolvedValue([post()]);
      prisma.post.count.mockResolvedValue(1);
      prisma.postReaction.groupBy.mockResolvedValue([]);
      prisma.postReaction.findMany.mockResolvedValue([]);
    });

    it('returns post #1 as the body — there is no bodyMarkdown on the topic (AD-9)', async () => {
      const detail = await service.getThread(CTX, 'hello');

      expect(detail).not.toHaveProperty('bodyMarkdown');
      expect(detail.posts.items[0]?.postNumber).toBe(1);
      expect(detail.posts.items[0]?.bodyMarkdown).toBe('the body');
    });

    it('orders posts by postNumber, which is total and stable within the topic', async () => {
      await service.getThread(CTX, 'hello');

      expect(prisma.post.findMany.mock.calls[0]?.[0]?.orderBy).toEqual({
        postNumber: 'asc',
      });
    });

    it('INCLUDES a tombstone that still has live children (R1.3.5)', async () => {
      await service.getThread(CTX, 'hello');

      const where = prisma.post.findMany.mock.calls[0]?.[0]?.where;
      // Live posts OR tombstones holding live replies — expressed in the WHERE,
      // not by fetching everything and filtering afterwards.
      expect(where.OR).toEqual([
        { deletedAt: null },
        { children: { some: { deletedAt: null } } },
      ]);
    });

    it('withholds a tombstone body and author, and reports deleted: true', async () => {
      prisma.post.findMany.mockResolvedValue([
        post(),
        post({
          id: 'p2',
          postNumber: 2,
          bodyMarkdown: 'the removed text',
          deletedAt: NOW,
          authorId: 'author-1',
        }),
      ]);
      prisma.post.count.mockResolvedValue(2);

      const detail = await service.getThread(CTX, 'hello');
      const tombstone = detail.posts.items[1];

      expect(tombstone?.deleted).toBe(true);
      expect(tombstone?.bodyMarkdown).toBe('');
      expect(tombstone?.authorName).toBeNull();
      // It keeps its position in the thread.
      expect(tombstone?.postNumber).toBe(2);
      // The removed text does not reach the wire anywhere in the response.
      expect(JSON.stringify(detail)).not.toContain('the removed text');
    });

    it('hoists the accepted answer AND leaves it in place, carrying accepted: true', async () => {
      prisma.topic.findFirst.mockResolvedValue({
        ...TOPIC,
        acceptedPostId: 'p2',
      });
      prisma.post.findMany.mockResolvedValue([
        post(),
        post({ id: 'p2', postNumber: 2, bodyMarkdown: 'the answer' }),
      ]);
      prisma.post.count.mockResolvedValue(2);

      const detail = await service.getThread(CTX, 'hello');

      // Both copies — this duplication IS the design (§3.3, R1.5.1).
      expect(detail.acceptedPost?.id).toBe('p2');
      expect(detail.posts.items.map((p) => p.id)).toEqual(['p1', 'p2']);
      expect(detail.posts.items[1]?.accepted).toBe(true);
      expect(detail.posts.items[0]?.accepted).toBe(false);
    });

    it('fetches the accepted answer when it is OFF this page — the reason the hoist exists', async () => {
      prisma.topic.findFirst.mockResolvedValue({
        ...TOPIC,
        acceptedPostId: 'p99',
      });
      prisma.post.findMany.mockResolvedValue([post()]);
      prisma.post.count.mockResolvedValue(80);
      prisma.post.findFirst.mockResolvedValue(
        post({ id: 'p99', postNumber: 40, bodyMarkdown: 'the answer' }),
      );

      const detail = await service.getThread(CTX, 'hello', {
        page: 1,
        pageSize: 25,
      });

      // An accepted answer that landed on page 4 must still be readable from
      // page 1 without paging to it.
      expect(detail.acceptedPost?.id).toBe('p99');
      expect(detail.acceptedPost?.bodyMarkdown).toBe('the answer');
      expect(detail.posts.items.map((p) => p.id)).toEqual(['p1']);
    });

    it('costs no extra query when the topic has no accepted answer', async () => {
      await service.getThread(CTX, 'hello');

      expect(prisma.post.findFirst).not.toHaveBeenCalled();
    });

    it('reaction counts are TOTAL — every type present, zero-valued', async () => {
      const detail = await service.getThread(CTX, 'hello');

      expect(detail.posts.items[0]?.reactions).toEqual({
        like: 0,
        insightful: 0,
        celebrate: 0,
        thanks: 0,
      });
      expect(detail.posts.items[0]?.myReactions).toEqual([]);
    });

    it('reaction counts for the whole page come back in ONE groupBy', async () => {
      prisma.post.findMany.mockResolvedValue([
        post(),
        post({ id: 'p2', postNumber: 2 }),
        post({ id: 'p3', postNumber: 3 }),
      ]);
      prisma.postReaction.groupBy.mockResolvedValue([
        { postId: 'p2', type: 'like', _count: { _all: 4 } },
        { postId: 'p2', type: 'thanks', _count: { _all: 1 } },
      ]);
      prisma.postReaction.findMany.mockResolvedValue([
        { postId: 'p2', type: 'like' },
      ]);

      const detail = await service.getThread(CTX, 'hello');

      expect(prisma.postReaction.groupBy).toHaveBeenCalledTimes(1);
      expect(detail.posts.items[1]?.reactions).toEqual({
        like: 4,
        insightful: 0,
        celebrate: 0,
        thanks: 1,
      });
      expect(detail.posts.items[1]?.myReactions).toEqual(['like']);
    });

    it('joins author names without ever selecting an email', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'author-0', firstName: 'Ada', lastName: 'Lovelace' },
      ]);

      const detail = await service.getThread(CTX, 'hello');

      expect(detail.authorName).toBe('Ada Lovelace');
      expect(detail.posts.items[0]?.authorName).toBe('Ada Lovelace');
      expect(JSON.stringify(detail)).not.toContain('@');
    });

    it('a post with a null author (migrated content, A-4) reports authorName null', async () => {
      prisma.post.findMany.mockResolvedValue([post({ authorId: null })]);
      prisma.user.findMany.mockResolvedValue([]);

      const detail = await service.getThread(CTX, 'hello');

      expect(detail.posts.items[0]?.authorName).toBeNull();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* NFR-P5 — the DTO gate                                                   */
  /* ---------------------------------------------------------------------- */

  describe('ListTopicsQueryDto (NFR-P5)', () => {
    const invalidProps = async (payload: Record<string, unknown>) => {
      const dto = plainToInstance(ListTopicsQueryDto, payload);
      return (await validate(dto)).map((error) => error.property);
    };

    it('pageSize=51 is a 400 — the cap is enforced BEFORE the service is entered', async () => {
      expect(await invalidProps({ pageSize: 51 })).toEqual(['pageSize']);
      expect(await invalidProps({ pageSize: 50 })).toEqual([]);
    });

    it('page=0 is a 400 — paging is 1-based', async () => {
      expect(await invalidProps({ page: 0 })).toEqual(['page']);
    });

    it('rejects an unknown sort value', async () => {
      expect(await invalidProps({ sort: 'popular' })).toEqual(['sort']);
      expect(await invalidProps({ sort: 'unread' })).toEqual([]);
    });

    it('coerces numeric query strings — @Type(() => Number) is load-bearing', async () => {
      const dto = plainToInstance(ListTopicsQueryDto, {
        page: '3',
        pageSize: '10',
      });

      expect(dto.page).toBe(3);
      expect(await validate(dto)).toEqual([]);
    });

    it('an omitted pageSize defaults to 25 and is echoed back', async () => {
      const page = await service.listFeed(CTX, feedQuery());

      expect(page.pageSize).toBe(25);
      expect(prisma.topic.findMany.mock.calls[0]?.[0]?.take).toBe(25);
      expect(prisma.topic.findMany.mock.calls[0]?.[0]?.skip).toBe(0);
    });

    it('page 3 at pageSize 10 skips 20 rows', async () => {
      await service.listFeed(CTX, feedQuery({ page: 3, pageSize: 10 }));

      expect(prisma.topic.findMany.mock.calls[0]?.[0]?.skip).toBe(20);
      expect(prisma.topic.findMany.mock.calls[0]?.[0]?.take).toBe(10);
    });

    it('hasMore is derived from page * pageSize < total', async () => {
      prisma.topic.count.mockResolvedValue(30);

      const page = await service.listFeed(
        CTX,
        feedQuery({ page: 1, pageSize: 25 }),
      );
      expect(page.hasMore).toBe(true);

      prisma.topic.count.mockResolvedValue(25);
      const last = await service.listFeed(
        CTX,
        feedQuery({ page: 1, pageSize: 25 }),
      );
      expect(last.hasMore).toBe(false);
    });
  });
});
