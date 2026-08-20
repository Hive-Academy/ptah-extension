/**
 * The MG-1 community seed — TASK_2026_177 Batch 8, plan §7.
 *
 * Imports the 4 categories, 9 non-curriculum topics and their post bodies from
 * `docs/community/discourse-export.json` into the native forum tables.
 *
 * ⚠️ A TARGET, NOT A MIGRATION (MG-1.3). A Prisma migration runs exactly once
 * and re-runnability is a requirement here: the export has already been
 * re-captured once (`a22b03eb6` corrected `6614f9e92`), and the next correction
 * must be applyable without a database reset.
 *
 * ⚠️ IT READS ONLY THE COMMITTED EXPORT (MG-1.1). Never a Discourse container,
 * never a live instance. The forum this content came from was destroyed on
 * 2026-08-04; the export file is now the sole source of truth, and correctness is
 * proven by comparing the database against that file rather than against a
 * service someone can turn off.
 *
 * ⚠️ IT READS ONLY EACH POST'S `raw` (AD-8, MG-1.9, NFR-S10). Discourse's
 * pre-rendered HTML field is not destructured, not referenced and not logged
 * anywhere in this directory — `discourse-export.schema.ts` does not even declare
 * it, so it is stripped at parse time and there is nothing left downstream to
 * read. Ptah renders member content through `libs/frontend/markdown`, a markdown
 * chokepoint; putting HTML through it would be a sanitiser mismatch, and this
 * quarantine is what makes "no HTML in the pipeline" total.
 *
 * ⚠️ THE 10 "Day N" TOPICS ARE NOT IMPORTED AS FORUM TOPICS. Batch 11 turns them
 * into ONE `Course`, 10 `CourseModule` rows and 10 `Lesson` rows in this same
 * transaction (MG-1.5, §7.3). See `IMPORTED_TOPIC_IDS` / `CURRICULUM_TOPIC_IDS`
 * for the split and `map-course.ts` for the mapping. Every source topic is
 * therefore written exactly once, in exactly one shape.
 *
 * Usage:
 *   npx nx run ptah-license-server:seed-community
 *   npx nx run ptah-license-server:seed-community --args="--refresh-bodies"
 */
import { resolve } from 'node:path';
import {
  EXPECTED_POST_COUNT,
  EXPECTED_TOPIC_COUNT,
  ExportValidationError,
  readDiscourseExport,
  type DiscourseExport,
} from './discourse-export.schema';
import {
  buildCategoryRows,
  MissingDefaultCohortError,
  type CategorySeedRow,
} from './map-categories';
import {
  buildTopicRows,
  CURRICULUM_TOPIC_IDS,
  IMPORTED_TOPIC_IDS,
  type TopicSeedRow,
} from './map-topics';
import {
  buildCourseRows,
  CourseMappingError,
  type CourseModuleSeedRow,
  type CourseSeedRow,
} from './map-course';
import {
  emptyCounts,
  formatSummary,
  type EntityCounts,
  type RefreshedBody,
  type SeedSummary,
} from './summary';
import {
  createSeedPrismaClient,
  MissingDatabaseUrlError,
} from './prisma-client';

/** The one content source (MG-1.1), relative to this file. */
export const EXPORT_PATH = resolve(
  __dirname,
  '../../../../docs/community/discourse-export.json',
);

export interface SeedOptions {
  /**
   * Overwrite `bodyMarkdown` on rows that already exist (§7.4).
   *
   * ⚠️ DEFAULT OFF, AND IT MUST STAY OFF. A re-run must not clobber a member's
   * or an admin's subsequent edit. With `raw` as a lossless source of truth,
   * "re-import the authored markdown, discarding in-product edits" is a coherent
   * operation — which is why the flag exists at all — but the operator has to
   * type the destructive intent rather than inherit it, and every overwrite is
   * logged per row.
   */
  readonly refreshBodies: boolean;
  /** Overridable so the spec can point at a fixture. */
  readonly exportPath: string;
}

