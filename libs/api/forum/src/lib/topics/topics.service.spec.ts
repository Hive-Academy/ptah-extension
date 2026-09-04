import 'reflect-metadata';

import {
  BadRequestException,
  ForbiddenException,
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
import { CategoriesService } from '../categories/categories.service';
import { EDIT_WINDOW_HOURS } from '../common/edit-window';

import { CreateAdminTopicDto } from './dto/create-admin-topic.dto';
import { CreateTopicDto } from './dto/create-topic.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';
import {
  assertTopicNotLocked,
  TOPIC_LOCKED_REASON,
  TopicsService,
} from './topics.service';

/**
 * `TopicsService` — R1.2.1–R1.2.7, R8.2, AD-9, ASSUMPTION-5.
 *
 * ⚠️ ASSUMPTION-5 IS ASSERTED HERE BY ITS EFFECT, NOT BY ITS VALUE. The tests
 * below use `EDIT_WINDOW_HOURS` to construct the boundary instants rather than
 * hard-coding 24, so overruling the assumption is a change to ONE constant in
 * `common/edit-window.ts` and this file follows it. A test asserting
 * `EDIT_WINDOW_MS === 86400000` would have to be edited too, and would be the
 * second place the number lived.
 */

const CTX: MemberContext = {
  userId: 'author-1',
  email: 'author@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

const OTHER: MemberContext = { ...CTX, userId: 'someone-else' };

const CREATED_AT = new Date('2026-08-04T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
/** One millisecond before the window closes. */
const INSIDE = new Date(CREATED_AT.getTime() + EDIT_WINDOW_HOURS * HOUR - 1);
/** Exactly at the boundary — the window is CLOSED there. */
const AT_BOUNDARY = new Date(CREATED_AT.getTime() + EDIT_WINDOW_HOURS * HOUR);

function build(prisma: MockForumPrisma): TopicsService {
  return new TopicsService(
    asPrismaService(prisma),
    new CategoriesService(asPrismaService(prisma)),
  );
}

function knownRequestError(code: string, target?: string[]): Error {
  return new Prisma.PrismaClientKnownRequestError('raw prisma detail', {
    code,
    clientVersion: '7.7.0',
    meta: target ? { target } : undefined,
  });
}

describe('TopicsService', () => {
  let prisma: MockForumPrisma;
  let service: TopicsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = build(prisma);

    prisma.category.findFirst.mockResolvedValue({
      id: 'cat-1',
      name: 'General',
    });
    prisma.topic.findMany.mockResolvedValue([]);
    prisma.topic.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'topic-1',
        slug: data['slug'],
      }),
    );
    prisma.post.create.mockResolvedValue({ id: 'post-1' });
  });

  /* ---------------------------------------------------------------------- */
  /* AD-9 — create writes the topic AND post #1, atomically                  */
  /* ---------------------------------------------------------------------- */

  describe('create (R1.2.1, R1.2.2, AD-9)', () => {
    const input = (over: Partial<CreateTopicDto> = {}): CreateTopicDto =>
      Object.assign(new CreateTopicDto(), {
        categoryId: 'cat-1',
        title: 'How do I use Ptah?',
        bodyMarkdown: 'A question about **setup**.',
        ...over,
      });

    it('writes the topic AND post #1 in ONE transaction', async () => {
      const created = await service.create(CTX, input(), CREATED_AT);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.topic.create).toHaveBeenCalledTimes(1);
      expect(prisma.post.create).toHaveBeenCalledTimes(1);
      expect(created).toEqual({
        id: 'topic-1',
        slug: 'how-do-i-use-ptah',
        firstPostId: 'post-1',
      });
    });

    it('post #1 IS the body — there is no bodyMarkdown on the topic row (AD-9)', async () => {
      await service.create(CTX, input(), CREATED_AT);

      expect(prisma.topic.create.mock.calls[0]?.[0]?.data).not.toHaveProperty(
        'bodyMarkdown',
      );
      expect(prisma.post.create.mock.calls[0]?.[0]?.data).toMatchObject({
        topicId: 'topic-1',
        postNumber: 1,
        parentId: null,
        bodyMarkdown: 'A question about **setup**.',
      });
    });

    it('writes the two rows as SEPARATE calls, not a nested posts: { create }', async () => {
      await service.create(CTX, input(), CREATED_AT);

      // A nested relation write named `posts` is indistinguishable, to the AD-5
      // structural analyser, from a nested relation READ that returns tombstones.
      expect(prisma.topic.create.mock.calls[0]?.[0]?.data).not.toHaveProperty(
        'posts',
      );
    });

    it('seeds lastPostedAt — the feed sort key has no schema default', async () => {
      await service.create(CTX, input(), CREATED_AT);

      expect(prisma.topic.create.mock.calls[0]?.[0]?.data.lastPostedAt).toBe(
        CREATED_AT,
      );
    });

    it('leaves postCount at its default — post #1 is not a reply (AD-11)', async () => {
      await service.create(CTX, input(), CREATED_AT);

      expect(prisma.topic.create.mock.calls[0]?.[0]?.data).not.toHaveProperty(
        'postCount',
      );
    });

    it('creating in an INVISIBLE category is 404, not 403 (R1.2.1 + R1.1.3)', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      const error = await service
        .create(CTX, input({ categoryId: 'staff-only' }), CREATED_AT)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).not.toBeInstanceOf(ForbiddenException);
      expect(prisma.topic.create).not.toHaveBeenCalled();
    });

    it('suffixes a colliding slug', async () => {
      prisma.topic.findMany.mockResolvedValue([{ slug: 'how-do-i-use-ptah' }]);

      const created = await service.create(CTX, input(), CREATED_AT);

      expect(created.slug).toBe('how-do-i-use-ptah-2');
    });

    it('reads the taken-set through NOT_DELETED (AD-5)', async () => {
      await service.create(CTX, input(), CREATED_AT);

      expect(
        prisma.topic.findMany.mock.calls[0]?.[0]?.where.deletedAt,
      ).toBeNull();
    });

    it('RETRIES on a P2002 slug collision — the taken-set cannot see a tombstone slug', async () => {
      // The soft-deleted topic's slug is invisible to the resolver (AD-5 filters
      // the read) but still occupies the unique index. Without the retry this is
      // a deterministic 500.
      prisma.topic.create
        .mockRejectedValueOnce(knownRequestError('P2002', ['slug']))
        .mockImplementationOnce(
          async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'topic-1',
            slug: data['slug'],
          }),
        );

      const created = await service.create(CTX, input(), CREATED_AT);

      expect(created.slug).toBe('how-do-i-use-ptah-2');
      expect(prisma.topic.create).toHaveBeenCalledTimes(2);
    });

    it('gives up after bounded attempts with a sanitized 400, never a raw message', async () => {
      prisma.topic.create.mockRejectedValue(
        knownRequestError('P2002', ['slug']),
      );

      const error = await service
        .create(CTX, input(), CREATED_AT)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).not.toContain('raw prisma detail');
    });

    it('a title that normalises to nothing still gets a usable slug', async () => {
      const created = await service.create(
        CTX,
        input({ title: '???' }),
        CREATED_AT,
      );

      expect(created.slug).toBe('topic');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.2.3 / R1.2.4 — the member edit path                                  */
  /* ---------------------------------------------------------------------- */

  describe('updateByAuthor (R1.2.3, R1.2.4, ASSUMPTION-5)', () => {
    beforeEach(() => {
      prisma.topic.findFirst.mockResolvedValue({
        id: 'topic-1',
        slug: 'how-do-i-use-ptah',
        authorId: CTX.userId,
        createdAt: CREATED_AT,
      });
      prisma.topic.update.mockResolvedValue({});
      prisma.post.updateMany.mockResolvedValue({ count: 1 });
    });

    const patch = (over: Partial<UpdateTopicDto> = {}): UpdateTopicDto =>
      Object.assign(new UpdateTopicDto(), over);

    it('a title edit NEVER changes the slug (R1.2.2)', async () => {
      const result = await service.updateByAuthor(
        CTX,
        'topic-1',
        patch({ title: 'A completely different title' }),
        INSIDE,
      );

      expect(prisma.topic.update.mock.calls[0]?.[0]?.data).not.toHaveProperty(
        'slug',
      );
      expect(result.slug).toBe('how-do-i-use-ptah');
    });

    it('sets editedAt on a title edit', async () => {
      await service.updateByAuthor(
        CTX,
        'topic-1',
        patch({ title: 'New' }),
        INSIDE,
      );

      expect(prisma.topic.update.mock.calls[0]?.[0]?.data.editedAt).toBe(
        INSIDE,
      );
    });

    it('a body edit writes POST #1, not a topic column (AD-9)', async () => {
      await service.updateByAuthor(
        CTX,
        'topic-1',
        patch({ bodyMarkdown: 'rewritten' }),
        INSIDE,
      );

      expect(prisma.post.updateMany).toHaveBeenCalledWith({
        where: { topicId: 'topic-1', postNumber: 1, deletedAt: null },
        data: { bodyMarkdown: 'rewritten', editedAt: INSIDE },
      });
      expect(prisma.topic.update).not.toHaveBeenCalled();
    });

    it('a non-author edit is 403 (R1.2.4)', async () => {
      await expect(
        service.updateByAuthor(
          OTHER,
          'topic-1',
          patch({ title: 'Mine now' }),
          INSIDE,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.topic.update).not.toHaveBeenCalled();
    });

    it('an out-of-window edit is 403, and the boundary instant is CLOSED', async () => {
      await expect(
        service.updateByAuthor(
          CTX,
          'topic-1',
          patch({ title: 'Late' }),
          AT_BOUNDARY,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // One millisecond earlier it is allowed — the two branches can never both
      // be true for one instant.
      await expect(
        service.updateByAuthor(
          CTX,
          'topic-1',
          patch({ title: 'Just in time' }),
          INSIDE,
        ),
      ).resolves.toMatchObject({ id: 'topic-1' });
    });

    it('the window is measured from createdAt, so an edit does not restart the clock', async () => {
      prisma.topic.findFirst.mockResolvedValue({
        id: 'topic-1',
        slug: 's',
        authorId: CTX.userId,
        createdAt: CREATED_AT,
        // A recent `editedAt` must NOT reopen the window.
        editedAt: AT_BOUNDARY,
      });

      await expect(
        service.updateByAuthor(
          CTX,
          'topic-1',
          patch({ title: 'x' }),
          AT_BOUNDARY,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('THERE IS NO isAdmin BRANCH on the member edit path', async () => {
      // The admin exemption is STRUCTURAL: a different route, behind AdminGuard,
      // which writes an audit row. An inline bypass would be unaudited.
      const admin: MemberContext = { ...OTHER, isAdmin: true };

      await expect(
        service.updateByAuthor(admin, 'topic-1', patch({ title: 'x' }), INSIDE),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('an invisible topic is 404', async () => {
      prisma.topic.findFirst.mockResolvedValue(null);

      await expect(
        service.updateByAuthor(CTX, 'topic-1', patch({ title: 'x' }), INSIDE),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('an empty patch is a 400 rather than a 200 that changed nothing', async () => {
      await expect(
        service.updateByAuthor(CTX, 'topic-1', patch(), INSIDE),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.2.7 — soft delete                                                    */
  /* ---------------------------------------------------------------------- */

  describe('softDelete (R1.2.7)', () => {
    beforeEach(() => {
      prisma.topic.findFirst.mockResolvedValue({
        id: 'topic-1',
        authorId: CTX.userId,
      });
      prisma.topic.update.mockResolvedValue({});
    });

    it('sets deletedAt and deletedBy', async () => {
      await service.softDelete(CTX, 'topic-1', INSIDE);

      expect(prisma.topic.update).toHaveBeenCalledWith({
        where: { id: 'topic-1' },
        data: { deletedAt: INSIDE, deletedBy: CTX.userId },
      });
    });

    it('does NOT touch the posts — leaving them intact makes R8.5 restore a one-row write', async () => {
      await service.softDelete(CTX, 'topic-1', INSIDE);

      expect(prisma.post.updateMany).not.toHaveBeenCalled();
      expect(prisma.post.deleteMany).not.toHaveBeenCalled();
    });

    it('a non-author delete is 403', async () => {
      await expect(
        service.softDelete(OTHER, 'topic-1', INSIDE),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('has NO edit window — §3.3 annotates only PATCH with "window closed"', async () => {
      const muchLater = new Date('2027-01-01T00:00:00.000Z');

      await expect(
        service.softDelete(CTX, 'topic-1', muchLater),
      ).resolves.toEqual({
        deleted: true,
      });
    });

    it('a soft-deleted topic is absent from every subsequent member read', async () => {
      // Not a behaviour of this method: every member read in the lib spreads
      // NOT_DELETED, so the disappearance is free. Asserted on the read path.
      prisma.topic.findFirst.mockResolvedValue(null);

      await expect(
        service.updateByAuthor(CTX, 'topic-1', { title: 'x' }, INSIDE),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        prisma.topic.findFirst.mock.calls.at(-1)?.[0]?.where.deletedAt,
      ).toBeNull();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.3.4 — the lock refusal                                               */
  /* ---------------------------------------------------------------------- */

  describe('assertTopicNotLocked (R1.2.6, R1.3.4, §3.3)', () => {
    it('refuses with 403 and the machine-readable reason topic_locked', () => {
      const error = (() => {
        try {
          assertTopicNotLocked(true);
          return null;
        } catch (e: unknown) {
          return e;
        }
      })();

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        statusCode: 403,
        reason: TOPIC_LOCKED_REASON,
      });
    });

    it('the reason is a stable machine value, not a sentence a client parses', () => {
      expect(TOPIC_LOCKED_REASON).toBe('topic_locked');
    });

    it('an unlocked topic passes silently', () => {
      expect(() => assertTopicNotLocked(false)).not.toThrow();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R8.2 — moderation                                                       */
  /* ---------------------------------------------------------------------- */

  describe('moderate (R1.2.5, R1.2.6, R8.2)', () => {
    beforeEach(() => {
      prisma.topic.findFirst.mockResolvedValue({ id: 'topic-1' });
      prisma.topic.update.mockResolvedValue({});
      prisma.category.findUnique.mockResolvedValue({ id: 'cat-2' });
      prisma.post.updateMany.mockResolvedValue({ count: 1 });
    });

    it('pins a topic and reports what changed', async () => {
      const result = await service.moderate(
        'topic-1',
        { pinned: true },
        INSIDE,
      );

      expect(prisma.topic.update.mock.calls[0]?.[0]?.data).toEqual({
        pinned: true,
      });
      expect(result.changed).toEqual(['pinned']);
    });

    it('distinguishes locked: false from "do not change locked"', async () => {
      await service.moderate('topic-1', { locked: false }, INSIDE);

      expect(prisma.topic.update.mock.calls[0]?.[0]?.data).toEqual({
        locked: false,
      });
    });

    it('moves a topic by connecting the target category', async () => {
      await service.moderate('topic-1', { categoryId: 'cat-2' }, INSIDE);

      expect(prisma.topic.update.mock.calls[0]?.[0]?.data.category).toEqual({
        connect: { id: 'cat-2' },
      });
    });

    it('a missing target category is a typed 400, not a raw P2003', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      const error = await service
        .moderate('topic-1', { categoryId: 'ghost' }, INSIDE)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe('Target category not found');
      expect(prisma.topic.update).not.toHaveBeenCalled();
    });

    it('DOES NOT consult the edit window — the structural admin exemption', async () => {
      const yearLater = new Date('2027-08-04T12:00:00.000Z');

      await expect(
        service.moderate(
          'topic-1',
          { title: 'Corrected by a moderator' },
          yearLater,
        ),
      ).resolves.toMatchObject({ changed: ['title'] });
    });

    it('a moderator body edit writes post #1 (AD-9)', async () => {
      await service.moderate('topic-1', { bodyMarkdown: 'cleaned up' }, INSIDE);

      expect(prisma.post.updateMany.mock.calls[0]?.[0]?.where).toEqual({
        topicId: 'topic-1',
        postNumber: 1,
        deletedAt: null,
      });
    });

    it('enlists the audit hook in the moderation transaction (PRE-6)', async () => {
      const audit = jest.fn().mockResolvedValue(undefined);

      await service.moderate('topic-1', { pinned: true }, INSIDE, audit);

      expect(audit).toHaveBeenCalledTimes(1);
      expect(audit.mock.calls[0]?.[0]).toBe(prisma);
      expect(audit.mock.calls[0]?.[2]).toEqual(['pinned']);
    });

    it('an empty moderation payload is a 400', async () => {
      await expect(
        service.moderate('topic-1', {}, INSIDE),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('takes NO MemberContext at all — it applies no visibility filter by construction', () => {
      // The strongest available statement that this path grants no member-side
      // authority: there is no context here to consult.
      expect(service.moderate.length).toBeLessThanOrEqual(4);
    });
  });

  describe('createAsAdmin', () => {
    const input = (
      over: Partial<CreateAdminTopicDto> = {},
    ): CreateAdminTopicDto =>
      Object.assign(new CreateAdminTopicDto(), {
        categoryId: 'staff-only',
        title: 'Admin announcement',
        body: 'Welcome, builders.',
        pinned: true,
        locked: false,
        ...over,
      });

    beforeEach(() => {
      prisma.category.findUnique.mockResolvedValue({
        id: 'staff-only',
        visibility: 'staff',
      });
    });

    it('finds a staff-only category without a member visibility filter', async () => {
      await service.createAsAdmin('admin-1', input(), CREATED_AT);

      expect(prisma.category.findUnique).toHaveBeenCalledWith({
        where: { id: 'staff-only' },
        select: { id: true },
      });
      expect(prisma.category.findFirst).not.toHaveBeenCalled();
    });

    it('writes topic, post #1 and flags for the acting admin in one transaction', async () => {
      const created = await service.createAsAdmin(
        'admin-1',
        input(),
        CREATED_AT,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.topic.create.mock.calls[0]?.[0]?.data).toMatchObject({
        categoryId: 'staff-only',
        slug: 'admin-announcement',
        title: 'Admin announcement',
        authorId: 'admin-1',
        pinned: true,
        locked: false,
        lastPostedAt: CREATED_AT,
      });
      expect(prisma.topic.create.mock.calls[0]?.[0]?.data).not.toHaveProperty(
        'postCount',
      );
      expect(prisma.post.create.mock.calls[0]?.[0]?.data).toEqual({
        topicId: 'topic-1',
        parentId: null,
        postNumber: 1,
        bodyMarkdown: 'Welcome, builders.',
        authorId: 'admin-1',
      });
      expect(created).toEqual({
        id: 'topic-1',
        slug: 'admin-announcement',
      });
    });

    it('enlists the audit hook in the same transaction after both writes', async () => {
      const audit = jest.fn().mockResolvedValue(undefined);

      await service.createAsAdmin('admin-1', input(), CREATED_AT, audit);

      expect(audit).toHaveBeenCalledWith(prisma, 'topic-1');
      expect(prisma.post.create.mock.invocationCallOrder[0]).toBeLessThan(
        audit.mock.invocationCallOrder[0] as number,
      );
    });

    it('returns 404 when the unfiltered category lookup finds no row', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.createAsAdmin('admin-1', input(), CREATED_AT),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns Category not found when the category is deleted between lookup and insert', async () => {
      prisma.topic.create.mockRejectedValueOnce(knownRequestError('P2003'));

      const error = await service
        .createAsAdmin('admin-1', input(), CREATED_AT)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as Error).message).toBe('Category not found');
      expect(prisma.topic.create).toHaveBeenCalledTimes(1);
      expect(prisma.post.create).not.toHaveBeenCalled();
    });

    it('reuses the slug collision retry behavior', async () => {
      prisma.topic.create
        .mockRejectedValueOnce(knownRequestError('P2002', ['slug']))
        .mockImplementationOnce(
          async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'topic-1',
            slug: data['slug'],
          }),
        );

      const created = await service.createAsAdmin(
        'admin-1',
        input(),
        CREATED_AT,
      );

      expect(created.slug).toBe('admin-announcement-2');
    });
  });

  describe('softDeleteAsAdmin (R8.2)', () => {
    it('records the acting ADMIN in deletedBy, with no author check', async () => {
      prisma.topic.findFirst.mockResolvedValue({ id: 'topic-1' });
      prisma.topic.update.mockResolvedValue({});

      await service.softDeleteAsAdmin('topic-1', 'admin-7', INSIDE);

      expect(prisma.topic.update).toHaveBeenCalledWith({
        where: { id: 'topic-1' },
        data: { deletedAt: INSIDE, deletedBy: 'admin-7' },
      });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* DTOs — §3.3's limits live here, not in the service                      */
  /* ---------------------------------------------------------------------- */

  describe('CreateTopicDto (§3.3 limits)', () => {
    const invalidProps = async (payload: Record<string, unknown>) => {
      const dto = plainToInstance(CreateTopicDto, payload);
      return (await validate(dto)).map((error) => error.property);
    };

    const base = {
      categoryId: 'cat-1',
      title: 'A good title',
      bodyMarkdown: 'Body',
    };

    it('accepts a well-formed topic', async () => {
      expect(await invalidProps(base)).toEqual([]);
    });

    it('rejects a title shorter than 3 or longer than 200', async () => {
      expect(await invalidProps({ ...base, title: 'ab' })).toEqual(['title']);
      expect(await invalidProps({ ...base, title: 'x'.repeat(201) })).toEqual([
        'title',
      ]);
    });

    it('rejects an empty body and one over 50 000 characters', async () => {
      expect(await invalidProps({ ...base, bodyMarkdown: '' })).toEqual([
        'bodyMarkdown',
      ]);
      expect(
        await invalidProps({ ...base, bodyMarkdown: 'x'.repeat(50_001) }),
      ).toEqual(['bodyMarkdown']);
      expect(
        await invalidProps({ ...base, bodyMarkdown: 'x'.repeat(50_000) }),
      ).toEqual([]);
    });

    it('declares no slug, pinned or locked field — those are not a member decision', () => {
      const dto = plainToInstance(CreateTopicDto, {
        ...base,
        slug: 'squatted',
        pinned: true,
      });

      // `forbidNonWhitelisted` in `dtoPipe` turns these into a 400 at the
      // controller; the DTO simply does not declare them.
      expect(Object.keys(new CreateTopicDto())).not.toContain('slug');
      expect(dto).not.toHaveProperty('locked');
    });
  });

  describe('CreateAdminTopicDto', () => {
    const invalidProps = async (payload: Record<string, unknown>) => {
      const dto = plainToInstance(CreateAdminTopicDto, payload);
      return (await validate(dto)).map((error) => error.property);
    };
    const base = {
      categoryId: 'cat-1',
      title: 'An admin topic',
      body: 'Body',
    };

    it('accepts optional pinned and locked flags', async () => {
      expect(
        await invalidProps({ ...base, pinned: true, locked: false }),
      ).toEqual([]);
    });

    it('reuses the member topic length limits', async () => {
      expect(await invalidProps({ ...base, title: 'ab' })).toContain('title');
      expect(await invalidProps({ ...base, title: 'x'.repeat(201) })).toContain(
        'title',
      );
      expect(await invalidProps({ ...base, body: '' })).toContain('body');
      expect(
        await invalidProps({ ...base, body: 'x'.repeat(50_001) }),
      ).toContain('body');
      expect(
        await invalidProps({ ...base, categoryId: 'x'.repeat(65) }),
      ).toContain('categoryId');
    });

    it('rejects null optional flags', async () => {
      expect(await invalidProps({ ...base, pinned: null })).toContain('pinned');
      expect(await invalidProps({ ...base, locked: null })).toContain('locked');
    });
  });

  describe('UpdateTopicDto', () => {
    it('declares no categoryId — moving a topic is moderation, not editing', () => {
      expect(Object.keys(new UpdateTopicDto())).not.toContain('categoryId');
    });

    it('accepts a title-only patch', async () => {
      const dto = plainToInstance(UpdateTopicDto, { title: 'Fixed typo' });
      expect(await validate(dto)).toEqual([]);
    });
  });
});
