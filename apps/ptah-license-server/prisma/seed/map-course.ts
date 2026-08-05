/**
 * Curriculum course mapping — TASK_2026_177 Task 11.2, plan §7.3, MG-1.5.
 *
 * Turns the export's 8 "Week N build thread" topics into one `Course`, 8
 * `CourseModule` rows and 8 `Lesson` rows. Pure: nothing here touches the
 * database, reads the clock or reads `process.env`, which is what lets the
 * mapping — byte fidelity included — be asserted without one.
 *
 * ⚠️ ONE MODULE PER WEEK, NOT ONE MODULE OF EIGHT LESSONS. §7.3, verbatim:
 * "R2.4.1's date-based unlock operates on modules, so per-week modules are what
 * makes weekly release expressible later without a restructure." Collapsing the
 * eight weeks into a single module would make the first date-gated release a
 * schema-shaped migration rather than eight `releaseAt` writes.
 *
 * ⚠️ `sequential: false`, DELIBERATELY. The source threads have no completion
 * gate and MG-1.5 asks to preserve *ordering*, not to invent gating. Turning it
 * on would lock a member out of week 2 until week 1's lesson is marked complete
 * — a rule nobody in the source cohort was ever subject to.
 *
 * ⚠️ `youtubeVideoId` IS `null` ON ALL 8 ⇒ MANUAL COMPLETION ONLY (R2.3.4), and
 * the mechanism is worth stating precisely because it is NOT the id that decides.
 * ASSUMPTION-8 keys the 90% rule on `videoDurationSeconds`: a lesson whose
 * duration is `null` cannot have a threshold computed against it and is
 * manual-only even if it *does* carry a video id. Both columns are written `null`
 * here, so every seeded lesson is manual-only under either reading — and that
 * makes the no-video lesson layout the DEFAULT case in this workspace rather than
 * an edge case.
 *
 * ⚠️ `createdBy` IS `null`. A-4's reasoning transfers unchanged: no `User` row is
 * fabricated, so the seed has no author to name. One consequence worth recording
 * so nobody later reads it as a defect — Task 9.14's `setAnswered` check is
 * "admin OR lesson author", resolved through `Course.createdBy`. With that null,
 * **`setAnswered` is admin-only for every seeded lesson.** That is correct, not a
 * regression.
 *
 * ⚠️ THE MODULE TITLES ARE A LITERAL TABLE HERE AND ARE NOT DERIVED FROM THE
 * TOPIC TITLES. They are editorial content MG-1.5 supplies. A derivation would
 * also be wrong today, not merely fragile: source topic 21 is titled "Week 7
 * build thread — Hardening — tests, policies, observability" while MG-1.5's
 * module title is simply "Hardening".
 */
import type {
  DiscourseExport,
  DiscourseExportTopic,
} from './discourse-export.schema';
import { CURRICULUM_TOPIC_IDS } from './map-topics';

/** The natural key the whole course import is idempotent on (AD-15, §7.3). */
export const COURSE_SLUG = 'ptah-builders-cohort-1';
export const COURSE_TITLE = 'Ptah Builders — Cohort 1';

/**
 * `Course.description` is a REQUIRED column and §7.3 specifies no value for it.
 *
 * Left unstated it would have to be `''`, which renders as a blank paragraph
 * under the course title on the member course card and reads as a bug. This one
 * sentence is editorial, is not derived from any source topic, and says only what
 * the mapping itself establishes — eight weeks, one thread each.
 */
export const COURSE_DESCRIPTION =
  'The eight-week Ptah Builders cohort, one module per week, assembled from the ' +
  'cohort build threads.';

/** §7.3. `cohort` gating; the key itself is resolved at run time, never here. */
export const COURSE_VISIBILITY = 'cohort';

/**
 * Sparse ordering with gaps of 100 (R8.8, and the same step Task 9.8 uses):
 * a single later insert between two modules must not force a full renumber.
 */
export const SORT_ORDER_STEP = 100;

/** §7.3. The course's own position in the (currently single-course) list. */
export const COURSE_SORT_ORDER = 100;

