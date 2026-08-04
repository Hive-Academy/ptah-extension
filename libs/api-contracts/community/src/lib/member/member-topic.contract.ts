import { z } from 'zod';

import { pagedSchema } from '../shared/paged';
import type { Paged } from '../shared/paged';
import { REACTION_TYPES } from '../shared/reaction-type';
import type { ReactionCounts, ReactionType } from '../shared/reaction-type';
import { VISIBILITIES } from '../shared/visibility';
import type { Visibility } from '../shared/visibility';

/**
 * MEMBER-facing community topic contracts.
 *
 * ⚠️ THE RULE THIS DIRECTORY EXISTS TO ENFORCE (RK-8, NFR-S4, AD-6).
 * Nothing in `admin/` may `extend` anything declared here, and nothing here may
 * `extend` anything in `admin/`. Admin types RE-DECLARE their fields.
 * `contract-boundary.spec.ts` fails the build on either direction — a comment
 * cannot fail a build; that spec can.
 *
 * The admin counterparts are `../admin/admin-topic.contract.ts`:
 * `AdminCategory`, `AdminTopicSummary`, `AdminPost`. They carry `deletedAt`,
 * `deletedBy` and `authorEmail` — three fields deliberately absent from every
 * shape in this file. `authorEmail` in particular is the concrete leak: one
 * `extends` puts every other member's email address on
 * `GET /v1/members/community/topics/:slug`.
 *
 * ⚠️ NO FIELD HERE IS HTML. Every string is plain text or raw markdown, and the
 * client renders markdown through `libs/frontend/markdown`'s `'member'` preset —
 * the one sanitizer (PRE-4, AD-1). A `cooked`/`bodyHtml` field must never be
 * added to this contract; it would be an XSS sink that bypasses the chokepoint
 * (AD-8 quarantined Discourse's `cooked` for exactly this reason).
 *
 * PHASE 2 SCOPE (Batch 6). {@link HubTopicSummary} was Phase 1's only member
 * community type, because only the hub envelope referenced community data then.
 * The per-surface types below — {@link MemberCategory},
 * {@link MemberTopicSummary}, {@link MemberTopicDetail} and {@link MemberPost} —
 * are Batch 6's, exactly where the Phase-1 docblock said they would land.
 *
 * {@link HubTopicSummary} is NOT replaced by {@link MemberTopicSummary} and the
 * two are not unified. The hub card is a launcher that must stay inside R6.2's
 * one-request budget; the feed row carries the author, lock state and accepted
 * flag the hub has no room for. Collapsing them would push the wider shape into
 * the hub response.
 */

/**
 * One community topic as it appears on the member hub's `community` section
 * (R6.1 "recent/unread community activity").
 *
 * Deliberately a SUMMARY, not a detail: no body, no posts, no author email.
 * The hub is a launcher — `slug` is what the card links to
 * (`/members/community/topics/:slug`), and the detail request happens on
 * navigation. Sending bodies here would inflate the one hub request R6.2 caps
 * at exactly one.
 */
export interface HubTopicSummary {
  id: string;
  /** Stable for the life of the topic; a title edit never changes it (R1.2.2). */
  slug: string;
  title: string;
  /** Denormalised for the card. Never `null` — every topic has a category. */
  categoryName: string;
  /**
   * Replies only. Excludes post #1, which IS the topic body (AD-9), and
   * excludes soft-deleted posts.
   */
  replyCount: number;
  /**
   * Posts added since THIS member last read the topic (R1.6.2). `0` means
   * read; a topic never opened is fully unread and reports its whole
   * `replyCount` here (R1.6.3).
   */
  unreadCount: number;
  /** ISO 8601. */
  lastPostedAt: string;
  /** Pinned topics sort above unpinned ones in the feed (R1.2.5). */
  pinned: boolean;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const hubTopicSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  categoryName: z.string(),
  replyCount: z.number().int(),
  unreadCount: z.number().int(),
  lastPostedAt: z.string(),
  pinned: z.boolean(),
}) satisfies z.ZodType<HubTopicSummary>;

