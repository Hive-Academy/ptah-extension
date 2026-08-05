import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';

import { CategoriesService } from '../categories/categories.service';
import { markerForAllRepliesRead, repliesRead } from '../common/post-numbering';
import { NOT_DELETED } from '../common/soft-delete';
import { buildTopicCategoryVisibilityWhere } from '../common/visibility';

/**
 * Unread for one topic — R1.6.2, R1.6.3.
 *
 * ⚠️ THE TWO ARGUMENTS ARE IN DIFFERENT UNITS, AND {@link repliesRead} IS THE
 * CONVERSION. `postCount` is a count of REPLIES (post #1 is the body and is
 * excluded, AD-9/AD-11); `lastReadPostNumber` is a POST NUMBER, which counts
 * post #1. Subtracting one from the other directly is the TASK_2026_177 F-1
 * defect: it under-reported every badge by exactly one on every topic that had
 * been opened, and it was invisible with no marker at all because the default
 * `0` made the arithmetic accidentally correct. Do not "simplify" this back —
 * see `common/post-numbering.ts` and `unread-units.spec.ts`.
 *
 * ⚠️ CLAMPED AT 0, AND THE CLAMP IS NOT DEFENSIVE PROGRAMMING. `postCount`
 * DECREASES when a reply is soft-deleted (AD-11), while `lastReadPostNumber`
 * only ever increases. So a member who read a 10-reply thread and then saw two
 * replies removed has `10 - 8 = -2` unread, which would render as "-2 new" on
 * the feed. The clamp is the difference between a correct zero and a negative
 * badge.
 *
 * ⚠️ A MISSING READ-STATE ROW IS THE "NEVER READ" SIGNAL (R1.6.3). No row is
 * written when a member merely opens a topic, so `lastRead` defaults to `0` and
 * a never-opened topic reports its WHOLE reply count. A marker of `1` — the
 * member opened the thread and read the body only — must report the same thing,
 * which is exactly what {@link repliesRead} collapses. That is why this takes a
 * plain number rather than a row: the absence of a row, a row holding `0`, and a
 * row holding `1` all mean "no replies read" and must compute the same answer.
 */
export function unreadCount(
  postCount: number,
  lastReadPostNumber: number,
): number {
  return Math.max(0, postCount - repliesRead(lastReadPostNumber));
}

/**
 * ReadStateService — A-6, R1.6.1, R1.6.5, R1.6.6.
 *
 * ⚠️ ONE ROW PER MEMBER PER TOPIC, ON A COMPOSITE PRIMARY KEY
 * `@@id([userId, topicId])` — there is no surrogate id, and the key LEADS WITH
 * `userId`, which is exactly the index a "my read markers for these topics"
 * lookup needs (NFR-P4).
 *
 * ⚠️ THERE IS NO PER-POST READ RECEIPT, AND A-6 HAS ALREADY REJECTED ONE
 * (R1.6.6). Unread is computed for the REQUESTING member only, from one integer
 * per topic. A per-post model would be one row per member per post — the same
 * data volume as the forum itself — to answer a question no surface asks.
 *
 * ⚠️ THIS SERVICE IS EXPORTED FROM THE LIB BARREL. `member-hub` composes it for
 * the hub's unread badge (plan §2.5). It is therefore one of only three symbols
 * this lib makes public, and it must stay free of write authority over content.
 */
