import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';

import { emptyReactionCounts } from '../common/post-view';
import { NOT_DELETED } from '../common/soft-delete';
import { buildTopicCategoryVisibilityWhere } from '../common/visibility';

import {
  isReactionType,
  type ReactionCounts,
  type ReactionType,
} from './reaction-types';

/** Everything a thread render needs about reactions, in two queries. */
export interface ReactionSummary {
  /** Per-post, per-type counts. Absent post id ⇒ no reactions at all. */
  readonly counts: ReadonlyMap<string, ReactionCounts>;
  /** The REQUESTING member's own reactions, by post id. */
  readonly mine: ReadonlyMap<string, ReactionType[]>;
}

/**
 * ReactionsService — R1.4.1–R1.4.4, A-8.
 *
 * ⚠️ COUNTS ARE DERIVED, NEVER STORED (R1.4.4, RK-1). There is no
 * `Post.likeCount` column and there must not be one. `Topic.postCount` is the
 * SINGLE denormalisation this design allows (AD-11), and the only thing that
 * licenses it is a consistency test; a second counter would need a second such
 * test and would be the un-reconciled counter RK-1 rejects. At §1.3 volume a
 * `groupBy` over `community_post_reactions` filtered to one page of post ids is
 * an index scan over a handful of rows.
 *
 * ⚠️ THE TOGGLE IS DELETE-IF-EXISTS-ELSE-CREATE, INSIDE ONE TRANSACTION
 * (R1.4.1). Read-then-write across two round trips lets a double-tap — or two
 * tabs — both observe "no reaction" and both create, which
 * `@@unique([postId, userId, type])` then rejects with a `500` on the second.
 * Inside a transaction the constraint still decides, but the losing branch is
 * a retry-able conflict rather than a torn read.
 */
@Injectable()
export class ReactionsService {
  private readonly logger = new Logger(ReactionsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Toggle one reaction type on one post — R1.4.1.
   *
   * Returns the post's counts and the member's own reactions AFTER the change,
   * both read inside the same transaction, so a client never has to make a
   * second request to learn what its own click did — and never renders a count
   * from before its own write.
   *
   * A post the member cannot see, or a soft-deleted one, is `404` (R1.1.3,
   * R1.3.5): reacting to a tombstone would attach personal state to content the
   * member is not allowed to read.
   */
  async toggle(
    ctx: MemberContext,
    postId: string,
    type: ReactionType,
  ): Promise<{ counts: ReactionCounts; mine: ReactionType[] }> {
    const post = await this.prisma.post.findFirst({
      where: {
        id: postId,
        ...NOT_DELETED,
        topic: { ...NOT_DELETED, ...buildTopicCategoryVisibilityWhere(ctx) },
      },
      select: { id: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const summary = await this.prisma.$transaction(async (tx) => {
      const key = { postId: post.id, userId: ctx.userId, type };

      // `PostReaction` has no `deletedAt` column, so `findUnique` is legal here
      // — and it is the right verb: the composite unique IS the identity of a
      // reaction (one per member per post per type, R1.4.1).
      const existing = await tx.postReaction.findUnique({
        where: { postId_userId_type: key },
        select: { id: true },
      });

      if (existing) {
        await tx.postReaction.delete({ where: { id: existing.id } });
      } else {
        await tx.postReaction.create({ data: key });
      }

      const grouped = await tx.postReaction.groupBy({
        by: ['type'],
        where: { postId: post.id },
        _count: { _all: true },
      });

      const own = await tx.postReaction.findMany({
        where: { postId: post.id, userId: ctx.userId },
        select: { type: true },
      });

      const counts = emptyReactionCounts();
      for (const row of grouped) {
        if (isReactionType(row.type)) counts[row.type] = row._count._all;
      }

      return {
        counts,
        mine: own.map((row) => row.type).filter(isReactionType),
      };
    });

    this.logger.log(
      `Reaction toggled: post=${post.id} type=${type} total=${summary.mine.length}`,
    );
    return summary;
  }

  /**
   * Reaction counts and own-reactions for a BATCH of posts — the shape a thread
   * render needs.
   *
   * ⚠️ TWO QUERIES FOR THE WHOLE PAGE, NEVER TWO PER POST. This is one of the
   * queries NFR-P4's budget accounts for, and a per-post call here is the N+1
   * that budget exists to forbid. `groupBy(['postId', 'type'])` collapses the
   * counts for every post on the page into one result set; the second query is
   * the member's own rows, which is a bounded, indexed read
   * (`@@index([userId])`).
   *
   * ⚠️ THE FILTER IS BY POST ID ONLY — VISIBILITY IS THE CALLER'S JOB, AND IT HAS
   * ALREADY DONE IT. The ids handed in came from a read that carried the
   * category visibility clause and `NOT_DELETED`. Re-deriving visibility here
   * would be a second authority for the same rule (R7.3), and `PostReaction`
   * cannot be reached except through a post the caller already resolved.
   */
  async summarize(
    postIds: readonly string[],
    userId: string,
  ): Promise<ReactionSummary> {
    if (postIds.length === 0) {
      return { counts: new Map(), mine: new Map() };
    }

    const ids = [...postIds];

    const grouped = await this.prisma.postReaction.groupBy({
      by: ['postId', 'type'],
      where: { postId: { in: ids } },
      _count: { _all: true },
    });

    const own = await this.prisma.postReaction.findMany({
      where: { postId: { in: ids }, userId },
      select: { postId: true, type: true },
    });

    const counts = new Map<string, ReactionCounts>();
    for (const row of grouped) {
      if (!isReactionType(row.type)) continue;
      const forPost = counts.get(row.postId) ?? emptyReactionCounts();
      forPost[row.type] = row._count._all;
      counts.set(row.postId, forPost);
    }

    const mine = new Map<string, ReactionType[]>();
    for (const row of own) {
      if (!isReactionType(row.type)) continue;
      mine.set(row.postId, [...(mine.get(row.postId) ?? []), row.type]);
    }

    return { counts, mine };
  }
}
