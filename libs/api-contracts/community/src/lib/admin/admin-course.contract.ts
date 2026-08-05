import type { Visibility } from '../shared/visibility';

/**
 * ADMIN-facing course contracts — R2, R8 authoring, plan §3.4, NFR-S4, RK-8.
 *
 * ⚠️ READ `../member/member-course.contract.ts` ALONGSIDE THIS FILE. They are
 * the third RK-8 pair in this lib (after `AdminPack`/`MemberPack` and
 * `AdminTopicSummary`/`MemberTopicSummary`) and they are ADJACENT AND
 * INDEPENDENT: nothing here `extends` a member type, nothing there `extends` an
 * admin type, and neither file imports the other by ANY mechanism.
 * `contract-boundary.spec.ts` fails the build on either direction.
 *
 * ⚠️ WHAT THE ADMIN SHAPES CARRY THAT THE MEMBER SHAPES MUST NOT.
 *
 *   1. `published`, `visibility`, `cohortKeys` — the gate ITSELF. A member
 *      never receives these: a draft or out-of-cohort course is simply ABSENT
 *      from every member response (R2.1.2, the `where`-clause posture), so a
 *      member type carrying them would invite a client-side filter that
 *      re-implements a server decision.
 *   2. `videoMetadataFetchedAt` / `videoMetadataSource` — STALENESS, which is
 *      an authoring concern and only an authoring concern (plan §4.5). The
 *      admin UI badges rows older than N days and offers `refresh-metadata`;
 *      `'manual'` marks a row an admin typed with `YOUTUBE_API_KEY` unset
 *      (R2.2.6). A member has no action to take on either and the fields would
 *      be noise on their response.
 *   3. `deletedAt` / `deletedBy` — soft-delete bookkeeping (AD-5). A member
 *      never sees a deleted course at all.
 *   4. `sortOrder` on a course — the member list is ordered BY it and does not
 *      need to know it.
 *
 * ⚠️ NO PROGRESS FIELDS ANYWHERE IN THIS FILE (NFR-S4, R2.3.7). There is no
 * `completedLessons`, no `learners`, no `completionCount` — not because an
 * admin may not be curious, but because §5 ships no cross-member analytics and
 * plan §1.4 deliberately REJECTED the `@@index([lessonId])` that would make
 * such a query efficient. Adding a field here would be the first step toward
 * an endpoint the schema was shaped to prevent.
 *
 * ⚠️ FIELD DUPLICATION AGAINST `member/` IS INTENTIONAL AND IS NOT A DRY
 * VIOLATION. Two audiences, not one shape used twice.
 *
 * ⚠️ TYPES ONLY, NO ZOD — matching `admin-pack.contract.ts` and
 * `admin-topic.contract.ts` (zero `z.` references in either). Member schemas
 * exist because the MEMBER PANEL parses them at its HTTP boundary; the admin
 * surface in `libs/web/admin` carries its own response envelopes. Adding
 * unparsed schemas here would be decoration that drifts — Batch 7's D-4
 * declined a third admin schema for exactly this reason.
 */

/**
 * A course as an admin sees it — `GET/POST /v1/admin/courses`,
 * `GET/PATCH/DELETE .../courses/:id`, `PUT .../courses/:id/published`,
 * `PATCH .../courses/reorder`.
 */