/** §7.3. Every module holds exactly one lesson, so its position is the first. */
export const LESSON_SORT_ORDER = 100;

/**
 * MG-1.5's eight descriptive module titles, in week order.
 *
 * ⚠️ THIS LIST CARRIES NO TOPIC IDS. It is zipped with `CURRICULUM_TOPIC_IDS`
 * from `map-topics.ts`, which is already asserted to hold 8 ids, to be disjoint
 * from `IMPORTED_TOPIC_IDS` and to cover the 17 source ids exactly. A second copy
 * of those ids in this file is how the two halves drift until a topic lands in
 * both or in neither.
 */
export const MODULE_TITLES: readonly string[] = [
  'Foundation — workspace, boundaries, CI',
  'The domain — modelling and migrations',
  'Authentication and tenancy',
  'Billing and entitlements',
  'The first vertical slice',
  'Agents, memory and skills',
  'Hardening',
  'Deploy and launch',
] as const;

/** Thrown when the export cannot supply the curriculum MG-1.5 names. */
export class CourseMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CourseMappingError';
  }
}

/** A lesson row ready to be written, in `Lesson` field names. */
export interface LessonSeedRow {
  /** §7.3: the lesson slug equals its module slug. */
  readonly slug: string;
  /**
   * The SOURCE TOPIC TITLE, with the "Week N build thread — " prefix RETAINED
   * (§7.3), so the curriculum reads as it was authored.
   */
  readonly title: string;
  /**
   * The source topic's post #1 `raw`, copied VERBATIM. No transform, no
   * re-wrap, no entity decoding, not even a trim. Byte-identical to the source
   * is the property the exit gate checks, and any normalisation breaks it —
   * silently, because the result still looks like the same markdown.
   */
  readonly bodyMarkdown: string;
  readonly sortOrder: number;
  /** R2.3.4 + ASSUMPTION-8. See the file docblock. */
  readonly youtubeVideoId: null;
  /** ASSUMPTION-8: this null, not the one above, is what makes it manual-only. */
  readonly videoDurationSeconds: null;
  /**
   * MG-1.7's principle applied to lessons: the source instant, never `now()`.
   * The body IS that topic's body and its date is a true fact about it.
   */
  readonly createdAt: Date;
}

/** A module row ready to be written, in `CourseModule` field names. */
export interface CourseModuleSeedRow {
  readonly sourceTopicId: number;
  /** `week-1` … `week-8`, literals from §7.3 — never `buildSlug()`. */
  readonly slug: string;
  /** MG-1.5's descriptive half. Editorial; not derived from the topic title. */
  readonly title: string;
  readonly sortOrder: number;
  readonly lesson: LessonSeedRow;
}

/** The course row ready to be written, in `Course` field names. */
export interface CourseSeedRow {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly visibility: string;
  readonly cohortKeys: readonly string[];
  readonly published: boolean;
  readonly sequential: boolean;
  readonly sortOrder: number;
  /** A-4. No `User` row is fabricated, so there is no author to name. */
  readonly createdBy: null;
}

export interface CourseMappingResult {
  readonly course: CourseSeedRow;
  readonly modules: readonly CourseModuleSeedRow[];
}

/**
 * Build the course, its 8 modules and their 8 lessons.
 *
 * ⚠️ THE SLUGS ARE LITERALS, NOT GENERATED. `buildSlug()` in either
 * `common/slug.ts` is documented as create-path-only and its collision resolver
 * takes the set of slugs already in use: a second run would see run 1's `week-1`,
 * resolve `week-1-2` and create a duplicate module — breaking the one property
 * the exit gate is built on. Batch 8 established this for topics (its Finding 5);
 * it applies verbatim here. `week-1` … `week-8` satisfy the same character set
 * the generator emits, which is asserted rather than assumed.
 *
 * ⚠️ `Course.createdAt` IS NOT CARRIED FROM ANY SOURCE TOPIC, AND THAT IS
 * DELIBERATE. §7.3 specifies source timestamps for topics and posts (MG-1.7) and
 * says nothing about the course, because the course is a NEW EDITORIAL OBJECT —
 * assembled in 2026-08 out of eight threads written across three weeks. Stamping
 * it with one of their instants would be a fabricated claim about when the
 * curriculum was authored. The same reasoning covers `CourseModule.createdAt`:
 * a module's identity is its MG-1.5 title, which no source topic supplies. Both
 * fall through to `@default(now())`. `Lesson.createdAt` is the exception and
 * carries its source topic's instant, because a lesson IS a source body.
 *
 * @param cohortKey the resolved default `MemberGroup.key`. Never defaulted here:
 *   `cohortKeys: []` on a `cohort` course means "gated on nothing", which the
 *   visibility resolver reads as visible to every entitled member.
 */
