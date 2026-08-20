import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type {
  LockReason,
  MemberCourseDetail,
  MemberCourseSummary,
  MemberLessonDetail,
  MemberLessonRef,
  MemberLessonSummary,
  MemberModuleSummary,
} from '@ptah-contracts/community';

import { LessonCommentsService } from '../comments/lesson-comments.service';
import { NOT_DELETED } from '../common/soft-delete';
import { DETERMINISTIC_ORDER_BY } from '../common/sort-order';
import { buildCourseVisibilityWhere } from '../common/visibility';
import {
  ProgressService,
  toMemberLessonProgress,
  type LessonProgressRow,
} from '../progress/progress.service';

import {
  ModuleLockService,
  type LockCourse,
  type LockModule,
} from './module-lock.service';

/**
 * CourseReadService — R2.1.2, R2.1.4, R2.1.5, R2.3.5, R2.3.6, R2.4.4, NFR-P4,
 * NFR-P6, NFR-S4, plan §3.4.
 *
 * The member read model: it owns the projection, the mapper and the query
 * budget in one place, the way `topics-read.service.ts` does for the forum.
 *
 * 🔴 NFR-P6 STARTS HERE: THIS FILE MUST NOT IMPORT `@ptah-api/youtube`, AND IT
 * DOES NOT. Every video field it returns comes from the persisted `Lesson`
 * columns — persistence IS the cache (plan §4.5), because the metadata was
 * fetched once at authoring time. Serving a lesson page makes ZERO third-party
 * calls. Task 9.17 asserts the importer set by name and proves it by deliberate
 * failure; this task is where the property is true or not.
 *
 * 🔴 R2.3.5's PERCENTAGE IS COMPUTED FROM **LESSON COUNTS**, NEVER FROM SECONDS
 * (RISK-O). `percent = completedLessons / totalLessons`, rounded, with `0`
 * lessons yielding `0` rather than `NaN`. There is no sum of seconds anywhere
 * in this file, and no import of `completion.ts` — a member who has watched 89%
 * of every lesson has completed none of them and is at `0`, which is the honest
 * answer: R2.3.2's threshold is per-lesson, and averaging watch positions
 * across lessons of different lengths produces a number that means nothing and
 * that disagrees with the completion ticks beside it.
 *
 * 🔴 NFR-S4 / R2.3.7 — THE PROGRESS LOOKUP IS SCOPED TO `ctx.userId` AND
 * NOTHING ELSE, and it is not scoped here: it goes through
 * `ProgressService.listProgressFor`, which takes a `MemberContext` and has no
 * `userId` parameter for a caller to supply. There is no code path in this file
 * that could read another member's progress.
 *
 * ⚠️ AD-5 — `NOT_DELETED` ON EVERY READ, **INCLUDING THE NESTED ONES**. Forum's
 * `RULE-NESTED` exists because the top-level scan misses the reads that matter
 * most: an unfiltered `lessons` relation counts tombstones, which inflates
 * `totalLessons`, which DEFLATES EVERY PERCENTAGE IN THE PRODUCT — silently,
 * consistently, and invisibly to any call-expression scan.
 */
