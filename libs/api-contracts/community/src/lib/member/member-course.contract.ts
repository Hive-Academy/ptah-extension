import { z } from 'zod';

import {
  memberLessonCommentSchema,
  type MemberLessonComment,
} from './member-lesson-comment.contract';

/**
 * MEMBER-facing course contracts.
 *
 * ⚠️ No `admin/*` type may `extend` anything here, and nothing here may extend
 * an `admin/*` type. `contract-boundary.spec.ts` enforces both directions.
 *
 * PHASE 3 SCOPE (Batch 9B). {@link ContinueLearning} was declared in Phase 1 as
 * the hub's `learning` section payload; everything below it is the course
 * surface proper — R2.1, R2.3, R2.4, plan §3.4.
 *
 * ── THE THREE UNITS THIS FILE TOUCHES, AND WHY THEY ARE NAMED (RISK-O) ──────
 *
 *   A POSITION IN SECONDS — {@link MemberLessonProgress.furthestPositionSeconds}.
 *                           How far into the video this member has watched.
 *   A DURATION IN SECONDS — {@link MemberLessonSummary.durationSeconds} and
 *                           {@link MemberLessonDetail.videoDurationSeconds}.
 *                           How long the video IS.
 *   A PERCENTAGE          — {@link MemberCourseSummary.percent} and
 *                           {@link ContinueLearning.percent}. DERIVED FROM
 *                           LESSON COUNTS, never from a sum of seconds.
 *
 * The first two are both non-negative integers ending in `Seconds` and are
 * interchangeable at every call site without a type error; the third is a
 * different quantity entirely that a reader may assume is "seconds watched over
 * seconds total". It is not, and there is deliberately no field anywhere on the
 * wire from which it could be computed that way. The forum shipped the same
 * class of defect with `postCount` / `lastReadPostNumber` (TASK_2026_177 F-1)
 * and it was invisible to every single-site test.
 *
 * ⚠️ ISO 8601 TIMESTAMPS AND URLS ARE `z.string()`, NOT `z.iso.datetime()` /
 * `z.url()`. This matches every sibling contract in this lib
 * (`memberPostSchema.createdAt`, `memberPackSchema.repoUrl`) and it is the
 * deliberate posture: these schemas run at the CLIENT's HTTP boundary, where a
 * stricter format check turns a server value the UI could render perfectly well
 * into a hard parse failure and a blank page. The server is the authority on
 * the format; the client's job here is to reject the wrong SHAPE.
 */

/**
 * "Where you left off" — the hub's `learning` section (R6.1).
 *
 * ONE course, not a list: the hub answers "what do I resume", and a member
 * working through the cohort curriculum has exactly one current course. The
 * full course list is `GET /v1/members/courses`, a separate surface.
 */