export interface AdminCourse {
  id: string;
  slug: string;
  title: string;
  description: string;
  coverImageUrl: string | null;
  visibility: Visibility;
  /**
   * `MemberGroup.key` values, ANY-match (AD-10 — a `String[]` column, not a
   * join table). Validated against real `MemberGroup.key` rows on write, since
   * there is NO foreign key to catch a typo.
   *
   * ⚠️ Empty whenever {@link visibility} is not `'cohort'`. A non-empty array
   * on a `'member'` course gates nothing and is the kind of stale state that
   * later reads as an access rule.
   */
  cohortKeys: string[];
  /**
   * Denormalised `MemberGroup.name` per key, SAME ORDER, for admin display.
   *
   * ⚠️ RESOLVED FROM `MemberGroup`, NOT ECHOED FROM THE KEYS. A key naming a
   * group that has since been renamed or deleted stays in the array and matches
   * nobody; this is the only surface that can show that, and it can only show
   * it if a missing name renders as `"<key> (unknown group)"` rather than being
   * dropped. Batch 6C's D-6.13g settled this for categories.
   */
  cohortNames: string[];
  /** R2.1.2 — `false` means invisible to every member endpoint (404). */
  published: boolean;
  /** R2.4.2 — modules unlock only after the previous one is complete. */
  sequential: boolean;
  sortOrder: number;
  /**
   * The admin who created the course, or `null`.
   *
   * ⚠️ A PLAIN COLUMN WITH NO FOREIGN KEY (plan §1.4) — it records who acted
   * for audit display and is deliberately not a relation. It is also the only
   * "author" a lesson has, which is why R2.5.3's "the lesson author" resolves
   * through it; see `LessonCommentsService`.
   */
  createdBy: string | null;
  /** Live (non-deleted) modules in this course. */
  moduleCount: number;
  /** Live (non-deleted) lessons across every module in this course. */
  lessonCount: number;
  /** ISO 8601, or `null` for a live course (AD-5). */
  deletedAt: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/**
 * A module as an admin sees it — `POST /v1/admin/course-modules`,
 * `PATCH/DELETE .../:id`, `PATCH .../reorder`.
 */
export interface AdminCourseModule {
  id: string;
  courseId: string;
  slug: string;
  title: string;
  description: string | null;
  sortOrder: number;
  /**
   * ISO 8601, or `null` for a module with no scheduled release.
   *
   * ⚠️ R2.4.1 — a FUTURE value locks the module and its lessons answer `403
   * { reason: 'not_released', unlocksAt }`. A past value is inert. Clearing it
   * (writing `null`) opens the module immediately.
   */
  releaseAt: string | null;
  /** Live (non-deleted) lessons in this module. */
  lessonCount: number;
  /** ISO 8601, or `null` for a live module (AD-5). */
  deletedAt: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/**
 * A lesson as an admin sees it — `POST /v1/admin/lessons`,
 * `PATCH/DELETE .../:id`, `PATCH .../reorder`,
 * `POST .../refresh-metadata`, `POST .../:id/refresh-metadata`.
 */
export interface AdminLesson {
  id: string;
  moduleId: string;
  slug: string;
  title: string;
  bodyMarkdown: string;
  sortOrder: number;
  /** The 11-character id, extracted server-side from an id OR a URL (R2.2.1). */
  youtubeVideoId: string | null;
  videoTitle: string | null;
  /**
   * A DURATION IN SECONDS — the persisted length of the video (RISK-O: NOT a
   * position; no admin type carries a position at all).
   *
   * `null` ⇒ the lesson is manual-completion-only for every member, even when
   * {@link youtubeVideoId} is set (ASSUMPTION-8). That combination is the
   * R2.2.6 feature-off path and is exactly what the admin UI should surface.
   */
  videoDurationSeconds: number | null;
  videoThumbnailUrl: string | null;
  /**
   * ISO 8601 — when the metadata was last fetched from the Data API, or `null`.
   *
   * ⚠️ THE STALENESS SIGNAL plan §4.5 EXISTS FOR, and the reason this field is
   * on the admin type and no member type. It is set ONLY on an `'api'` write
   * and deliberately left alone on a `'manual'` one: stamping a hand-typed row
   * as freshly fetched would badge stale data as current.
   */
  videoMetadataFetchedAt: string | null;
  /**
   * `'api'` — fetched from the YouTube Data API at authoring time.
   * `'manual'` — R2.2.6, an admin typed it with `YOUTUBE_API_KEY` unset.
   * `null` — the lesson has no video.
   */
  videoMetadataSource: 'api' | 'manual' | null;
  /** Live (non-deleted) comments on this lesson (R2.5.5 — tombstones excluded). */
  commentCount: number;
  /** ISO 8601, or `null` for a live lesson (AD-5). */
  deletedAt: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}