@Injectable()
export class CourseReadService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModuleLockService) private readonly locks: ModuleLockService,
    @Inject(ProgressService) private readonly progress: ProgressService,
    @Inject(LessonCommentsService)
    private readonly comments: LessonCommentsService,
  ) {}

  /**
   * Every course this member may see — `GET /v1/members/courses` (R2.1.1).
   *
   * TWO QUERIES, AND THE COMPOSITION IS THE ASSERTION (NFR-P4's shape):
   *   1. `course.findMany` — the visible, published, live courses WITH their
   *      live modules and those modules' live lesson ids, nested. One round
   *      trip for the whole forest.
   *   2. `lessonProgress.findMany` — this member's rows for exactly those
   *      lesson ids, in ONE `in` clause.
   *
   * ⚠️ THE NESTED SELECT IS WHAT AVOIDS THE N+1, AND IT IS ALSO WHY THE COUNTS
   * ARE HONEST. The obvious alternative — `_count: { select: { modules: true } }`
   * — is shorter, counts SOFT-DELETED rows, and no call-expression scan sees
   * it. It would inflate `totalLessons` and deflate every percentage.
   */
  async listCourses(ctx: MemberContext): Promise<MemberCourseSummary[]> {
    const courses = await this.fetchCourseTrees(ctx, {});
    if (courses.length === 0) return [];

    const lessonIds = courses.flatMap((course) =>
      course.modules.flatMap((m) => m.lessons.map((l) => l.id)),
    );
    const completed = await this.completedLessonIds(ctx, lessonIds);

    return courses.map((course) => toCourseSummary(course, completed));
  }

  /**
   * One course with its whole outline — `GET /v1/members/courses/:slug`.
   *
   * TWO QUERIES: the course tree, and this member's progress for its lessons.
   *
   * ⚠️ THE 404 IS THE HONEST RESULT OF THE QUERY THAT RAN. A draft course
   * (R2.1.2) or one whose cohort/visibility gate excludes the caller produces
   * no row, so nothing here ever learns it existed and no branch could return a
   * `403` for it. Contrast {@link getLesson}'s locked-module `403`.
   */
  async getCourse(
    ctx: MemberContext,
    slug: string,
  ): Promise<MemberCourseDetail> {
    const [course] = await this.fetchCourseTrees(ctx, { slug });
    if (!course) throw new NotFoundException('Course not found');

    const flat = flatten(course);
    const completed = await this.completedLessonIds(
      ctx,
      flat.map((entry) => entry.lesson.id),
    );

    const now = new Date();
    const lockCourse = toLockCourse(course);

    const modules: MemberModuleSummary[] = course.modules.map((module) => {
      const verdict = this.locks.evaluate(
        toLockModule(module),
        lockCourse,
        completed,
        now,
      );

      return {
        id: module.id,
        slug: module.slug,
        title: module.title,
        description: module.description,
        sortOrder: module.sortOrder,
        locked: verdict.locked,
        lockReason: verdict.reason,
        unlocksAt: verdict.unlocksAt?.toISOString() ?? null,
        // ⚠️ A LOCKED MODULE'S LESSONS ARE STILL LISTED (R2.4.4). The redaction
        // is STRUCTURAL: `MemberLessonSummary` has no body, no video id and no
        // comments key, so there is nothing here for a mapper to forget to
        // delete. Omitting the lessons instead would make the outline disagree
        // with prev/next traversal about what comes after this module.
        lessons: module.lessons.map((lesson) =>
          toLessonSummary(lesson, completed),
        ),
      };
    });

    return {
      ...toCourseSummary(course, completed),
      modules,
      // R2.3.6, computed from the SAME flattened list — one derivation.
      resumeLesson: resumeRef(flat, completed),
    };
  }

  /**
   * One lesson in full — `GET /v1/members/courses/:slug/lessons/:lessonSlug`.
   *
   * 🔴 A LOCKED MODULE IS A `403 { reason, unlocksAt }`, NOT A `404`, AND THAT
   * IS NOT IN TENSION WITH THE RULE ABOVE. The member has ALREADY been shown
   * this module and its lesson titles by {@link getCourse} — R2.4.4 discloses
   * them on purpose so they can see what is coming — so answering "not found"
   * would contradict the response they are looking at. Visible-but-forbidden is
   * exactly what `403` is for. It is also an exit-gate clause (§8.2 P3, clause
   * 1) that this comes from the API and not from a CSS state.
   *
   * ⚠️ FIVE QUERIES, AND THE COMPOSITION IS STATED RATHER THAN THE NUMBER
   * ADJUSTED. `tasks.md` targets three (the lesson with its module and course ·
   * neighbours from the same course tree · comments). Achieved: FIVE.
   *   1. the course tree — resolves the course by slug through the visibility
   *      clause, locates the lesson, AND supplies every neighbour and every
   *      lock input. This one query covers the task's first two;
   *   2. this member's progress across the course's lessons — needed for the
   *      lock's completion set, for `completed` on the outline, and for this
   *      lesson's own `progress` object;
   *   3. the target lesson's body and video columns. DELIBERATELY NOT FOLDED
   *      INTO (1): the outline select omits `bodyMarkdown` on purpose, and
   *      adding it there would load the whole course's markdown to render one
   *      lesson — a payload that grows with the curriculum for a benefit that
   *      does not;
   *   4. the comment thread;
   *   5. ONE batched author-name lookup for those comments.
   * (4) and (5) are `LessonCommentsService.listForLesson`, counted because it
   * is the REAL collaborator — the task's "three" counts comments as one query
   * and omits the author names `MemberLessonComment.authorName` requires. That
   * is the same accounting correction Batch 6B recorded as C-5.
   */
  async getLesson(
    ctx: MemberContext,
    slug: string,
    lessonSlug: string,
  ): Promise<MemberLessonDetail> {
    const { flat, index, entry, progressRows } = await this.requireOpenLesson(
      ctx,
      slug,
      lessonSlug,
    );

    const body = await this.prisma.lesson.findFirst({
      where: { id: entry.lesson.id, ...NOT_DELETED },
      select: {
        bodyMarkdown: true,
        youtubeVideoId: true,
        videoTitle: true,
        videoDurationSeconds: true,
        videoThumbnailUrl: true,
      },
    });
    if (!body) throw new NotFoundException('Lesson not found');

    const comments = await this.comments.listForLesson(entry.lesson.id);

    return {
      id: entry.lesson.id,
      slug: entry.lesson.slug,
      title: entry.lesson.title,
      bodyMarkdown: body.bodyMarkdown,
      youtubeVideoId: body.youtubeVideoId,
      videoTitle: body.videoTitle,
      videoDurationSeconds: body.videoDurationSeconds,
      videoThumbnailUrl: body.videoThumbnailUrl,
      progress: toMemberLessonProgress(
        progressRows.get(entry.lesson.id) ?? null,
      ),
      // 🔴 R2.1.5 — NEIGHBOURS IN **COURSE** ORDER, NOT MODULE ORDER, computed
      // from the flattened list the same query already produced. And they
      // traverse THROUGH locked modules: skipping them would make `next` jump a
      // module, so the outline and the player would disagree about what comes
      // next. The lock is enforced when the neighbour is REQUESTED, which is
      // the only place it can be enforced honestly.
      previous: refAt(flat, index - 1),
      next: refAt(flat, index + 1),
      comments,
    };
  }

  /**
   * Resolve a lesson the member may WRITE TO, by the course-scoped slug pair —
   * the seam the two progress endpoints stand on.
   *
   * 🔴 IT EXISTS SO THE `403` ON A PROGRESS WRITE IS THE SAME DECISION AS THE
   * `403` ON A LESSON READ, NOT A SECOND ONE. `ProgressService` deliberately
   * does not evaluate the module lock (Batch 9B, Task 9.13): the lock is a
   * property of the MODULE and evaluating it needs the course tree and the
   * member's completed lessons, which a one-row write has no reason to fetch.
   * Plan §3.4 still annotates `PUT …/progress` and `PUT …/completion` with
   * `403`, so the composition has to happen somewhere — and the only safe
   * "somewhere" is code that runs {@link ModuleLockService} over the same tree
   * `getLesson` runs it over. That is literally what this does: both methods
   * call {@link requireOpenLesson}, so a change to the lock semantics cannot
   * reach one and miss the other.
   *
   * ⚠️ TWO QUERIES, NOT FIVE — AND THAT IS WHY IT IS NOT JUST `getLesson()`.
   * Composing the progress routes through `getLesson` would have been one line
   * and would have cost the lesson BODY, the whole comment thread and a batched
   * author lookup on **every progress ping**. A member watching a lesson emits
   * one write per 15 seconds plus flushes on pause and teardown (which is why
   * the throttle tier is 60/min, not 10/min); paying five queries and a full
   * markdown payload for each of those is the shape that turns a working feature
   * into an incident. This pays the two the DECISION actually needs.
   *
   * ⚠️ IT RETURNS THE ID AND NOTHING ELSE. `MemberLessonDetail` is the read
   * model's business; a write path needs the primary key and the permission,
   * and returning more would invite a caller to use this as a cheaper read and
   * then wonder why the body is missing.
   *
   * `404` for a course or lesson this member cannot see (R2.1.2 — a draft or an
   * out-of-cohort course produces no row and nothing here learns it existed);
   * `403 { reason, unlocksAt }` for a VISIBLE course whose module is locked. The
   * two are not interchangeable and are not unified.
   */
  async resolveWritableLesson(
    ctx: MemberContext,
    slug: string,
    lessonSlug: string,
  ): Promise<{ lessonId: string }> {
    const { entry } = await this.requireOpenLesson(ctx, slug, lessonSlug);
    return { lessonId: entry.lesson.id };
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * 🔴 THE ONE IMPLEMENTATION OF "may this member open this lesson right now".
   *
   * Extracted from {@link getLesson} so {@link resolveWritableLesson} is the
   * SAME decision rather than a second one that happens to agree today. R2.4.5
   * requires the lock to be evaluated server-side on every lesson access; two
   * copies of that evaluation is the shape in which one of them silently stops
   * matching the other.
   *
   * TWO QUERIES: the course tree, and this member's progress for its lessons.
   * It returns the flattened list and the progress rows as well as the target,
   * because `getLesson` needs both for prev/next (R2.1.5) and for the progress
   * block — re-reading them would make the extraction cost a query.
   */
  private async requireOpenLesson(
    ctx: MemberContext,
    slug: string,
    lessonSlug: string,
  ): Promise<{
    course: CourseTree;
    flat: FlatEntry[];
    index: number;
    entry: FlatEntry;
    progressRows: ReadonlyMap<string, LessonProgressRow>;
  }> {
    const [course] = await this.fetchCourseTrees(ctx, { slug });
    if (!course) throw new NotFoundException('Course not found');

    const flat = flatten(course);
    const index = flat.findIndex((e) => e.lesson.slug === lessonSlug);
    if (index === -1) throw new NotFoundException('Lesson not found');

    const entry = flat[index];
    // Narrowed rather than asserted: `findIndex` already proved it is there,
    // and a `!` would hide the day someone reorders these two statements.
    if (!entry) throw new NotFoundException('Lesson not found');

    const progressRows = await this.progress.listProgressFor(
      ctx,
      flat.map((e) => e.lesson.id),
    );

    const verdict = this.locks.evaluate(
      toLockModule(entry.module),
      toLockCourse(course),
      completedFrom(progressRows),
      new Date(),
    );
    if (verdict.locked) {
      // ⚠️ THE MACHINE `reason` AND `unlocksAt`, NEVER A SENTENCE. `LOCK_REASONS`
      // is the shared vocabulary; the UI matches on the value, so a copy edit
      // to the message must never change which screen a member sees.
      throw new ForbiddenException({
        reason: verdict.reason satisfies LockReason | null,
        unlocksAt: verdict.unlocksAt?.toISOString() ?? null,
        message: 'This module is not open yet.',
      });
    }

    return { course, flat, index, entry, progressRows };
  }

  /**
   * The ONE course-tree read, shared by all three public methods.
   *
   * ⚠️ EVERY LEVEL CARRIES `NOT_DELETED`, AND THE NESTED ONES ARE THE ONES THAT
   * MATTER. See the class docblock: an unfiltered `lessons` relation inflates
   * `totalLessons` and deflates every percentage in the product.
   *
   * ⚠️ EVERY LEVEL ALSO CARRIES `DETERMINISTIC_ORDER_BY` (R2.1.4). `sortOrder`
   * alone is not a total order — `@@unique([courseId, sortOrder])` is
   * deliberately not declared (R8.8) — so ties are an ordinary state, and
   * without the tie-break Postgres may return them in whatever order it last
   * wrote them. That would make prev/next non-deterministic between two
   * identical requests.
   *
   * ⚠️ THE LESSON SELECT OMITS `bodyMarkdown` ON PURPOSE. It is an OUTLINE
   * read; carrying every body would blow the payload for a list of links.
   */
  private async fetchCourseTrees(
    ctx: MemberContext,
    extra: Prisma.CourseWhereInput,
  ): Promise<CourseTree[]> {
    return this.prisma.course.findMany({
      where: { ...NOT_DELETED, ...buildCourseVisibilityWhere(ctx), ...extra },
      orderBy: [...DETERMINISTIC_ORDER_BY],
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        coverImageUrl: true,
        sequential: true,
        modules: {
          where: { ...NOT_DELETED },
          orderBy: [...DETERMINISTIC_ORDER_BY],
          select: {
            id: true,
            slug: true,
            title: true,
            description: true,
            sortOrder: true,
            releaseAt: true,
            lessons: {
              where: { ...NOT_DELETED },
              orderBy: [...DETERMINISTIC_ORDER_BY],
              select: {
                id: true,
                slug: true,
                title: true,
                sortOrder: true,
                videoDurationSeconds: true,
              },
            },
          },
        },
      },
    });
  }

  /** THIS member's completed lesson ids among a set — NFR-S4, one query. */
  private async completedLessonIds(
    ctx: MemberContext,
    lessonIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    return completedFrom(await this.progress.listProgressFor(ctx, lessonIds));
  }
}

