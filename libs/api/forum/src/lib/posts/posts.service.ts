import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';

import { assertWithinEditWindow } from '../common/edit-window';
import {
  NOT_DELETED,
  assertRestored,
  restorableWhere,
} from '../common/soft-delete';
import { buildTopicCategoryVisibilityWhere } from '../common/visibility';
import {
  assertTopicNotLocked,
  type ModerationAuditHook,
} from '../topics/topics.service';

import type { CreatePostDto } from './dto/create-post.dto';
import type { UpdatePostDto } from './dto/update-post.dto';

/**
 * The post number of the opening post. AD-9: it IS the topic body.
 *
 * Named rather than written as a bare `1` in five places, because every rule in
 * this service that treats the opening post differently — it is not counted by
 * `postCount`, it cannot be replied-to-as-a-child at depth 3, it cannot be
 * deleted through the post endpoint — keys off this number.
 */
export const FIRST_POST_NUMBER = 1;

/**
 * How many times a reply retries after losing the `postNumber` race.
 *
 * ⚠️ THE RETRY IS THE OTHER HALF OF `@@unique([topicId, postNumber])`. Two
 * concurrent replies read the same maximum, compute the same next number, and
 * one of them loses — LOUDLY, with a `P2002`, which is exactly what the unique
 * index is for (the alternative is two posts silently sharing a number and a
 * thread that cannot be ordered). A retry turns "loudly" into "and then it
 * worked", which is what the member needs.
 *
 * ⚠️ IT ALSO ABSORBS A NON-RACY CASE, AND THIS IS THE SUBTLE ONE. The maximum is
 * read through `NOT_DELETED`, because AD-5 requires every read in this file to
 * carry the filter and `soft-delete-filter.spec.ts` enforces it. But the unique
 * index does NOT exclude tombstones — a soft-deleted post keeps its number
 * forever (R1.3.5: the row stays so the thread is not renumbered and the
 * children are not orphaned). So when the highest-numbered post in a topic has
 * been soft-deleted, the filtered maximum is STALE and the first attempt
 * collides deterministically, not occasionally. The retry increments and
 * converges within one or two attempts, and the attempts are bounded so a
 * pathological topic produces a typed `409` rather than a hot loop.
 *
 * This is a genuine, reported tension between AD-5's structural rule and
 * `postNumber` allocation. The alternatives were an AD-5 exemption comment on a
 * MEMBER write path (rejected — the exemption census exists for the admin
 * `?includeDeleted` read) and hand-written SQL in the hottest write path
 * (rejected — it would not remove the need for this retry anyway, since a
 * `SELECT MAX` under a transaction snapshot does not lock the range).
 */
const MAX_POST_NUMBER_ATTEMPTS = 6;

/** What `createReply` hands back; the controller composes the wire shape. */
export interface CreatedPost {
  readonly id: string;
  readonly topicId: string;
  readonly postNumber: number;
  /** After the R1.3.3 repair — NOT necessarily what the client sent. */
  readonly parentId: string | null;
  /** `true` when {@link parentId} differs from the requested one (RK-12). */
  readonly depthRepaired: boolean;
}

/**
 * PostsService — replies, depth repair, tombstones and the `postCount`
 * invariant. R1.3.1–R1.3.5, R1.6.4, AD-9, AD-11, RK-12.
 *
 * ⚠️ THREE THINGS HAPPEN IN THE SAME TRANSACTION AS EVERY REPLY WRITE, AND EACH
 * IS A BUG IF IT HAPPENS ANYWHERE ELSE:
 *
 *   1. `Topic.postCount` is incremented (AD-11). It is the ONE denormalised
 *      counter this design permits, and the only thing licensing it is the
 *      consistency test in `posts.service.spec.ts` — without that test it is
 *      exactly the un-reconciled counter RK-1 rejects.
 *   2. `Topic.lastPostedAt` is bumped. It is the FEED'S SORT KEY
 *      (`@@index([pinned, lastPostedAt])`); a reply that commits without it
 *      leaves an active thread sorted as though it were dormant.
 *   3. The AUTHOR'S OWN read marker is advanced (R1.6.4). Done after the
 *      transaction, a member's own post flashes as unread to them until they
 *      reload — the single most obviously-wrong behaviour an unread count can
 *      have.
 *
 * ⚠️ `postCount` COUNTS REPLIES ONLY. It excludes post #1 (which is the body,
 * not a reply) and excludes soft-deleted posts. The invariant, asserted
 * directly: `Topic.postCount === count({ topicId, postNumber: { gt: 1 },
 * deletedAt: null })`, after ANY sequence of creates, replies, edits and
 * deletes.
 */
