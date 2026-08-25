import { z } from 'zod';

import { pagedSchema } from '../shared/paged';
import type { Paged } from '../shared/paged';

/**
 * MEMBER-facing search contracts — R1.7, plan §3.3.
 *
 * `GET /api/v1/members/search?q&kinds&page&pageSize`, one controller of its own
 * (RI-2) rather than a route under `v1/members/community`, because it spans
 * three domains and only one of them is the forum.
 *
 * ⚠️ NO ADMIN COUNTERPART, DELIBERATELY. Admin search is a `?search` filter on
 * `GET /v1/admin/community/topics` — a different feature with a different
 * result shape, declared in `../admin/admin-topic.contract.ts`. Nothing here is
 * shared with it, and `contract-boundary.spec.ts` makes sharing impossible in
 * either direction (RK-8, NFR-S4).
 *
 * ⚠️ EXCERPTS ARE PLAIN TEXT PLUS OFFSETS. NEVER HTML (R1.7.5).
 * See {@link SearchExcerpt} for the full argument — it is the security property
 * this file exists to hold.
 *
 * ⚠️ VISIBILITY IS APPLIED IN THE SQL (R1.7.2), not by filtering results after
 * the fact. That is what makes every `total` in this response a count of rows
 * the member may actually read (R1.1.2). A post-filter would return honest
 * items with a lying `total`, which tells the member exactly how much content
 * exists that they cannot see.
 */

/* -------------------------------------------------------------------------- */
/* The excerpt                                                                 */
/* -------------------------------------------------------------------------- */

/** One highlight span within {@link SearchExcerpt.text}. */
export interface SearchMatch {
  /**
   * 0-based index into `text`, in UTF-16 code units — the unit
   * `String.prototype.slice` and DOM `Range` offsets both use, so a client can
   * apply it without conversion. Not a byte offset.
   */
  start: number;
  /** Length in the same units. `start + length <= text.length`, always. */
  length: number;
}

/**
 * A search excerpt — R1.7.5, and the reason this file is written the way it is.
 *
 * ⚠️ `text` IS PLAIN TEXT AND `matches` ARE OFFSETS INTO IT. The API NEVER
 * returns highlight markup — no `<mark>`, no `<b>`, no `<span class=...>`, no
 * server-side sanitized HTML of any kind.
 *
 * WHY, CONCRETELY. Returning `"...the <mark>bug</mark> in..."` would require the
 * client to render that string as HTML to make the highlight visible. The
 * surrounding text is MEMBER-AUTHORED markdown, so the moment any surface binds
 * a server-highlighted string into the DOM as HTML, every search result is an
 * XSS sink — and it is a sink that bypasses `libs/frontend/markdown`'s
 * `'member'` preset, the ONE sanitizer in the product (PRE-4, AD-1). Offsets
 * make the highlight a DOM operation over text nodes the client already owns:
 * there is nothing to sanitize because nothing is markup.
 *
 * It also survives escaping correctly. A body containing a literal `<mark>` or
 * `&amp;` cannot be confused with the server's own highlighting, because the
 * server emits none.
 */
export interface SearchExcerpt {
  /**
   * A plain-text window around the match, already truncated server-side.
   * Markdown syntax may still be present (it is the stored text); it is NOT
   * rendered — an excerpt is displayed as-is, so a search result never runs a
   * second markdown pipeline.
   */
  text: string;
  /**
   * Every match within {@link text}, in ascending `start` order and
   * non-overlapping. `[]` is valid: a hit can be matched on a field that is not
   * the one excerpted.
   */
  matches: SearchMatch[];
}

/** Runtime schema for the client's HTTP boundary parse. */
export const searchExcerptSchema = z.object({
  text: z.string(),
  matches: z.array(
    z.object({ start: z.number().int(), length: z.number().int() }),
  ),
}) satisfies z.ZodType<SearchExcerpt>;

/* -------------------------------------------------------------------------- */
/* The three result kinds                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The searchable domains, and the accepted values of `?kinds=` (a comma-joined
 * subset; omitting the parameter searches all three).
 *
 * Exported as a tuple so the server DTO's validator, the client's request
 * builder and the response keys below all read ONE source.
 */
export const SEARCH_KINDS = ['topics', 'posts', 'lessons'] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Runtime narrowing for a `?kinds=` segment. */
export function isSearchKind(value: unknown): value is SearchKind {
  return (SEARCH_KINDS as readonly unknown[]).includes(value);
}

