import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type {
  MemberSearchResults,
  Paged,
  SearchExcerpt,
  SearchLessonHit,
  SearchMatch,
  SearchPostHit,
  SearchTopicHit,
} from '@ptah-contracts/community';

import { toAuthorName } from '../common/author-name';
import {
  emptyPage,
  toPaged,
  toSkipTake,
  type PageRequest,
} from '../common/pagination';
import { buildCategoryVisibilityWhere } from '../common/visibility';

import {
  resolveSearchQuery,
  type SearchQueryDto,
} from './dto/search.query.dto';

/**
 * SearchService — R1.7.1–R1.7.5, A-7, NFR-S1.
 *
 * ⚠️ THE ONE BOUNDARY IN THIS LIB THAT TAKES FREE-FORM MEMBER TEXT INTO A QUERY.
 * `q` is PARAMETERISED through `Prisma.sql` — it never reaches the SQL string.
 * `$queryRawUnsafe` with an interpolated `q` is a SQL-injection hole against a
 * database that holds every licence and every user record, and it is the exact
 * failure NFR-S1 names. The SQL builders below are EXPORTED PURE FUNCTIONS
 * precisely so `search.service.spec.ts` can assert parameterisation against the
 * GENERATED SQL rather than by reading the source and believing it.
 *
 * ⚠️ VISIBILITY IS A `WHERE` CLAUSE IN THE QUERY, NEVER A POST-FILTER (R1.7.2).
 * The visible category ids come from `buildCategoryVisibilityWhere` — the same
 * one authority every other read in this lib uses, so search cannot drift into
 * a second, subtly different definition of "visible" — and are then bound into
 * the search SQL as a parameterised `IN` list. Filtering results afterwards
 * would return honest `items` with a LYING `total`, which tells the member
 * exactly how much content exists that they cannot see. That is the same
 * disclosure R1.1.2 forbids on the category list.
 *
 * ⚠️ WHY RAW SQL HERE AND NOWHERE ELSE IN THIS BATCH. The trigram path (A-7)
 * needs `ILIKE '%…%'` against `community_posts_body_trgm`, joined through the
 * topic to the category, with one `count` under the identical predicate. It is
 * also the ONLY read in this lib whose soft-delete filter is therefore NOT
 * visible to `soft-delete-filter.spec.ts` — a structural analyser cannot read
 * SQL text. Both `deleted_at IS NULL` predicates are consequently asserted
 * DIRECTLY against the generated SQL in the spec, which is a stronger check
 * than the structural one it substitutes for, not a weaker one.
 *
 * ⚠️ EXCERPTS ARE PLAIN TEXT PLUS OFFSETS — NEVER HTML, NEVER `<mark>` (R1.7.5).
 * See `buildExcerpt`. Highlighting is a DOM operation the client performs over
 * text nodes it already owns; a server-highlighted string would have to be
 * bound as HTML and would become an XSS sink bypassing the one sanitizer
 * (PRE-4, AD-1).
 *
 * ⚠️ `lessons` IS AN EMPTY `Paged` UNTIL BATCH 9 (R2, Phase 3). It is DECLARED
 * now so the response SHAPE never changes mid-task: `?kinds=lessons` returns an
 * empty page, not a `400`, and a client reads `results.lessons.total`
 * unconditionally today and forever.
 */
