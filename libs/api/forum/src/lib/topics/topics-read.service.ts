import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  type MemberPost,
  type MemberTopicDetail,
  type MemberTopicSummary,
  type Paged,
} from '@ptah-contracts/community';

import { toAuthorNameMap } from '../common/author-name';
import {
  emptyPage,
  toPaged,
  toSkipTake,
  type PageRequest,
} from '../common/pagination';
import { toMemberPost, type PostViewContext } from '../common/post-view';
import { NOT_DELETED } from '../common/soft-delete';
import { buildCategoryVisibilityWhere } from '../common/visibility';
import { ReactionsService } from '../reactions/reactions.service';
import {
  ReadStateService,
  unreadCount,
} from '../read-state/read-state.service';

import {
  resolveTopicQuery,
  type ListTopicsQueryDto,
} from './dto/list-topics.query.dto';

/**
 * TopicsReadService — the FEED and THREAD read models. R1.2.5, R1.6.2, R1.6.3,
 * NFR-P4, NFR-P5.
 *
 * ⚠️ NFR-P4: A 25-TOPIC FEED EXECUTES AT MOST FIVE DATABASE QUERIES, AND THAT IS
 * A §8.2 EXIT-GATE ITEM ASSERTED IN `topics-read.service.spec.ts` BY COUNTING
 * CALLS ON THE MOCK CLIENT.
 *
 * The five, for `sort=recent`:
 *   1. the visible categories   — visibility, and the `categoryName` every row
 *      carries, without a per-row join;
 *   2. the topics page;
 *   3. the matching `count`     — `Paged.total` must be computed under the SAME
 *      `where`, or the member sees a total that includes rows they cannot read
 *      (R1.1.2);
 *   4. this member's read markers for exactly those topic ids — ONE `findMany`
 *      with `topicId: { in: [...] }`;
 *   5. the authors of those topics — ONE `findMany` with `id: { in: [...] }`.
 *
 * ⚠️ WHY THE AUTHORS ARE A SEPARATE QUERY RATHER THAN AN `include`. Prisma's
 * default relation-load strategy on PostgreSQL issues a SECOND query for an
 * included relation anyway, so `include: { author: … }` would cost the same
 * round trip while making it invisible — to a reader, and to the call counter
 * that guards this budget. An explicit query is the honest number.
 *
 * ⚠️ EVERY ONE OF THE FIVE IS PER-COLLECTION, NEVER PER-ROW. The N+1 this budget
 * exists to forbid does not look like a mistake at the call site: a
 * `findFirst` inside a `.map` reads perfectly well and costs 25 round trips.
 * That is why the assertion counts EVERY verb on EVERY model rather than
 * eyeballing the code.
 *
 * ⚠️ THIS SERVICE IS EXPORTED FROM THE LIB BARREL — `member-hub` composes it for
 * the hub's community section (plan §2.5). It is read-only by construction:
 * there is no write on any path in this file, and there must not be one.
 */