@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Reply to a topic — R1.3.1, R1.3.3, R1.3.4, R1.6.4, AD-11, RK-12.
   *
   * ⚠️ THE DEPTH CAP IS A REPAIR, NOT A REJECTION (R1.3.3, RK-12, §8.2 exit
   * gate). A `parentId` naming a post that itself has a parent is re-pointed to
   * THAT post's parent, so the reply lands as a sibling at depth 2 and is
   * saved. A `400` here would discard a member's written reply over an
   * implementation detail they cannot see — the nesting cap is not in the wire
   * contract, the UI renders two levels, and a client that guessed wrong is not
   * the member's problem. `depthRepaired` is reported back so a client CAN show
   * "replying to the thread" if it wants to, but nothing depends on it.
   *
   * Depth cannot exceed 2 by induction: every stored post has either a `null`
   * parent or a parent whose own parent is `null`, and this method preserves
   * that on every write. So one hop of repair is always enough — there is no
   * loop here and there does not need to be one.
   */
  async createReply(
    ctx: MemberContext,
    topicId: string,
    input: CreatePostDto,
    now: Date = new Date(),
  ): Promise<CreatedPost> {
    const topic = await this.prisma.topic.findFirst({
      where: {
        id: topicId,
        ...NOT_DELETED,
        ...buildTopicCategoryVisibilityWhere(ctx),
      },
      select: { id: true, locked: true },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    // R1.3.4 — a locked topic refuses new replies while staying readable. The
    // refusal is constructed in ONE place, shared with the moderation service.
    assertTopicNotLocked(topic.locked);

    const parentId = await this.resolveParentId(topic.id, input.parentId);
    const depthRepaired =
      input.parentId !== undefined && parentId !== input.parentId;

    for (let attempt = 1; attempt <= MAX_POST_NUMBER_ATTEMPTS; attempt++) {
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          // ⚠️ ALLOCATED INSIDE THE TRANSACTION. Reading the maximum outside it
          // and writing inside would widen the window in which two replies see
          // the same number from "the duration of one statement" to "the
          // duration of the request".
          const highest = await tx.post.aggregate({
            where: { topicId: topic.id, ...NOT_DELETED },
            _max: { postNumber: true },
          });

          const postNumber =
            Math.max(
              highest._max.postNumber ?? FIRST_POST_NUMBER,
              FIRST_POST_NUMBER,
            ) + attempt;

          const post = await tx.post.create({
            data: {
              topicId: topic.id,
              parentId,
              postNumber,
              bodyMarkdown: input.bodyMarkdown,
              authorId: ctx.userId,
            },
            select: { id: true, postNumber: true, parentId: true },
          });

          // AD-11 + the feed's sort key, in the SAME transaction as the write.
          await tx.topic.update({
            where: { id: topic.id },
            data: { postCount: { increment: 1 }, lastPostedAt: now },
          });

          // R1.6.4 — the author's own reply must not read as unread TO THEM.
          // The new post carries the highest `postNumber` in the topic by
          // construction, so advancing the marker to it can only move forwards:
          // this upsert is monotonic without needing a conditional.
          await tx.topicReadState.upsert({
            where: {
              userId_topicId: { userId: ctx.userId, topicId: topic.id },
            },
            create: {
              userId: ctx.userId,
              topicId: topic.id,
              lastReadPostNumber: post.postNumber,
            },
            update: { lastReadPostNumber: post.postNumber },
          });

          return post;
        });

        this.logger.log(
          `Reply created: id=${created.id} topic=${topic.id} n=${created.postNumber}` +
            (depthRepaired ? ' depth-repaired' : ''),
        );

        return {
          id: created.id,
          topicId: topic.id,
          postNumber: created.postNumber,
          parentId: created.parentId,
          depthRepaired,
        };
      } catch (error: unknown) {
        if (
          this.isPostNumberCollision(error) &&
          attempt < MAX_POST_NUMBER_ATTEMPTS
        ) {
          continue;
        }
        throw this.mapPrismaError(error);
      }
    }

    // Unreachable in practice: `attempt` is added to the observed maximum, so
    // each retry strictly advances the candidate. Typed and sanitized (NFR-S7).
    throw new BadRequestException(
      'This topic is receiving replies faster than they can be numbered — please try again',
    );
  }

  /**
   * The R1.3.3 depth repair — the one piece of logic RK-12 names.
   *
   * Returns the parent id the reply should ACTUALLY be attached to:
   *   - `null` for a top-level reply;
   *   - the requested id, when that post is itself top-level (depth 2, legal);
   *   - the requested post's OWN parent, when the request would have produced
   *     depth 3 (the repair).
   *
   * ⚠️ A PARENT THAT IS SOFT-DELETED OR IN ANOTHER TOPIC IS A `404`, NOT A
   * REPAIR. Those are not depth problems: the first would attach a live reply
   * under a tombstone the member cannot see the body of, and the second would
   * put a post in a thread its parent does not belong to. Both mean the client
   * is referring to something that does not exist in this context, which is what
   * `404` says.
   */
  private async resolveParentId(
    topicId: string,
    requestedParentId: string | undefined,
  ): Promise<string | null> {
    if (requestedParentId === undefined) return null;

    const parentPost = await this.prisma.post.findFirst({
      where: { id: requestedParentId, topicId, ...NOT_DELETED },
      select: { id: true, parentId: true },
    });

    if (!parentPost) {
      throw new NotFoundException('Parent post not found in this topic');
    }

    // THE REPAIR. `parentPost.parentId` is non-null exactly when the requested
    // parent is itself a depth-2 reply — attaching to it would be depth 3, so
    // the new reply becomes its SIBLING instead.
    return parentPost.parentId ?? parentPost.id;
  }

  /**
   * Edit a reply — R1.3.2, ASSUMPTION-5.
   *
   * Author only, inside the edit window. Both refusals are `403` (§3.3), and
   * the window is decided by the single guard in `common/edit-window.ts` — the
   * same one `TopicsService` uses, so a topic edit and a post edit cannot end up
   * with two different windows.
   *
   * ⚠️ THE VISIBILITY FILTER REACHES THROUGH THE TOPIC. A post is visible only
   * if its topic is live AND its topic's category is visible, so the `where`
   * nests both — rather than finding the post and then checking its topic,
   * which decides the post exists before it checks whether it may.
   */
  async updateByAuthor(
    ctx: MemberContext,
    postId: string,
    input: UpdatePostDto,
    now: Date = new Date(),
  ): Promise<{ id: string; topicId: string }> {
    const post = await this.requireVisiblePost(ctx, postId);

    if (post.authorId !== ctx.userId) {
      throw new ForbiddenException('Only the author can edit this post');
    }
    assertWithinEditWindow(post.createdAt, now);

    await this.prisma.post.update({
      where: { id: post.id },
      data: { bodyMarkdown: input.bodyMarkdown, editedAt: now },
    });

    this.logger.log(`Post edited by author: id=${post.id}`);
    return { id: post.id, topicId: post.topicId };
  }

  /**
   * Soft delete a reply — R1.3.5, AD-5, AD-11.
   *
   * ⚠️ THE ROW BECOMES A TOMBSTONE, NOT A HOLE. It keeps its `postNumber`, stays
   * in the thread, and keeps its children attached beneath it. Removing it
   * would renumber the conversation and orphan every reply written to it —
   * which is also why `Post.parent` is `onDelete: Restrict`: nothing hard-deletes
   * a post, and if something ever tried, Postgres would refuse rather than
   * orphan the children R1.3.5 requires stay readable.
   *
   * The body and author are withheld at the READ MODEL (`common/post-view.ts`),
   * not here. The stored text survives so R8.5's admin restore is a single-row
   * write rather than an unrecoverable loss.
   *
   * ⚠️ POST #1 CANNOT BE DELETED THROUGH THIS ENDPOINT. It is the topic body
   * (AD-9), and tombstoning it would leave a topic that renders nothing while
   * still appearing in the feed with a title and a reply count. Deleting the
   * TOPIC is the operation that means "remove this thread", and it is a `400`
   * with a message that says so rather than a silent success.
   */
  async softDelete(
    ctx: MemberContext,
    postId: string,
    now: Date = new Date(),
  ): Promise<{ deleted: boolean }> {
    const post = await this.requireVisiblePost(ctx, postId);

    if (post.authorId !== ctx.userId) {
      throw new ForbiddenException('Only the author can delete this post');
    }
    if (post.postNumber === FIRST_POST_NUMBER) {
      throw new BadRequestException(
        'The opening post is the topic body and cannot be deleted on its own — delete the topic instead',
      );
    }

    await this.tombstone(post.id, post.topicId, ctx.userId, now);

    this.logger.log(`Post soft-deleted by author: id=${post.id}`);
    return { deleted: true };
  }

  /**
   * Admin soft delete — R8.2. No author check, no `MemberContext`, and the
   * acting admin is recorded in `deletedBy` so R8.5's restore window is
   * auditable.
   */
  async softDeleteAsAdmin(
    postId: string,
    actorId: string,
    now: Date = new Date(),
    audit?: ModerationAuditHook,
  ): Promise<{ deleted: boolean }> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, ...NOT_DELETED },
      select: { id: true, topicId: true, postNumber: true },
    });
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    if (post.postNumber === FIRST_POST_NUMBER) {
      throw new BadRequestException(
        'The opening post is the topic body — delete the topic instead',
      );
    }

    await this.tombstone(post.id, post.topicId, actorId, now, audit);

    this.logger.log(
      `Post soft-deleted by admin: id=${post.id} actor=${actorId}`,
    );
    return { deleted: true };
  }

  /**
   * Admin restore of a tombstoned reply — R8.5, R8.2.
   *
   * ⚠️ IT MUST RE-INCREMENT `postCount`, AND THAT IS THE WHOLE REASON THIS IS
   * NOT A ONE-LINER. {@link tombstone} decremented it (AD-11:
   * `postCount === count({ postNumber > 1, deletedAt: null })`), so a restore
   * that only clears `deletedAt` leaves the counter permanently one BELOW the
   * truth — and RK-1 forbids the reconciliation job that would ever notice.
   * `posts.service.spec.ts` asserts the invariant after an arbitrary sequence,
   * restore included, rather than asserting that an increment was called.
   *
   * ⚠️ THE `topicId` IS READ *AFTER* THE RESTORE, THROUGH A FULLY FILTERED
   * READ. That ordering is what keeps this path free of an AD-5 exemption: by
   * the time the `findFirst` runs, the post is LIVE, so `...NOT_DELETED` finds
   * it honestly. Reading it first would have meant reading a tombstone.
   *
   * ⚠️ THE WINDOW IS THE `UPDATE`'S `WHERE` (see `restorableWhere`), so the
   * check and the write cannot disagree and `count` is the outcome.
   *
   * A reply inside a SOFT-DELETED TOPIC restores fine and stays invisible until
   * the topic is restored too — the topic's own `deletedAt` is what hides the
   * thread, and having this route silently refuse would make "restore the
   * topic, then its posts" impossible in that order.
   */
  async restore(
    postId: string,
    actorId: string,
    now: Date = new Date(),
    audit?: ModerationAuditHook,
  ): Promise<{ restored: boolean }> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.post.updateMany({
        where: { id: postId, ...restorableWhere(now) },
        data: { deletedAt: null, deletedBy: null },
      });

      assertRestored(result.count);

      const restored = await tx.post.findFirst({
        where: { id: postId, ...NOT_DELETED },
        select: { topicId: true },
      });
      if (!restored) {
        // Unreachable: the `updateMany` above just cleared `deletedAt` on this
        // row inside this transaction. Checked rather than asserted because the
        // alternative is a non-null assertion on the value that decides whether
        // AD-11's counter is repaired.
        throw new NotFoundException('Post not found');
      }

      await tx.topic.update({
        where: { id: restored.topicId },
        data: { postCount: { increment: 1 } },
      });

      await audit?.(tx, restored.topicId, ['post.restored']);
    });

    this.logger.log(`Post restored by admin: id=${postId} actor=${actorId}`);
    return { restored: true };
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * The tombstone write and the `postCount` decrement, in ONE transaction.
   *
   * ⚠️ THE DECREMENT MUST BE ATOMIC WITH THE DELETE. Split across two
   * statements, a failure between them leaves `postCount` permanently one
   * higher than the truth — and because there is no reconciliation job (RK-1
   * forbids one), permanently is the operative word. This is the same reason
   * the increment lives inside the create transaction.
   *
   * The caller has already established `postNumber > 1`, so the decrement is
   * unconditional here: only replies are counted (AD-11).
   */
  private async tombstone(
    postId: string,
    topicId: string,
    actorId: string,
    now: Date,
    audit?: ModerationAuditHook,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.post.update({
        where: { id: postId },
        data: { deletedAt: now, deletedBy: actorId },
      });

      await tx.topic.update({
        where: { id: topicId },
        data: { postCount: { decrement: 1 } },
      });

      await audit?.(tx, topicId, ['post.deleted']);
    });
  }

  /**
   * One post, if the member may see it: the post is live, its topic is live,
   * and its topic's category is visible. Otherwise `404` (R1.1.3).
   */
  private async requireVisiblePost(
    ctx: MemberContext,
    postId: string,
  ): Promise<{
    id: string;
    topicId: string;
    postNumber: number;
    authorId: string | null;
    createdAt: Date;
  }> {
    const post = await this.prisma.post.findFirst({
      where: {
        id: postId,
        ...NOT_DELETED,
        topic: { ...NOT_DELETED, ...buildTopicCategoryVisibilityWhere(ctx) },
      },
      select: {
        id: true,
        topicId: true,
        postNumber: true,
        authorId: true,
        createdAt: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }
    return post;
  }

  /** A `P2002` on `(topicId, postNumber)` — the one collision a reply retries. */
  private isPostNumberCollision(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (error.code !== 'P2002') return false;

    const target = error.meta?.['target'];
    if (Array.isArray(target)) return target.includes('post_number');
    if (typeof target === 'string') return target.includes('post_number');
    // No reported target: this transaction writes one `Post`, whose only unique
    // constraint IS `(topicId, postNumber)`. Retrying is the safe direction.
    return true;
  }

  /** Typed, sanitized translation of a Prisma failure (NFR-S7). */
  private mapPrismaError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003') {
        return new NotFoundException('Topic or parent post not found');
      }
      if (error.code === 'P2025') {
        return new NotFoundException('Post not found');
      }
    }
    return error instanceof Error
      ? error
      : new Error('Unknown post persistence error');
  }
}
