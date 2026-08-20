import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type { NotificationsService } from '@ptah-api/notifications';

import {
  asPrismaService,
  createMockPrisma,
  type MockForumPrisma,
} from '../../testing/mock-forum-prisma';
import { TOPIC_LOCKED_REASON } from '../topics/topics.service';

import {
  excerptOf,
  PostsService,
  resolveReplyRecipients,
} from './posts.service';

/**
 * `PostsService` — R1.3, R1.6.4, AD-11, RK-12.
 *
 * TWO OF THE FOUR §8.2 P2 BACKEND EXIT-GATE ITEMS ARE ASSERTED IN THIS FILE:
 *
 *   - RK-12 — a depth-3 reply attempt attaches at DEPTH 2, server-side, as a
 *     REPAIR and not a rejection ("RK-12" describe block);
 *   - AD-11 — `Topic.postCount` equals a freshly computed
 *     `count({ topicId, postNumber: { gt: 1 }, deletedAt: null })` after an
 *     arbitrary sequence of writes ("AD-11 consistency" describe block).
 *
 * ⚠️ THE AD-11 TEST IS WHAT LICENSES THE DENORMALISED COLUMN. RK-1 rejects
 * un-reconciled counters and there is no reconciliation job in this design, so
 * `postCount` is permitted ONLY because its invariant is asserted. The test
 * below therefore runs a real in-memory model of the two tables rather than
 * asserting that `increment: 1` was passed — the latter would pass while the
 * decrement was missing.
 */