/* -------------------------------------------------------------------------- */
/* Categories — GET /v1/members/community/categories                           */
/* -------------------------------------------------------------------------- */

/**
 * One category the requesting member is allowed to see —
 * `GET /api/v1/members/community/categories` (R1.1).
 *
 * ⚠️ THE LIST IS ALREADY FILTERED. Every category in the response passed
 * `buildCategoryVisibilityWhere` server-side, in the SQL. The client does no
 * visibility filtering, and must not: a category the member cannot see is not
 * a category they receive and hide, it is one they never learn exists (R1.1.3).
 *
 * That is also why {@link visibility} is present at all. It is NOT an access
 * control the client evaluates — it is a LABEL, so the UI can render a "cohort
 * only" or "staff" chip on a category the member demonstrably already has
 * access to. Branching on it to decide what to show would re-implement, in the
 * browser, a decision the server already made correctly.
 */
export interface MemberCategory {
  id: string;
  /** Stable for the life of the category; a rename never changes it. */
  slug: string;
  name: string;
  description: string | null;
  /**
   * A display LABEL only — see the type docblock. `'staff'` reaches a member
   * response only when that member is an admin (ASSUMPTION-4).
   */
  visibility: Visibility;
  /** Admin-defined display order, ascending (R1.1.4). Ties break on `name`. */
  sortOrder: number;
  /**
   * Topics in this category that the member can see, excluding soft-deleted
   * ones (AD-5). It matches what a `GET topics?categoryId=` would total, so the
   * count on the nav and the count on the page cannot disagree (R1.1.2).
   */
  topicCount: number;
  /**
   * How many of those {@link topicCount} topics have at least one post the
   * member has not read (R1.6.2).
   *
   * ⚠️ A COUNT OF TOPICS, NOT OF POSTS. `MemberTopicSummary.unreadCount` counts
   * posts within one topic; this counts topics with any unread activity, which
   * is the badge a category row renders ("3 threads with new replies"). Summing
   * the per-topic post counts here would produce a number that is always ≥ this
   * one and that no UI displays — and the two would be trivially confusable at
   * a call site. Bounded above by {@link topicCount}.
   */
  unreadCount: number;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberCategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(VISIBILITIES),
  sortOrder: z.number().int(),
  topicCount: z.number().int(),
  unreadCount: z.number().int(),
}) satisfies z.ZodType<MemberCategory>;

/* -------------------------------------------------------------------------- */
/* Posts                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One post — `GET topics/:slug` (inside {@link MemberTopicDetail}),
 * `POST topics/:id/posts`, `PATCH posts/:id`.
 *
 * ⚠️ POST #1 IS THE TOPIC BODY (AD-9). There is no `Topic.body` column and no
 * `bodyMarkdown` on {@link MemberTopicDetail}. The opening post arrives here
 * like any other, with `postNumber === 1` and `parentId === null`. A client that
 * wants "the topic body" reads the first item of `posts.items` on page 1.
 *
 * ⚠️ DEPTH IS CAPPED AT 2, SERVER-SIDE (R1.3.3, RK-12). `parentId` is either
 * `null` (a top-level post) or the id of a post whose own `parentId` is `null`.
 * A depth-3 attempt is not rejected — it is REPAIRED, and the reply comes back
 * attached to the depth-1 ancestor. So a client can render exactly two levels
 * and never has to handle a third; if it sees one, the server is broken.
 */
