import { Inject, Injectable } from '@nestjs/common';
import type {
  ContinueLearning,
  HubSection,
  MemberCourseSummary,
} from '@ptah-contracts/community';
import { CourseReadService } from '@ptah-api/learning';
import type { MemberContext } from '@ptah-api/membership';
import type { HubSectionResolver } from './hub-section';

/**
 * The hub's `learning` section — "continue where you left off" (R6.1).
 *
 * ── PHASE 3: `'empty'` → `'ok'` (§3.2 phase table, R6.6) ───────────────────
 * Phase 1 returned a hard-coded `{ status: 'empty', data: null }` because
 * `Course`, `CourseModule`, `Lesson` and `LessonProgress` did not exist. Batch 9
 * created them and `libs/api/learning`. **The envelope does not change, the
 * composer gains no line, and the client still issues one request** — this file
 * already returned a `HubSection<ContinueLearning | null>` and still does. Its
 * Phase-1 docblock said in terms: *"THIS FILE IS THE SEAM, NOT A PLACEHOLDER.
 * Batch 9 replaces the body of `resolve` … and changes NOTHING else — not the
 * envelope, not the composer, not the client."* That is honoured literally, the
 * way Task 6.15 honoured it for `community`.
 *
 * ── WHY IT INJECTS ONLY `CourseReadService` ────────────────────────────────
 * `LearningModule` exports two services and `MemberHubModule` imports it for
 * both, but every number this card renders is ALREADY computed inside
 * `CourseReadService`'s own query budget: `MemberCourseSummary` carries
 * `completedLessons`, `totalLessons` and `percent`, and `MemberCourseDetail`
 * carries `resumeLesson` (R2.3.6) and the per-module lock verdict (R2.4).
 * Injecting `ProgressService` here would issue extra queries for numbers already
 * in hand and — worse — would derive the same values twice, so the hub card and
 * the courses page could disagree. That is Batch 6C's D-6.15a, and the reasoning
 * transfers unchanged. The second export stays for the consumers §2.6
 * anticipates (Batch 14's notification badge); this section does not need it.
 *
 * ── R6.2: THE HUB IS STILL EXACTLY ONE REQUEST ─────────────────────────────
 * `ContinueLearning` is a launcher card — one course, a next lesson, a
 * percentage. Nothing on it makes a client want a second call, and nothing here
 * is fetched per render.
 *
 * ⚠️ IT COSTS TWO SERVICE CALLS AND FOUR QUERIES, STATED RATHER THAN ROUNDED
 * DOWN. `listCourses` (2 queries) answers "which course", and `getCourse`
 * (2 queries) answers "which lesson next, and is its module locked". Plan AD-4
 * describes this as "a two-query lookup"; the real number is four, for the same
 * accounting reason Batch 6B recorded as its C-5 — the plan counted the
 * conceptual lookups, not the round trips. Both calls happen once per hub
 * request and neither grows with the size of the curriculum.
 *
 * ── WHICH COURSE IS "THE" COURSE, AND WHY IT IS NOT "THE MOST RECENT" ──────
 * The first course in course order (`sortOrder`, then the deterministic
 * tie-break) that this member has not finished; if every visible course is
 * complete, the first course, whose `resumeLesson` is then `null` and whose card
 * renders a completion state rather than a dead "Resume" button.
 *
 * ⚠️ "MOST RECENTLY TOUCHED" WOULD BE THE NICER RULE AND IT IS NOT AVAILABLE.
 * `MemberCourseSummary` carries no timestamp, and `LessonProgress.updatedAt` is
 * a per-LESSON fact that would need a third query and a second definition of
 * "current course" — one on this card and one on the courses page. Course order
 * is deterministic, matches the order the member sees on that page, and needs
 * nothing new. If the product later wants recency, it belongs in
 * `CourseReadService` as ONE derivation both surfaces read.
 *
 * ── `'empty'` AND `'unavailable'` ARE NOT INTERCHANGEABLE (R6.4) ───────────
 * `'empty'` means the query ran and this member has no visible courses;
 * `'unavailable'` means a source failed. This resolver returns `'empty'` for the
 * first and **DOES NOT CATCH** for the second: a throw propagates to
 * `MemberHubService`'s `Promise.allSettled` round, which logs it and degrades
 * this section to `{ status: 'unavailable', data: null }` inside a `200` hub
 * (AD-4, NFR-R3).
 *
 * ⚠️ CATCHING HERE AND RETURNING `'empty'` WOULD BE THE BUG. It reads as
 * defensive and it destroys R6.4's fault signal: the member is told "nothing to
 * continue" on the strength of a query that failed, the hub looks healthy, and
 * nothing is logged. The one legitimate reason to catch would be to return
 * `'unavailable'` from here — which is exactly what the composer already does,
 * one layer up, for every section.
 *
 * ── 🔴 NFR-P6: THIS CARD MAKES NO YOUTUBE REQUEST ──────────────────────────
 * It reads `CourseReadService`, which reads persisted columns. Nothing in
 * `libs/api/learning` outside `lessons/lesson-video.service.ts` can reach
 * `@ptah-api/youtube` at all, and `no-youtube-on-read.spec.ts` asserts that by
 * name and proves it by deliberate failure.
 */