export interface ContinueLearning {
  courseSlug: string;
  courseTitle: string;
  /**
   * The next INCOMPLETE lesson in course order (module `sortOrder`, then
   * lesson `sortOrder`).
   *
   * `null` when every lesson is complete — the course is finished and the card
   * renders a completion state rather than a dead "Resume" button. It is NOT
   * `null` for a locked next lesson: a sequential-course lock (R2.4.2) or a
   * future `releaseAt` (R2.4.1) is surfaced through {@link locked}, because
   * "you finished everything" and "the next module opens on Tuesday" are
   * different messages and a `null` cannot tell them apart.
   */
  nextLesson: {
    slug: string;
    title: string;
    /** The owning module's title, for the "Module 3 · Lesson 2" breadcrumb. */
    moduleTitle: string;
  } | null;
  /**
   * The next lesson's module is locked (R2.4.1 `releaseAt` in the future, or
   * R2.4.2 sequential gating). The card shows the reason instead of linking.
   */
  locked: boolean;
  /** Lessons this member has completed in this course. */
  completedLessons: number;
  /** Lessons in this course that are visible to this member. */
  totalLessons: number;
  /**
   * `0`–`100`, integer. DERIVED from the two counts above and sent anyway, so
   * every progress meter in the product rounds identically. `totalLessons: 0`
   * yields `0`, never `NaN`.
   */
  percent: number;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const continueLearningSchema = z.object({
  courseSlug: z.string(),
  courseTitle: z.string(),
  nextLesson: z
    .object({
      slug: z.string(),
      title: z.string(),
      moduleTitle: z.string(),
    })
    .nullable(),
  locked: z.boolean(),
  completedLessons: z.number().int(),
  totalLessons: z.number().int(),
  percent: z.number().int(),
}) satisfies z.ZodType<ContinueLearning>;

/* -------------------------------------------------------------------------- */
/* Lock vocabulary — R2.4                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Why a module is locked — R2.4.1 (date) and R2.4.2 (sequential).
 *
 * ⚠️ THE UI MATCHES ON THESE MACHINE VALUES, NEVER ON A SENTENCE. The `403`
 * body from `GET :slug/lessons/:lessonSlug` carries `{ reason, unlocksAt }` and
 * nothing prose-shaped; Batch 6C's `{ reason: 'topic_locked' }` is the
 * precedent and its carried item 5 says exactly this. A copy edit to a server
 * message must never change which screen a member sees.
 *
 * ⚠️ THERE ARE EXACTLY TWO AND THERE MUST NOT BE A THIRD WITHOUT A REQUIREMENT.
 * R2.4.3 fixes that when `Course.sequential` is `false` ONLY the date rule
 * applies — it is not a third reason, it is the absence of the second.
 */
export const LOCK_REASONS = [
  'not_released',
  'previous_module_incomplete',
] as const;

/** One of {@link LOCK_REASONS}. */
export type LockReason = (typeof LOCK_REASONS)[number];

/** Runtime narrowing for {@link LockReason}, mirroring `isReactionType`. */
export function isLockReason(value: unknown): value is LockReason {
  return (LOCK_REASONS as readonly unknown[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Courses                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One row in the member course list — `GET /v1/members/courses` (R2.1.1).
 *
 * ⚠️ EVERY COURSE IN THIS LIST IS ALREADY PUBLISHED AND ALREADY VISIBLE TO THIS
 * MEMBER. There is no `published` field and no `visibility` field, because
 * neither is a decision the client makes: a draft course (R2.1.2) and a course
 * whose cohort gate excludes the caller are both simply ABSENT, by the same
 * `where` clause, and the client never learns they exist. Adding either field
 * here would invite a client-side filter that re-implements — badly — a
 * decision the server already made correctly.
 *
 * ⚠️ THE THREE PROGRESS NUMBERS ARE THIS MEMBER'S OWN AND NOBODY ELSE'S
 * (NFR-S4, R2.3.7). There is no `completedBy`, no `completionCount`, no
 * `learners`. The composite primary key on `LessonProgress` (plan §1.4) makes
 * "who else completed this lesson" inefficient to ask; this type makes it
 * unrepresentable to answer.
 */
export interface MemberCourseSummary {
  id: string;
  /** Stable for the life of the course; a title edit never changes it. */
  slug: string;
  title: string;
  /** Non-null: `Course.description` is a required column (plan §1.4). */
  description: string;
  coverImageUrl: string | null;
  /** Lessons in this course this member has completed. */
  completedLessons: number;
  /**
   * Lessons in this course, EXCLUDING soft-deleted ones (AD-5).
   *
   * ⚠️ IT MAY LEGITIMATELY BE `0` — an admin creates the course shell before
   * any modules exist. See {@link percent}.
   */
  totalLessons: number;
  /**
   * `0`–`100`, integer — R2.3.5.
   *
   * ⚠️ DERIVED FROM THE TWO COUNTS ABOVE, NEVER FROM SECONDS (RISK-O).
   * `completedLessons / totalLessons`, rounded. A member who has watched 89% of
   * every lesson has completed none of them and is at `0`, which is the honest
   * answer: R2.3.2's threshold is per-lesson, and averaging watch positions
   * across lessons of different lengths produces a number that means nothing.
   *
   * ⚠️ `totalLessons: 0` YIELDS `0`, NEVER `NaN`. The server does not divide.
   */
  percent: number;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberCourseSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  coverImageUrl: z.string().nullable(),
  completedLessons: z.number().int(),
  totalLessons: z.number().int(),
  percent: z.number().int(),
}) satisfies z.ZodType<MemberCourseSummary>;

/* -------------------------------------------------------------------------- */
/* The course outline                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One lesson AS IT APPEARS IN THE COURSE OUTLINE — inside
 * {@link MemberModuleSummary.lessons}.
 *
 * 🔴 THIS TYPE IS WHERE R2.4.4's REDACTION LIVES, AND IT ENFORCES IT BY HAVING
 * NO FIELD TO LEAK.
 *
 * R2.4.4 says a LOCKED module's title and lesson titles MAY be visible — that
 * is deliberate, so a member can see what is coming — but its lesson BODIES,
 * COMMENTS and VIDEO IDS SHALL NOT be returned. The outline is therefore the
 * one response that can contain a locked module's lessons, and it carries no
 * `bodyMarkdown`, no `youtubeVideoId` and no `comments`.
 *
 * That is not an oversight to be corrected by a future field addition. It is
 * the mechanism: a mapper that must REMEMBER to delete three fields will one
 * day forget one, and a `{ ...row }` spread puts every column added next year
 * into the narrower response at once. A type with no such field cannot. This is
 * the same argument `HubTopicSummary` makes for being a distinct type rather
 * than an alias of `MemberTopicSummary` (Batch 6C, D-6.15c).
 *
 * ⚠️ SO THE OUTLINE IS IDENTICAL FOR A LOCKED AND AN UNLOCKED MODULE. The lock
 * is expressed on {@link MemberModuleSummary}, not by thinning this type per
 * row — which keeps "what the outline shows" one answer rather than two, and
 * keeps prev/next traversal (R2.1.5) able to see lessons in locked modules.
 */
export interface MemberLessonSummary {
  id: string;
  slug: string;
  title: string;
  /** Ascending within the module. Ties break on `(sortOrder, createdAt, id)`. */
  sortOrder: number;
  /** THIS member's completion (R2.3), computed server-side. */
  completed: boolean;
  /**
   * A DURATION IN SECONDS — how long the video is — or `null`.
   *
   * ⚠️ NOT A POSITION. The member's watch position is
   * {@link MemberLessonProgress.furthestPositionSeconds} and appears only on
   * the lesson detail. Both are integer seconds (RISK-O).
   *
   * `null` means the lesson has no usable persisted duration, which by
   * ASSUMPTION-8 makes it MANUAL-COMPLETION-ONLY even if it has a video: the
   * server cannot compute a 90% threshold against `null`. The outline shows a
   * runtime chip only when this is non-null.
   */
  durationSeconds: number | null;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberLessonSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  sortOrder: z.number().int(),
  completed: z.boolean(),
  durationSeconds: z.number().int().nullable(),
}) satisfies z.ZodType<MemberLessonSummary>;

/**
 * One module in the course outline — R2.1.4, R2.4.
 *
 * ⚠️ `locked` IS THE SERVER'S ANSWER, NOT A HINT. R2.4.5 requires the lock to
 * be evaluated server-side on every lesson read, and `GET
 * :slug/lessons/:lessonSlug` answers `403 { reason, unlocksAt }` for a locked
 * module. This field exists so the outline can render the padlock and the
 * "opens Tuesday" copy WITHOUT a request that is going to fail — it is not the
 * enforcement, and a client that ignored it would still be refused.
 */
export interface MemberModuleSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  /** Ascending within the course. Ties break on `(sortOrder, createdAt, id)`. */
  sortOrder: number;
  /** R2.4.1 / R2.4.2, evaluated server-side for THIS member at THIS instant. */
  locked: boolean;
  /**
   * Which rule locked it, or `null` when {@link locked} is `false`.
   *
   * When both rules would fire, this is `'not_released'` — see
   * {@link unlocksAt}.
   */
  lockReason: LockReason | null;
  /**
   * ISO 8601 — when the date rule stops applying. Non-null ONLY for
   * `lockReason: 'not_released'`.
   *
   * ⚠️ `'previous_module_incomplete'` CARRIES `null` BECAUSE THERE IS NO DATE.
   * It unlocks on an action, not on a clock, and inventing a timestamp for it
   * would render as a countdown to a moment that means nothing.
   */
  unlocksAt: string | null;
  /**
   * Every lesson in this module, in order — INCLUDING when {@link locked} is
   * `true` (R2.4.4). See {@link MemberLessonSummary} for why that is safe.
   */
  lessons: MemberLessonSummary[];
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberModuleSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  locked: z.boolean(),
  lockReason: z.enum(LOCK_REASONS).nullable(),
  unlocksAt: z.string().nullable(),
  lessons: z.array(memberLessonSummarySchema),
}) satisfies z.ZodType<MemberModuleSummary>;

