import { z } from 'zod';

/**
 * MEMBER-facing course contracts.
 *
 * ⚠️ No `admin/*` type may `extend` anything here, and nothing here may extend
 * an `admin/*` type. `contract-boundary.spec.ts` enforces both directions.
 *
 * PHASE 1 SCOPE. Only {@link ContinueLearning} is declared — it is the hub's
 * `learning` section payload. `MemberCourseSummary`, `MemberCourseDetail`,
 * `MemberLessonDetail` and the comment types are added by Batch 9 (P3-BE), in
 * THIS file.
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