@Injectable()
export class LearningSection implements HubSectionResolver<ContinueLearning | null> {
  constructor(
    @Inject(CourseReadService) private readonly courses: CourseReadService,
  ) {}

  async resolve(
    ctx: MemberContext,
  ): Promise<HubSection<ContinueLearning | null>> {
    const summaries = await this.courses.listCourses(ctx);

    if (summaries.length === 0) {
      // ⚠️ `data: null`, NEVER `[]`. `ContinueLearning` is a single object and
      // there is no such thing as an empty one — the contract requires ARRAY
      // sections to carry `[]` in every status so one renderer handles all
      // three (R6.3), and this is not an array section.
      return { status: 'empty', data: null };
    }

    const current = pickCurrentCourse(summaries);
    const detail = await this.courses.getCourse(ctx, current.slug);

    const nextLesson = detail.resumeLesson;
    const locked =
      nextLesson === null
        ? false
        : detail.modules.some(
            (module) =>
              module.locked &&
              module.lessons.some((lesson) => lesson.slug === nextLesson.slug),
          );

    return {
      status: 'ok',
      // ⚠️ FIELDS ARE DROPPED, NOT SPREAD — see {@link toContinueLearning}.
      data: toContinueLearning(current, nextLesson, locked),
    };
  }
}

/**
 * The course the member is working through.
 *
 * ⚠️ THE FALLBACK IS THE FIRST COURSE, NOT `null`. A member who has finished
 * everything should see a finished course with `nextLesson: null` and
 * `percent: 100`, not an empty card — "you are done" and "there is no
 * curriculum" are different messages, and `'empty'` is the only status the
 * section could report for the second.
 *
 * `summaries` is non-empty at every call site; the `?? ` is a narrowing, not a
 * case that fires.
 */
function pickCurrentCourse(
  summaries: readonly MemberCourseSummary[],
): MemberCourseSummary {
  const unfinished = summaries.find(
    (course) => course.completedLessons < course.totalLessons,
  );
  return unfinished ?? (summaries[0] as MemberCourseSummary);
}

/**
 * `MemberCourseSummary` + the resume pointer → `ContinueLearning`.
 *
 * ⚠️ IT DROPS FIELDS RATHER THAN SPREADING. `id`, `description`,
 * `coverImageUrl`, `modules` and `resumeLesson` are all present on the inputs
 * and all absent from the output: NFR-S4/S5 say a member-facing response carries
 * what the surface renders and nothing else, and a `{ ...summary }` here would
 * put every one of them into the hub the moment `MemberCourseSummary` grows a
 * field. That is why `ContinueLearning` is a distinct type rather than an
 * extension of the summary — the same argument `HubTopicSummary` makes against
 * aliasing `MemberTopicSummary`.
 *
 * ⚠️ `percent` IS PASSED THROUGH, NOT RECOMPUTED. It is derived from LESSON
 * COUNTS inside `CourseReadService` (R2.3.5, RISK-O — never from seconds), and
 * recomputing it here would be the second derivation of one number that D-6.15a
 * refused. `totalLessons: 0` already yields `0` there, never `NaN`.
 */
function toContinueLearning(
  course: MemberCourseSummary,
  nextLesson: ContinueLearning['nextLesson'],
  locked: boolean,
): ContinueLearning {
  return {
    courseSlug: course.slug,
    courseTitle: course.title,
    nextLesson,
    locked,
    completedLessons: course.completedLessons,
    totalLessons: course.totalLessons,
    percent: course.percent,
  };
}