const CTX: MemberContext = {
  userId: 'author-1',
  email: 'author@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

const OTHER: MemberContext = { ...CTX, userId: 'someone-else' };

const NOW = new Date('2026-08-04T12:00:00.000Z');

/**
 * The notification double every construction in this file shares.
 *
 * ⚠️ IT IS A `jest.fn()` RESOLVING AN ID, NOT A REAL SERVICE. R10.2's
 * suppression is `NotificationsService.create`'s and is asserted in
 * `notifications.service.spec.ts`; what THIS file asserts is what the PRODUCER
 * hands it — the recipient set, the kinds, the targets and the routes. A double
 * that implemented the suppression would hide a producer that pre-checked the
 * equality itself, which is precisely the drift the single-site rule forbids.
 */
function notificationsDouble(): {
  create: jest.Mock;
  service: NotificationsService;
} {
  const create = jest.fn().mockResolvedValue('notif-1');
  return {
    create,
    service: { create } as unknown as NotificationsService,
  };
}

function build(
  prisma: MockForumPrisma,
  notifications: NotificationsService = notificationsDouble().service,
): PostsService {
  return new PostsService(asPrismaService(prisma), notifications);
}

/**
 * A visible, unlocked topic — the happy-path lookup every write starts with.
 *
 * ⚠️ `authorId` AND `slug` JOINED IT IN PHASE 5. The topic's author is the
 * `topic.reply` recipient and the slug is what `buildNotificationRoute` needs;
 * both ride the read `createReply` already performs. `authorId` defaults to
 * someone OTHER than `CTX.userId`, so the default fixture exercises the case
 * where a notification IS written — a default of "the actor" would have made
 * every unrelated test in this file silently prove nothing about the producer.
 */
function liveTopic(
  prisma: MockForumPrisma,
  overrides: Record<string, unknown> = {},
) {
  prisma.topic.findFirst.mockResolvedValue({
    id: 'topic-1',
    locked: false,
    authorId: 'topic-author',
    slug: 'a-topic',
    ...overrides,
  });
}

function knownRequestError(code: string, target?: string[]): Error {
  return new Prisma.PrismaClientKnownRequestError('sanitize me', {
    code,
    clientVersion: '7.7.0',
    meta: target ? { target } : undefined,
  });
}

describe('PostsService', () => {
  let prisma: MockForumPrisma;
  let service: PostsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = build(prisma);

    liveTopic(prisma);
    prisma.post.aggregate.mockResolvedValue({ _max: { postNumber: 3 } });
    prisma.post.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'new-post',
        postNumber: data['postNumber'],
        parentId: data['parentId'] ?? null,
      }),
    );
    prisma.topic.update.mockResolvedValue({});
    prisma.topicReadState.upsert.mockResolvedValue({});
  });

  /* ---------------------------------------------------------------------- */
  /* RK-12 — the §8.2 exit-gate item                                         */
  /* ---------------------------------------------------------------------- */

  describe('RK-12 — depth is capped at 2 by REPAIR, not by rejection', () => {
    it('a depth-3 reply attempt attaches at DEPTH 2, re-pointed to the parent of the parent', async () => {
      // The requested parent is ITSELF a reply (its `parentId` is non-null), so
      // attaching to it would be depth 3.
      prisma.post.findFirst.mockResolvedValue({
        id: 'depth-2-post',
        parentId: 'depth-1-post',
      });

      const created = await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'my reply', parentId: 'depth-2-post' },
        NOW,
      );

      // ⚠️ THE REPLY IS SAVED — this is the whole of RK-12. A 400 here would
      // discard member-authored content over an invisible implementation rule.
      expect(prisma.post.create).toHaveBeenCalledTimes(1);
      const written = prisma.post.create.mock.calls[0]?.[0]?.data;

      // It became a SIBLING of the post it was replying to.
      expect(written.parentId).toBe('depth-1-post');
      expect(written.parentId).not.toBe('depth-2-post');
      expect(written.bodyMarkdown).toBe('my reply');

      expect(created.parentId).toBe('depth-1-post');
      expect(created.depthRepaired).toBe(true);
    });

    it('does NOT reject the attempt — no exception of any kind is raised', async () => {
      prisma.post.findFirst.mockResolvedValue({
        id: 'depth-2-post',
        parentId: 'depth-1-post',
      });

      await expect(
        service.createReply(
          CTX,
          'topic-1',
          { bodyMarkdown: 'x', parentId: 'depth-2-post' },
          NOW,
        ),
      ).resolves.toMatchObject({ depthRepaired: true });
    });

    it('a legal depth-2 reply is left exactly where it was aimed', async () => {
      prisma.post.findFirst.mockResolvedValue({
        id: 'top-level',
        parentId: null,
      });

      const created = await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'x', parentId: 'top-level' },
        NOW,
      );

      expect(prisma.post.create.mock.calls[0]?.[0]?.data.parentId).toBe(
        'top-level',
      );
      expect(created.depthRepaired).toBe(false);
    });

    it('a top-level reply carries a null parent', async () => {
      const created = await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'x' },
        NOW,
      );

      expect(prisma.post.create.mock.calls[0]?.[0]?.data.parentId).toBeNull();
      expect(created.depthRepaired).toBe(false);
      // No parent was requested, so no parent lookup happened.
      expect(prisma.post.findFirst).not.toHaveBeenCalled();
    });

    it('the invariant holds by induction: every written parentId is itself top-level', async () => {
      // Whatever the client aims at, the stored `parentId` is either null or an
      // id whose own parent is null. That is what makes ONE hop of repair
      // sufficient and is why there is no loop in `resolveParentId`.
      for (const parent of [
        { id: 'a', parentId: null },
        { id: 'b', parentId: 'a' },
      ]) {
        prisma.post.create.mockClear();
        prisma.post.findFirst.mockResolvedValue(parent);

        await service.createReply(
          CTX,
          'topic-1',
          { bodyMarkdown: 'x', parentId: parent.id },
          NOW,
        );

        const written = prisma.post.create.mock.calls[0]?.[0]?.data.parentId;
        expect(written).toBe(parent.parentId ?? parent.id);
      }
    });

    it('a parent in ANOTHER topic is a 404 — that is not a depth question', async () => {
      // `topicId` is part of the lookup `where`, so a foreign parent simply is
      // not found.
      prisma.post.findFirst.mockResolvedValue(null);

      await expect(
        service.createReply(
          CTX,
          'topic-1',
          { bodyMarkdown: 'x', parentId: 'foreign' },
          NOW,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.post.create).not.toHaveBeenCalled();
    });

    it('a soft-deleted parent is a 404 — a live reply must not hang under a tombstone', async () => {
      prisma.post.findFirst.mockResolvedValue(null);

      await expect(
        service.createReply(
          CTX,
          'topic-1',
          { bodyMarkdown: 'x', parentId: 'tombstone' },
          NOW,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      // The parent lookup carried the soft-delete filter.
      expect(prisma.post.findFirst.mock.calls[0]?.[0]?.where).toMatchObject({
        deletedAt: null,
      });
    });
  });

  /* ---------------------------------------------------------------------- */
  /* AD-11 — the §8.2 exit-gate item                                         */
  /* ---------------------------------------------------------------------- */

  describe('AD-11 consistency — postCount equals a freshly computed count', () => {
    /**
     * A minimal in-memory model of `community_topics` + `community_posts`,
     * driven through the REAL service.
     *
     * ⚠️ THIS IS DELIBERATELY NOT `expect(update).toHaveBeenCalledWith({ increment: 1 })`.
     * That assertion passes even when the DECREMENT is missing, which is the
     * failure that actually drifts the counter. Modelling the two columns and
     * recomputing the count at the end is the only version of this test that
     * can fail for the right reason.
     */
    interface World {
      postCount: number;
      posts: {
        id: string;
        postNumber: number;
        deletedAt: Date | null;
        parentId: string | null;
      }[];
    }

    let world: World;

    /** The invariant, computed from the posts table exactly as AD-11 states it. */
    const freshCount = (w: World): number =>
      w.posts.filter((post) => post.postNumber > 1 && post.deletedAt === null)
        .length;

    beforeEach(() => {
      world = {
        postCount: 0,
        // Post #1 — the topic body (AD-9). It is NOT a reply and must never be
        // counted.
        posts: [{ id: 'p1', postNumber: 1, deletedAt: null, parentId: null }],
      };

      prisma.topic.findFirst.mockImplementation(async () => ({
        id: 'topic-1',
        locked: false,
        // Phase 5 widened this read; the AD-11 model is indifferent to both
        // fields, but `buildNotificationRoute` throws without the slug rather
        // than storing `/members/community/topics/undefined`.
        authorId: 'topic-author',
        slug: 'a-topic',
      }));

      prisma.post.aggregate.mockImplementation(async () => ({
        _max: {
          postNumber: Math.max(
            ...world.posts
              .filter((p) => p.deletedAt === null)
              .map((p) => p.postNumber),
            0,
          ),
        },
      }));

      prisma.post.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `p${world.posts.length + 1}`,
            postNumber: data['postNumber'] as number,
            deletedAt: null,
            parentId: (data['parentId'] as string | null) ?? null,
          };
          if (world.posts.some((p) => p.postNumber === row.postNumber)) {
            throw knownRequestError('P2002', ['topic_id', 'post_number']);
          }
          world.posts.push(row);
          return row;
        },
      );

      prisma.post.update.mockImplementation(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = world.posts.find((p) => p.id === where.id);
          if (row && data['deletedAt'])
            row.deletedAt = data['deletedAt'] as Date;
          return row;
        },
      );

      prisma.topic.update.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => {
          const count = data['postCount'] as
            | { increment?: number; decrement?: number }
            | undefined;
          if (count?.increment) world.postCount += count.increment;
          if (count?.decrement) world.postCount -= count.decrement;
          return {};
        },
      );

      prisma.post.findFirst.mockImplementation(
        async ({ where }: { where: Record<string, unknown> }) => {
          const row = world.posts.find(
            (p) => p.id === where['id'] && p.deletedAt === null,
          );
          if (!row) return null;
          return {
            id: row.id,
            topicId: 'topic-1',
            postNumber: row.postNumber,
            parentId: row.parentId,
            authorId: CTX.userId,
            createdAt: NOW,
          };
        },
      );
    });

    it('holds after a sequence of creates, replies, edits and soft deletes', async () => {
      // The topic starts with post #1 only.
      expect(world.postCount).toBe(freshCount(world));
      expect(world.postCount).toBe(0);

      // Three replies.
      const first = await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'a' },
        NOW,
      );
      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'b' }, NOW);
      const third = await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'c' },
        NOW,
      );
      expect(world.postCount).toBe(freshCount(world));
      expect(world.postCount).toBe(3);

      // A nested reply — still a reply, still counted.
      await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'd', parentId: first.id },
        NOW,
      );
      expect(world.postCount).toBe(freshCount(world));

      // An EDIT must not move the counter.
      await service.updateByAuthor(
        CTX,
        first.id,
        { bodyMarkdown: 'a (fixed)' },
        NOW,
      );
      expect(world.postCount).toBe(freshCount(world));
      expect(world.postCount).toBe(4);

      // Two soft deletes.
      await service.softDelete(CTX, third.id, NOW);
      expect(world.postCount).toBe(freshCount(world));
      await service.softDelete(CTX, first.id, NOW);
      expect(world.postCount).toBe(freshCount(world));
      expect(world.postCount).toBe(2);

      // A reply after the deletes — the counter recovers correctly, and the
      // allocation still avoids the tombstoned numbers.
      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'e' }, NOW);
      expect(world.postCount).toBe(freshCount(world));
      expect(world.postCount).toBe(3);

      // The final, explicit form of the AD-11 statement.
      expect(world.postCount).toBe(
        world.posts.filter((p) => p.postNumber > 1 && p.deletedAt === null)
          .length,
      );
    });

    it('postCount EXCLUDES post #1 — a fresh topic with a body has a count of 0', async () => {
      expect(world.posts).toHaveLength(1);
      expect(world.postCount).toBe(0);
    });

    it('every postNumber stays unique even when the highest post is a tombstone', async () => {
      // The stale filtered maximum makes the first attempt collide
      // DETERMINISTICALLY, not occasionally. The retry is what converges it.
      const a = await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'a' },
        NOW,
      );
      await service.softDelete(CTX, a.id, NOW);

      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'b' }, NOW);
      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'c' }, NOW);

      const numbers = world.posts.map((p) => p.postNumber);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(world.postCount).toBe(freshCount(world));
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R1.6.4 — the author's own reply is not unread to them                   */
  /* ---------------------------------------------------------------------- */

  describe("R1.6.4 — the author's own reply leaves their unread count at 0", () => {
    it('upserts the author read marker to the new postNumber, in the SAME transaction', async () => {
      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW);

      expect(prisma.topicReadState.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.topicReadState.upsert.mock.calls[0]?.[0];

      expect(call.where).toEqual({
        userId_topicId: { userId: CTX.userId, topicId: 'topic-1' },
      });
      expect(call.create.lastReadPostNumber).toBe(4);
      expect(call.update.lastReadPostNumber).toBe(4);

      // ONE transaction wraps the post write, the counter and the marker.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('advances the marker to the post it just wrote, not to a stale number', async () => {
      prisma.post.aggregate.mockResolvedValue({ _max: { postNumber: 41 } });

      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW);

      expect(
        prisma.topicReadState.upsert.mock.calls[0]?.[0].create
          .lastReadPostNumber,
      ).toBe(42);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* TASK_2026_177 Task 14.13 — the reply notification producer               */
  /* R10.1, R10.2, RISK-AF, RISK-AJ                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * 🔴 EVERY ASSERTION HERE DRIVES THE REAL `createReply`, NOT
   * `resolveReplyRecipients` DIRECTLY.
   *
   * That is the whole instruction for exit-gate clause 2: the suppression and
   * the de-duplication have to be true OF THE PATH, not merely of a pure
   * function somebody remembered to call. A producer that computed the right set
   * and then wrote it with the wrong `actorId` — or wrote it outside the
   * transaction, or wrote it before the depth repair — passes every unit test of
   * the helper and fails all four of these.
   *
   * The pure-function block at the end of the file is a SUPPLEMENT for the
   * combinatorics, not a substitute.
   */
  describe('🔴 R10.1 — the reply notification producer', () => {
    let notifications: ReturnType<typeof notificationsDouble>;

    beforeEach(() => {
      notifications = notificationsDouble();
      service = build(prisma, notifications.service);
    });

    /** Every `create` call's input, in call order. */
    function written(): Array<Record<string, unknown>> {
      return notifications.create.mock.calls.map(
        (call) => call[0] as Record<string, unknown>,
      );
    }

    it('a top-level reply notifies the TOPIC AUTHOR with kind topic.reply', async () => {
      await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'a considered answer' },
        NOW,
      );

      expect(written()).toEqual([
        {
          recipientId: 'topic-author',
          actorId: CTX.userId,
          kind: 'topic.reply',
          targetType: 'Topic',
          targetId: 'topic-1',
          title: 'New reply to your topic',
          bodyPreview: 'a considered answer',
          route: '/members/community/topics/a-topic',
          tx: prisma,
        },
      ]);
    });

    it('🔴 passes actorId and NEVER pre-checks it against the recipient (R10.2)', async () => {
      // THE CONTRACT WITH `create()`. The suppression lives there and nowhere
      // else; a producer that filtered here would be a second copy of the rule.
      // Asserted against the SOURCE, because a producer that pre-checked and
      // happened to agree with `create()` is invisible in behaviour.
      const source = readFileSync(join(__dirname, 'posts.service.ts'), 'utf8');

      expect(source).toContain('actorId: ctx.userId');

      // ⚠️ SCOPED TO `createReply`, NOT THE WHOLE FILE. `updateByAuthor` and
      // `softDelete` both compare `post.authorId !== ctx.userId` — that is
      // R1.3.2's AUTHORSHIP check and has nothing to do with R10.2. A
      // file-wide assertion would flag them, so it would be deleted the first
      // time it fired and the real property would go with it.
      const createReply = source.slice(
        source.indexOf('  async createReply('),
        source.indexOf('  private async resolveParent('),
      );
      expect(createReply).not.toMatch(/[!=]==\s*ctx\.userId/);
      expect(createReply).not.toMatch(/ctx\.userId\s*[!=]==/);

      // The recipient resolver never sees the actor at all — it takes a topic,
      // a parent and a post id, and nothing else.
      const resolver = source.slice(
        source.indexOf('export function resolveReplyRecipients('),
        source.indexOf('export function excerptOf('),
      );
      expect(resolver).not.toContain('ctx');
      expect(resolver).not.toContain('actorId');
    });

    it('🔴 EXIT-GATE CLAUSE 2, THROUGH THE REAL PATH: the author replying to their own topic writes NOTHING', async () => {
      liveTopic(prisma, { authorId: CTX.userId });

      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW);

      // The producer still CALLS `create` — it must, or the suppression would be
      // happening here instead of there. What it must not do is write a row, and
      // `create()` returning `null` is how that is expressed.
      expect(written()).toEqual([
        expect.objectContaining({
          recipientId: CTX.userId,
          actorId: CTX.userId,
        }),
      ]);
      // …and the reply itself committed regardless: a suppression is not a
      // failure, and a producer that treated `null` as one would roll it back.
      expect(prisma.post.create).toHaveBeenCalledTimes(1);
    });

    it('🔴 RISK-AF: topic author IS the parent author ⇒ EXACTLY ONE row, post.child_reply', async () => {
      // The two-message thread, which is the COMMON case: a member posts a
      // topic, a third member replies to the opening post. A naive producer
      // writes two rows for one event and R10.2 does not catch it, because
      // neither recipient is the actor.
      liveTopic(prisma, { authorId: 'topic-author' });
      prisma.post.findFirst.mockResolvedValue({
        id: 'opening-post',
        parentId: null,
        authorId: 'topic-author',
      });

      await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'x', parentId: 'opening-post' },
        NOW,
      );

      const rows = written();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        recipientId: 'topic-author',
        kind: 'post.child_reply',
        targetType: 'Post',
        targetId: 'opening-post',
      });
    });

    it('two DIFFERENT people earn two rows, one each, with the right kind', async () => {
      // The control for the assertion above: de-duplication must not collapse
      // two genuinely distinct recipients.
      liveTopic(prisma, { authorId: 'topic-author' });
      prisma.post.findFirst.mockResolvedValue({
        id: 'some-post',
        parentId: null,
        authorId: 'other-member',
      });

      await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'x', parentId: 'some-post' },
        NOW,
      );

      expect(written().map((row) => [row['recipientId'], row['kind']])).toEqual(
        [
          ['topic-author', 'topic.reply'],
          ['other-member', 'post.child_reply'],
        ],
      );
    });

    it('🔴 THE REPAIR CASE: the notification follows the REPAIRED parent, not the requested one', async () => {
      // Task 14.13's third assertion. The requested parent is at depth 2, so the
      // reply is re-pointed to ITS parent — and a notification aimed at the
      // requested post would tell `wrong-recipient` their post was replied to
      // when the reply landed elsewhere in the tree.
      liveTopic(prisma, { authorId: 'topic-author' });
      prisma.post.findFirst
        // (1) the requested parent — itself a reply
        .mockResolvedValueOnce({
          id: 'depth-2-post',
          parentId: 'depth-1-post',
          authorId: 'wrong-recipient',
        })
        // (2) the repaired parent, read ONLY for its author
        .mockResolvedValueOnce({ authorId: 'right-recipient' });

      const created = await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'x', parentId: 'depth-2-post' },
        NOW,
      );

      // The attachment is unchanged (RK-12) …
      expect(created.parentId).toBe('depth-1-post');
      expect(created.depthRepaired).toBe(true);

      // … and the notification follows it.
      const child = written().find((row) => row['kind'] === 'post.child_reply');
      expect(child).toMatchObject({
        recipientId: 'right-recipient',
        targetId: 'depth-1-post',
      });
      expect(written().map((row) => row['recipientId'])).not.toContain(
        'wrong-recipient',
      );
    });

    it('a repaired parent that is a TOMBSTONE notifies nobody, and the reply still attaches', async () => {
      liveTopic(prisma, { authorId: 'topic-author' });
      prisma.post.findFirst
        .mockResolvedValueOnce({
          id: 'depth-2-post',
          parentId: 'deleted-parent',
          authorId: 'wrong-recipient',
        })
        // The `NOT_DELETED` read finds nothing: the grandparent is a tombstone.
        .mockResolvedValueOnce(null);

      const created = await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'x', parentId: 'depth-2-post' },
        NOW,
      );

      expect(created.parentId).toBe('deleted-parent');
      expect(written().map((row) => row['kind'])).toEqual(['topic.reply']);
    });

    it('a topic whose author DELETED THEIR ACCOUNT produces no row at all', async () => {
      // `Topic.authorId` is nullable (`onDelete: SetNull`). A `null` recipient
      // would fail the foreign key INSIDE the reply's transaction and turn a
      // perfectly good reply into a 400.
      liveTopic(prisma, { authorId: null });

      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW);

      expect(written()).toEqual([]);
      expect(prisma.post.create).toHaveBeenCalledTimes(1);
    });

    it('🔴 ENLISTS IN THE REPLY TRANSACTION (ASSUMPTION-21) — same tx object', async () => {
      let txSeenByTransaction: unknown;
      prisma.$transaction.mockImplementation(
        async (cb: (tx: MockForumPrisma) => Promise<unknown>) => {
          txSeenByTransaction = prisma;
          return cb(prisma);
        },
      );

      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW);

      expect(written()[0]?.['tx']).toBe(txSeenByTransaction);
    });

    it('🔴 a FAILED notification rolls the reply back (ASSUMPTION-21)', async () => {
      // The property the `tx` above exists for, asserted as behaviour rather
      // than as an argument shape: the error must escape `createReply`.
      notifications.create.mockRejectedValue(
        new Error('notification exploded'),
      );

      await expect(
        service.createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW),
      ).rejects.toThrow('notification exploded');
    });

    it('🔴 the RETRY does not leave a duplicate notification behind', async () => {
      // A `postNumber` collision rolls the whole transaction back, notifications
      // included, and `createReply` retries. The double cannot model a rollback,
      // so what is asserted is the thing that would be WRONG: the notification
      // must be written INSIDE the callback, so a rolled-back attempt takes it
      // with it. If it were written outside, a two-attempt reply would leave two
      // committed rows for one reply.
      const source = readFileSync(join(__dirname, 'posts.service.ts'), 'utf8');
      const txBody = source.slice(
        source.indexOf('this.prisma.$transaction(async (tx)'),
        source.indexOf('return post;'),
      );

      expect(txBody).toContain('this.notifications.create(');
      expect(txBody).toContain('tx,');
    });

    it('truncates the preview and stores MARKDOWN SOURCE, unrendered (ground truth 4)', async () => {
      const body = `**bold** ${'x'.repeat(400)}`;

      await service.createReply(CTX, 'topic-1', { bodyMarkdown: body }, NOW);

      const preview = written()[0]?.['bodyPreview'] as string;
      // The markers survive: nothing rendered them, nothing stripped them.
      expect(preview.startsWith('**bold**')).toBe(true);
      expect(preview.length).toBeLessThanOrEqual(141); // 140 + the ellipsis
      expect(preview.endsWith('…')).toBe(true);
    });

    it('🔴 the route goes through buildNotificationRoute — a hostile slug cannot escape /members/ (RISK-AJ)', async () => {
      liveTopic(prisma, { slug: '../../admin?x=1#y' });

      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW);

      const route = written()[0]?.['route'] as string;
      expect(route.startsWith('/members/community/topics/')).toBe(true);
      // Percent-encoded into ONE inert path segment.
      expect(route).toBe(
        `/members/community/topics/${encodeURIComponent('../../admin?x=1#y')}`,
      );
    });

    it('🔴 the child-reply route anchors on the NEW post, while targetId is the parent', async () => {
      liveTopic(prisma, { authorId: 'topic-author', slug: 'a-topic' });
      prisma.post.findFirst.mockResolvedValue({
        id: 'some-post',
        parentId: null,
        authorId: 'other-member',
      });

      await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'x', parentId: 'some-post' },
        NOW,
      );

      const child = written().find((row) => row['kind'] === 'post.child_reply');
      // The two ids are DIFFERENT on purpose — see the producer's docblock.
      expect(child?.['targetId']).toBe('some-post');
      expect(child?.['route']).toBe(
        '/members/community/topics/a-topic#post-new-post',
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The reply write path                                                    */
  /* ---------------------------------------------------------------------- */

  describe('createReply', () => {
    it('bumps lastPostedAt — the feed sort key — in the same transaction', async () => {
      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW);

      expect(prisma.topic.update).toHaveBeenCalledWith({
        where: { id: 'topic-1' },
        data: { postCount: { increment: 1 }, lastPostedAt: NOW },
      });
    });

    it('allocates postNumber INSIDE the transaction', async () => {
      let aggregateRanInsideTransaction = false;
      prisma.$transaction.mockImplementation(
        async (cb: (tx: MockForumPrisma) => Promise<unknown>) => {
          prisma.post.aggregate.mockImplementation(async () => {
            aggregateRanInsideTransaction = true;
            return { _max: { postNumber: 3 } };
          });
          return cb(prisma);
        },
      );

      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW);

      expect(aggregateRanInsideTransaction).toBe(true);
    });

    it('replies attach chronologically — the next number after the highest', async () => {
      prisma.post.aggregate.mockResolvedValue({ _max: { postNumber: 7 } });

      const created = await service.createReply(
        CTX,
        'topic-1',
        { bodyMarkdown: 'x' },
        NOW,
      );

      expect(created.postNumber).toBe(8);
    });

    it('a locked topic refuses the reply with 403 { reason: topic_locked }', async () => {
      liveTopic(prisma, { locked: true });

      await expect(
        service.createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW),
      ).rejects.toMatchObject({
        status: 403,
        response: { reason: TOPIC_LOCKED_REASON },
      });
      expect(prisma.post.create).not.toHaveBeenCalled();
    });

    it('an invisible or soft-deleted topic is a 404, never a 403', async () => {
      prisma.topic.findFirst.mockResolvedValue(null);

      const error = await service
        .createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).not.toBeInstanceOf(ForbiddenException);
    });

    it('the topic lookup carries both the soft-delete filter and the category visibility clause', async () => {
      await service.createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW);

      const where = prisma.topic.findFirst.mock.calls[0]?.[0]?.where;
      expect(where.deletedAt).toBeNull();
      expect(where.category).toBeDefined();
      expect(where.category.OR).toBeDefined();
    });

    it('never forwards a raw Prisma message to the client (NFR-S7)', async () => {
      prisma.post.create.mockRejectedValue(knownRequestError('P2003'));

      const error = await service
        .createReply(CTX, 'topic-1', { bodyMarkdown: 'x' }, NOW)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as Error).message).not.toContain('sanitize me');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Edit                                                                    */
  /* ---------------------------------------------------------------------- */

  describe('updateByAuthor', () => {
    beforeEach(() => {
      prisma.post.findFirst.mockResolvedValue({
        id: 'post-9',
        topicId: 'topic-1',
        postNumber: 2,
        authorId: CTX.userId,
        createdAt: new Date('2026-08-04T11:00:00.000Z'),
      });
      prisma.post.update.mockResolvedValue({});
    });

    it('sets editedAt alongside the body', async () => {
      await service.updateByAuthor(
        CTX,
        'post-9',
        { bodyMarkdown: 'fixed' },
        NOW,
      );

      expect(prisma.post.update).toHaveBeenCalledWith({
        where: { id: 'post-9' },
        data: { bodyMarkdown: 'fixed', editedAt: NOW },
      });
    });

    it('a non-author edit is 403', async () => {
      await expect(
        service.updateByAuthor(OTHER, 'post-9', { bodyMarkdown: 'x' }, NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.post.update).not.toHaveBeenCalled();
    });

    it('an out-of-window edit is 403 — the window is measured from createdAt', async () => {
      const tooLate = new Date('2026-08-05T11:00:01.000Z'); // 24h + 1s later

      await expect(
        service.updateByAuthor(CTX, 'post-9', { bodyMarkdown: 'x' }, tooLate),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('an edit one second inside the window is allowed', async () => {
      const justInTime = new Date('2026-08-05T10:59:59.000Z');

      await expect(
        service.updateByAuthor(
          CTX,
          'post-9',
          { bodyMarkdown: 'x' },
          justInTime,
        ),
      ).resolves.toMatchObject({ id: 'post-9' });
    });

    it('there is NO admin bypass on the member edit path', async () => {
      // The structural exemption: an admin edits through the moderation
      // surface, which is a different route behind AdminGuard.
      const admin: MemberContext = { ...OTHER, isAdmin: true };

      await expect(
        service.updateByAuthor(admin, 'post-9', { bodyMarkdown: 'x' }, NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Tombstones                                                              */
  /* ---------------------------------------------------------------------- */

  describe('softDelete — tombstones (R1.3.5)', () => {
    beforeEach(() => {
      prisma.post.findFirst.mockResolvedValue({
        id: 'post-9',
        topicId: 'topic-1',
        postNumber: 4,
        authorId: CTX.userId,
        createdAt: NOW,
      });
      prisma.post.update.mockResolvedValue({});
    });

    it('sets deletedAt/deletedBy and decrements postCount in ONE transaction', async () => {
      await service.softDelete(CTX, 'post-9', NOW);

      expect(prisma.post.update).toHaveBeenCalledWith({
        where: { id: 'post-9' },
        data: { deletedAt: NOW, deletedBy: CTX.userId },
      });
      expect(prisma.topic.update).toHaveBeenCalledWith({
        where: { id: 'topic-1' },
        data: { postCount: { decrement: 1 } },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("does NOT touch the post's children — a deleted parent's replies still read", async () => {
      await service.softDelete(CTX, 'post-9', NOW);

      // Exactly one post row was written: the tombstone itself. Nothing
      // cascaded, nothing was renumbered.
      expect(prisma.post.update).toHaveBeenCalledTimes(1);
      expect(prisma.post.updateMany).not.toHaveBeenCalled();
      expect(prisma.post.deleteMany).not.toHaveBeenCalled();
      expect(prisma.post.delete).not.toHaveBeenCalled();
    });

    it('keeps the stored body — withholding happens at the READ model, so a restore is possible', async () => {
      await service.softDelete(CTX, 'post-9', NOW);

      const written = prisma.post.update.mock.calls[0]?.[0]?.data;
      expect(written).not.toHaveProperty('bodyMarkdown');
      expect(written).not.toHaveProperty('authorId');
    });

    it('a non-author delete is 403', async () => {
      await expect(
        service.softDelete(OTHER, 'post-9', NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('post #1 cannot be deleted through this endpoint — it is the topic body (AD-9)', async () => {
      prisma.post.findFirst.mockResolvedValue({
        id: 'p1',
        topicId: 'topic-1',
        postNumber: 1,
        authorId: CTX.userId,
        createdAt: NOW,
      });

      await expect(service.softDelete(CTX, 'p1', NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.topic.update).not.toHaveBeenCalled();
    });

    it('there is no edit window on deletion — a day-old post is still deletable', async () => {
      prisma.post.findFirst.mockResolvedValue({
        id: 'post-9',
        topicId: 'topic-1',
        postNumber: 4,
        authorId: CTX.userId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await expect(service.softDelete(CTX, 'post-9', NOW)).resolves.toEqual({
        deleted: true,
      });
    });
  });

  describe('softDeleteAsAdmin', () => {
    it('records the acting admin in deletedBy, with no author check', async () => {
      prisma.post.findFirst.mockResolvedValue({
        id: 'post-9',
        topicId: 'topic-1',
        postNumber: 4,
      });
      prisma.post.update.mockResolvedValue({});

      await service.softDeleteAsAdmin('post-9', 'admin-7', NOW);

      expect(prisma.post.update).toHaveBeenCalledWith({
        where: { id: 'post-9' },
        data: { deletedAt: NOW, deletedBy: 'admin-7' },
      });
    });

    it('enlists the audit hook in the mutation transaction (PRE-6)', async () => {
      prisma.post.findFirst.mockResolvedValue({
        id: 'post-9',
        topicId: 'topic-1',
        postNumber: 4,
      });
      prisma.post.update.mockResolvedValue({});

      const audit = jest.fn().mockResolvedValue(undefined);
      await service.softDeleteAsAdmin('post-9', 'admin-7', NOW, audit);

      expect(audit).toHaveBeenCalledTimes(1);
      // The hook received the SAME client the mutation used, so the audit row
      // commits or rolls back with it.
      expect(audit.mock.calls[0]?.[0]).toBe(prisma);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The pure halves — a SUPPLEMENT to the path assertions, never a substitute   */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ READ THE `R10.1` BLOCK ABOVE FIRST. Exit-gate clause 2 is asserted THROUGH
 * `createReply`, because a helper can be perfectly correct and never called.
 * What these add is the combinatorics — four author configurations for one
 * event — which would need four full `createReply` drives to say the same thing
 * and would say it less clearly.
 */
describe('resolveReplyRecipients — RISK-AF in isolation', () => {
  const TOPIC = { id: 't1', slug: 'a-topic', authorId: 'topic-author' };

  it.each([
    ['no parent', null, ['topic-author:topic.reply']],
    [
      'parent by the same person',
      { id: 'p1', authorId: 'topic-author' },
      ['topic-author:post.child_reply'],
    ],
    [
      'parent by someone else',
      { id: 'p1', authorId: 'other' },
      ['topic-author:topic.reply', 'other:post.child_reply'],
    ],
    [
      'parent by a deleted account',
      { id: 'p1', authorId: null },
      ['topic-author:topic.reply'],
    ],
  ])('%s', (_label, parent, expected) => {
    const rows = resolveReplyRecipients(TOPIC, parent, 'new-post');

    expect(rows.map((row) => `${row.recipientId}:${row.kind}`)).toEqual(
      expected,
    );
  });

  it('a deleted topic author AND a deleted parent author produce nothing', () => {
    expect(
      resolveReplyRecipients(
        { ...TOPIC, authorId: null },
        { id: 'p1', authorId: null },
        'new-post',
      ),
    ).toEqual([]);
  });

  it('🔴 the SPECIFIC kind wins the collision, not the general one', () => {
    // The ordering inside the function is the entire de-duplication mechanism.
    // Swap the two `Map.set` calls and this is the assertion that goes red.
    const [only] = resolveReplyRecipients(
      TOPIC,
      { id: 'p1', authorId: 'topic-author' },
      'new-post',
    );

    expect(only?.kind).toBe('post.child_reply');
    expect(only?.targetType).toBe('Post');
  });
});

describe('excerptOf', () => {
  it('returns null for an empty or whitespace-only body', () => {
    expect(excerptOf('')).toBeNull();
    expect(excerptOf('   \n\t ')).toBeNull();
  });

  it('returns a short body verbatim, with no ellipsis', () => {
    expect(excerptOf('  short reply  ')).toBe('short reply');
  });

  it('does not render, escape or strip markdown (ground truth 4)', () => {
    // The contract says `bodyPreview` is NOT sanitized and the client renders it
    // into a text node. Anything done here would be the wrong end of the pipe.
    expect(excerptOf('<script>alert(1)</script> **hi**')).toBe(
      '<script>alert(1)</script> **hi**',
    );
  });
});
