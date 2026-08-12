/**
 * Curriculum course mapping — TASK_2026_177 Task 11.2, plan §7.3, MG-1.5.
 * Restructured by TASK_2026_202: eight weekly modules → ten daily ones.
 *
 * Turns the export's 10 "Day N build thread" topics into one `Course`, 10
 * `CourseModule` rows and 10 `Lesson` rows. Pure: nothing here touches the
 * database, reads the clock or reads `process.env`, which is what lets the
 * mapping — byte fidelity included — be asserted without one.
 *
 * ⚠️ ONE MODULE PER SESSION, NOT ONE MODULE OF TEN LESSONS. §7.3, verbatim:
 * "R2.4.1's date-based unlock operates on modules, so per-week modules are what
 * makes weekly release expressible later without a restructure." The daily
 * restructure made that argument STRONGER, not weaker: a two-week intensive
 * needs ten `releaseAt` writes and no schema change at all, which is exactly
 * what `CourseScheduleService`
 * (`libs/api/learning/src/lib/courses/course-schedule.service.ts`, driven by
 * `POST /v1/admin/course-modules/schedule`) does from one start date. Collapsing
 * the ten sessions into a single module would have made the first date-gated
 * release a schema-shaped migration instead. Per-session modules are the unit.
 *
 * ⚠️ `sequential: false`, DELIBERATELY AND STILL. The source threads have no
 * completion gate and MG-1.5 asks to preserve *ordering*, not to invent gating.
 * Turning it on would lock a member out of Day 2 until Day 1's lesson is marked
 * complete — a rule nobody in the source cohort was ever subject to. Ten DAILY
 * modules make this a stronger reason to leave it off, not a reason to turn it
 * on: a member who falls a day behind in a two-week intensive would be locked
 * out of the rest of the cohort, and the body of every lesson says in as many
 * words "if you are behind, say so — the point is to finish, not to keep pace
 * with a schedule".
 *
 * ⚠️ `youtubeVideoId` IS `null` ON ALL 10 ⇒ MANUAL COMPLETION ONLY (R2.3.4), and
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
 * TOPIC TITLES. They are editorial content the curriculum owner supplies.
 *
 * This note used to record a defect rather than a design: source topic 21 was
 * titled "Week 7 build thread — Hardening — tests, policies, observability"
 * while the module title was simply "Hardening", so a derivation would have been
 * "wrong today, not merely fragile". **TASK_2026_202 REPAIRED THAT.** Every one
 * of the ten source titles is now exactly
 * `` `Day ${n} build thread — ${MODULE_TITLES[n - 1]}` `` (FR-TITLE-1), and
 * {@link curriculumTopicTitle} plus the guard in {@link buildCourseRows} make a
 * divergence a **BUILD FAILURE** instead of a comment. What is deliberately NOT
 * done is deriving one from the other: the two halves stay independently
 * authored in two files — the export and this table — and their AGREEMENT is the
 * check. A derivation would have nothing left to disagree with.
 *
 * ⚠️ THE CURRICULUM TOPICS ARE EDITORIAL, MAINTAINED IN PLACE, AND ARE NOT A
 * DISCOURSE CAPTURE (Requirement 5.4). The nine forum topics in the same export
 * ARE a capture and are frozen; the ten here were rewritten by hand in 2026-08
 * and carry one authored instant. The forum they came from was destroyed on
 * 2026-08-04, so "re-capture the export" is not a remedy for anything in this
 * file. See `curriculumNote` in `docs/community/discourse-export.json`.
 *
 * ⚠️ WHY TEN DAYS AND NOT AN EVEN 5×2 (TASK_2026_202 C2, founder-approved).
 * The domains are deliberately UNEVEN — Domain modelling gets one day, AI +
 * integrations gets three. The evenness of the first draft was tidiness, not
 * weighting. Three consequences worth keeping:
 *   - Products folds into Day 5 rather than taking Day 6, because Day 5 has
 *     already built the same aggregate pattern one level up and the second pass
 *     is faster, not equal.
 *   - The agent (Day 8) lands AFTER entitlements (Day 7), so its cost control
 *     enforces real plan limits rather than hypothetical ones.
 *   - Deploy stays on Day 2, which is what removes the Day-10 launch crunch a
 *     two-week format cannot absorb. The integration then splits across Days
 *     9–10 so overrun on the OAuth handshake has somewhere to go.
 *
 * ⚠️ FR-DATE-2 — WHAT THE RELEASE SCHEDULE COMPUTES, AND WHY IT IS NOT A TABLE.
 *
 * **The rule.** Day 1 is the cohort start date. Each subsequent day advances one
 * calendar day in the cohort's own time zone, skipping Saturday and Sunday,
 * until every module has a date. The offsets are therefore a **function of the
 * start weekday**, not a constant. Writing them down as a constant is the one
 * mistake this block exists to prevent.
 *
 * **Monday start** — offsets `+0 +1 +2 +3 +4 · +7 +8 +9 +10 +11`; a clean 5 + 5
 * across two weeks.
 *
 * **Tuesday 1 September 2026 (the cohort-1 decision, TASK_2026_202 C3)** —
 * offsets `+0 +1 +2 +3 +6 · +7 +8 +9 +10 +13`:
 *
 * | Day | Date | Weekday |
 * | --- | --- | --- |
 * | 1 | 2026-09-01 | Tue |
 * | 2 | 2026-09-02 | Wed |
 * | 3 | 2026-09-03 | Thu |
 * | 4 | 2026-09-04 | Fri |
 * | 5 | 2026-09-07 | Mon |
 * | 6 | 2026-09-08 | Tue |
 * | 7 | 2026-09-09 | Wed |
 * | 8 | 2026-09-10 | Thu |
 * | 9 | 2026-09-11 | Fri |
 * | 10 | 2026-09-14 | Mon |
 *
 * ⚠️ Day 10 alone on Monday 14 September is a **known, accepted consequence**
 * (C3). A Monday 31 August start would give 5 + 5 ending Friday 11 September.
 * The founder was shown this and supplied 1 September. Because the schedule is
 * one admin action, it can be revisited without a code change. **Do not
 * re-raise it.**
 *
 * Nobody needs to read this table. `POST /v1/admin/course-modules/schedule`
 * computes it. It is here so the arithmetic is reviewable.
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
 * the mapping itself establishes — ten daily sessions, one thread each.
 *
 * ⚠️ THE PHRASE "one module per weekday" IS DELIBERATELY ABSENT. It reads well,
 * and it CONTAINS the substring "one module per week" — which is the exact
 * phrase acceptance criterion 1.2 forbids, and which is what the old eight-week
 * description said. A description phrased to survive a substring check while
 * still containing the forbidden stem is a description phrased for a test.
 * Say "ten daily sessions" and the stem is simply not there.
 */
