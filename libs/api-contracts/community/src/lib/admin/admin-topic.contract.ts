import type { ReactionCounts } from '../shared/reaction-type';
import type { Visibility } from '../shared/visibility';

/**
 * ADMIN-facing community contracts — R8 moderation, plan §3.3, NFR-S4, RK-8.
 *
 * ⚠️ READ `../member/member-topic.contract.ts` ALONGSIDE THIS FILE. They are the
 * second RK-8 pair in this lib (after `AdminPack` / `MemberPack`) and they are
 * ADJACENT AND INDEPENDENT: nothing here `extends` a member type, nothing there
 * `extends` an admin type, and neither file imports the other by ANY mechanism.
 * `contract-boundary.spec.ts` fails the build on either direction — and this is
 * the first time that spec has a second admin file to police.
 *
 * ⚠️ WHAT THE ADMIN SHAPES CARRY THAT THE MEMBER SHAPES MUST NOT.
 *
 *   1. `deletedAt` / `deletedBy` — soft-delete bookkeeping (AD-5). A member sees
 *      a tombstone (`deleted: true`, empty body, `null` author); an admin sees
 *      WHEN it was deleted and BY WHOM, which is what makes the ≥30-day restore
 *      window (R8.5) and the audit trail reviewable.
 *   2. `authorEmail` — THE CONCRETE LEAK THIS SPLIT PREVENTS. It is how a
 *      moderator identifies the account behind a post. One `extends` puts every
 *      other member's email address on
 *      `GET /v1/members/community/topics/:slug` for every entitled member. This
 *      is the same failure mode `AdminSession extends BuildersSession` documents
 *      in its own docblock — that inheritance is safe only because its base is
 *      frozen, and nothing structural freezes a base.
 *   3. `bodyMarkdown` ON A DELETED POST — an admin reading with
 *      `?includeDeleted` legitimately reads tombstone bodies, because deciding
 *      whether to restore requires seeing what was removed. That is precisely
 *      the read `soft-delete-filter.spec.ts` in `@ptah-api/forum` requires an
 *      explicit `// AD-5-EXEMPT:` comment for.
 *
 * ⚠️ FIELD DUPLICATION AGAINST `member/` IS INTENTIONAL AND IS NOT A DRY
 * VIOLATION. Two audiences, not one shape used twice. The types are permitted
 * to diverge, and the moment they do an inheritance link would have to be
 * broken anyway — with a member-facing leak already shipped.
 *
 * ⚠️ TYPES ONLY, NO ZOD — matching `admin-pack.contract.ts`. The member schemas
 * exist because the MEMBER PANEL parses them at its HTTP boundary; the admin
 * surface in `libs/web/admin` carries its own response envelopes. Adding
 * unparsed schemas here would be decoration that drifts.
 */

/**
 * A category as an admin sees it — `GET/POST /v1/admin/community/categories`,
 * `PATCH/DELETE .../categories/:id`, `PATCH .../categories/reorder`.
 *
 * No `unreadCount`: unread state is per-member (A-6) and an admin listing
 * categories is not reading them as a member.
 */
export interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: Visibility;
  /**
   * `MemberGroup.key` values, ANY-match (AD-10 — a `String[]` column, not a
   * join table). Validated against real `MemberGroup.key` rows on write.
   *
   * ⚠️ Empty whenever {@link visibility} is not `'cohort'`. A non-empty array on
   * a `'member'` category gates nothing and is the kind of stale state that
   * later reads as an access rule.
   */
  cohortKeys: string[];
  /** Denormalised `MemberGroup.name` per key, same order, for admin display. */
  cohortNames: string[];
  sortOrder: number;
  /**
   * ⚠️ INCLUDES SOFT-DELETED TOPICS — unlike `MemberCategory.topicCount`, which
   * excludes them. Deleting a category is `Restrict`ed while it holds topics
   * (§1.3), and that restriction counts tombstones too, so an admin needs the
   * number the database will actually enforce on.
   */
  topicCount: number;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/**
 * A topic row in the moderation queue —
 * `GET /v1/admin/community/topics?includeDeleted&categoryId&search`,
 * `PATCH .../topics/:id`, `DELETE .../topics/:id`,
 * `POST .../topics/:id/restore`.
 */
export interface AdminTopicSummary {
  id: string;
  slug: string;
  title: string;
  categoryId: string;
  categoryName: string;
  /** `null` for migrated/system content (A-4) or a deleted account. */
  authorName: string | null;
  /**
   * ⚠️ ADMIN-ONLY. See the file docblock — this is the field the member/admin
   * split most exists to keep apart (NFR-S4). `null` when the topic has no
   * `User` row behind it (A-4: migrated content is never given a fabricated
   * author).
   */
  authorEmail: string | null;
  pinned: boolean;
  locked: boolean;
  /** Replies only, excluding soft-deleted posts — `Topic.postCount` (AD-11). */
  replyCount: number;
  hasAcceptedAnswer: boolean;
  /**
   * ISO 8601, or `null` when live. Non-null means the topic is a tombstone and
   * is invisible to every member endpoint.
   *
   * ⚠️ R8.5's restore window is measured from THIS timestamp, not from
   * {@link updatedAt}. A later edit to a deleted row must not extend or reset
   * the window.
   */
  deletedAt: string | null;
  /** Admin email recorded at deletion time; `null` while live. */
  deletedBy: string | null;
  /** ISO 8601. */
  lastPostedAt: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
  /** ISO 8601, or `null` if the title was never edited. */
  editedAt: string | null;
}

/**
 * A post as an admin sees it — `DELETE /v1/admin/community/posts/:id`,
 * `POST .../posts/:id/restore`, and the post list under a topic read with
 * `?includeDeleted`.
 */
export interface AdminPost {
  id: string;
  postNumber: number;
  parentId: string | null;
  topicId: string;
  topicSlug: string;
  /**
   * RAW MARKDOWN, never HTML.
   *
   * ⚠️ POPULATED EVEN WHEN {@link deletedAt} IS NON-NULL — the deliberate
   * asymmetry against `MemberPost.bodyMarkdown`, which is `''` on a tombstone
   * (R1.3.5). Deciding whether to restore requires seeing what was removed.
   * This is the ONLY read in the forum that legitimately returns a
   * soft-deleted body, and it is the read that carries an explicit
   * `// AD-5-EXEMPT:` comment in `@ptah-api/forum`.
   */
  bodyMarkdown: string;
  /** `null` for migrated/system content (A-4) or a deleted account. */
  authorName: string | null;
  /** ⚠️ ADMIN-ONLY. See the file docblock. */
  authorEmail: string | null;
  accepted: boolean;
  /** Per-type counts, derived from stored rows (R1.4.4). Total, never sparse. */
  reactions: ReactionCounts;
  /** ISO 8601, or `null` while live. See {@link AdminTopicSummary.deletedAt}. */
  deletedAt: string | null;
  /** Admin email recorded at deletion time; `null` while live. */
  deletedBy: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
  /** ISO 8601, or `null` if never edited. */
  editedAt: string | null;
}
