import { NotFoundException } from '@nestjs/common';
import { REACTION_TYPES } from '@ptah-contracts/community';
import type { MemberContext } from '@ptah-api/membership';

import {
  asPrismaService,
  createMockPrisma,
  type MockForumPrisma,
} from '../../testing/mock-forum-prisma';

import { ReactionsService } from './reactions.service';
import { emptyReactionCounts } from './reaction-types';

/**
 * `ReactionsService` — R1.4.1–R1.4.4, A-8, RK-1.
 *
 * ⚠️ THE LOAD-BEARING ASSERTION HERE IS "COUNTS ARE DERIVED, NEVER STORED"
 * (R1.4.4). RK-1 forbids denormalised reaction counters, and `Topic.postCount`
 * is the single denormalisation this design allows (AD-11) — licensed only by
 * its own consistency test. A second counter would need a second such test, so
 * the tests below assert that NO counter column is ever written.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

function build(prisma: MockForumPrisma): ReactionsService {
  return new ReactionsService(asPrismaService(prisma));
}

describe('ReactionsService', () => {
  let prisma: MockForumPrisma;
  let service: ReactionsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = build(prisma);

    prisma.post.findFirst.mockResolvedValue({ id: 'post-1' });
    prisma.postReaction.findUnique.mockResolvedValue(null);
    prisma.postReaction.create.mockResolvedValue({});
    prisma.postReaction.delete.mockResolvedValue({});
    prisma.postReaction.groupBy.mockResolvedValue([]);
    prisma.postReaction.findMany.mockResolvedValue([]);
  });

  /* ---------------------------------------------------------------------- */
  /* R1.4.1 — the toggle                                                     */
  /* ---------------------------------------------------------------------- */

  describe('R1.4.1 — toggle is delete-if-exists-else-create, in ONE transaction', () => {
    it('creates the row when the member has not reacted', async () => {
      await service.toggle(CTX, 'post-1', 'like');

      expect(prisma.postReaction.create).toHaveBeenCalledWith({
        data: { postId: 'post-1', userId: CTX.userId, type: 'like' },
      });
      expect(prisma.postReaction.delete).not.toHaveBeenCalled();
    });

    it('a SECOND identical reaction REMOVES the row', async () => {
      prisma.postReaction.findUnique.mockResolvedValue({ id: 'reaction-9' });

      await service.toggle(CTX, 'post-1', 'like');

      expect(prisma.postReaction.delete).toHaveBeenCalledWith({
        where: { id: 'reaction-9' },
      });
      expect(prisma.postReaction.create).not.toHaveBeenCalled();
    });

    it('the read and the write happen inside ONE transaction', async () => {
      // Read-then-write across two round trips lets a double-tap observe "no
      // reaction" twice and both create, which the unique constraint rejects.
      await service.toggle(CTX, 'post-1', 'like');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('identifies the reaction by the composite unique — one per member per post per type', async () => {
      await service.toggle(CTX, 'post-1', 'thanks');

      expect(prisma.postReaction.findUnique.mock.calls[0]?.[0]?.where).toEqual({
        postId_userId_type: {
          postId: 'post-1',
          userId: CTX.userId,
          type: 'thanks',
        },
      });
    });

    it('returns the post-change counts, read inside the same transaction', async () => {
      prisma.postReaction.groupBy.mockResolvedValue([
        { type: 'like', _count: { _all: 3 } },
      ]);
      prisma.postReaction.findMany.mockResolvedValue([{ type: 'like' }]);

      const result = await service.toggle(CTX, 'post-1', 'like');

      expect(result.counts.like).toBe(3);
      expect(result.mine).toEqual(['like']);
    });

    it('toggling one type leaves the member other reactions untouched', async () => {
      prisma.postReaction.findMany.mockResolvedValue([
        { type: 'like' },
        { type: 'thanks' },
      ]);

      const result = await service.toggle(CTX, 'post-1', 'thanks');

      expect(result.mine.sort()).toEqual(['like', 'thanks']);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.4.4 — counts are derived                                             */
  /* ---------------------------------------------------------------------- */

  describe('R1.4.4 — counts are DERIVED, never stored (RK-1)', () => {
    it('derives counts with groupBy and writes no counter column anywhere', async () => {
      await service.toggle(CTX, 'post-1', 'like');

      expect(prisma.postReaction.groupBy).toHaveBeenCalledTimes(1);
      // No `Post.likeCount`, no `Topic` counter touched by a reaction.
      expect(prisma.post.update).not.toHaveBeenCalled();
      expect(prisma.post.updateMany).not.toHaveBeenCalled();
      expect(prisma.topic.update).not.toHaveBeenCalled();
    });

    it('counts are TOTAL — every type present, zero-valued when unreacted', async () => {
      prisma.postReaction.groupBy.mockResolvedValue([
        { type: 'celebrate', _count: { _all: 2 } },
      ]);

      const result = await service.toggle(CTX, 'post-1', 'celebrate');

      for (const type of REACTION_TYPES) {
        expect(result.counts[type]).toBeDefined();
        expect(typeof result.counts[type]).toBe('number');
      }
      expect(result.counts).toEqual({
        like: 0,
        insightful: 0,
        celebrate: 2,
        thanks: 0,
      });
    });

    it('ignores a stored type outside the fixed four — the column is a String, not an enum', async () => {
      prisma.postReaction.groupBy.mockResolvedValue([
        { type: 'like', _count: { _all: 1 } },
        { type: 'rocket', _count: { _all: 99 } },
      ]);

      const result = await service.toggle(CTX, 'post-1', 'like');

      expect(result.counts).not.toHaveProperty('rocket');
      expect(result.counts.like).toBe(1);
    });

    it('emptyReactionCounts returns a FRESH object each call, never a shared constant', () => {
      const a = emptyReactionCounts();
      const b = emptyReactionCounts();

      a.like = 5;

      // A shared frozen constant aliased into 25 posts would make one mutation
      // change all of them.
      expect(b.like).toBe(0);
      expect(a).not.toBe(b);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Visibility                                                              */
  /* ---------------------------------------------------------------------- */

  describe('visibility and tombstones', () => {
    it('reacting to an invisible or soft-deleted post is 404', async () => {
      prisma.post.findFirst.mockResolvedValue(null);

      await expect(
        service.toggle(CTX, 'post-1', 'like'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.postReaction.create).not.toHaveBeenCalled();
    });

    it('the lookup filters the post AND reaches through to the topic and category', async () => {
      await service.toggle(CTX, 'post-1', 'like');

      const where = prisma.post.findFirst.mock.calls[0]?.[0]?.where;
      expect(where.deletedAt).toBeNull();
      expect(where.topic.deletedAt).toBeNull();
      expect(where.topic.category.OR).toBeDefined();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* summarize — the batched read the thread uses                            */
  /* ---------------------------------------------------------------------- */

  describe('summarize', () => {
    it('returns empty maps without querying for an empty page', async () => {
      const summary = await service.summarize([], CTX.userId);

      expect(summary.counts.size).toBe(0);
      expect(prisma.postReaction.groupBy).not.toHaveBeenCalled();
    });

    it('costs TWO queries for a whole page, never two per post (NFR-P4)', async () => {
      await service.summarize(['p1', 'p2', 'p3'], CTX.userId);

      expect(prisma.postReaction.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.postReaction.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.postReaction.findUnique).not.toHaveBeenCalled();
    });

    it('groups counts by postId and type in one result set', async () => {
      prisma.postReaction.groupBy.mockResolvedValue([
        { postId: 'p1', type: 'like', _count: { _all: 2 } },
        { postId: 'p1', type: 'thanks', _count: { _all: 1 } },
        { postId: 'p2', type: 'like', _count: { _all: 5 } },
      ]);

      const summary = await service.summarize(['p1', 'p2'], CTX.userId);

      expect(summary.counts.get('p1')).toEqual({
        like: 2,
        insightful: 0,
        celebrate: 0,
        thanks: 1,
      });
      expect(summary.counts.get('p2')?.like).toBe(5);
    });

    it('reports only the REQUESTING member own reactions', async () => {
      prisma.postReaction.findMany.mockResolvedValue([
        { postId: 'p1', type: 'like' },
        { postId: 'p1', type: 'thanks' },
      ]);

      const summary = await service.summarize(['p1', 'p2'], CTX.userId);

      expect(
        prisma.postReaction.findMany.mock.calls[0]?.[0]?.where.userId,
      ).toBe(CTX.userId);
      expect(summary.mine.get('p1')?.sort()).toEqual(['like', 'thanks']);
      expect(summary.mine.get('p2')).toBeUndefined();
    });

    it('a post with no reactions is simply absent from the map', async () => {
      const summary = await service.summarize(['p1'], CTX.userId);

      expect(summary.counts.get('p1')).toBeUndefined();
    });
  });
});