/* -------------------------------------------------------------------------- */
/* Projections                                                                 */
/* -------------------------------------------------------------------------- */

interface TreeLesson {
  id: string;
  slug: string;
  title: string;
  sortOrder: number;
  videoDurationSeconds: number | null;
}

interface TreeModule {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  sortOrder: number;
  releaseAt: Date | null;
  lessons: TreeLesson[];
}

interface CourseTree {
  id: string;
  slug: string;
  title: string;
  description: string;
  coverImageUrl: string | null;
  sequential: boolean;
  modules: TreeModule[];
}

/** One lesson plus the module it belongs to, in course order. */
interface FlatEntry {
  readonly module: TreeModule;
  readonly lesson: TreeLesson;
}

/**
 * The course's lessons in COURSE order — module `sortOrder`, then lesson
 * `sortOrder`, both already applied by the query's `DETERMINISTIC_ORDER_BY`.
 *
 * 🔴 THIS LIST IS THE SINGLE SOURCE OF prev/next AND OF resume (R2.1.5,
 * R2.3.6). Both derivations read it, so they cannot disagree — Batch 6C's
 * D-6.15a refused a second injection for exactly this reason: a second
 * derivation of one number is how a card and a feed start disagreeing.
 *
 * ⚠️ LOCKED MODULES' LESSONS ARE IN IT. See {@link CourseReadService.getLesson}.
 */