@Injectable()
export class TopicsReadService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ReadStateService) private readonly readState: ReadStateService,
    @Inject(ReactionsService) private readonly reactions: ReactionsService,
  ) {}

  /**
   * The topic feed — `Paged<MemberTopicSummary>` (R1.2.5, NFR-P4, NFR-P5).
   *
   * ⚠️ PINNED FIRST, THEN `lastPostedAt` DESCENDING. `pinned: 'desc'` puts
   * `true` above `false` in Postgres, which is the ordering
   * `@@index([categoryId, pinned, lastPostedAt])` and `@@index([pinned,
   * lastPostedAt])` were both created to serve. Ordering by `lastPostedAt`
   * alone and hoisting pinned rows in JavaScript would be wrong across page
   * boundaries — a pinned topic on page 3 would never reach page 1.
   */
  async listFeed(
    ctx: MemberContext,
    query: ListTopicsQueryDto,
  ): Promise<Paged<MemberTopicSummary>> {
    const resolved = resolveTopicQuery(query);
    const page: PageRequest = {
      page: resolved.page,
      pageSize: resolved.pageSize,
    };

    /* 1 — the visible categories. */
    const categories = await this.prisma.category.findMany({
      where: buildCategoryVisibilityWhere(ctx),
      select: { id: true, name: true },
    });

    const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

    if (
      resolved.categoryId !== undefined &&
      !categoryNames.has(resolved.categoryId)
    ) {
      // R1.2.1 + R1.1.3 — invisible OR nonexistent, indistinguishably. The
      // member learned nothing about which of the two it was.
      throw new NotFoundException('Category not found');
    }
    if (categoryNames.size === 0) {
      return emptyPage<MemberTopicSummary>(page);
    }

    const categoryFilter =
      resolved.categoryId !== undefined
        ? resolved.categoryId
        : { in: [...categoryNames.keys()] };

    /* 2 (unread sort only) — every read marker this member holds. */
    let markers: ReadonlyMap<string, number> | null = null;
    let unreadClause: Prisma.TopicWhereInput = {};

    if (resolved.sort === 'unread') {
      markers = await this.readState.allMarkers(ctx.userId);
      unreadClause = buildUnreadWhere(markers);
    }

    const where: Prisma.TopicWhereInput = {
      ...NOT_DELETED,
      categoryId: categoryFilter,
      ...unreadClause,
    };

    /* topics page + matching count. */
    const rows = await this.prisma.topic.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { lastPostedAt: 'desc' }],
      ...toSkipTake(page),
      select: {
        id: true,
        slug: true,
        title: true,
        categoryId: true,
        authorId: true,
        postCount: true,
        pinned: true,
        locked: true,
        acceptedPostId: true,
        lastPostedAt: true,
        createdAt: true,
      },
    });

    const total = await this.prisma.topic.count({ where });

    if (rows.length === 0) {
      return toPaged<MemberTopicSummary>([], total, page);
    }

    /* read markers for exactly this page (recent sort), then the authors. */
    const pageMarkers =
      markers ??
      (await this.readState.markersFor(
        ctx.userId,
        rows.map((row) => row.id),
      ));

    const authorNames = await this.loadAuthorNames(
      rows.map((row) => row.authorId),
    );

    const items = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      categoryId: row.categoryId,
      // Never `null` — every topic has a category, and this map was built from
      // the categories the topic was filtered against.
      categoryName: categoryNames.get(row.categoryId) ?? '',
      authorName:
        row.authorId !== null ? (authorNames.get(row.authorId) ?? null) : null,
      replyCount: row.postCount,
      unreadCount: unreadCount(row.postCount, pageMarkers.get(row.id) ?? 0),
      pinned: row.pinned,
      locked: row.locked,
      hasAcceptedAnswer: row.acceptedPostId !== null,
      lastPostedAt: row.lastPostedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));

    return toPaged(items, total, page);
  }

  /**
   * One thread — `MemberTopicDetail` (§3.3, R1.3.5, R1.5.1, AD-9).
   *
   * ⚠️ TOMBSTONES WITH LIVE CHILDREN ARE IN THE LIST; CHILDLESS ONES ARE NOT
   * (R1.3.5, plan §1.3). A soft-deleted post that still has replies beneath it
   * MUST be returned — dropping it would orphan those replies and renumber the
   * conversation around a hole. A soft-deleted post with no replies has nothing
   * hanging from it, so it is simply omitted.
   *
   * That distinction is expressed IN THE `where`, as
   * `OR: [NOT_DELETED, { children: { some: NOT_DELETED } }]` — not by fetching
   * everything and filtering afterwards. It is also why this read satisfies AD-5
   * honestly rather than needing an exemption: the clause genuinely restricts
   * to live posts plus the tombstones the requirement names, and the withheld
   * body and author are applied by `toMemberPost`, which is the one place the
   * tombstone rule lives.
   *
   * ⚠️ THE ACCEPTED ANSWER IS RETURNED TWICE, ON PURPOSE (§3.3, R1.5.1): once
   * hoisted into `acceptedPost` and once in its chronological position carrying
   * `accepted: true`. Do NOT "fix" the duplication — see `MemberTopicDetail`.
   */
  async getThread(
    ctx: MemberContext,
    slug: string,
    page: PageRequest = { page: FIRST_PAGE, pageSize: DEFAULT_PAGE_SIZE },
  ): Promise<MemberTopicDetail> {
    const topic = await this.prisma.topic.findFirst({
      where: {
        slug,
        ...NOT_DELETED,
        // The category filter is NESTED into the topic's own `where` rather than
        // checked in a second query: "invisible" and "not found" must be the
        // same event, or the second query has already decided the topic exists
        // (R1.1.3).
        category: buildCategoryVisibilityWhere(ctx),
      },
      select: {
        id: true,
        slug: true,
        title: true,
        categoryId: true,
        authorId: true,
        pinned: true,
        locked: true,
        acceptedPostId: true,
        createdAt: true,
        lastPostedAt: true,
        editedAt: true,
        category: { select: { name: true } },
      },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    const postWhere: Prisma.PostWhereInput = {
      topicId: topic.id,
      OR: [{ ...NOT_DELETED }, { children: { some: { ...NOT_DELETED } } }],
    };

    const rows = await this.prisma.post.findMany({
      where: postWhere,
      // `postNumber`, not `createdAt`: it is the thread's canonical ordering and
      // it is unique within the topic, so the order is total and stable.
      orderBy: { postNumber: 'asc' },
      ...toSkipTake(page),
      select: POST_SELECT,
    });

    const total = await this.prisma.post.count({ where: postWhere });

    // ⚠️ THE HOISTED COPY IS FETCHED WHEN IT IS NOT ON THIS PAGE. That is the
    // entire point of the hoist: an accepted answer that landed on page 4 of a
    // long thread must still be readable from page 1 without paging to it
    // (`MemberTopicDetail`'s docblock makes exactly that argument). The extra
    // query happens only for a topic that HAS an accepted answer, only when it
    // is off-page, and never on the feed.
    const onPage = rows.some((row) => row.id === topic.acceptedPostId);
    const offPageAccepted =
      topic.acceptedPostId !== null && !onPage
        ? await this.prisma.post.findFirst({
            where: {
              id: topic.acceptedPostId,
              topicId: topic.id,
              ...NOT_DELETED,
            },
            select: POST_SELECT,
          })
        : null;

    const visible = offPageAccepted ? [...rows, offPageAccepted] : rows;

    const reactions = await this.reactions.summarize(
      // A TOMBSTONE HAS NO REACTIONS ON THE WIRE (`post-view.ts`), so asking for
      // them would be a wasted widening of the `IN` list.
      visible.filter((row) => row.deletedAt === null).map((row) => row.id),
      ctx.userId,
    );

    const authorNames = await this.loadAuthorNames([
      topic.authorId,
      ...visible.map((row) => row.authorId),
    ]);

    const view: PostViewContext = {
      acceptedPostId: topic.acceptedPostId,
      authorNames,
      reactions: reactions.counts,
      myReactions: reactions.mine,
    };

    const items: MemberPost[] = rows.map((row) => toMemberPost(row, view));
    const acceptedRow =
      offPageAccepted ?? rows.find((row) => row.id === topic.acceptedPostId);

    return {
      id: topic.id,
      slug: topic.slug,
      title: topic.title,
      categoryId: topic.categoryId,
      categoryName: topic.category.name,
      authorName:
        topic.authorId !== null
          ? (authorNames.get(topic.authorId) ?? null)
          : null,
      pinned: topic.pinned,
      locked: topic.locked,
      acceptedPost: acceptedRow ? toMemberPost(acceptedRow, view) : null,
      posts: toPaged(items, total, page),
      createdAt: topic.createdAt.toISOString(),
      lastPostedAt: topic.lastPostedAt.toISOString(),
      editedAt: topic.editedAt?.toISOString() ?? null,
    };
  }

  /**
   * ONE post as the wire sees it — `MemberPost` (§3.3).
   *
   * ⚠️ THE WRITE PATHS RETURN IDENTIFIERS, NOT WIRE SHAPES (this service's
   * class docblock, and `CreatedPost`'s). `POST topics/:id/posts` and
   * `PATCH posts/:id` both answer `MemberPost`, so the composition has to happen
   * somewhere; putting it HERE rather than in each controller is what stops the
   * tombstone rule, the accepted flag and the author-name derivation being
   * written a third and fourth time. `toMemberPost` stays the one place a
   * deleted body is withheld.
   *
   * ⚠️ VISIBILITY IS NESTED INTO THE POST'S OWN `where`, so a post in a category
   * this member cannot see is NOT FOUND rather than found-and-refused (R1.1.3).
   * There is no branch here that can produce a `403`.
   *
   * ⚠️ `accepted` IS READ FROM THE TOPIC, NOT FROM THE POST. `Post.accepted` is
   * never written (R1.5.2 is implemented by assignment on
   * `Topic.acceptedPostId`), so deriving it from the post row would report
   * `false` for the accepted answer itself.
   *
   * Three queries: the post (with its topic's `acceptedPostId`), its reactions,
   * its author's name. NFR-P4's five-query budget is stated for the FEED; this
   * is a single row and no requirement sets a bound on it.
   */
  async getPost(ctx: MemberContext, postId: string): Promise<MemberPost> {
    const row = await this.prisma.post.findFirst({
      where: {
        id: postId,
        ...NOT_DELETED,
        topic: {
          ...NOT_DELETED,
          category: buildCategoryVisibilityWhere(ctx),
        },
      },
      select: { ...POST_SELECT, topic: { select: { acceptedPostId: true } } },
    });

    if (!row) {
      throw new NotFoundException('Post not found');
    }

    const reactions = await this.reactions.summarize([row.id], ctx.userId);
    const authorNames = await this.loadAuthorNames([row.authorId]);

    return toMemberPost(row, {
      acceptedPostId: row.topic.acceptedPostId,
      authorNames,
      reactions: reactions.counts,
      myReactions: reactions.mine,
    });
  }

  /**
   * ONE `user.findMany` for a whole page of author ids — never one per row.
   *
   * ⚠️ THE `select` IS `id`, `firstName`, `lastName` AND NOTHING ELSE. `email`
   * is deliberately absent: `authorEmail` belongs to the ADMIN contracts, and a
   * `select` that pulled the whole user row would put every participant's email
   * one spread away from a member response (NFR-S4).
   *
   * Returns an empty map without querying when the page has no identified
   * authors at all — migrated content (A-4) and deleted accounts both carry a
   * null `authorId`, so this is a real case, not a micro-optimisation.
   */
  private async loadAuthorNames(
    authorIds: readonly (string | null)[],
  ): Promise<ReadonlyMap<string, string | null>> {
    const ids = [
      ...new Set(authorIds.filter((id): id is string => id !== null)),
    ];
    if (ids.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
    });

    return toAuthorNameMap(users);
  }
}