export interface MemberPost {
  id: string;
  /** 1-based, unique within the topic, allocated in-transaction (MG-1.7). */
  postNumber: number;
  /** `null` for a top-level post. See the depth cap in the type docblock. */
  parentId: string | null;
  /**
   * RAW MARKDOWN, never HTML — rendered through the `'member'` preset (PRE-4).
   *
   * ⚠️ THE EMPTY STRING IS MEANINGFUL. When {@link deleted} is `true` this is
   * `''`, always. A soft-deleted post's body MUST NOT reach the wire (R1.3.5):
   * the row survives so the thread stays readable and the children stay
   * attached, but the text is withheld at the read model, not hidden by the
   * client. A client rendering `''` shows its tombstone placeholder.
   */
  bodyMarkdown: string;
  /**
   * Display name. `null` for a deleted post (the tombstone withholds it), for
   * migrated/system content whose author is not a `User` row (A-4), and for a
   * post whose author's account was deleted.
   *
   * ⚠️ NAME ONLY, NEVER AN EMAIL. `authorEmail` is on the ADMIN shape
   * (`AdminPost`) and is the single field this member/admin split most exists
   * to keep apart (NFR-S4).
   */
  authorName: string | null;
  /**
   * R1.5.1. `true` on the one post the topic author or an admin accepted as the
   * answer. At most one post per topic carries it (R1.5.2, enforced by a
   * `@unique` on `Topic.acceptedPostId`).
   *
   * ⚠️ The accepted post appears TWICE in {@link MemberTopicDetail} — see that
   * type's docblock. This flag is what marks the in-place copy.
   */
  accepted: boolean;
  /**
   * A TOMBSTONE, not a removal (AD-5, R1.3.5). The post is still in the list,
   * still occupies its `postNumber`, and still has its children attached
   * beneath it — with no body and no author. Removing it outright would
   * renumber the thread and orphan the replies to it.
   */
  deleted: boolean;
  /**
   * Per-type counts, DERIVED from stored rows (R1.4.4) — total, never sparse:
   * every {@link ReactionType} is present, zero-valued when unreacted.
   */
  reactions: ReactionCounts;
  /**
   * The requesting member's own reactions on this post, so the UI can render
   * the toggled state without a second request (R1.4.1). `[]` is normal.
   */
  myReactions: ReactionType[];
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601, or `null` if never edited (R1.2.7 renders an "edited" marker). */
  editedAt: string | null;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberPostSchema = z.object({
  id: z.string(),
  postNumber: z.number().int(),
  parentId: z.string().nullable(),
  bodyMarkdown: z.string(),
  authorName: z.string().nullable(),
  accepted: z.boolean(),
  deleted: z.boolean(),
  // A RECORD over the tuple, not a partial: `z.record(z.enum(...), ...)` requires
  // every key, which is the totality `ReactionCounts` promises. A renderer that
  // reads `counts.thanks` must never get `undefined`.
  reactions: z.record(z.enum(REACTION_TYPES), z.number().int()),
  myReactions: z.array(z.enum(REACTION_TYPES)),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
}) satisfies z.ZodType<MemberPost>;

/* -------------------------------------------------------------------------- */
/* Topics                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One row in the topic feed — `GET /v1/members/community/topics`, returned
 * inside `Paged<MemberTopicSummary>` (R1.2.5).
 *
 * ⚠️ NO BODY. The feed is a list of links; the body is `GET topics/:slug`.
 * Adding `bodyMarkdown` here is what turns a 25-row feed into a payload that
 * blows NFR-P4's query and size budget in one edit.
 *
 * Ordering is pinned-first, then `lastPostedAt` descending (R1.2.5) — served by
 * the `@@index([categoryId, pinned, lastPostedAt])` composite.
 */
export interface MemberTopicSummary {
  id: string;
  /** Stable for the life of the topic; a title edit never changes it (R1.2.2). */
  slug: string;
  title: string;
  categoryId: string;
  /** Denormalised for the row. Never `null` — every topic has a category. */
  categoryName: string;
  /** `null` for migrated/system content (A-4) or a deleted account. */
  authorName: string | null;
  /**
   * Replies only. Excludes post #1, which IS the topic body (AD-9), and
   * excludes soft-deleted posts. This is `Topic.postCount` — the one
   * denormalised counter this design permits (AD-11), maintained inside the
   * same transaction as every post write.
   */
  replyCount: number;
  /**
   * Posts added since THIS member last read the topic (R1.6.2), clamped at 0.
   * A topic never opened is fully unread and reports its whole
   * {@link replyCount} here (R1.6.3).
   */
  unreadCount: number;
  /** Sorts above unpinned topics in the feed (R1.2.5). */
  pinned: boolean;
  /** No new replies accepted; existing ones stay readable (R1.3.4). */
  locked: boolean;
  /**
   * R1.5.1 — whether the topic has an accepted answer, WITHOUT sending the
   * answer. The feed renders a checkmark; the post itself arrives with the
   * detail request.
   */
  hasAcceptedAnswer: boolean;
  /** ISO 8601. */
  lastPostedAt: string;
  /** ISO 8601. */
  createdAt: string;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberTopicSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  authorName: z.string().nullable(),
  replyCount: z.number().int(),
  unreadCount: z.number().int(),
  pinned: z.boolean(),
  locked: z.boolean(),
  hasAcceptedAnswer: z.boolean(),
  lastPostedAt: z.string(),
  createdAt: z.string(),
}) satisfies z.ZodType<MemberTopicSummary>;