@Injectable()
export class SearchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Search topics and posts — R1.7.1.
   *
   * FIVE QUERIES AT MOST: the visible categories, then a page + a count for
   * each of the two live kinds. A kind the caller did not ask for costs
   * nothing, and a member who can see no categories costs one.
   *
   * Each group pages INDEPENDENTLY under the same `page`/`pageSize` (see
   * `MemberSearchResults`) — there is no merged relevance ranking across kinds,
   * because that needs a scoring model RK-1 explicitly does not build.
   */
  async search(
    ctx: MemberContext,
    query: SearchQueryDto,
  ): Promise<MemberSearchResults> {
    const resolved = resolveSearchQuery(query);
    const page: PageRequest = {
      page: resolved.page,
      pageSize: resolved.pageSize,
    };

    // ⚠️ ALWAYS AN EMPTY PAGE, NEVER A 400 AND NEVER AN ABSENT KEY.
    const lessons: Paged<SearchLessonHit> = emptyPage<SearchLessonHit>(page);

    const categories = await this.prisma.category.findMany({
      where: buildCategoryVisibilityWhere(ctx),
      select: { id: true },
    });

    const categoryIds = categories.map((category) => category.id);

    if (categoryIds.length === 0) {
      // A member who can see no category can match nothing. Short-circuiting
      // also avoids emitting `IN ()`, which is a syntax error in Postgres — the
      // failure mode a naive `Prisma.join([])` produces.
      return {
        topics: emptyPage<SearchTopicHit>(page),
        posts: emptyPage<SearchPostHit>(page),
        lessons,
      };
    }

    const pattern = toLikePattern(resolved.q);
    const { skip, take } = toSkipTake(page);

    const topics = resolved.kinds.has('topics')
      ? await this.searchTopics(
          pattern,
          resolved.q,
          categoryIds,
          skip,
          take,
          page,
        )
      : emptyPage<SearchTopicHit>(page);

    const posts = resolved.kinds.has('posts')
      ? await this.searchPosts(
          pattern,
          resolved.q,
          categoryIds,
          skip,
          take,
          page,
        )
      : emptyPage<SearchPostHit>(page);

    return { topics, posts, lessons };
  }

  private async searchTopics(
    pattern: string,
    needle: string,
    categoryIds: readonly string[],
    skip: number,
    take: number,
    page: PageRequest,
  ): Promise<Paged<SearchTopicHit>> {
    const rows = await this.prisma.$queryRaw<TopicHitRow[]>(
      buildTopicSearchSql(pattern, categoryIds, skip, take),
    );
    const counted = await this.prisma.$queryRaw<CountRow[]>(
      buildTopicCountSql(pattern, categoryIds),
    );

    const items: SearchTopicHit[] = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      titleExcerpt: buildExcerpt(row.title, needle),
      categoryName: row.category_name,
      authorName: toAuthorName({
        firstName: row.first_name,
        lastName: row.last_name,
      }),
      replyCount: Number(row.post_count),
      lastPostedAt: row.last_posted_at.toISOString(),
    }));

    return toPaged(items, toCount(counted), page);
  }

  private async searchPosts(
    pattern: string,
    needle: string,
    categoryIds: readonly string[],
    skip: number,
    take: number,
    page: PageRequest,
  ): Promise<Paged<SearchPostHit>> {
    const rows = await this.prisma.$queryRaw<PostHitRow[]>(
      buildPostSearchSql(pattern, categoryIds, skip, take),
    );
    const counted = await this.prisma.$queryRaw<CountRow[]>(
      buildPostCountSql(pattern, categoryIds),
    );

    const items: SearchPostHit[] = rows.map((row) => ({
      id: row.id,
      postNumber: Number(row.post_number),
      topicId: row.topic_id,
      topicSlug: row.topic_slug,
      topicTitle: row.topic_title,
      categoryName: row.category_name,
      bodyExcerpt: buildExcerpt(row.body_markdown, needle),
      authorName: toAuthorName({
        firstName: row.first_name,
        lastName: row.last_name,
      }),
      createdAt: row.created_at.toISOString(),
    }));

    return toPaged(items, toCount(counted), page);
  }
}

/* -------------------------------------------------------------------------- */
/* SQL — exported and pure, so the spec can assert against what is GENERATED    */
/* -------------------------------------------------------------------------- */

/**
 * The `LIKE` escape character used by every pattern this file builds.
 *
 * ⚠️ ESCAPING IS A SEPARATE CONCERN FROM PARAMETERISATION, AND BOTH ARE NEEDED.
 * Parameterisation stops `q` from being read as SQL. It does NOT stop `q` from
 * being read as a LIKE PATTERN: a member searching for `100%` would otherwise
 * send `%100%%`, where the trailing `%` is a wildcard, and a search for `_`
 * would match every single character in the forum — turning one request into a
 * full scan of every post body. `\` itself must be escaped first, or escaping
 * the others would corrupt it.
 */
const LIKE_ESCAPE = '\\';

/** `q` → a safe, escaped `%…%` containment pattern. */
export function toLikePattern(q: string): string {
  const escaped = q
    .replace(/\\/g, `${LIKE_ESCAPE}\\`)
    .replace(/%/g, `${LIKE_ESCAPE}%`)
    .replace(/_/g, `${LIKE_ESCAPE}_`);

  return `%${escaped}%`;
}