/** The `Post` projection both thread reads use. Shared so they cannot diverge. */
const POST_SELECT = {
  id: true,
  postNumber: true,
  parentId: true,
  bodyMarkdown: true,
  deletedAt: true,
  createdAt: true,
  editedAt: true,
  authorId: true,
} as const;

/**
 * `sort=unread` — topics with at least one post this member has not read.
 *
 * ⚠️ THE COMPARISON IS EXPANDED INTO AN `OR`, BECAUSE PRISMA CANNOT COMPARE A
 * COLUMN TO A COLUMN IN ANOTHER TABLE. "Unread" is
 * `Topic.postCount > TopicReadState.lastReadPostNumber`, which is a join
 * predicate; what this builds instead is the same predicate with the read side
 * already resolved — one branch per topic the member has actually opened, plus
 * one branch covering every topic they have not.
 *
 * ⚠️ IT SCALES WITH TOPICS-THE-MEMBER-HAS-READ, NOT WITH TOPICS. At §1.3 volume
 * that is single digits. If the forum grows past a few hundred read markers per
 * member, the replacement is a raw `LEFT JOIN … WHERE post_count > COALESCE(
 * last_read_post_number, 0)` — one query, same budget. It is NOT a per-topic
 * lookup; that is the N+1 NFR-P4 forbids and it is not the shape here.
 */
function buildUnreadWhere(
  markers: ReadonlyMap<string, number>,
): Prisma.TopicWhereInput {
  const read = [...markers.keys()];

  // A member with no markers at all has read nothing: every topic with at least
  // one reply is unread. Written as its own branch rather than relying on
  // `notIn: []`, whose behaviour is a Prisma detail a reader cannot check here.
  if (read.length === 0) {
    return { postCount: { gt: 0 } };
  }

  return {
    OR: [
      { id: { notIn: read }, postCount: { gt: 0 } },
      ...[...markers.entries()].map(([topicId, lastRead]) => ({
        id: topicId,
        postCount: { gt: lastRead },
      })),
    ],
  };
}