// ---------------------------------------------------------------------------
// The Prisma surface this seed uses.
//
// ⚠️ A STRUCTURAL TYPE, NOT `PrismaClient`. It names exactly the six delegates
// and three verbs the seed touches, which is what lets `community-seed.spec.ts`
// drive the real write path against a recording double — and therefore assert
// "a malformed fixture writes NOTHING" as zero recorded calls, rather than as an
// absence of rows that an empty table would also produce.
// ---------------------------------------------------------------------------

interface Delegate<TRow> {
  findUnique(args: unknown): Promise<TRow | null>;
  create(args: unknown): Promise<TRow>;
  update(args: unknown): Promise<TRow>;
}

interface CategoryRow {
  id: string;
  slug: string;
}
interface TopicRow {
  id: string;
  slug: string;
}
interface PostRow {
  id: string;
  bodyMarkdown: string;
}
interface CourseRow {
  id: string;
  slug: string;
}
interface CourseModuleRow {
  id: string;
  slug: string;
}
interface LessonRow {
  id: string;
  bodyMarkdown: string;
}

export interface SeedTransactionClient {
  category: Delegate<CategoryRow>;
  topic: Delegate<TopicRow>;
  post: Delegate<PostRow>;
  /**
   * Batch 11's three delegates. Added to the same STRUCTURAL type on purpose:
   * the recording double in `community-seed.spec.ts` is typed against this
   * interface, so it picks them up without a second stand-in and the "wrote
   * nothing" proofs keep covering the writes this batch added.
   */
  course: Delegate<CourseRow>;
  courseModule: Delegate<CourseModuleRow>;
  lesson: Delegate<LessonRow>;
}