function flatten(course: CourseTree): FlatEntry[] {
  return course.modules.flatMap((module) =>
    module.lessons.map((lesson) => ({ module, lesson })),
  );
}

function refAt(
  flat: readonly FlatEntry[],
  index: number,
): MemberLessonRef | null {
  const entry = flat[index];
  if (!entry) return null;
  return {
    slug: entry.lesson.slug,
    title: entry.lesson.title,
    moduleTitle: entry.module.title,
  };
}

/**
 * R2.3.6 — the first INCOMPLETE lesson in course order, crossing module
 * boundaries. `null` when every lesson is complete or the course has none.
 */
function resumeRef(
  flat: readonly FlatEntry[],
  completed: ReadonlySet<string>,
): MemberLessonRef | null {
  const index = flat.findIndex((entry) => !completed.has(entry.lesson.id));
  return index === -1 ? null : refAt(flat, index);
}

function toLockModule(module: TreeModule): LockModule {
  return {
    id: module.id,
    releaseAt: module.releaseAt,
    // ⚠️ LIVE LESSONS ONLY — the query's nested `NOT_DELETED` guarantees it. A
    // deleted lesson in this list could never be completed, so it would lock
    // the following module forever.
    lessonIds: module.lessons.map((lesson) => lesson.id),
  };
}