export const COURSE_DESCRIPTION =
  'The two-week Ptah Builders intensive: ten daily sessions across five ' +
  'domains, assembled from the cohort build threads.';

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
 * The ten descriptive module titles, in DAY order (TASK_2026_202 C2).
 *
 * ⚠️ THIS LIST CARRIES NO TOPIC IDS. It is zipped with `CURRICULUM_TOPIC_IDS`
 * from `map-topics.ts`, which is already asserted to hold 10 ids, to be disjoint
 * from `IMPORTED_TOPIC_IDS` and to cover the 19 source ids exactly. A second copy
 * of those ids in this file is how the two halves drift until a topic lands in
 * both or in neither.
 *
 * ⚠️ THESE ARE THE DESCRIPTIVE HALF ONLY. The source topic title is
 * `` `Day ${n} build thread — ${MODULE_TITLES[n - 1]}` ``, and
 * {@link buildCourseRows} enforces that equality against the export before any
 * row is built. Editing an entry here without editing the export title — or the
 * other way round — fails the seed with a message naming both.
 */
export const MODULE_TITLES: readonly string[] = [
  'The workspace — monorepo, boundaries, first green CI',
  'The database and the deploy pipe — Postgres, migrations, staging on merge',
  'Sign-up, sign-in, session',
  'Users, organisations and the tenancy boundary',
  'Projects and products — the aggregates and their contracts',
  'Checkout — plans, prices and the first paid subscription',
  'Webhooks and entitlements — turning a payment into a durable fact',
  'The agent in the product — tools, streaming and cost control',
  'Connecting an integration — OAuth and the token lifecycle',
  'Publish, fail, retry — and launch',
] as const;

/**
 * The source topic title FR-TITLE-1 requires, for day `day` (1-based).
 *
 * ⚠️ THE SEPARATOR IS SPACE + U+2014 EM DASH + SPACE. A hyphen-minus in the
 * export fails the guard in {@link buildCourseRows}, which is the point.
 *
 * ⚠️ EXPORTED FOR THE SEED, NOT AS THE SPEC'S ONLY ORACLE. A test that checks
 * the export titles by calling this function cannot detect a wrong prefix —
 * both halves would move together. `community-seed.spec.ts` pins Day 1 and
 * Day 10 against hand-written literals as well.
 */