@Injectable()
export class ReadStateService {
  private readonly logger = new Logger(ReadStateService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CategoriesService) private readonly categories: CategoriesService,
  ) {}

  /**
   * Advance this member's read marker on one topic — R1.6.1.
   *
   * ⚠️ MONOTONIC: THE MARKER NEVER MOVES BACKWARDS. An out-of-order client — two
   * tabs, a retried request, a slow response arriving after a newer one —
   * otherwise UN-READS a thread the member has already read, and the unread
   * badge starts flickering for reasons no one can reproduce.
   *
   * It is implemented as TWO statements in one transaction rather than one
   * `upsert`, because Prisma's `upsert` cannot express "update only if greater":
   *
   *   1. `upsert` with an EMPTY `update` — creates the row when it is missing
   *      and does NOTHING when it exists. This is the "first read" case, and the
   *      empty update is the literal statement of "never move backwards".
   *   2. `updateMany` filtered on `lastReadPostNumber: { lt: n }` — advances the
   *      marker only when `n` is genuinely ahead. The COMPARISON IS IN THE
   *      `WHERE`, so it is evaluated by Postgres against the committed row
   *      rather than against a value this process read a moment ago.
   *
   * ⚠️ NO UPPER CLAMP AGAINST `postCount`, DELIBERATELY. A marker higher than the
   * current reply count is harmless — {@link unreadCount} clamps the difference
   * at 0 — and clamping it here would need the topic's maximum `postNumber`,
   * which is NOT `postCount` (tombstones keep their numbers, so the maximum is
   * higher). Storing the client's honest claim and clamping at the point of
   * display is the simpler correct arrangement.
   */
  async markRead(
    ctx: MemberContext,
    topicId: string,
    lastReadPostNumber: number,
  ): Promise<{ unreadCount: number }> {
    const topic = await this.prisma.topic.findFirst({
      where: {
        id: topicId,
        ...NOT_DELETED,
        ...buildTopicCategoryVisibilityWhere(ctx),
      },
      select: { id: true, postCount: true },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    const effective = await this.prisma.$transaction(async (tx) => {
      await tx.topicReadState.upsert({
        where: { userId_topicId: { userId: ctx.userId, topicId: topic.id } },
        create: {
          userId: ctx.userId,
          topicId: topic.id,
          lastReadPostNumber,
        },
        // ⚠️ EMPTY ON PURPOSE — see the method docblock. This branch means "a
        // row already exists", and the advance is decided by the guarded
        // `updateMany` below, not here.
        update: {},
      });

      await tx.topicReadState.updateMany({
        where: {
          userId: ctx.userId,
          topicId: topic.id,
          lastReadPostNumber: { lt: lastReadPostNumber },
        },
        data: { lastReadPostNumber },
      });

      const state = await tx.topicReadState.findUnique({
        where: { userId_topicId: { userId: ctx.userId, topicId: topic.id } },
        select: { lastReadPostNumber: true },
      });

      return state?.lastReadPostNumber ?? lastReadPostNumber;
    });

    return { unreadCount: unreadCount(topic.postCount, effective) };
  }

  /**
   * Mark every VISIBLE topic in a category as read — R1.6.5.
   *
   * ⚠️ ONE REQUEST AND ONE TRANSACTION, NOT A LOOP OF UPSERTS. A per-topic round
   * trip from a "mark all read" button is N queries for one click, and it can
   * half-apply if the connection drops.
   *
   * ⚠️ IT IS A `deleteMany` + `createMany` PAIR, AND THE REASON IS THAT EACH ROW
   * NEEDS A DIFFERENT VALUE. "Read" means the marker sits above every reply, and
   * the reply count differs per topic — so a single `updateMany` cannot express
   * it, and a uniform large value would be actively WRONG: setting every marker
   * to 999 means the next real reply computes `postCount - 998` unread, clamps
   * to 0, and never shows as new again. Replacing the rows writes each topic's
   * own value.
   *
   * ⚠️ THE VALUE WRITTEN IS A POST NUMBER, NOT `postCount` — {@link
   * markerForAllRepliesRead} converts. This is the WRITE half of the unit
   * conversion `unreadCount` performs on the read half, and the two must move
   * together: writing a bare `postCount` here (as this did before
   * TASK_2026_177 F-1 was fixed) leaves every marked topic reporting exactly one
   * unread reply. `unread-units.spec.ts` asserts the round trip rather than
   * either half, so the pair cannot drift apart again.
   *
   * That replacement can lower a marker numerically — only ever from a value a
   * client previously over-claimed down to the topic's true reply count — and
   * the OBSERVABLE unread stays 0 either way, so the monotonic guarantee
   * {@link markRead} makes about the badge is preserved. It is also the more
   * correct outcome: a later reply then shows as unread, which is what the
   * member expects after clicking "mark all read" yesterday.
   *
   * ⚠️ "VISIBLE" IS RESOLVED BY THE QUERY, NOT BY A FILTER AFTERWARDS. The
   * category itself must be visible (`requireVisible`, `404` otherwise), and the
   * topics are read through `NOT_DELETED` — so a soft-deleted topic never gets a
   * read marker written for it.
   */
  async markCategoryRead(
    ctx: MemberContext,
    categoryId: string,
  ): Promise<{ topicsMarked: number }> {
    const category = await this.categories.requireVisible(ctx, categoryId);

    const topics = await this.prisma.topic.findMany({
      where: { ...NOT_DELETED, categoryId: category.id },
      select: { id: true, postCount: true },
    });

    if (topics.length === 0) {
      return { topicsMarked: 0 };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.topicReadState.deleteMany({
        where: {
          userId: ctx.userId,
          topicId: { in: topics.map((topic) => topic.id) },
        },
      });

      await tx.topicReadState.createMany({
        data: topics.map((topic) => ({
          userId: ctx.userId,
          topicId: topic.id,
          lastReadPostNumber: markerForAllRepliesRead(topic.postCount),
        })),
      });
    });

    this.logger.log(
      `Category marked read: category=${category.id} topics=${topics.length}`,
    );
    return { topicsMarked: topics.length };
  }

  /**
   * This member's read markers for a batch of topics — the ONE query the feed's
   * unread column costs (NFR-P4).
   *
   * ⚠️ ONE `findMany` WITH `topicId: { in: [...] }`, NEVER ONE LOOKUP PER TOPIC.
   * The composite PK leads with `userId`, so this is a single index range scan.
   * A per-topic lookup is the N+1 NFR-P4 forbids, and it is invisible in code
   * review because each individual call looks cheap.
   *
   * Topics with no row are simply ABSENT from the result — the caller reads `?? 0`,
   * which is the "never read" signal (R1.6.3).
   */
  async markersFor(
    userId: string,
    topicIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (topicIds.length === 0) return new Map();

    const rows = await this.prisma.topicReadState.findMany({
      where: { userId, topicId: { in: [...topicIds] } },
      select: { topicId: true, lastReadPostNumber: true },
    });

    return new Map(rows.map((row) => [row.topicId, row.lastReadPostNumber]));
  }

  /** Every read marker this member holds — used by the `sort=unread` feed. */
  async allMarkers(userId: string): Promise<ReadonlyMap<string, number>> {
    const rows = await this.prisma.topicReadState.findMany({
      where: { userId },
      select: { topicId: true, lastReadPostNumber: true },
    });

    return new Map(rows.map((row) => [row.topicId, row.lastReadPostNumber]));
  }
}
