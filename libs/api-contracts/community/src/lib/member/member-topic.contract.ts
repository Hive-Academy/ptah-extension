import { z } from 'zod';

/**
 * MEMBER-facing community topic contracts.
 *
 * ⚠️ THE RULE THIS DIRECTORY EXISTS TO ENFORCE (RK-8, NFR-S4, AD-6).
 * Nothing in `admin/` may `extend` anything declared here, and nothing here may
 * `extend` anything in `admin/`. Admin types RE-DECLARE their fields.
 * `contract-boundary.spec.ts` fails the build on either direction — a comment
 * cannot fail a build; that spec can.
 *
 * PHASE 1 SCOPE. Only {@link HubTopicSummary} is declared, because only the hub
 * envelope references community data in Phase 1. The fuller per-surface types
 * (`MemberCategory`, `MemberTopicSummary`, `MemberTopicDetail`, `MemberPost`)
 * are added by Batch 6 (P2-BE), in THIS file. The directory and the rule exist
 * now so nothing lands outside them later.
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