/**
 * A full thread — `GET /v1/members/community/topics/:slug?page&pageSize`, and
 * the `201` body of `POST topics` and `PATCH topics/:id`.
 *
 * ⚠️ THE ACCEPTED ANSWER IS SENT TWICE, ON PURPOSE (§3.3, R1.5.1).
 *
 * The same post appears once hoisted into {@link acceptedPost} and once in its
 * chronological position inside {@link posts}, there carrying
 * `accepted: true`. The client renders the hoisted copy directly under the
 * opening post and marks the in-line one where it actually happened.
 *
 * ⚠️ THIS DUPLICATION IS THE DESIGN. DO NOT "FIX" IT by dropping the hoisted
 * copy or by filtering the post out of the list. Dropping the hoist would make
 * the answer unreachable without paging to wherever it landed — page 4 of a
 * long thread — which is the entire point of accepting an answer. Filtering it
 * out of the list would put a hole in the chronology and detach any replies
 * made to it. {@link acceptedPost} is additionally `null` whenever the accepted
 * post is not on the requested page's slice, so a client can rely on it being
 * present regardless of paging.
 *
 * ⚠️ NO `bodyMarkdown` FIELD. Post #1 is the body (AD-9); it is
 * `posts.items[0]` on page 1.
 */
export interface MemberTopicDetail {
  id: string;
  slug: string;
  title: string;
  categoryId: string;
  categoryName: string;
  /** `null` for migrated/system content (A-4) or a deleted account. */
  authorName: string | null;
  pinned: boolean;
  /** When `true` the client hides the reply composer; the server also 403s. */
  locked: boolean;
  /**
   * The accepted answer, hoisted out of {@link posts} — see the duplication
   * note in the type docblock. `null` when the topic has none.
   */
  acceptedPost: MemberPost | null;
  /**
   * One page of the thread in `postNumber` order, INCLUDING post #1 on page 1
   * and including tombstones for soft-deleted posts (R1.3.5).
   */
  posts: Paged<MemberPost>;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  lastPostedAt: string;
  /** ISO 8601, or `null` if the title was never edited (R1.2.7). */
  editedAt: string | null;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberTopicDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  authorName: z.string().nullable(),
  pinned: z.boolean(),
  locked: z.boolean(),
  acceptedPost: memberPostSchema.nullable(),
  posts: pagedSchema(memberPostSchema),
  createdAt: z.string(),
  lastPostedAt: z.string(),
  editedAt: z.string().nullable(),
}) satisfies z.ZodType<MemberTopicDetail>;
