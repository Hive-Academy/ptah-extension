import 'reflect-metadata';

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  asPrismaService,
  createMockPrisma,
  type MockForumPrisma,
} from '../../testing/mock-forum-prisma';

import { CategoriesService, SORT_ORDER_STEP } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';

/**
 * `CategoriesService` — R1.1.1, R1.1.2, R1.1.4, R8.8, AD-10.
 *
 * ⚠️ THE ASSERTION THIS FILE EXISTS FOR IS R1.1.2, AND IT IS STRONGER THAN
 * "FILTER THE LIST": an invisible category must be absent from the response AND
 * absent from every COUNT in it. A masked count is a disclosure — "there are 47
 * threads you cannot see" is the same oracle as a `403`, delivered as a number.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

function build(prisma: MockForumPrisma): CategoriesService {
  return new CategoriesService(asPrismaService(prisma));
}

function category(over: Record<string, unknown> = {}) {
  return {
    id: 'cat-member',
    slug: 'general',
    name: 'General',
    description: null,
    visibility: 'member',
    sortOrder: 100,
    ...over,
  };
}

function knownRequestError(code: string): Error {
  return new Prisma.PrismaClientKnownRequestError(
    'Foreign key constraint failed on the field: `community_topics_category_id_fkey`',
    { code, clientVersion: '7.7.0' },
  );
}

describe('CategoriesService', () => {
  let prisma: MockForumPrisma;
  let service: CategoriesService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = build(prisma);
    prisma.category.findMany.mockResolvedValue([category()]);
    prisma.topic.findMany.mockResolvedValue([]);
    prisma.topicReadState.findMany.mockResolvedValue([]);
  });

  /* ---------------------------------------------------------------------- */
  /* R1.1.4 — ordering                                                       */
  /* ---------------------------------------------------------------------- */

  describe('R1.1.4 — admin-defined order', () => {
    it('orders by sortOrder ascending, NEVER alphabetically or by creation date', async () => {
      await service.listForMember(CTX);

      expect(prisma.category.findMany.mock.calls[0]?.[0]?.orderBy).toEqual([
        { sortOrder: 'asc' },
        // `name` is the TIE-BREAK only, so equal sortOrder is still stable.
        { name: 'asc' },
      ]);
    });

    it('preserves the order the query returned rather than re-sorting in JS', async () => {
      prisma.category.findMany.mockResolvedValue([
        category({ id: 'z', name: 'Zebra', sortOrder: 100 }),
        category({ id: 'a', name: 'Apple', sortOrder: 200 }),
      ]);

      const list = await service.listForMember(CTX);

      expect(list.map((c) => c.id)).toEqual(['z', 'a']);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.1.2 / R1.1.3 — invisible categories and their counts                 */
  /* ---------------------------------------------------------------------- */

  describe('R1.1.2 — an invisible category is absent from the list AND from the counts', () => {
    it('asks the shared visibility builder rather than re-deriving visibility', async () => {
      await service.listForMember(CTX);

      const where = prisma.category.findMany.mock.calls[0]?.[0]?.where;
      // A zero-cohort non-admin matches exactly one branch: `member`.
      expect(where.OR).toEqual([{ visibility: 'member' }]);
    });

    it('counts topics only within the categories that SURVIVED the visibility clause', async () => {
      prisma.category.findMany.mockResolvedValue([
        category({ id: 'visible-1' }),
      ]);

      await service.listForMember(CTX);

      // The count query is scoped by the already-filtered ids. It is not a
      // count across all categories that is masked afterwards.
      expect(
        prisma.topic.findMany.mock.calls[0]?.[0]?.where.categoryId,
      ).toEqual({
        in: ['visible-1'],
      });
    });

    it('spreads NOT_DELETED, so soft-deleted topics never inflate topicCount (AD-5)', async () => {
      await service.listForMember(CTX);

      expect(
        prisma.topic.findMany.mock.calls[0]?.[0]?.where.deletedAt,
      ).toBeNull();
    });

    it('never uses _count over the topics relation, which would count tombstones', async () => {
      await service.listForMember(CTX);

      const select = prisma.category.findMany.mock.calls[0]?.[0]?.select;
      expect(select).not.toHaveProperty('_count');
      expect(select).not.toHaveProperty('topics');
    });

    it('a member who can see no category gets [] and no further query', async () => {
      prisma.category.findMany.mockResolvedValue([]);

      expect(await service.listForMember(CTX)).toEqual([]);
      expect(prisma.topic.findMany).not.toHaveBeenCalled();
    });
  });

  describe('topicCount and unreadCount', () => {
    beforeEach(() => {
      prisma.category.findMany.mockResolvedValue([
        category({ id: 'c1' }),
        category({ id: 'c2', slug: 'deep', name: 'Deep' }),
      ]);
      prisma.topic.findMany.mockResolvedValue([
        { id: 't1', categoryId: 'c1', postCount: 5 },
        { id: 't2', categoryId: 'c1', postCount: 0 },
        { id: 't3', categoryId: 'c2', postCount: 2 },
      ]);
    });

    it('topicCount is the number of live topics per category', async () => {
      const list = await service.listForMember(CTX);

      expect(list.find((c) => c.id === 'c1')?.topicCount).toBe(2);
      expect(list.find((c) => c.id === 'c2')?.topicCount).toBe(1);
    });

    it('unreadCount counts TOPICS with unread activity, not unread posts', async () => {
      prisma.topicReadState.findMany.mockResolvedValue([
        { topicId: 't1', lastReadPostNumber: 2 }, // 5 > 2 → unread topic
      ]);

      const list = await service.listForMember(CTX);

      // t1 unread (3 posts behind), t2 has no replies at all → not unread.
      // The badge is "1 thread with new replies", not "3 new posts".
      expect(list.find((c) => c.id === 'c1')?.unreadCount).toBe(1);
    });

    it('a never-opened topic with replies counts as unread (R1.6.3)', async () => {
      prisma.topicReadState.findMany.mockResolvedValue([]);

      const list = await service.listForMember(CTX);

      expect(list.find((c) => c.id === 'c1')?.unreadCount).toBe(1); // t1 only
      expect(list.find((c) => c.id === 'c2')?.unreadCount).toBe(1); // t3
    });

    it('unreadCount is bounded above by topicCount', async () => {
      const list = await service.listForMember(CTX);

      for (const item of list) {
        expect(item.unreadCount).toBeLessThanOrEqual(item.topicCount);
      }
    });

    it('a fully read category reports 0 unread', async () => {
      // ⚠️ THE MARKERS ARE `postCount + 1`, NOT `postCount`. A marker is a POST
      // NUMBER and post #1 is the body (AD-9), so a topic with 5 replies is
      // fully read at post #6. This fixture previously used the bare reply
      // count, which is the fixture half of TASK_2026_177 F-1 — it made the
      // spec agree with the defect instead of with the requirement.
      prisma.topicReadState.findMany.mockResolvedValue([
        { topicId: 't1', lastReadPostNumber: 6 },
        { topicId: 't3', lastReadPostNumber: 3 },
      ]);

      const list = await service.listForMember(CTX);

      expect(list.every((c) => c.unreadCount === 0)).toBe(true);
    });

    it('reads markers in ONE query for all the topics, never one per topic', async () => {
      await service.listForMember(CTX);

      expect(prisma.topicReadState.findMany).toHaveBeenCalledTimes(1);
      expect(
        prisma.topicReadState.findMany.mock.calls[0]?.[0]?.where.topicId.in,
      ).toEqual(['t1', 't2', 't3']);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* requireVisible                                                          */
  /* ---------------------------------------------------------------------- */

  describe('requireVisible', () => {
    it('puts the visibility clause IN the query, so invisible is 404 not 403', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(
        service.requireVisible(CTX, 'staff-cat'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        prisma.category.findFirst.mock.calls[0]?.[0]?.where.OR,
      ).toBeDefined();
    });

    it('returns the id and name of a visible category', async () => {
      prisma.category.findFirst.mockResolvedValue({
        id: 'c1',
        name: 'General',
      });

      expect(await service.requireVisible(CTX, 'c1')).toEqual({
        id: 'c1',
        name: 'General',
      });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Admin writes                                                            */
  /* ---------------------------------------------------------------------- */

  describe('create', () => {
    beforeEach(() => {
      prisma.memberGroup.findMany.mockResolvedValue([{ key: 'founding' }]);
      prisma.category.aggregate.mockResolvedValue({ _max: { sortOrder: 200 } });
      prisma.category.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'new',
          ...data,
        }),
      );
    });

    const input = (over: Partial<CreateCategoryDto> = {}): CreateCategoryDto =>
      Object.assign(new CreateCategoryDto(), {
        slug: 'announcements',
        name: 'Announcements',
        visibility: 'member',
        ...over,
      });

    it('appends on the sparse scale when sortOrder is omitted', async () => {
      await service.create(input());

      expect(prisma.category.create.mock.calls[0]?.[0]?.data.sortOrder).toBe(
        200 + SORT_ORDER_STEP,
      );
    });

    it('rejects an unknown cohortKey with 400 — AD-10 has no FK to catch it', async () => {
      // The `String[]` column means a typo saves cleanly and produces a
      // category invisible to EVERYONE, silently. This check is the only guard.
      const error = await service
        .create(input({ visibility: 'cohort', cohortKeys: ['foundng'] }))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('foundng');
      expect(prisma.category.create).not.toHaveBeenCalled();
    });

    it('accepts a known cohortKey', async () => {
      await expect(
        service.create(
          input({ visibility: 'cohort', cohortKeys: ['founding'] }),
        ),
      ).resolves.toMatchObject({ id: 'new' });
    });

    it('does not query member groups at all when there are no cohort keys', async () => {
      await service.create(input());

      expect(prisma.memberGroup.findMany).not.toHaveBeenCalled();
    });

    it('a duplicate slug is a sanitized 409, never a raw Prisma message (NFR-S7)', async () => {
      prisma.category.create.mockRejectedValue(knownRequestError('P2002'));

      const error = await service.create(input()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toBe(
        "A category with slug 'announcements' already exists",
      );
      expect((error as Error).message).not.toContain('constraint');
    });

    it('enlists the audit hook in the create transaction (PRE-6)', async () => {
      const audit = jest.fn().mockResolvedValue(undefined);

      await service.create(input(), audit);

      expect(audit).toHaveBeenCalledTimes(1);
      expect(audit.mock.calls[0]?.[0]).toBe(prisma); // the same tx client
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('turns the onDelete: Restrict refusal into a sanitized 409', async () => {
      prisma.category.findUnique.mockResolvedValue({
        id: 'c1',
        slug: 'general',
      });
      prisma.category.delete.mockRejectedValue(knownRequestError('P2003'));

      const error = await service.remove('c1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toBe(
        'This category still contains topics and cannot be deleted. Move or delete its topics first.',
      );
      // The raw P2003 names the constraint and the table — a schema disclosure.
      expect((error as Error).message).not.toContain('fkey');
      expect((error as Error).message).not.toContain('community_topics');
    });

    it('does not pre-count topics as the gate — the constraint is the gate (no TOCTOU)', async () => {
      prisma.category.findUnique.mockResolvedValue({
        id: 'c1',
        slug: 'general',
      });
      prisma.category.delete.mockResolvedValue({});

      await service.remove('c1');

      expect(prisma.topic.count).not.toHaveBeenCalled();
    });

    it('a missing category is 404', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('reorder (R8.8)', () => {
    const reorder = (ids: string[]): ReorderCategoriesDto =>
      Object.assign(new ReorderCategoriesDto(), { ids });

    beforeEach(() => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
      prisma.category.update.mockResolvedValue({});
    });

    it('renumbers in ONE transaction, on the sparse scale', async () => {
      await service.reorder(reorder(['c', 'a', 'b']));

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.category.update.mock.calls.map((call) => call[0])).toEqual([
        { where: { id: 'c' }, data: { sortOrder: 100 } },
        { where: { id: 'a' }, data: { sortOrder: 200 } },
        { where: { id: 'b' }, data: { sortOrder: 300 } },
      ]);
    });

    it('is sparse so a later single insert does not force a full renumber', async () => {
      await service.reorder(reorder(['a', 'b', 'c']));

      const orders = prisma.category.update.mock.calls.map(
        (call) => call[0].data.sortOrder,
      );
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i] - orders[i - 1]).toBe(SORT_ORDER_STEP);
      }
    });

    it('rejects duplicates — one category cannot hold two positions', async () => {
      await expect(
        service.reorder(reorder(['a', 'a', 'b'])),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown id', async () => {
      const error = await service
        .reorder(reorder(['a', 'b', 'ghost']))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('unknown category id');
    });

    it('rejects a PARTIAL list — sortOrder is a total ordering', async () => {
      // A subset renumbered onto the sparse scale would interleave with the
      // untouched rows at values nobody chose, and could produce ties.
      const error = await service
        .reorder(reorder(['a', 'b']))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('every category exactly once');
    });

    it('validates completeness INSIDE the transaction, against the same snapshot', async () => {
      await service.reorder(reorder(['a', 'b', 'c']));

      // The `findMany` that established the known set ran on the tx client.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.category.findMany).toHaveBeenCalledTimes(1);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* DTOs                                                                    */
  /* ---------------------------------------------------------------------- */

  describe('CreateCategoryDto', () => {
    const invalidProps = async (payload: Record<string, unknown>) => {
      const dto = plainToInstance(CreateCategoryDto, payload);
      return (await validate(dto)).map((error) => error.property);
    };

    const base = { slug: 'general', name: 'General', visibility: 'member' };

    it('accepts a well-formed category', async () => {
      expect(await invalidProps(base)).toEqual([]);
    });

    it('rejects a visibility outside the shared VISIBILITIES tuple', async () => {
      // The column is a Postgres String, not an enum — nothing at the database
      // layer would catch a fourth value.
      expect(await invalidProps({ ...base, visibility: 'public' })).toEqual([
        'visibility',
      ]);
    });

    it('rejects a slug with uppercase or spaces', async () => {
      expect(await invalidProps({ ...base, slug: 'General Chat' })).toEqual([
        'slug',
      ]);
    });

    it('rejects a malformed cohortKey shape', async () => {
      expect(
        await invalidProps({ ...base, cohortKeys: ['Founding Members!'] }),
      ).toEqual(['cohortKeys']);
    });
  });

  describe('ReorderCategoriesDto', () => {
    it('requires a non-empty ids array', async () => {
      const dto = plainToInstance(ReorderCategoriesDto, { ids: [] });
      expect((await validate(dto)).map((e) => e.property)).toEqual(['ids']);
    });
  });
});
