import 'reflect-metadata';

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { MemberContext } from '@ptah-api/membership';
import type { NotificationsService } from '@ptah-api/notifications';

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

/** See `posts.service.spec.ts` for why this is a bare `jest.fn()` double. */
let notifyCreate: jest.Mock;

function build(prisma: MockForumPrisma): AcceptedAnswerService {
  notifyCreate = jest.fn().mockResolvedValue('notif-1');
  return new AcceptedAnswerService(asPrismaService(prisma), {
    create: notifyCreate,
  } as unknown as NotificationsService);
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
      // Phase 5: `buildNotificationRoute` needs the slug (RISK-AJ).
      slug: 'a-topic',
    });
    prisma.post.findFirst.mockResolvedValue({
      id: 'post-5',
      postNumber: 5,
      // Phase 5: the `post.accepted` recipient. NOT the topic author, which is
      // the case the notification exists for — someone else answered.
      authorId: 'answer-author',
    });
    prisma.topic.update.mockResolvedValue({});
  });

  /* ---------------------------------------------------------------------- */
  /* TASK_2026_177 Task 14.13 — the `post.accepted` producer (R10.1, R10.2)   */
  /* ---------------------------------------------------------------------- */

  describe('🔴 R10.1 — post.accepted', () => {
    it("notifies the ANSWER's author, not the topic author", async () => {
      await service.accept(AUTHOR, 'topic-1', { postId: 'post-5' });

      expect(notifyCreate).toHaveBeenCalledTimes(1);
      expect(notifyCreate.mock.calls[0]?.[0]).toEqual({
        recipientId: 'answer-author',
        actorId: AUTHOR.userId,
        kind: 'post.accepted',
        targetType: 'Post',
        targetId: 'post-5',
        title: 'Your answer was accepted',
        bodyPreview: null,
        route: '/members/community/topics/a-topic#post-post-5',
        tx: prisma,
      });
    });

    it('🔴 the SELF-ACCEPT case is passed to create(), not filtered here (R10.2)', async () => {
      // A member answering their own question and accepting it is ordinary.
      // The suppression belongs to `create()`; this service must hand it the
      // equality rather than resolve it.
      prisma.post.findFirst.mockResolvedValue({
        id: 'post-5',
        postNumber: 5,
        authorId: AUTHOR.userId,
      });

      await service.accept(AUTHOR, 'topic-1', { postId: 'post-5' });

      expect(notifyCreate.mock.calls[0]?.[0]).toMatchObject({
        recipientId: AUTHOR.userId,
        actorId: AUTHOR.userId,
      });
      // The acceptance still committed — a suppression is not a failure.
      expect(prisma.topic.update).toHaveBeenCalledTimes(1);
    });

    it('an ADMIN accepting someone else’s answer is the actor, and the author is the recipient', async () => {
      await service.accept(ADMIN, 'topic-1', { postId: 'post-5' });

      expect(notifyCreate.mock.calls[0]?.[0]).toMatchObject({
        recipientId: 'answer-author',
        actorId: ADMIN.userId,
      });
    });

    it('an answer whose author DELETED THEIR ACCOUNT writes nothing, and the accept still lands', async () => {
      prisma.post.findFirst.mockResolvedValue({
        id: 'post-5',
        postNumber: 5,
        authorId: null,
      });

      await service.accept(AUTHOR, 'topic-1', { postId: 'post-5' });

      expect(notifyCreate).not.toHaveBeenCalled();
      expect(prisma.topic.update).toHaveBeenCalledTimes(1);
    });

    it('🔴 ENLISTS in the accept transaction (ASSUMPTION-21) and rolls it back on failure', async () => {
      notifyCreate.mockRejectedValue(new Error('notification exploded'));

      await expect(
        service.accept(AUTHOR, 'topic-1', { postId: 'post-5' }),
      ).rejects.toThrow('notification exploded');

      // The update ran INSIDE the same `$transaction`, so a real Postgres would
      // have rolled it back. What is asserted here is that both statements went
      // through one transaction rather than two.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('🔴 R1.5.2 is UNWEAKENED: still exactly one Topic write, no compensating clear', async () => {
      // The transaction added in Phase 5 must not have grown a "clear the
      // previous accepted answer" step — that is the shape with a state in which
      // two posts are accepted.
      await service.accept(AUTHOR, 'topic-1', { postId: 'post-5' });

      expect(prisma.topic.update).toHaveBeenCalledTimes(1);
      expect(prisma.topic.updateMany).not.toHaveBeenCalled();
    });

    it('clear() produces NO notification — nothing happened to anyone’s answer', async () => {
      await service.clear(AUTHOR, 'topic-1');

      expect(notifyCreate).not.toHaveBeenCalled();
    });
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
        slug: 'a-topic',
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
        slug: 'a-topic',
      });
      prisma.post.findFirst.mockResolvedValue({
        id: 'post-9',
        postNumber: 9,
        authorId: 'answer-author',
      });

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