/**
 * One page of topic hits — R1.7.1, R1.7.2, A-7.
 *
 * ⚠️ EVERY DYNAMIC VALUE IS A BOUND PARAMETER. `pattern`, the category ids,
 * `take` and `skip` all arrive through `Prisma.sql`'s interpolation, which emits
 * `$1, $2, …` placeholders and carries the values alongside. Nothing here is
 * string concatenation, including the `IN` list — `Prisma.join` emits one
 * placeholder per id rather than a comma-joined literal.
 *
 * ⚠️ `t.deleted_at IS NULL` IS THE AD-5 FILTER, IN SQL. `soft-delete-filter.spec.ts`
 * cannot see it — it parses Prisma call expressions, not SQL text — so
 * `search.service.spec.ts` asserts its presence against this function's output
 * directly. Removing it would put soft-deleted topics into search results,
 * which is the one place a member could still read content that was withdrawn.
 *
 * ⚠️ `c.id IN (…)` IS THE VISIBILITY CLAUSE (R1.7.2). It is in the query, so an
 * invisible category's topics cannot be returned AND cannot be counted.
 */
export function buildTopicSearchSql(
  pattern: string,
  categoryIds: readonly string[],
  skip: number,
  take: number,
): Prisma.Sql {
  return Prisma.sql`
    SELECT t.id,
           t.slug,
           t.title,
           t.post_count,
           t.last_posted_at,
           c.name       AS category_name,
           u.first_name,
           u.last_name
      FROM community_topics t
      JOIN community_categories c ON c.id = t.category_id
      LEFT JOIN users u ON u.id = t.author_id
     WHERE t.deleted_at IS NULL
       AND t.category_id IN (${Prisma.join([...categoryIds])})
       AND t.title ILIKE ${pattern} ESCAPE ${LIKE_ESCAPE}
     ORDER BY t.last_posted_at DESC
     LIMIT ${take} OFFSET ${skip}
  `;
}

/**
 * The matching total — R1.1.2.
 *
 * ⚠️ THE PREDICATE MUST BE IDENTICAL TO {@link buildTopicSearchSql}'s. A count
 * computed under a wider filter is a disclosure, not a rounding error.
 */
export function buildTopicCountSql(
  pattern: string,
  categoryIds: readonly string[],
): Prisma.Sql {
  return Prisma.sql`
    SELECT count(*) AS total
      FROM community_topics t
     WHERE t.deleted_at IS NULL
       AND t.category_id IN (${Prisma.join([...categoryIds])})
       AND t.title ILIKE ${pattern} ESCAPE ${LIKE_ESCAPE}
  `;
}

/**
 * One page of post hits — R1.7.1, R1.7.2, A-7, AD-5.
 *
 * ⚠️ TWO SOFT-DELETE PREDICATES, AND BOTH ARE LOAD-BEARING.
 * `p.deleted_at IS NULL` keeps TOMBSTONES out of search: a tombstone has no body
 * on the wire (R1.3.5), so matching one would return an excerpt of text the
 * member is explicitly not allowed to read — the exact leak the tombstone
 * exists to prevent. `t.deleted_at IS NULL` keeps the live posts of a
 * SOFT-DELETED TOPIC out: deleting a topic must remove it from every listing,
 * feed AND search result immediately (R1.2.7), and its replies were never
 * separately deleted.
 *
 * The join to `community_categories` exists only for the visibility clause and
 * the `category_name` each hit carries — so gating is part of THIS query rather
 * than a second pass.
 */
export function buildPostSearchSql(
  pattern: string,
  categoryIds: readonly string[],
  skip: number,
  take: number,
): Prisma.Sql {
  return Prisma.sql`
    SELECT p.id,
           p.post_number,
           p.body_markdown,
           p.created_at,
           t.id         AS topic_id,
           t.slug       AS topic_slug,
           t.title      AS topic_title,
           c.name       AS category_name,
           u.first_name,
           u.last_name
      FROM community_posts p
      JOIN community_topics t ON t.id = p.topic_id
      JOIN community_categories c ON c.id = t.category_id
      LEFT JOIN users u ON u.id = p.author_id
     WHERE p.deleted_at IS NULL
       AND t.deleted_at IS NULL
       AND t.category_id IN (${Prisma.join([...categoryIds])})
       AND p.body_markdown ILIKE ${pattern} ESCAPE ${LIKE_ESCAPE}
     ORDER BY p.created_at DESC
     LIMIT ${take} OFFSET ${skip}
  `;
}

