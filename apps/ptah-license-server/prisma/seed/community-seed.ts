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
 * ⚠️ THE 8 "Week N" TOPICS ARE DELIBERATELY NOT IMPORTED HERE. They become a
 * course in Batch 11 against this same module. See `IMPORTED_TOPIC_IDS`.
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
  emptyCounts,
  formatSummary,
  type EntityCounts,
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

export interface SeedTransactionClient {
  category: Delegate<CategoryRow>;
  topic: Delegate<TopicRow>;
  post: Delegate<PostRow>;
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
}

/**
 * Resolve the cohort key the one `cohort` category is gated on (MG-1.4, RISK-G).
 *
 * ⚠️ NEVER HARD-CODED, AND THE ABORT IS NOT NEGOTIABLE. `founding` is the
 * current value, but the check is the control that stops a cohort-gated category
 * from being seeded wide open: `cohortKeys: []` on a `cohort` category means
 * "gated on nothing", which the visibility resolver reads as visible to every
 * entitled member.
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

  const categories = emptyCounts();
  const topics = emptyCounts();
  const posts = emptyCounts();
  const refreshedBodies: SeedSummary['refreshedBodies'][number][] = [];

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
    },
    // The default 5s interactive-transaction budget is tight for ~60 round
    // trips over a cold pool; a timeout here would look like a mapping bug.
    { maxWait: 10_000, timeout: 60_000 },
  );

  const importedBodies = topicRows.reduce((n, t) => n + t.posts.length, 0);

  const summary: SeedSummary = {
    entities: [
      { label: 'categories', counts: categories },
      { label: 'topics', counts: topics },
      { label: 'posts', counts: posts },
    ],
    unmatchedUsernames: collectUnmatchedUsernames(exportData),
    bodies: {
      imported: importedBodies,
      total: importedBodies,
      transformed: 0,
    },
    skippedEmptyBodies,
    refreshedBodies,
    assertions: [
      `source topics ${EXPECTED_TOPIC_COUNT} = ${CURRICULUM_TOPIC_IDS.length} curriculum (batch 11) + ` +
        `${IMPORTED_TOPIC_IDS.length} topics ${
          CURRICULUM_TOPIC_IDS.length + IMPORTED_TOPIC_IDS.length ===
          EXPECTED_TOPIC_COUNT
            ? 'OK'
            : 'MISMATCH'
        }`,
      `source posts ${EXPECTED_POST_COUNT} = ${importedBodies} written here + ` +
        `${skippedEmptyBodies.length} skipped (empty source body) + ` +
        `${
          EXPECTED_POST_COUNT - importedBodies - skippedEmptyBodies.length
        } curriculum bodies (batch 11) ${
          importedBodies +
            skippedEmptyBodies.length +
            (EXPECTED_POST_COUNT -
              importedBodies -
              skippedEmptyBodies.length) ===
          EXPECTED_POST_COUNT
            ? 'OK'
            : 'MISMATCH'
        }`,
    ],
  };

  return { summary, categories, topics, posts };
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
  bodyPolicy: {
    refreshBodies: boolean;
    refreshedBodies: SeedSummary['refreshedBodies'][number][];
  },
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