/**
 * One course with its whole outline — `GET /v1/members/courses/:slug`.
 *
 * ⚠️ IT EXTENDS {@link MemberCourseSummary}, WHICH IS SAFE HERE AND WOULD NOT BE
 * ACROSS THE member/admin BOUNDARY. The hazard `contract-boundary.spec.ts`
 * exists for is a WIDENING one: a field added to a base for one audience
 * silently appearing in the other's response. Here both types face the SAME
 * audience and detail is a strict superset of summary by definition, so a field
 * added to the summary belongs on the detail too — the inheritance states that
 * rather than leaving two lists to drift.
 */
export interface MemberCourseDetail extends MemberCourseSummary {
  /**
   * Modules in `sortOrder` (R2.1.4), each with its lessons.
   *
   * ⚠️ LOCKED MODULES ARE PRESENT, NOT OMITTED (R2.4.4). Omitting them would
   * make the outline disagree with prev/next traversal (R2.1.5) about what
   * comes after the last lesson of the current module.
   */
  modules: MemberModuleSummary[];
  /**
   * R2.3.6 — the first INCOMPLETE lesson in COURSE order (module `sortOrder`,
   * then lesson `sortOrder`), crossing module boundaries.
   *
   * `null` when every lesson is complete, or when the course has no lessons.
   *
   * ⚠️ ONE DERIVATION, SERVED FROM ONE PLACE. The hub's `learning` section
   * (`ContinueLearning.nextLesson`) is the same number computed by the same
   * code path — Batch 6C's D-6.15a refused a second injection for exactly this
   * reason: a second derivation is how a card and a page start disagreeing.
   */
  resumeLesson: MemberLessonRef | null;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberCourseDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  coverImageUrl: z.string().nullable(),
  completedLessons: z.number().int(),
  totalLessons: z.number().int(),
  percent: z.number().int(),
  modules: z.array(memberModuleSummarySchema),
  resumeLesson: z
    .object({
      slug: z.string(),
      title: z.string(),
      moduleTitle: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<MemberCourseDetail>;

/* -------------------------------------------------------------------------- */
/* The lesson page                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A pointer to a neighbouring lesson — {@link MemberLessonDetail.previous} /
 * {@link MemberLessonDetail.next} and {@link MemberCourseDetail.resumeLesson}.
 *
 * ⚠️ `moduleTitle` IS CARRIED BECAUSE THE NEIGHBOUR IS OFTEN IN ANOTHER MODULE
 * (R2.1.5). "Next: Lesson 1" is misleading when it is the first lesson of the
 * NEXT module; "Next: Module 3 · Getting started" is not. It is the same shape
 * `ContinueLearning.nextLesson` already uses, deliberately.
 *
 * No `id`: the lesson route is `courses/:slug/lessons/:lessonSlug`, so a slug
 * is what the client needs and an id would be an unused internal identifier on
 * a member response.
 */
export interface MemberLessonRef {
  slug: string;
  title: string;
  moduleTitle: string;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberLessonRefSchema = z.object({
  slug: z.string(),
  title: z.string(),
  moduleTitle: z.string(),
}) satisfies z.ZodType<MemberLessonRef>;

/**
 * THIS member's progress on one lesson — R2.3.
 *
 * 🔴 IT IS ALWAYS THE CALLER'S OWN AND THERE IS NO SHAPE HERE THAT COULD CARRY
 * ANOTHER MEMBER'S (NFR-S4, R2.3.7). No `userId`, no list, no aggregate. A spec
 * greps every member contract file in this lib for `userId` and requires none.
 */
export interface MemberLessonProgress {
  /**
   * A POSITION IN SECONDS — the furthest point this member has reached.
   *
   * ⚠️ NOT A DURATION. The lesson's length is
   * {@link MemberLessonDetail.videoDurationSeconds}. Both are integer seconds,
   * both are non-negative, and the server compares them in exactly one file
   * (`progress/completion.ts`) — RISK-O.
   *
   * MONOTONIC (R2.3.1): the server only ever advances it, so seeking backwards
   * never regresses progress. `0` for a lesson never opened.
   */
  furthestPositionSeconds: number;
  /** ISO 8601, or `null` when not complete. */
  completedAt: string | null;
  /**
   * How completion was reached, or `null` when not complete.
   *
   * `'auto'` — R2.3.2's 90%-of-persisted-duration threshold was crossed.
   * `'manual'` — R2.3.3, the member ticked it. Manual is REVERSIBLE, and
   * reversing it clears {@link completedAt} and this field while leaving
   * {@link furthestPositionSeconds} untouched: where a member watched to is a
   * different fact from what they claim to have finished.
   */
  completionSource: 'auto' | 'manual' | null;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberLessonProgressSchema = z.object({
  furthestPositionSeconds: z.number().int(),
  completedAt: z.string().nullable(),
  completionSource: z.enum(['auto', 'manual']).nullable(),
}) satisfies z.ZodType<MemberLessonProgress>;

/**
 * One lesson, in full — `GET /v1/members/courses/:slug/lessons/:lessonSlug`.
 *
 * 🔴 THIS TYPE IS NEVER A REDACTED SHAPE, AND THAT IS DELIBERATE. When the
 * owning module is locked the endpoint answers `403 { reason, unlocksAt }` and
 * this object is not produced at all (R2.4.4/R2.4.5). So there is no "locked
 * variant" of it with empty fields, and no client branch that has to tell a
 * withheld body from an empty one. The outline's {@link MemberLessonSummary} is
 * the shape a locked module's lessons come back in, and it has no body field.
 *
 * ⚠️ 403 HERE, 404 FOR AN INVISIBLE COURSE — AND THEY ARE NOT IN TENSION.
 * A draft course (R2.1.2) or one whose cohort/visibility gate excludes the
 * caller is `404`, because a `403` would confirm it exists (the forum's R1.1.3
 * posture). A LOCKED MODULE is `403`, because the member has ALREADY been shown
 * the module and its lesson titles in the outline — its existence is disclosed
 * on purpose, so answering "not found" would contradict the response the same
 * member just received. Visible-but-forbidden is precisely what 403 is for.
 * Do not harmonise these.
 *
 * ⚠️ EVERY VIDEO FIELD BELOW IS A PERSISTED COLUMN, READ FROM OUR OWN DATABASE
 * (NFR-P6, plan §4.5 — "persistence IS the cache"). Serving this response makes
 * ZERO YouTube requests. The metadata was fetched once, at authoring time.
 */
export interface MemberLessonDetail {
  id: string;
  slug: string;
  title: string;
  /** RAW MARKDOWN, never HTML — rendered through the `'member'` preset (PRE-4). */
  bodyMarkdown: string;
  /**
   * The 11-character YouTube id, or `null` for a lesson with no video.
   *
   * The client builds the embed from this id alone, against
   * `youtube-nocookie.com`, after re-validating it (NFR-S3, plan §4.6).
   */
  youtubeVideoId: string | null;
  /** The persisted video title (plan §4.5). `null` on a lesson with no video. */
  videoTitle: string | null;
  /**
   * A DURATION IN SECONDS — the persisted length of the video.
   *
   * ⚠️ THE ONLY NUMBER R2.3.2's 90% RULE MAY BE COMPUTED AGAINST (ASSUMPTION-8),
   * and it is computed SERVER-SIDE. It appears here so the player can render a
   * scrub bar, not so the client can decide completion — the client never sends
   * a `completed` flag and there is no field for one.
   *
   * `null` ⇒ manual-completion-only, even when {@link youtubeVideoId} is set.
   * That combination is the R2.2.6 feature-off path: an admin saved a video id
   * with `YOUTUBE_API_KEY` unset and typed no runtime.
   */
  videoDurationSeconds: number | null;
  /** The persisted thumbnail, for the facade poster (plan §4.6.1). */
  videoThumbnailUrl: string | null;
  /** THIS member's progress, and never anyone else's. */
  progress: MemberLessonProgress;
  /**
   * The previous lesson IN COURSE ORDER — R2.1.5.
   *
   * ⚠️ IT CROSSES MODULE BOUNDARIES. The first lesson of module 3 has the LAST
   * lesson of module 2 as its `previous`, not `null`. `null` means this is the
   * first lesson of the whole course.
   *
   * ⚠️ AND IT TRAVERSES THROUGH LOCKED MODULES. Skipping them would make the
   * player's "next" disagree with the outline the member is looking at. The
   * lock is enforced when the neighbour is REQUESTED, which is the only place
   * it can be enforced honestly.
   */
  previous: MemberLessonRef | null;
  /** The next lesson in course order — same rules as {@link previous}. */
  next: MemberLessonRef | null;
  /**
   * The lesson's comment thread — R2.5, at most two levels deep.
   *
   * Flat, in `createdAt` order, with parentage carried on each item; the client
   * groups children under their parent. Present only on this type — the outline
   * has no comments key at all (R2.4.4).
   */
  comments: MemberLessonComment[];
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberLessonDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  bodyMarkdown: z.string(),
  youtubeVideoId: z.string().nullable(),
  videoTitle: z.string().nullable(),
  videoDurationSeconds: z.number().int().nullable(),
  videoThumbnailUrl: z.string().nullable(),
  progress: memberLessonProgressSchema,
  previous: memberLessonRefSchema.nullable(),
  next: memberLessonRefSchema.nullable(),
  comments: z.array(memberLessonCommentSchema),
}) satisfies z.ZodType<MemberLessonDetail>;