export interface SeedPrismaClient {
  memberGroup: {
    findFirst(args: unknown): Promise<{ key: string } | null>;
  };
  $transaction<T>(
    fn: (tx: SeedTransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
}

export interface SeedResult {
  readonly summary: SeedSummary;
  readonly categories: EntityCounts;
  readonly topics: EntityCounts;
  readonly posts: EntityCounts;
  readonly courses: EntityCounts;
  readonly modules: EntityCounts;
  readonly lessons: EntityCounts;
}

/**
 * Resolve the cohort key the `cohort` category AND the curriculum course are
 * gated on (MG-1.4, MG-1.5, RISK-G).
 *
 * ⚠️ NEVER HARD-CODED, AND THE ABORT IS NOT NEGOTIABLE. `founding` is the
 * current value, but the check is the control that stops a cohort-gated category
 * or course from being seeded wide open: `cohortKeys: []` on a `cohort` row means
 * "gated on nothing", which the visibility resolver reads as visible to every
 * entitled member.
 *
 * ⚠️ ONE RESOLVER, USED TWICE. Task 11.3 is explicit that the course reuses this
 * rather than adding a second lookup — two resolvers can disagree, and the one
 * that disagrees quietly is the one that ungates the curriculum.
 */
async function resolveCohortKey(prisma: SeedPrismaClient): Promise<string> {
  const group = await prisma.memberGroup.findFirst({
    where: { isDefault: true },
    select: { key: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!group) throw new MissingDefaultCohortError();
  return group.key;
}

/**
 * Run the import.
 *
 * ⚠️ ONE `$transaction` FOR THE WHOLE IMPORT (§7.4). A mid-run failure — a
 * constraint violation on topic 7 of 9 — leaves the database exactly as it was,
 * rather than leaving an operator to work out which half landed.
 *
 * ⚠️ IT IS `findUnique` + `create`/`update`, NOT `upsert`, AND THAT IS A
 * DELIBERATE DEPARTURE FROM §7.4's WORDING. The natural-key property AD-15
 * actually requires is preserved exactly — every read and every write is keyed on
 * `Category.slug`, `Topic.slug` or `Post @@unique([topicId, postNumber])`, and no
 * synthetic `sourceRef` column exists (RK-1 rejected one). What `upsert` cannot
 * do is tell the caller WHICH branch it took, and "a second run produces zero
 * creates" is the exit gate's central observable. An `upsert`-based seed reports
 * the same summary whether it created 9 topics or updated 9, which is precisely
 * the failure mode the idempotency check exists to catch. The pre-read also
 * supplies the before-image that `--refresh-bodies` logs per row.
 */
export async function runCommunitySeed(
  prisma: SeedPrismaClient,
  options: SeedOptions,
): Promise<SeedResult> {
  // MG-1.2: the WHOLE file is validated before a single write. A malformed
  // export aborts here, with the database untouched and the transaction never
  // opened.
  const exportData: DiscourseExport = readDiscourseExport(options.exportPath);

  const cohortKey = await resolveCohortKey(prisma);
  const categoryRows = buildCategoryRows(exportData, cohortKey);
  const { topics: topicRows, skippedEmptyBodies } = buildTopicRows(exportData);
  const { course: courseRow, modules: moduleRows } = buildCourseRows(
    exportData,
    cohortKey,
  );

  const categories = emptyCounts();
  const topics = emptyCounts();
  const posts = emptyCounts();
  const courses = emptyCounts();
  const modules = emptyCounts();
  const lessons = emptyCounts();
  const refreshedBodies: RefreshedBody[] = [];

  await prisma.$transaction(
    async (tx) => {
      const categoryIdBySourceId = await writeCategories(
        tx,
        categoryRows,
        categories,
      );

      for (const topic of topicRows) {
        const categoryId = categoryIdBySourceId.get(topic.categorySourceId);
        if (!categoryId) {
          throw new Error(
            `Topic "${topic.slug}" maps to source category ${topic.categorySourceId}, ` +
              'which CATEGORY_MAPPING does not cover. MG-1.4 must map every category a ' +
              'seeded topic lives in.',
          );
        }
        await writeTopic(tx, topic, categoryId, topics, posts, {
          refreshBodies: options.refreshBodies,
          refreshedBodies,
        });
      }

      // ⚠️ THE CURRICULUM WRITES COME LAST AND DO NOT INTERLEAVE WITH THE FORUM
      // WRITES. Two independent write groups inside one transaction is what makes
      // a partial failure unambiguous: whatever aborts, the whole import rolls
      // back, and the recorded call sequence reads as two blocks rather than as
      // a shuffle nobody can reason about.
      await writeCourse(tx, courseRow, moduleRows, courses, modules, lessons, {
        refreshBodies: options.refreshBodies,
        refreshedBodies,
      });
    },
    // The default 5s interactive-transaction budget is tight for ~60 round trips
    // over a cold pool; a timeout here would look like a mapping bug rather than
    // a budget. Batch 11 adds 1 + 10 + 10 natural-key reads and the same number of
    // writes — ~42 more round trips, ~98 in total. Measured wall time for the
    // whole transaction on this workspace stayed well inside a second, so the
    // 60s ceiling is left where Batch 8 set it: it was already ~60x the observed
    // cost and raising it further would only delay a real hang.
    { maxWait: 10_000, timeout: 60_000 },
  );

  const importedBodies = topicRows.reduce((n, t) => n + t.posts.length, 0);
  const curriculumBodies = moduleRows.length;
  const accountedPosts =
    importedBodies + skippedEmptyBodies.length + curriculumBodies;

  const summary: SeedSummary = {
    entities: [
      { label: 'categories', counts: categories },
      { label: 'topics', counts: topics },
      { label: 'posts', counts: posts },
      { label: 'courses', counts: courses },
      { label: 'modules', counts: modules },
      { label: 'lessons', counts: lessons },
    ],
    unmatchedUsernames: collectUnmatchedUsernames(exportData),
    bodies: {
      // Both halves now, because both are written by this run: 10 forum post
      // bodies + 10 lesson bodies = 20, the export's non-empty ones.
      imported: importedBodies + curriculumBodies,
      total: importedBodies + curriculumBodies,
      transformed: 0,
    },
    skippedEmptyBodies,
    refreshedBodies,
    // ⚠️ EVERY NUMBER BELOW IS COMPUTED, NOT RESTATED. `19`, `21`, `9`, `10` and
    // `10` are all derived from the census constants and the mapped rows, so a
    // re-captured export moves the line instead of making it a lie. Task 11.4.
    // TASK_2026_202 is the proof: the eight-week → ten-day restructure moved
    // every one of those numbers and not one character of the code below.
    assertions: [
      `source topics ${EXPECTED_TOPIC_COUNT} = ${CURRICULUM_TOPIC_IDS.length} curriculum + ` +
        `${IMPORTED_TOPIC_IDS.length} topics ${
          CURRICULUM_TOPIC_IDS.length + IMPORTED_TOPIC_IDS.length ===
          EXPECTED_TOPIC_COUNT
            ? 'OK'
            : 'MISMATCH'
        }`,
      `source posts ${EXPECTED_POST_COUNT} = ${importedBodies} written + ` +
        `${skippedEmptyBodies.length} skipped (empty source body) + ` +
        `${curriculumBodies} curriculum bodies ${
          accountedPosts === EXPECTED_POST_COUNT ? 'OK' : 'MISMATCH'
        }`,
    ],
  };

  return { summary, categories, topics, posts, courses, modules, lessons };
}

/**
 * MG-1.8 / A-4. Every source username that matches no `User`.
 *
 * ⚠️ IT DOES NOT QUERY `User` AND MUST NOT CREATE ONE. Fabricating placeholder
 * accounts would pollute the one table entitlement derives from (A-2), so the
 * seed treats every source author as unmatched by construction: `authorId` is
 * `null` on every row it writes, rendered as the "Ptah Team" system author. The
 * counts describe the SOURCE, which is why the total is 19 while this run writes
 * fewer — Batch 11 writes the remainder from the same posts.
 */
function collectUnmatchedUsernames(
  exportData: DiscourseExport,
): SeedSummary['unmatchedUsernames'] {
  const counts = new Map<string, number>();
  for (const topic of exportData.topics) {
    for (const post of topic.posts) {
      counts.set(post.username, (counts.get(post.username) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([username, postCount]) => ({ username, postCount }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

/** The `--refresh-bodies` decision plus the one log both writers append to. */
interface BodyPolicy {
  refreshBodies: boolean;
  refreshedBodies: RefreshedBody[];
}

async function writeCategories(
  tx: SeedTransactionClient,
  rows: readonly CategorySeedRow[],
  counts: EntityCounts,
): Promise<Map<number, string>> {
  const idBySourceId = new Map<number, string>();

  for (const row of rows) {
    const existing = await tx.category.findUnique({
      where: { slug: row.slug },
      select: { id: true, slug: true },
    });

    const data = {
      slug: row.slug,
      name: row.name,
      description: row.description,
      sortOrder: row.sortOrder,
      visibility: row.visibility,
      cohortKeys: [...row.cohortKeys],
    };

    if (existing) {
      const updated = await tx.category.update({
        where: { slug: row.slug },
        data,
        select: { id: true, slug: true },
      });
      counts.updated += 1;
      idBySourceId.set(row.sourceId, updated.id);
    } else {
      const created = await tx.category.create({
        data,
        select: { id: true, slug: true },
      });
      counts.created += 1;
      idBySourceId.set(row.sourceId, created.id);
    }
  }

  return idBySourceId;
}

async function writeTopic(
  tx: SeedTransactionClient,
  row: TopicSeedRow,
  categoryId: string,
  topicCounts: EntityCounts,
  postCounts: EntityCounts,
  bodyPolicy: BodyPolicy,
): Promise<void> {
  const existing = await tx.topic.findUnique({
    where: { slug: row.slug },
    select: { id: true, slug: true },
  });

  // ⚠️ `createdAt` AND `lastPostedAt` ARE WRITTEN EXPLICITLY, ON BOTH BRANCHES
  // (MG-1.7). `Topic.createdAt` carries `@default(now())`; a row that falls
  // through to the default loses the exact property the exit gate checks, and it
  // loses it invisibly — the timestamp is still plausible, just wrong.
  const data = {
    categoryId,
    title: row.title,
    pinned: row.pinned,
    authorId: row.authorId,
    postCount: row.postCount,
    lastPostedAt: row.lastPostedAt,
    createdAt: row.createdAt,
  };

  let topicId: string;
  if (existing) {
    const updated = await tx.topic.update({
      where: { slug: row.slug },
      data,
      select: { id: true, slug: true },
    });
    topicCounts.updated += 1;
    topicId = updated.id;
  } else {
    const created = await tx.topic.create({
      data: { ...data, slug: row.slug },
      select: { id: true, slug: true },
    });
    topicCounts.created += 1;
    topicId = created.id;
  }

  for (const post of row.posts) {
    const existingPost = await tx.post.findUnique({
      where: {
        topicId_postNumber: { topicId, postNumber: post.postNumber },
      },
      select: { id: true, bodyMarkdown: true },
    });

    if (!existingPost) {
      await tx.post.create({
        data: {
          topicId,
          postNumber: post.postNumber,
          bodyMarkdown: post.bodyMarkdown,
          authorId: post.authorId,
          parentId: post.parentId,
          createdAt: post.createdAt,
        },
        select: { id: true, bodyMarkdown: true },
      });
      postCounts.created += 1;
      continue;
    }

    // ⚠️ `bodyMarkdown` IS EXCLUDED FROM THE UPDATE PAYLOAD UNLESS
    // `--refresh-bodies` IS PASSED (§7.4). This is the whole reason a re-run is
    // safe to point at production: an admin who fixed a typo in a seeded post
    // keeps the fix.
    const shouldRefresh =
      bodyPolicy.refreshBodies &&
      existingPost.bodyMarkdown !== post.bodyMarkdown;

    if (shouldRefresh) {
      bodyPolicy.refreshedBodies.push({
        kind: 'post',
        topicSlug: row.slug,
        postNumber: post.postNumber,
        previousLength: existingPost.bodyMarkdown.length,
        newLength: post.bodyMarkdown.length,
      });
    }

    await tx.post.update({
      where: {
        topicId_postNumber: { topicId, postNumber: post.postNumber },
      },
      data: {
        authorId: post.authorId,
        parentId: post.parentId,
        createdAt: post.createdAt,
        ...(shouldRefresh ? { bodyMarkdown: post.bodyMarkdown } : {}),
      },
      select: { id: true, bodyMarkdown: true },
    });
    postCounts.updated += 1;
  }
}

/**
 * Write the course, its modules and their lessons (MG-1.5, §7.3, Task 11.3).
 *
 * ⚠️ NATURAL KEYS ONLY (AD-15), AND THEY ARE THE SCHEMA'S OWN UNIQUES:
 * `Course.slug`, `CourseModule @@unique([courseId, slug])` and
 * `Lesson @@unique([moduleId, slug])`. No synthetic `sourceRef` column exists —
 * RK-1 rejected one — so the course's identity is the slug an operator can read
 * in a URL, and a module's is its position in a course rather than a row id that
 * changes every time the seed is re-pointed at a fresh database. That is why a
 * second run updates in place instead of orphaning run 1's rows.
 *
 * ⚠️ `findUnique` + `create`/`update`, NOT `upsert` — Batch 8's Finding 4,
 * unchanged. "A second run produces zero creates" is the exit gate's central
 * observable and `upsert` cannot report which branch it took.
 *
 * ⚠️ THE UPDATE PAYLOADS ARE DELIBERATELY NARROWER THAN THE CREATE PAYLOADS.
 * `bodyMarkdown` is excluded unless `--refresh-bodies` is passed (§7.4), and so
 * are three columns the seed has no business owning after the first run:
 *   - `Course.createdBy` — null here (A-4); an admin may since have claimed it;
 *   - `CourseModule.releaseAt` — R2.4.1's release schedule. Re-running the seed
 *     must not silently unschedule ten modules an admin has date-gated. ⚠️ THIS
 *     EXCLUSION IS MORE IMPORTANT AFTER TASK_2026_202, NOT LESS: the schedule is
 *     now set by `POST /v1/admin/course-modules/schedule` from one cohort start
 *     date, so the seed and the scheduler are two writers of one column and only
 *     the scheduler owns it. Seeded modules are created open (`releaseAt = null`)
 *     and stay that way until an admin deliberately applies a schedule;
 *   - `Lesson.youtubeVideoId` and the video columns — an admin may have attached
 *     a recording, and clobbering it back to null would also reset every member's
 *     completion basis for that lesson (ASSUMPTION-8).
 * Every one of those is the same class of harm the `bodyMarkdown` exclusion
 * exists to prevent: a re-run destroying work done in the product.
 */
async function writeCourse(
  tx: SeedTransactionClient,
  courseRow: CourseSeedRow,
  moduleRows: readonly CourseModuleSeedRow[],
  courseCounts: EntityCounts,
  moduleCounts: EntityCounts,
  lessonCounts: EntityCounts,
  bodyPolicy: BodyPolicy,
): Promise<void> {
  const existingCourse = await tx.course.findUnique({
    where: { slug: courseRow.slug },
    select: { id: true, slug: true },
  });

  const courseData = {
    title: courseRow.title,
    description: courseRow.description,
    visibility: courseRow.visibility,
    cohortKeys: [...courseRow.cohortKeys],
    published: courseRow.published,
    sequential: courseRow.sequential,
    sortOrder: courseRow.sortOrder,
  };

  let courseId: string;
  if (existingCourse) {
    const updated = await tx.course.update({
      where: { slug: courseRow.slug },
      data: courseData,
      select: { id: true, slug: true },
    });
    courseCounts.updated += 1;
    courseId = updated.id;
  } else {
    const created = await tx.course.create({
      // ⚠️ `Course.createdAt` IS NOT SET AND THAT IS THE DECISION, NOT AN
      // OVERSIGHT. §7.3 specifies source timestamps for topics and posts
      // (MG-1.7) and says nothing about the course, because the course is a new
      // editorial object assembled in 2026-08 from eight threads written across
      // three weeks. Stamping it with one of their instants would be a
      // fabricated claim about when the curriculum was authored. It falls
      // through to `@default(now())`. See `map-course.ts`.
      data: {
        ...courseData,
        slug: courseRow.slug,
        createdBy: courseRow.createdBy,
      },
      select: { id: true, slug: true },
    });
    courseCounts.created += 1;
    courseId = created.id;
  }

  for (const module of moduleRows) {
    const existingModule = await tx.courseModule.findUnique({
      where: { courseId_slug: { courseId, slug: module.slug } },
      select: { id: true, slug: true },
    });

    const moduleData = {
      title: module.title,
      sortOrder: module.sortOrder,
    };

    let moduleId: string;
    if (existingModule) {
      const updated = await tx.courseModule.update({
        where: { courseId_slug: { courseId, slug: module.slug } },
        data: moduleData,
        select: { id: true, slug: true },
      });
      moduleCounts.updated += 1;
      moduleId = updated.id;
    } else {
      // `CourseModule.createdAt` also falls through to `@default(now())`: a
      // module's identity is its MG-1.5 title, which no source topic supplies.
      const created = await tx.courseModule.create({
        data: { ...moduleData, courseId, slug: module.slug },
        select: { id: true, slug: true },
      });
      moduleCounts.created += 1;
      moduleId = created.id;
    }

    await writeLesson(tx, module, moduleId, lessonCounts, bodyPolicy);
  }
}

async function writeLesson(
  tx: SeedTransactionClient,
  module: CourseModuleSeedRow,
  moduleId: string,
  lessonCounts: EntityCounts,
  bodyPolicy: BodyPolicy,
): Promise<void> {
  const lesson = module.lesson;
  const existing = await tx.lesson.findUnique({
    where: { moduleId_slug: { moduleId, slug: lesson.slug } },
    select: { id: true, bodyMarkdown: true },
  });

  if (!existing) {
    await tx.lesson.create({
      // ⚠️ `createdAt` IS WRITTEN EXPLICITLY. Unlike the course and the module,
      // a lesson IS a source body, so its date is a true fact about it (MG-1.7's
      // principle). A row that fell through to `@default(now())` would carry a
      // plausible-looking wrong timestamp — the failure mode that is invisible
      // in review.
      data: {
        moduleId,
        slug: lesson.slug,
        title: lesson.title,
        bodyMarkdown: lesson.bodyMarkdown,
        sortOrder: lesson.sortOrder,
        youtubeVideoId: lesson.youtubeVideoId,
        videoDurationSeconds: lesson.videoDurationSeconds,
        createdAt: lesson.createdAt,
      },
      select: { id: true, bodyMarkdown: true },
    });
    lessonCounts.created += 1;
    return;
  }

  const shouldRefresh =
    bodyPolicy.refreshBodies && existing.bodyMarkdown !== lesson.bodyMarkdown;

  if (shouldRefresh) {
    bodyPolicy.refreshedBodies.push({
      kind: 'lesson',
      moduleSlug: module.slug,
      lessonSlug: lesson.slug,
      previousLength: existing.bodyMarkdown.length,
      newLength: lesson.bodyMarkdown.length,
    });
  }

  await tx.lesson.update({
    where: { moduleId_slug: { moduleId, slug: lesson.slug } },
    data: {
      title: lesson.title,
      sortOrder: lesson.sortOrder,
      createdAt: lesson.createdAt,
      ...(shouldRefresh ? { bodyMarkdown: lesson.bodyMarkdown } : {}),
    },
    select: { id: true, bodyMarkdown: true },
  });
  lessonCounts.updated += 1;
}

/**
 * Parse the CLI. `--refresh-bodies` and nothing else (Task 8.2) — no `--force`,
 * no `--reset`. An unrecognised flag aborts rather than being ignored, because a
 * misspelled `--refresh-bodys` that silently does nothing is worse than one that
 * fails.
 */
export function parseArgs(argv: readonly string[]): { refreshBodies: boolean } {
  let refreshBodies = false;
  for (const arg of argv) {
    if (arg === '--refresh-bodies') {
      refreshBodies = true;
      continue;
    }
    throw new Error(
      `Unrecognised argument "${arg}". The community seed accepts only --refresh-bodies.`,
    );
  }
  return { refreshBodies };
}

async function main(): Promise<void> {
  const { refreshBodies } = parseArgs(process.argv.slice(2));
  const prisma = createSeedPrismaClient();
  try {
    const { summary } = await runCommunitySeed(
      prisma as unknown as SeedPrismaClient,
      { refreshBodies, exportPath: EXPORT_PATH },
    );
    process.stdout.write(`${formatSummary(summary)}\n`);
  } finally {
    // A `ts-node` process holding an open `pg` pool never exits, and a seed that
    // appears to hang after printing its summary is indistinguishable from one
    // that is still writing.
    await (prisma as unknown as { $disconnect(): Promise<void> }).$disconnect();
  }
}

// ⚠️ GUARDED SO THE SPEC CAN IMPORT THIS MODULE WITHOUT OPENING A SOCKET.
if (require.main === module) {
  main().catch((error: unknown) => {
    if (error instanceof MissingDatabaseUrlError) {
      process.stderr.write(`\n[community-seed] ${error.message}\n`);
    } else if (error instanceof MissingDefaultCohortError) {
      process.stderr.write(`\n[community-seed] ${error.message}\n`);
    } else if (error instanceof ExportValidationError) {
      process.stderr.write(`\n[community-seed] ${error.message}\n`);
    } else if (error instanceof CourseMappingError) {
      // A content problem, not a bug: print the remedy, not a stack.
      process.stderr.write(`\n[community-seed] ${error.message}\n`);
    } else {
      process.stderr.write(
        `\n[community-seed] ${
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
        }\n`,
      );
    }
    // ⚠️ NON-ZERO ON ABORT. A seed that reports failure on stdout and exits 0
    // will be chained into a deploy script and believed.
    process.exit(1);
  });
}