export function buildCourseRows(
  exportData: DiscourseExport,
  cohortKey: string,
): CourseMappingResult {
  if (MODULE_TITLES.length !== CURRICULUM_TOPIC_IDS.length) {
    throw new CourseMappingError(
      `MG-1.5 supplies ${MODULE_TITLES.length} module titles but map-topics.ts lists ` +
        `${CURRICULUM_TOPIC_IDS.length} curriculum topics. The two are zipped in order, so ` +
        "a mismatch would silently drop a week or title one with another week's heading.",
    );
  }

  if (cohortKey.length === 0) {
    throw new CourseMappingError(
      'The resolved cohort key is empty. A cohort-gated course with an empty key is ' +
        'gated on nothing, which is the opposite of what visibility: "cohort" means.',
    );
  }

  const byId = new Map<number, DiscourseExportTopic>(
    exportData.topics.map((t) => [t.id, t]),
  );

  const modules = CURRICULUM_TOPIC_IDS.map((sourceTopicId, index) => {
    const source = byId.get(sourceTopicId);
    if (!source) {
      throw new CourseMappingError(
        `The export has no topic with source id ${sourceTopicId}. MG-1.5 names 8 curriculum ` +
          `topics by id; present ids: ${[...byId.keys()].join(', ')}.`,
      );
    }

    const openingPost = source.posts.find((p) => p.postNumber === 1);
    if (!openingPost) {
      throw new CourseMappingError(
        `Curriculum topic ${sourceTopicId} ("${source.slug}") has no post #1. AD-9 makes ` +
          'post #1 the body, and a lesson with no body has no content.',
      );
    }

    // 🔴 AN EMPTY CURRICULUM BODY ABORTS; IT IS NOT SKIPPED. The community half
    // skips one empty small-action reply because nothing is lost and the thread
    // still reads correctly without it. A lesson body is the whole lesson: there
    // is nothing to skip to, and a blank lesson is a member-visible defect that
    // would ship silently. `SKIP_EMPTY_BODY_POSTS` deliberately does not reach
    // here.
    if (openingPost.raw.length === 0) {
      throw new CourseMappingError(
        `Curriculum topic ${sourceTopicId} ("${source.slug}") has an empty post #1 body. ` +
          'A lesson body is the entire lesson — unlike a skippable empty reply in the ' +
          'community half, there is nothing to fall back to. Re-capture the export.',
      );
    }

    const slug = `week-${index + 1}`;
    const title = MODULE_TITLES[index];
    if (title === undefined) {
      throw new CourseMappingError(
        `MG-1.5 supplies no module title at position ${index}.`,
      );
    }

    return {
      sourceTopicId,
      slug,
      title,
      sortOrder: (index + 1) * SORT_ORDER_STEP,
      lesson: {
        // §7.3: the lesson slug equals its module slug.
        slug,
        title: source.title,
        bodyMarkdown: openingPost.raw,
        sortOrder: LESSON_SORT_ORDER,
        youtubeVideoId: null,
        videoDurationSeconds: null,
        createdAt: new Date(source.createdAt),
      },
    } satisfies CourseModuleSeedRow;
  });

  return {
    course: {
      slug: COURSE_SLUG,
      title: COURSE_TITLE,
      description: COURSE_DESCRIPTION,
      visibility: COURSE_VISIBILITY,
      cohortKeys: [cohortKey],
      published: true,
      sequential: false,
      sortOrder: COURSE_SORT_ORDER,
      createdBy: null,
    },
    modules,
  };
}
