import 'reflect-metadata';

import { NotFoundException } from '@nestjs/common';
import type { MemberContext } from '@ptah-api/membership';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  asPrismaService,
  createMockPrisma,
  type MockForumPrisma,
} from '../../testing/mock-forum-prisma';
import { CategoriesService } from '../categories/categories.service';

import { MarkReadDto } from './dto/mark-read.dto';
import { ReadStateService, unreadCount } from './read-state.service';

/**
 * `ReadStateService` — A-6, R1.6.1–R1.6.6.
 *
 * ⚠️ THE PROPERTY THIS FILE PROTECTS IS MONOTONICITY. An out-of-order client —
 * two tabs, a retried request, a slow response overtaken by a newer one —
 * must never UN-READ a thread. That is a comparison against stored state, so no
 * DTO can enforce it and it is asserted here.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

function build(prisma: MockForumPrisma): ReadStateService {
  return new ReadStateService(
    asPrismaService(prisma),
    new CategoriesService(asPrismaService(prisma)),
  );
}

describe('ReadStateService', () => {
  let prisma: MockForumPrisma;
  let service: ReadStateService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = build(prisma);

    prisma.topic.findFirst.mockResolvedValue({ id: 'topic-1', postCount: 10 });
    prisma.topicReadState.upsert.mockResolvedValue({});
    prisma.topicReadState.updateMany.mockResolvedValue({ count: 1 });
    prisma.topicReadState.findUnique.mockResolvedValue({
      lastReadPostNumber: 10,
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.6.2 — the unread calculation                                         */
  /* ---------------------------------------------------------------------- */

  describe('R1.6.2 / R1.6.3 — unreadCount', () => {
    it('is postCount minus lastReadPostNumber', () => {
      expect(unreadCount(10, 4)).toBe(6);
    });

    it('is CLAMPED at 0 when the marker exceeds postCount', () => {
      // Real, not defensive: postCount DECREASES on a soft delete while the
      // marker only increases. Unclamped this renders "-2 new".
      expect(unreadCount(8, 10)).toBe(0);
    });

    it('a never-read topic (marker 0) reports its whole reply count (R1.6.3)', () => {
      expect(unreadCount(12, 0)).toBe(12);
    });

    it('a topic with no replies is never unread', () => {
      expect(unreadCount(0, 0)).toBe(0);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.6.1 — the marker never moves backwards                               */
  /* ---------------------------------------------------------------------- */

  describe('R1.6.1 — markRead is MONOTONIC', () => {
    it('creates the row on a first read', async () => {
      await service.markRead(CTX, 'topic-1', 7);

      expect(prisma.topicReadState.upsert.mock.calls[0]?.[0]).toMatchObject({
        where: { userId_topicId: { userId: CTX.userId, topicId: 'topic-1' } },
        create: {
          userId: CTX.userId,
          topicId: 'topic-1',
          lastReadPostNumber: 7,
        },
      });
    });

    it('the upsert UPDATE branch is EMPTY — that is the "never backwards" statement', async () => {
      await service.markRead(CTX, 'topic-1', 7);

      // The advance is decided by the guarded updateMany, not by the upsert.
      expect(prisma.topicReadState.upsert.mock.calls[0]?.[0]?.update).toEqual(
        {},
      );
    });

    it('advances only when the new number is GREATER — the comparison is in the WHERE', async () => {
      await service.markRead(CTX, 'topic-1', 7);

      expect(prisma.topicReadState.updateMany).toHaveBeenCalledWith({
        where: {
          userId: CTX.userId,
          topicId: 'topic-1',
          // Evaluated by Postgres against the committed row, not against a
          // value this process read a moment ago.
          lastReadPostNumber: { lt: 7 },
        },
        data: { lastReadPostNumber: 7 },
      });
    });

    it('an out-of-order LOWER number leaves the stored marker alone', async () => {
      // The guarded updateMany matches no row; the empty upsert update is a
      // no-op. Nothing moves backwards.
      prisma.topicReadState.updateMany.mockResolvedValue({ count: 0 });
      prisma.topicReadState.findUnique.mockResolvedValue({
        lastReadPostNumber: 9,
      });

      const result = await service.markRead(CTX, 'topic-1', 2);

      expect(result.unreadCount).toBe(1); // 10 - 9, not 10 - 2
    });

    it('both statements run in ONE transaction', async () => {
      await service.markRead(CTX, 'topic-1', 7);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('reports the resulting unread count', async () => {
      prisma.topicReadState.findUnique.mockResolvedValue({
        lastReadPostNumber: 10,
      });

      expect(await service.markRead(CTX, 'topic-1', 10)).toEqual({
        unreadCount: 0,
      });
    });

    it('an over-large marker clamps to 0 unread rather than erroring', async () => {
      prisma.topicReadState.findUnique.mockResolvedValue({
        lastReadPostNumber: 999,
      });

      expect(await service.markRead(CTX, 'topic-1', 999)).toEqual({
        unreadCount: 0,
      });
    });

    it('an invisible or soft-deleted topic is 404', async () => {
      prisma.topic.findFirst.mockResolvedValue(null);

      await expect(service.markRead(CTX, 'topic-1', 5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.topicReadState.upsert).not.toHaveBeenCalled();
    });

    it('the topic lookup carries NOT_DELETED and the category visibility clause', async () => {
      await service.markRead(CTX, 'topic-1', 5);

      const where = prisma.topic.findFirst.mock.calls[0]?.[0]?.where;
      expect(where.deletedAt).toBeNull();
      expect(where.category.OR).toBeDefined();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.6.5 — mark all read                                                  */
  /* ---------------------------------------------------------------------- */

  describe('R1.6.5 — markCategoryRead', () => {
    beforeEach(() => {
      prisma.category.findFirst.mockResolvedValue({
        id: 'cat-1',
        name: 'General',
      });
      prisma.topic.findMany.mockResolvedValue([
        { id: 't1', postCount: 4 },
        { id: 't2', postCount: 0 },
        { id: 't3', postCount: 9 },
      ]);
      prisma.topicReadState.deleteMany.mockResolvedValue({ count: 1 });
      prisma.topicReadState.createMany.mockResolvedValue({ count: 3 });
    });

    it('is ONE transaction and a deleteMany/createMany PAIR — not a loop', async () => {
      await service.markCategoryRead(CTX, 'cat-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.topicReadState.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.topicReadState.createMany).toHaveBeenCalledTimes(1);
      // No per-topic upsert.
      expect(prisma.topicReadState.upsert).not.toHaveBeenCalled();
      expect(prisma.topicReadState.update).not.toHaveBeenCalled();
    });

    it('writes each topic OWN postCount, not one uniform value', async () => {
      // A uniform large value would mark every topic read forever: the next
      // real reply computes `postCount - 999`, clamps to 0, and never shows.
      await service.markCategoryRead(CTX, 'cat-1');

      expect(prisma.topicReadState.createMany.mock.calls[0]?.[0]?.data).toEqual(
        [
          { userId: CTX.userId, topicId: 't1', lastReadPostNumber: 4 },
          { userId: CTX.userId, topicId: 't2', lastReadPostNumber: 0 },
          { userId: CTX.userId, topicId: 't3', lastReadPostNumber: 9 },
        ],
      );
    });

    it('leaves every affected topic at 0 unread — monotone in the OBSERVABLE badge', async () => {
      await service.markCategoryRead(CTX, 'cat-1');

      const rows = prisma.topicReadState.createMany.mock.calls[0]?.[0]?.data;
      const counts = [4, 0, 9];
      rows.forEach((row: { lastReadPostNumber: number }, i: number) => {
        expect(unreadCount(counts[i]!, row.lastReadPostNumber)).toBe(0);
      });
    });

    it('touches only VISIBLE, non-deleted topics', async () => {
      await service.markCategoryRead(CTX, 'cat-1');

      // The category itself was resolved through the visibility clause…
      expect(
        prisma.category.findFirst.mock.calls[0]?.[0]?.where.OR,
      ).toBeDefined();
      // …and its topics through the soft-delete filter.
      expect(prisma.topic.findMany.mock.calls[0]?.[0]?.where).toEqual({
        deletedAt: null,
        categoryId: 'cat-1',
      });
    });

    it('an invisible category is 404', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(
        service.markCategoryRead(CTX, 'staff-cat'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.topicReadState.createMany).not.toHaveBeenCalled();
    });

    it('an empty category writes nothing and reports 0', async () => {
      prisma.topic.findMany.mockResolvedValue([]);

      expect(await service.markCategoryRead(CTX, 'cat-1')).toEqual({
        topicsMarked: 0,
      });
      expect(prisma.topicReadState.deleteMany).not.toHaveBeenCalled();
    });

    it('reports how many topics were marked', async () => {
      expect(await service.markCategoryRead(CTX, 'cat-1')).toEqual({
        topicsMarked: 3,
      });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.6.6 / NFR-P4 — batched marker reads                                  */
  /* ---------------------------------------------------------------------- */

  describe('markersFor / allMarkers', () => {
    it('is ONE findMany with topicId: { in: [...] } (NFR-P4)', async () => {
      prisma.topicReadState.findMany.mockResolvedValue([
        { topicId: 't1', lastReadPostNumber: 3 },
      ]);

      const markers = await service.markersFor(CTX.userId, ['t1', 't2']);

      expect(prisma.topicReadState.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.topicReadState.findMany.mock.calls[0]?.[0]?.where).toEqual({
        userId: CTX.userId,
        topicId: { in: ['t1', 't2'] },
      });
      expect(markers.get('t1')).toBe(3);
      // A topic with no row is ABSENT — the "never read" signal (R1.6.3).
      expect(markers.get('t2')).toBeUndefined();
    });

    it('returns an empty map without querying for an empty id list', async () => {
      expect((await service.markersFor(CTX.userId, [])).size).toBe(0);
      expect(prisma.topicReadState.findMany).not.toHaveBeenCalled();
    });

    it('computes unread for the REQUESTING member only (R1.6.6)', async () => {
      prisma.topicReadState.findMany.mockResolvedValue([]);

      await service.markersFor(CTX.userId, ['t1']);
      await service.allMarkers(CTX.userId);

      for (const call of prisma.topicReadState.findMany.mock.calls) {
        expect(call[0].where.userId).toBe(CTX.userId);
      }
    });

    it('there is no per-post read receipt anywhere — A-6 rejected one', async () => {
      await service.markRead(CTX, 'topic-1', 5);

      // The whole model is one integer per member per topic.
      const written = prisma.topicReadState.upsert.mock.calls[0]?.[0]?.create;
      expect(Object.keys(written).sort()).toEqual([
        'lastReadPostNumber',
        'topicId',
        'userId',
      ]);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* MarkReadDto                                                             */
  /* ---------------------------------------------------------------------- */

  describe('MarkReadDto', () => {
    const invalidProps = async (payload: Record<string, unknown>) => {
      const dto = plainToInstance(MarkReadDto, payload);
      return (await validate(dto)).map((error) => error.property);
    };

    it('accepts 0 — the default "read nothing" state is a legal claim', async () => {
      expect(await invalidProps({ lastReadPostNumber: 0 })).toEqual([]);
    });

    it('rejects a negative marker', async () => {
      expect(await invalidProps({ lastReadPostNumber: -1 })).toEqual([
        'lastReadPostNumber',
      ]);
    });

    it('rejects an absurd marker that would overflow the Int column', async () => {
      expect(await invalidProps({ lastReadPostNumber: 2_000_000 })).toEqual([
        'lastReadPostNumber',
      ]);
    });

    it('coerces a numeric string, which several HTTP clients send', async () => {
      const dto = plainToInstance(MarkReadDto, { lastReadPostNumber: '12' });

      expect(dto.lastReadPostNumber).toBe(12);
      expect(await validate(dto)).toEqual([]);
    });
  });
});