export function curriculumTopicTitle(day: number, moduleTitle: string): string {
  return `Day ${day} build thread — ${moduleTitle}`;
}

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
   * The SOURCE TOPIC TITLE, with the "Day N build thread — " prefix RETAINED
   * (§7.3), so the curriculum reads as it was authored. This is what makes the
   * lesson title differ from its module title for all ten — see
   * {@link curriculumTopicTitle}.
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
  /** `day-01` … `day-10`, positional literals — never `buildSlug()`. */
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
 * Build the course, its 10 modules and their 10 lessons.
 *
 * ⚠️ THE SLUGS ARE POSITIONAL LITERALS, NOT GENERATED. `buildSlug()` in either
 * `common/slug.ts` is documented as create-path-only and its collision resolver
 * takes the set of slugs already in use: a second run would see run 1's `day-01`,
 * resolve `day-01-2` and create a duplicate module — breaking the one property
 * the exit gate is built on. Batch 8 established this for topics (its Finding 5);
 * it applies verbatim here. `day-01` … `day-10` satisfy the same character set
 * the generator emits, which is asserted rather than assumed.
 *
 * ⚠️ THE ZERO PADDING IS LOAD-BEARING AND READS AS COSMETIC. Four reasons, in
 * the order they bite:
 *   1. Unpadded, `day-1` is a strict PREFIX of `day-10`. Every `startsWith`,
 *      every `LIKE 'day-1%'` and every unanchored regex would then match two
 *      modules instead of one — silently, and only ever for that one pair.
 *   2. Padded, lexical order equals numeric order, so a slug-sorted admin list
 *      reads Day 1 … Day 10 rather than Day 1, Day 10, Day 2.
 *   3. Width 2 is sized to THIS curriculum: `MODULE_TITLES.length` is the bound
 *      and it is 10. A course of more than 99 modules would need width 3.
 *   4. The set is disjoint from the retired `week-1` … `week-8`, which is what
 *      makes a re-seed over an 8-week database a visible addition rather than a
 *      silent overwrite. See the reseed runbook.
 *
 * ⚠️ TITLES ARE UNPADDED, SLUGS ARE PADDED (FR-SLUG-3). "Day 10" in a title,
 * `day-10` in a slug. Any regex against a TITLE therefore takes `\d{1,2}`; any
 * regex against a SLUG takes the explicit alternation `(0[1-9]|10)`. A `\d`
 * written against a title passes eight of ten and fails only Day 10, which is
 * why it reads as a data defect rather than a quantifier defect.
 *
 * ⚠️ `Course.createdAt` IS NOT CARRIED FROM ANY SOURCE TOPIC, AND THAT IS
 * DELIBERATE. §7.3 specifies source timestamps for topics and posts (MG-1.7) and
 * says nothing about the course, because the course is a NEW EDITORIAL OBJECT.
 * Stamping it with one of their instants would be a fabricated claim about when
 * the curriculum was authored. The same reasoning covers `CourseModule.createdAt`:
 * a module's identity is its `MODULE_TITLES` entry, which no source topic
 * supplies. Both fall through to `@default(now())`. `Lesson.createdAt` is the
 * exception and carries its source topic's instant, because a lesson IS a source
 * body — and for the ten curriculum topics that instant is the single authoring
 * instant of the 2026-08 editorial pass, not ten fabricated ascending ones.
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
        "a mismatch would silently drop a day or title one with another day's heading.",
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
        `The export has no topic with source id ${sourceTopicId}. MG-1.5 names ` +
          `${CURRICULUM_TOPIC_IDS.length} curriculum topics by id; present ids: ` +
          `${[...byId.keys()].join(', ')}.`,
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

    // FR-SLUG-1: `day-01` … `day-10`. A positional literal, NOT `buildSlug()`,
    // and zero-padded for the four reasons in this function's docblock.
    const slug = `day-${String(index + 1).padStart(2, '0')}`;
    const title = MODULE_TITLES[index];
    if (title === undefined) {
      throw new CourseMappingError(
        `MG-1.5 supplies no module title at position ${index}.`,
      );
    }

    // 🔴 FR-TITLE-2. The export title and the module title are authored in two
    // different files and their AGREEMENT is the check. This runs before
    // `$transaction` opens, so a mismatch writes nothing at all — the same
    // position that makes the empty-body abort above write nothing.
    const expectedTitle = curriculumTopicTitle(index + 1, title);
    if (source.title !== expectedTitle) {
      throw new CourseMappingError(
        `Curriculum topic ${sourceTopicId} is titled "${source.title}" but ` +
          `MODULE_TITLES[${index}] makes it "${expectedTitle}". The two halves are ` +
          'authored in two files and their agreement is the check — repair the ' +
          'export title or the module title, do not derive one from the other. ' +
          'This is the defect this file recorded for source topic 21 before ' +
          'TASK_2026_202 turned it into a build failure.',
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