/** The matching total — identical predicate to {@link buildPostSearchSql}. */
export function buildPostCountSql(
  pattern: string,
  categoryIds: readonly string[],
): Prisma.Sql {
  return Prisma.sql`
    SELECT count(*) AS total
      FROM community_posts p
      JOIN community_topics t ON t.id = p.topic_id
     WHERE p.deleted_at IS NULL
       AND t.deleted_at IS NULL
       AND t.category_id IN (${Prisma.join([...categoryIds])})
       AND p.body_markdown ILIKE ${pattern} ESCAPE ${LIKE_ESCAPE}
  `;
}

/* -------------------------------------------------------------------------- */
/* Excerpts                                                                    */
/* -------------------------------------------------------------------------- */

/** Characters of context kept either side of the first match. */
const EXCERPT_RADIUS = 90;

/** How many matches are reported within one excerpt. */
const MAX_EXCERPT_MATCHES = 10;

/**
 * A plain-text window around the first match, plus every match's OFFSET —
 * R1.7.5.
 *
 * ⚠️ NO HTML IS PRODUCED HERE AND NONE MAY EVER BE. Not `<mark>`, not `<b>`, not
 * a "server-side sanitized" span. The surrounding text is MEMBER-AUTHORED
 * markdown; the moment a surface has to render a server-highlighted string as
 * HTML to make the highlight visible, every search result becomes an XSS sink —
 * and one that bypasses `libs/frontend/markdown`'s `'member'` preset, the ONE
 * sanitizer in the product (PRE-4, AD-1). Offsets make highlighting a DOM
 * operation over text nodes: there is nothing to sanitize because nothing is
 * markup.
 *
 * ⚠️ OFFSETS ARE INTO `text`, THE RETURNED WINDOW — NOT INTO THE ORIGINAL BODY.
 * The window is what the client renders, so an offset into the source would
 * highlight the wrong characters, or characters that are not there at all. They
 * are UTF-16 code-unit offsets, which is what `String.prototype.slice` and DOM
 * `Range` both use, so the client applies them without conversion.
 *
 * `matches` may legitimately be `[]` — a post can match on a field that is not
 * the one excerpted, and a window that starts after the tenth match contains
 * none of them.
 */
export function buildExcerpt(source: string, needle: string): SearchExcerpt {
  const haystack = source.toLowerCase();
  const term = needle.toLowerCase();

  if (term.length === 0) {
    return { text: truncate(source, EXCERPT_RADIUS * 2), matches: [] };
  }

  const first = haystack.indexOf(term);

  // No match in this field: return a leading window with no offsets rather than
  // an empty string, so the UI still has something to show for the hit.
  if (first === -1) {
    return { text: truncate(source, EXCERPT_RADIUS * 2), matches: [] };
  }

  const start = Math.max(0, first - EXCERPT_RADIUS);
  const end = Math.min(source.length, first + term.length + EXCERPT_RADIUS);
  const text = source.slice(start, end);

  const matches: SearchMatch[] = [];
  let cursor = start;

  while (matches.length < MAX_EXCERPT_MATCHES) {
    const at = haystack.indexOf(term, cursor);
    // `at + term.length > end` — a match that STRADDLES the window boundary is
    // dropped rather than clipped: a clipped length would highlight a partial
    // word that does not correspond to the search term.
    if (at === -1 || at + term.length > end) break;

    matches.push({ start: at - start, length: term.length });
    cursor = at + term.length;
  }

  return { text, matches };
}

function truncate(source: string, limit: number): string {
  return source.length <= limit ? source : source.slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Raw row shapes                                                              */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ `count(*)` COMES BACK AS A `bigint`, WHICH PRISMA MAPS TO JavaScript
 * `BigInt` — not `number`. `JSON.stringify` THROWS on a `BigInt`, so a `total`
 * that was passed straight through would turn a working search into a `500` at
 * serialisation time, with a stack trace that names the response encoder rather
 * than this query. `Number()` is applied at the boundary, once.
 */
interface CountRow {
  total: bigint | number;
}

function toCount(rows: readonly CountRow[]): number {
  return Number(rows[0]?.total ?? 0);
}

/** Snake-case because these come from raw SQL, not from the Prisma mapper. */
interface TopicHitRow {
  id: string;
  slug: string;
  title: string;
  post_count: number | bigint;
  last_posted_at: Date;
  category_name: string;
  first_name: string | null;
  last_name: string | null;
}

interface PostHitRow {
  id: string;
  post_number: number | bigint;
  body_markdown: string;
  created_at: Date;
  topic_id: string;
  topic_slug: string;
  topic_title: string;
  category_name: string;
  first_name: string | null;
  last_name: string | null;
}
