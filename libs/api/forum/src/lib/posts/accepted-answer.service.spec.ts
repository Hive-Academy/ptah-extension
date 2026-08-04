import 'reflect-metadata';

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { MemberContext } from '@ptah-api/membership';

import {
  asPrismaService,
  createMockPrisma,
  type MockForumPrisma,
} from '../../testing/mock-forum-prisma';

import { AcceptedAnswerService } from './accepted-answer.service';

/**
 * `AcceptedAnswerService` — R1.5.1, R1.5.2, R1.5.3.
 *
 * ⚠️ R1.5.2 ("at most one accepted answer per topic") IS ASSERTED AS AN ABSENCE:
 * marking a second answer must be ONE write that overwrites the first, with NO
 * compensating "clear the previous one" step. A compensating write has a state
 * in which both are accepted — after it fails, or when two accepts interleave —
 * and the schema's single `@unique` column exists precisely so that state
 * cannot be represented.
 */

const AUTHOR: MemberContext = {
  userId: 'topic-author',
  email: 'author@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

const STRANGER: MemberContext = { ...AUTHOR, userId: 'stranger' };
const ADMIN: MemberContext = { ...AUTHOR, userId: 'admin-1', isAdmin: true };

function build(prisma: MockForumPrisma): AcceptedAnswerService {
  return new AcceptedAnswerService(asPrismaService(prisma));
}

describe('AcceptedAnswerService', () => {
  let prisma: MockForumPrisma;
  let service: AcceptedAnswerService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = build(prisma);

    prisma.topic.findFirst.mockResolvedValue({
      id: 'topic-1',
      authorId: AUTHOR.userId,
    });
    prisma.post.findFirst.mockResolvedValue({ id: 'post-5', postNumber: 5 });
    prisma.topic.update.mockResolvedValue({});
  });

  /* ---------------------------------------------------------------------- */
  /* R1.5.3 — who may accept                                                 */
  /* ---------------------------------------------------------------------- */

  describe('R1.5.3 — the topic author or an admin', () => {
    it('the topic author may accept', async () => {
      await expect(
        service.accept(AUTHOR, 'topic-1', { postId: 'post-5' }),
      ).resolves.toEqual({ acceptedPostId: 'post-5' });
    });

    it('an admin may accept', async () => {
      await expect(
        service.accept(ADMIN, 'topic-1', { postId: 'post-5' }),
      ).resolves.toEqual({ acceptedPostId: 'post-5' });
    });

    it('anyone else gets 403 — NOT 404, because they can see the topic', async () => {
      const error = await service
        .accept(STRANGER, 'topic-1', { postId: 'post-5' })
        .catch((e: unknown) => e);

      // The refusal is about AUTHORITY, and the topic existence is not a secret
      // from someone who can already read it (R1.1.3's carve-out).
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error).not.toBeInstanceOf(NotFoundException);
      expect(prisma.topic.update).not.toHaveBeenCalled();
    });

    it('the same rule governs clearing', async () => {
      await expect(service.clear(STRANGER, 'topic-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.clear(AUTHOR, 'topic-1')).resolves.toEqual({
        acceptedPostId: null,
      });
    });

    it('a topic with a null author (migrated content, A-4) is admin-only', async () => {
      prisma.topic.findFirst.mockResolvedValue({
        id: 'topic-1',
        authorId: null,
      });

      await expect(
        service.accept(AUTHOR, 'topic-1', { postId: 'post-5' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.accept(ADMIN, 'topic-1', { postId: 'post-5' }),
      ).resolves.toMatchObject({ acceptedPostId: 'post-5' });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.5.2 — at most one, by assignment                                     */
  /* ---------------------------------------------------------------------- */

  describe('R1.5.2 — marking a second answer clears the first BY ASSIGNMENT', () => {
    it('is a single scalar write with no compensating clear', async () => {
      await service.accept(AUTHOR, 'topic-1', { postId: 'post-5' });

      expect(prisma.topic.update).toHaveBeenCalledTimes(1);
      expect(prisma.topic.update).toHaveBeenCalledWith({
        where: { id: 'topic-1' },
        data: { acceptedPostId: 'post-5' },
      });
    });

    it('never uses acceptedPost: { connect } or a disconnect step', async () => {
      await service.accept(AUTHOR, 'topic-1', { postId: 'post-5' });

      const data = prisma.topic.update.mock.calls[0]?.[0]?.data;
      expect(data).not.toHaveProperty('acceptedPost');
      expect(JSON.stringify(data)).not.toContain('disconnect');
    });

    it('accepting a second post overwrites the first in one write', async () => {
      prisma.topic.findFirst.mockResolvedValue({
        id: 'topic-1',
        authorId: AUTHOR.userId,
        acceptedPostId: 'post-5',
      });
      prisma.post.findFirst.mockResolvedValue({ id: 'post-9', postNumber: 9 });

      const result = await service.accept(AUTHOR, 'topic-1', {
        postId: 'post-9',
      });

      expect(result.acceptedPostId).toBe('post-9');
      expect(prisma.topic.update).toHaveBeenCalledTimes(1);
      expect(prisma.topic.update.mock.calls[0]?.[0]?.data.acceptedPostId).toBe(
        'post-9',
      );
    });

    it('never writes a Post.accepted boolean — the flag lives on the TOPIC', async () => {
      await service.accept(AUTHOR, 'topic-1', { postId: 'post-5' });

      expect(prisma.post.update).not.toHaveBeenCalled();
      expect(prisma.post.updateMany).not.toHaveBeenCalled();
    });

    it('clearing sets the column to null', async () => {
      await service.clear(AUTHOR, 'topic-1');

      expect(prisma.topic.update).toHaveBeenCalledWith({
        where: { id: 'topic-1' },
        data: { acceptedPostId: null },
      });
    });

    it('clearing a topic that has none is idempotent, not a 404', async () => {
      // A 404 would make an un-accept race between two tabs fail for the second
      // one, having achieved exactly the state it asked for.
      await expect(service.clear(AUTHOR, 'topic-1')).resolves.toEqual({
        acceptedPostId: null,
      });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The post must be real, live and in this topic                           */
  /* ---------------------------------------------------------------------- */

  describe('post validation', () => {
    it('accepting a SOFT-DELETED post is refused', async () => {
      prisma.post.findFirst.mockResolvedValue(null);

      await expect(
        service.accept(AUTHOR, 'topic-1', { postId: 'tombstone' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.topic.update).not.toHaveBeenCalled();
    });

    it('scopes the lookup by topicId AND the soft-delete filter', async () => {
      await service.accept(AUTHOR, 'topic-1', { postId: 'post-5' });

      // A post id from ANOTHER topic must not resolve — guaranteed by the
      // query, not by a check afterwards.
      expect(prisma.post.findFirst.mock.calls[0]?.[0]?.where).toEqual({
        id: 'post-5',
        topicId: 'topic-1',
        deletedAt: null,
      });
    });

    it('post #1 cannot be its own answer (AD-9) — 400', async () => {
      prisma.post.findFirst.mockResolvedValue({ id: 'p1', postNumber: 1 });

      await expect(
        service.accept(AUTHOR, 'topic-1', { postId: 'p1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.topic.update).not.toHaveBeenCalled();
    });

    it('an invisible or soft-deleted topic is 404 before any authority check', async () => {
      prisma.topic.findFirst.mockResolvedValue(null);

      const error = await service
        .accept(STRANGER, 'topic-1', { postId: 'post-5' })
        .catch((e: unknown) => e);

      // Order matters: a 403 here would confirm the topic exists to someone who
      // cannot see it (R1.1.3).
      expect(error).toBeInstanceOf(NotFoundException);
    });

    it('the topic lookup carries NOT_DELETED and the category visibility clause', async () => {
      await service.accept(AUTHOR, 'topic-1', { postId: 'post-5' });

      const where = prisma.topic.findFirst.mock.calls[0]?.[0]?.where;
      expect(where.deletedAt).toBeNull();
      expect(where.category.OR).toBeDefined();
    });
  });
});
