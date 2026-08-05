import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';

import { FIRST_POST_NUMBER } from '../common/post-numbering';
import { NOT_DELETED } from '../common/soft-delete';
import { buildTopicCategoryVisibilityWhere } from '../common/visibility';

import type { AcceptAnswerDto } from './dto/accept-answer.dto';

/**
 * AcceptedAnswerService — R1.5.1, R1.5.2, R1.5.3.
 *
 * ⚠️ "AT MOST ONE ACCEPTED ANSWER PER TOPIC" IS ENFORCED BY THE SCHEMA, NOT BY
 * THIS SERVICE. `Topic.acceptedPostId` is a single nullable `@unique` column
 * (§1.3), so marking a second post is one `UPDATE` that overwrites the first —
 * clearing it BY ASSIGNMENT (R1.5.2).
 *
 * The alternative shape — a `Post.accepted` boolean — would need a compensating
 * write ("clear the old one, then set the new one") and would therefore have a
 * state in which BOTH are true: after the second write fails, or after two
 * concurrent accepts interleave. There is no such state here, because there is
 * only one write and only one column. This is the whole reason the accepted
 * answer is modelled on the TOPIC rather than on the POST.
 *
 * ⚠️ `isAdmin` PARTICIPATES IN A MEMBER-SIDE DECISION HERE, AND R1.5.3 REQUIRES
 * IT. `common/visibility.ts`'s docblock calls itself "the one place in this lib
 * where `isAdmin` enters a member-side decision" — that statement was written
 * for ASSUMPTION-4 and is narrower than this lib turned out to be. The two are
 * different in kind and both are deliberate: there, `isAdmin` widens what an
 * admin can SEE; here it widens who may perform ONE specific write that the
 * topic author may already perform. It grants no moderation authority — pin,
 * lock, move, delete and restore all stay behind `AdminGuard` on
 * `v1/admin/community/*` — and it is the only write in this lib a member-side
 * `isAdmin` reaches.
 */
@Injectable()
export class AcceptedAnswerService {
  private readonly logger = new Logger(AcceptedAnswerService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Mark a post as the accepted answer — R1.5.1, R1.5.2, R1.5.3.
   *
   * The refusal ladder, in order, and each code is deliberate:
   *   - topic invisible or soft-deleted → `404` (R1.1.3 — never `403`, which
   *     would confirm the topic exists to someone who cannot see it);
   *   - not the author and not an admin → `403` (R1.5.3 — the member CAN see
   *     this topic, so its existence is not a secret; the refusal is about
   *     authority, and this is what `403` is reserved for);
   *   - post not in this topic, or soft-deleted → `404`;
   *   - post is #1 → `400` (the question cannot be its own answer, AD-9).
   */
  async accept(
    ctx: MemberContext,
    topicId: string,
    input: AcceptAnswerDto,
  ): Promise<{ acceptedPostId: string }> {
    const topic = await this.requireVisibleTopic(ctx, topicId);
    this.assertMayAccept(ctx, topic.authorId);

    const post = await this.prisma.post.findFirst({
      // `topicId` is part of the filter, not checked afterwards: a post id from
      // ANOTHER topic must not resolve here, and the cheapest way to guarantee
      // that is to make it impossible for the query to return one.
      where: { id: input.postId, topicId: topic.id, ...NOT_DELETED },
      select: { id: true, postNumber: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found in this topic');
    }
    if (post.postNumber === FIRST_POST_NUMBER) {
      throw new BadRequestException(
        'The opening post is the question and cannot be marked as its own answer',
      );
    }

    // ⚠️ SCALAR ASSIGNMENT, NOT `acceptedPost: { connect: … }`. Both compile;
    // the scalar is used because a previously accepted post is replaced by this
    // single write with no `disconnect` step to forget (R1.5.2).
    await this.prisma.topic.update({
      where: { id: topic.id },
      data: { acceptedPostId: post.id },
    });

    this.logger.log(
      `Accepted answer set: topic=${topic.id} post=${post.id} by=${ctx.userId}`,
    );
    return { acceptedPostId: post.id };
  }

  /**
   * Clear the accepted answer — the `DELETE` half of §3.3's pair.
   *
   * Idempotent: clearing a topic that has none succeeds and reports `null`. A
   * `404` there would make an un-accept race between two tabs fail for the
   * second one, having achieved exactly the state it asked for.
   */
  async clear(
    ctx: MemberContext,
    topicId: string,
  ): Promise<{ acceptedPostId: null }> {
    const topic = await this.requireVisibleTopic(ctx, topicId);
    this.assertMayAccept(ctx, topic.authorId);

    await this.prisma.topic.update({
      where: { id: topic.id },
      data: { acceptedPostId: null },
    });

    this.logger.log(
      `Accepted answer cleared: topic=${topic.id} by=${ctx.userId}`,
    );
    return { acceptedPostId: null };
  }

  /* ---------------------------------------------------------------------- */

  /** R1.5.3 — the topic author or an admin. Anyone else gets `403`. */
  private assertMayAccept(
    ctx: MemberContext,
    topicAuthorId: string | null,
  ): void {
    if (topicAuthorId === ctx.userId || ctx.isAdmin) return;

    throw new ForbiddenException(
      'Only the topic author or an admin can set the accepted answer',
    );
  }

  private async requireVisibleTopic(
    ctx: MemberContext,
    topicId: string,
  ): Promise<{ id: string; authorId: string | null }> {
    const topic = await this.prisma.topic.findFirst({
      where: {
        id: topicId,
        ...NOT_DELETED,
        ...buildTopicCategoryVisibilityWhere(ctx),
      },
      select: { id: true, authorId: true },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }
    return topic;
  }
}