/** A topic matched on its title — `GET topics/:slug` is the deep link. */
export interface SearchTopicHit {
  id: string;
  slug: string;
  /** The excerpt is over the TITLE, which is usually the whole of it. */
  titleExcerpt: SearchExcerpt;
  categoryName: string;
  /** `null` for migrated/system content (A-4) or a deleted account. */
  authorName: string | null;
  replyCount: number;
  /** ISO 8601. */
  lastPostedAt: string;
}

/**
 * A post matched on its body.
 *
 * ⚠️ SOFT-DELETED POSTS ARE NEVER HITS (AD-5). A tombstone has no body on the
 * wire, so matching one would return an excerpt of text the member is not
 * allowed to read — the exact leak the tombstone exists to prevent.
 */
export interface SearchPostHit {
  id: string;
  postNumber: number;
  /** Everything needed to deep-link to the post without a second request. */
  topicId: string;
  topicSlug: string;
  topicTitle: string;
  categoryName: string;
  bodyExcerpt: SearchExcerpt;
  /** `null` for migrated/system content (A-4) or a deleted account. */
  authorName: string | null;
  /** ISO 8601. */
  createdAt: string;
}

/**
 * A lesson matched on its title or description — R2, Phase 3.
 *
 * ⚠️ DECLARED NOW, EMPTY UNTIL BATCH 9. `MemberSearchResults.lessons` is a
 * well-formed empty `Paged` until courses exist. Declaring it later would
 * change the search response shape mid-task, which is the same failure R6.6
 * exists to prevent on the hub envelope: every client that had branched on
 * "does this response have a `lessons` key" would need editing, and the ones
 * that had not would silently keep showing two result groups.
 */
export interface SearchLessonHit {
  id: string;
  slug: string;
  courseSlug: string;
  courseTitle: string;
  moduleTitle: string;
  titleExcerpt: SearchExcerpt;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const searchTopicHitSchema = z.object({
  id: z.string(),
  slug: z.string(),
  titleExcerpt: searchExcerptSchema,
  categoryName: z.string(),
  authorName: z.string().nullable(),
  replyCount: z.number().int(),
  lastPostedAt: z.string(),
}) satisfies z.ZodType<SearchTopicHit>;

/** Runtime schema for the client's HTTP boundary parse. */
export const searchPostHitSchema = z.object({
  id: z.string(),
  postNumber: z.number().int(),
  topicId: z.string(),
  topicSlug: z.string(),
  topicTitle: z.string(),
  categoryName: z.string(),
  bodyExcerpt: searchExcerptSchema,
  authorName: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<SearchPostHit>;

/** Runtime schema for the client's HTTP boundary parse. */
export const searchLessonHitSchema = z.object({
  id: z.string(),
  slug: z.string(),
  courseSlug: z.string(),
  courseTitle: z.string(),
  moduleTitle: z.string(),
  titleExcerpt: searchExcerptSchema,
}) satisfies z.ZodType<SearchLessonHit>;

/* -------------------------------------------------------------------------- */
/* The response                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The whole of `GET /api/v1/members/search`.
 *
 * ⚠️ ALL THREE GROUPS ARE ALWAYS PRESENT, even when `?kinds=` asked for one.
 * An unrequested — or not-yet-implemented — group is a well-formed empty
 * `Paged`, never `undefined` and never an absent key. A caller therefore reads
 * `results.lessons.total` unconditionally, and Batch 9 turning lessons on is a
 * change in VALUES only, not in SHAPE.
 *
 * ⚠️ THREE INDEPENDENT PAGE CURSORS, ONE `?page`. Each group pages its own
 * result set with the same `page`/`pageSize`. That is intentional: a single
 * merged, relevance-ranked list across three domains would need a scoring
 * model this task explicitly does not build (RK-1 — no external search), and
 * the UI renders three labelled groups anyway.
 */
export interface MemberSearchResults {
  topics: Paged<SearchTopicHit>;
  posts: Paged<SearchPostHit>;
  /** Empty until Batch 9 — see {@link SearchLessonHit}. */
  lessons: Paged<SearchLessonHit>;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberSearchResultsSchema = z.object({
  topics: pagedSchema(searchTopicHitSchema),
  posts: pagedSchema(searchPostHitSchema),
  lessons: pagedSchema(searchLessonHitSchema),
}) satisfies z.ZodType<MemberSearchResults>;
