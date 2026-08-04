import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import type { AdminTopicSummary, Paged } from '@ptah-contracts/community';

import { toAuthorName } from '../common/author-name';
import { toPaged, toSkipTake, type PageRequest } from '../common/pagination';
import { deletedFilter } from '../common/soft-delete';

import {
  resolveAdminTopicQuery,
  type ListAdminTopicsQueryDto,
} from './dto/list-admin-topics.query.dto';

/**
 * `AdminTopicsReadService` — the moderation list, and THE ONLY PLACE IN THIS LIB
 * THAT MAY SEE A TOMBSTONE (§3.3 admin table, R8.2, AD-5).
 *
 * ⚠️ WHY IT IS ITS OWN FILE AND ITS OWN CLASS.
 * `soft-delete-filter.spec.ts` records every unfiltered read as
 * `<file>:<model>.<method>` and asserts the resulting set against
 * `EXPECTED_EXEMPTIONS` — a hand-maintained list a reviewer reads. Putting the
 * `?includeDeleted` read inside `TopicsReadService` would key its exemption on
 * the same file as the MEMBER feed and thread, so a future unfiltered member
 * read in that file would land on an already-approved key and be waved through
 * silently. Isolated here, the census names an ADMIN file, and any exemption
 * appearing in a member-facing file is a new entry that has to be argued for.
 *
 * ⚠️ EVERY TOMBSTONE-CAPABLE QUERY IS FUNNELLED THROUGH THE TWO PRIVATE METHODS
 * AT THE BOTTOM. Two call sites, two markers, two census entries — and adding a
 * third admin read that needs tombstones costs no new exemption, because it
 * reuses them. That is the property worth protecting: the number of places in
 * this lib that can return a deleted row is a constant, not a function of how
 * many admin features exist.
 *
 * ⚠️ THIS CLASS IS REACHABLE ONLY FROM `AdminCommunityTopicsController`, which
 * declares `@UseGuards(JwtAuthGuard, AdminGuard)` at class level, and it is NOT
 * exported from the lib barrel (which carries `ForumModule`, `TopicsReadService`
 * and `ReadStateService` and nothing else). A member-facing consumer cannot
 * reach a deleted body through it.
 *
 * ⚠️ `authorEmail` IS RETURNED HERE AND NOWHERE ELSE. `AdminTopicSummary`
 * declares it; `MemberTopicSummary` deliberately does not, and the member read
 * model's `select` omits `email` entirely so it cannot leak by a spread
 * (NFR-S4). This is the admin contract, so the email is the point.
 */
@Injectable()
export class AdminTopicsReadService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The moderation list — `Paged<AdminTopicSummary>`.
   *
   * Four queries and no N+1: the page · the matching count · the categories
   * named by the page · the authors named by the page. `total` is computed
   * under the SAME `where` as the page, so a moderator paging through 3 of 40
   * tombstones is told 40.
   *
   * Ordering is `deletedAt` NULLS FIRST? No — `lastPostedAt` descending, the
   * same key the member feed uses, WITHOUT the pinned hoist. Pinning is a
   * member-facing display rule (R1.2.5); a moderation queue that reordered
   * itself because someone pinned a thread would be actively unhelpful.
   */
  async list(
    query: ListAdminTopicsQueryDto,
  ): Promise<Paged<AdminTopicSummary>> {
    const resolved = resolveAdminTopicQuery(query);
    const page: PageRequest = {
      page: resolved.page,
      pageSize: resolved.pageSize,
    };

    const where: Prisma.TopicWhereInput = {
      ...deletedFilter(resolved.includeDeleted),
      ...(resolved.categoryId !== undefined
        ? { categoryId: resolved.categoryId }
        : {}),
      ...(resolved.search !== undefined
        ? { title: { contains: resolved.search, mode: 'insensitive' as const } }
        : {}),
    };

    const rows = await this.findRows(where, page);
    const total = await this.countRows(where);

    if (rows.length === 0) return toPaged([], total, page);

    const categories = await this.prisma.category.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.categoryId))] } },
      select: { id: true, name: true },
    });
    const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

    const authorIds = [
      ...new Set(
        rows
          .map((row) => row.authorId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const authors =
      authorIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: authorIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
          });
    const authorById = new Map(authors.map((author) => [author.id, author]));

    const items = rows.map((row): AdminTopicSummary => {
      const author =
        row.authorId !== null ? authorById.get(row.authorId) : undefined;

      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        categoryId: row.categoryId,
        // A category always exists (`Topic.category` is a required relation),
        // so the fallback is unreachable — it is here because an admin table
        // rendering `undefined` in a column is worse than one saying so.
        categoryName: categoryNames.get(row.categoryId) ?? 'Unknown category',
        authorName: toAuthorName(author ?? null),
        authorEmail: author?.email ?? null,
        pinned: row.pinned,
        locked: row.locked,
        replyCount: row.postCount,
        hasAcceptedAnswer: row.acceptedPostId !== null,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        deletedBy: row.deletedBy,
        lastPostedAt: row.lastPostedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        editedAt: row.editedAt?.toISOString() ?? null,
      };
    });

    return toPaged(items, total, page);
  }

  /* ---------------------------------------------------------------------- */
  /* The two sanctioned tombstone-capable queries                            */
  /* ---------------------------------------------------------------------- */

  /**
   * THE page query.
   *
   * `deletedFilter(includeDeleted)` produces `{ deletedAt: null }` or `{}`, so
   * the `NOT_DELETED` identifier is deliberately ABSENT from the `where` and
   * the structural analyser correctly reports this as unfiltered. That is why
   * the marker below is here rather than an argument that the read is "really"
   * filtered — 6A's `deletedFilter` docblock says exactly this: an admin read
   * using it still needs its exemption comment, because the decision belongs in
   * front of a reviewer.
   */
  private async findRows(
    where: Prisma.TopicWhereInput,
    page: PageRequest,
  ): Promise<AdminTopicRow[]> {
    // AD-5-EXEMPT: the admin ?includeDeleted moderation list (plan 3.3, R8.2) — the one read that must return tombstones, behind AdminGuard, never reachable from a member route.
    return this.prisma.topic.findMany({
      where,
      orderBy: { lastPostedAt: 'desc' },
      ...toSkipTake(page),
      select: ADMIN_TOPIC_SELECT,
    });
  }

  /**
   * THE matching count, under the identical `where`.
   *
   * ⚠️ IT NEEDS ITS OWN EXEMPTION BECAUSE `count` IS A FILTERABLE READ, and it
   * cannot be folded into {@link findRows}: `Paged.total` must be computed under
   * the same `where` as the page (or the moderator is told a total that omits
   * the tombstones they explicitly asked for), and there is no way to get both a
   * page and a total from one Prisma call.
   */
  private async countRows(where: Prisma.TopicWhereInput): Promise<number> {
    // AD-5-EXEMPT: Paged.total for the same admin ?includeDeleted list — computed under the identical where, or the moderator is shown a total that excludes the rows they asked to see.
    return this.prisma.topic.count({ where });
  }
}

/** The `Topic` projection the moderation list reads. */
const ADMIN_TOPIC_SELECT = {
  id: true,
  slug: true,
  title: true,
  categoryId: true,
  authorId: true,
  pinned: true,
  locked: true,
  postCount: true,
  acceptedPostId: true,
  deletedAt: true,
  deletedBy: true,
  lastPostedAt: true,
  createdAt: true,
  updatedAt: true,
  editedAt: true,
} as const;

type AdminTopicRow = Prisma.TopicGetPayload<{
  select: typeof ADMIN_TOPIC_SELECT;
}>;