function toLockCourse(course: CourseTree): LockCourse {
  return {
    sequential: course.sequential,
    modules: course.modules.map(toLockModule),
  };
}

function completedFrom(
  rows: ReadonlyMap<string, { completedAt: Date | null }>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [lessonId, row] of rows) {
    if (row.completedAt !== null) ids.add(lessonId);
  }
  return ids;
}

/**
 * A course row plus this member's completion, as the summary wire type.
 *
 * 🔴 `percent` IS DERIVED FROM COUNTS AND `totalLessons === 0` MUST NOT DIVIDE
 * (R2.3.5, RISK-O). A course with no lessons is a REAL state — an admin creates
 * the shell first — and `NaN%` on the member's home screen is the visible
 * failure. There is no sum of seconds in this function and there must not be
 * one.
 */
export function toCourseSummary(
  course: CourseTree,
  completed: ReadonlySet<string>,
): MemberCourseSummary {
  const lessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
  const totalLessons = lessonIds.length;
  const completedLessons = lessonIds.filter((id) => completed.has(id)).length;

  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    description: course.description,
    coverImageUrl: course.coverImageUrl,
    completedLessons,
    totalLessons,
    percent:
      totalLessons === 0
        ? 0
        : Math.round((completedLessons / totalLessons) * 100),
  };
}

/**
 * A lesson in the OUTLINE.
 *
 * ⚠️ `durationSeconds` IS A DURATION, NOT A POSITION (RISK-O). The member's
 * watch position appears only on the lesson DETAIL, inside `progress`. This
 * function has no access to a position at all, which is the shape making the
 * confusion unavailable rather than merely discouraged.
 */
function toLessonSummary(
  lesson: TreeLesson,
  completed: ReadonlySet<string>,
): MemberLessonSummary {
  return {
    id: lesson.id,
    slug: lesson.slug,
    title: lesson.title,
    sortOrder: lesson.sortOrder,
    completed: completed.has(lesson.id),
    durationSeconds: lesson.videoDurationSeconds,
  };
}
