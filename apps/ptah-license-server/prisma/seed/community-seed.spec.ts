/**
 * The RK-9 mitigation — TASK_2026_177 Task 8.7, plan §7.6.
 *
 * RK-9 is "the migration silently mangles the content". Every assertion below
 * exists because the original defect — 19 posts imported with `null` bodies —
 * was caught by a human noticing, months later, that the forum looked empty. The
 * verification the plan originally specified (compare the seeded database
 * against the live Discourse container) is no longer possible: production was
 * destroyed on 2026-08-04 and the local container was deleted. This file is the
 * replacement, and it is a better check — it compares against the committed
 * export file, so it is reproducible, runs in CI, and does not depend on a
 * service anyone can turn off.
 *
 * ⚠️ THE WRITE PATH IS EXERCISED FOR REAL, AGAINST A RECORDING DOUBLE. Asserting
 * "the fixture wrote nothing" by counting rows in an empty table proves nothing,
 * because an empty table is also what a seed that never ran produces. The double
 * records every call, so "wrote nothing" is asserted as zero recorded writes.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  EXPECTED_CATEGORY_COUNT,
  EXPECTED_NON_EMPTY_BODY_POSTS,
  EXPECTED_POST_COUNT,
  EXPECTED_TOPIC_COUNT,
  ExportValidationError,
  readDiscourseExport,
  validateDiscourseExport,
} from './discourse-export.schema';
import {
  buildCategoryRows,
  CATEGORY_MAPPING,
  stripHtmlToPlainText,
} from './map-categories';
import {
  buildTopicRows,
  CURRICULUM_TOPIC_IDS,
  IMPORTED_TOPIC_IDS,
} from './map-topics';
import {
  buildCourseRows,
  COURSE_SLUG,
  COURSE_TITLE,
  COURSE_SORT_ORDER,
  CourseMappingError,
  MODULE_TITLES,
  SORT_ORDER_STEP,
} from './map-course';
import {
  EXPORT_PATH,
  parseArgs,
  runCommunitySeed,
  type SeedPrismaClient,
  type SeedTransactionClient,
} from './community-seed';
import { formatSummary } from './summary';

const SEED_DIR = __dirname;
const FIXTURES = join(SEED_DIR, '__fixtures__');
const DEFAULT_COHORT_KEY = 'founding';

/** The raw export text, read once. Never mutated in place. */
const exportText = readFileSync(EXPORT_PATH, 'utf8');

// ---------------------------------------------------------------------------
// The recording double
// ---------------------------------------------------------------------------

interface RecordedCall {
  model: string;
  verb: string;
  args: Record<string, unknown>;
}

interface StoredPost {
  id: string;
  topicId: string;
  postNumber: number;
  bodyMarkdown: string;
  authorId: string | null;
  parentId: string | null;
  createdAt: Date;
}

interface StoredTopic {
  id: string;
  slug: string;
  title: string;
  categoryId: string;
  pinned: boolean;
  postCount: number;
  authorId: string | null;
  createdAt: Date;
  lastPostedAt: Date;
}

interface StoredCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  visibility: string;
  cohortKeys: string[];
}

interface StoredCourse {
  id: string;
  slug: string;
  title: string;
  description: string;
  visibility: string;
  cohortKeys: string[];
  published: boolean;
  sequential: boolean;
  sortOrder: number;
  createdBy: string | null;
  createdAt?: Date;
}

interface StoredModule {
  id: string;
  courseId: string;
  slug: string;
  title: string;
  sortOrder: number;
  releaseAt?: Date | null;
  createdAt?: Date;
}

interface StoredLesson {
  id: string;
  moduleId: string;
  slug: string;
  title: string;
  bodyMarkdown: string;
  sortOrder: number;
  youtubeVideoId: string | null;
  videoDurationSeconds: number | null;
  createdAt: Date;
}

/**
 * An in-memory Prisma stand-in that behaves like the real one for the six
 * verbs the seed uses, keyed on the same natural uniques.
 *
 * ⚠️ IT CARRIES A POISONED `user` DELEGATE. A-4 forbids fabricating a `User`
 * row, and the strongest available proof is a delegate that throws if anything
 * touches it. Omitting `user` from the surface would prove only that the seed
 * does not compile against it, which is a weaker claim than "it does not call
 * it at run time".
 */
function createRecordingPrisma(): {
  client: SeedPrismaClient;
  calls: RecordedCall[];
  categories: Map<string, StoredCategory>;
  topics: Map<string, StoredTopic>;
  posts: Map<string, StoredPost>;
  courses: Map<string, StoredCourse>;
  modules: Map<string, StoredModule>;
  lessons: Map<string, StoredLesson>;
  writes(): RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const categories = new Map<string, StoredCategory>();
  const topics = new Map<string, StoredTopic>();
  /** Keyed `${topicId}#${postNumber}` — the schema's @@unique. */
  const posts = new Map<string, StoredPost>();
  /** Keyed by slug — `Course.slug` is @unique. */
  const courses = new Map<string, StoredCourse>();
  /** Keyed `${courseId}#${slug}` — `@@unique([courseId, slug])`. */
  const modules = new Map<string, StoredModule>();
  /** Keyed `${moduleId}#${slug}` — `@@unique([moduleId, slug])`. */
  const lessons = new Map<string, StoredLesson>();
  let nextId = 1;
  const id = (prefix: string) => `${prefix}_${nextId++}`;

  const record = (model: string, verb: string, args: unknown) =>
    calls.push({ model, verb, args: args as Record<string, unknown> });

  const arg = <T>(args: unknown, key: string): T =>
    (args as Record<string, T>)[key] as T;

  const tx: SeedTransactionClient = {
    category: {
      findUnique: async (args) => {
        record('category', 'findUnique', args);
        const where = arg<{ slug: string }>(args, 'where');
        return categories.get(where.slug) ?? null;
      },
      create: async (args) => {
        record('category', 'create', args);
        const data = arg<Omit<StoredCategory, 'id'>>(args, 'data');
        const row = { ...data, id: id('cat') };
        categories.set(row.slug, row);
        return row;
      },
      update: async (args) => {
        record('category', 'update', args);
        const where = arg<{ slug: string }>(args, 'where');
        const data = arg<Partial<StoredCategory>>(args, 'data');
        const existing = categories.get(where.slug);
        if (!existing) throw new Error(`No category ${where.slug}`);
        const row = { ...existing, ...data };
        categories.set(row.slug, row);
        return row;
      },
    },
    topic: {
      findUnique: async (args) => {
        record('topic', 'findUnique', args);
        const where = arg<{ slug: string }>(args, 'where');
        return topics.get(where.slug) ?? null;
      },
      create: async (args) => {
        record('topic', 'create', args);
        const data = arg<Omit<StoredTopic, 'id'>>(args, 'data');
        const row = { ...data, id: id('topic') };
        topics.set(row.slug, row);
        return row;
      },
      update: async (args) => {
        record('topic', 'update', args);
        const where = arg<{ slug: string }>(args, 'where');
        const data = arg<Partial<StoredTopic>>(args, 'data');
        const existing = topics.get(where.slug);
        if (!existing) throw new Error(`No topic ${where.slug}`);
        const row = { ...existing, ...data };
        topics.set(row.slug, row);
        return row;
      },
    },
    post: {
      findUnique: async (args) => {
        record('post', 'findUnique', args);
        const where = arg<{
          topicId_postNumber: { topicId: string; postNumber: number };
        }>(args, 'where');
        const k = `${where.topicId_postNumber.topicId}#${where.topicId_postNumber.postNumber}`;
        return posts.get(k) ?? null;
      },
      create: async (args) => {
        record('post', 'create', args);
        const data = arg<Omit<StoredPost, 'id'>>(args, 'data');
        const row = { ...data, id: id('post') };
        posts.set(`${row.topicId}#${row.postNumber}`, row);
        return row;
      },
      update: async (args) => {
        record('post', 'update', args);
        const where = arg<{
          topicId_postNumber: { topicId: string; postNumber: number };
        }>(args, 'where');
        const data = arg<Partial<StoredPost>>(args, 'data');
        const k = `${where.topicId_postNumber.topicId}#${where.topicId_postNumber.postNumber}`;
        const existing = posts.get(k);
        if (!existing) throw new Error(`No post ${k}`);
        const row = { ...existing, ...data };
        posts.set(k, row);
        return row;
      },
    },
    // -- Batch 11 -----------------------------------------------------------
    // Picked up from the same STRUCTURAL `SeedTransactionClient`, which is why
    // the abort proofs above now cover the curriculum writes too without a
    // second double.
    course: {
      findUnique: async (args) => {
        record('course', 'findUnique', args);
        const where = arg<{ slug: string }>(args, 'where');
        return courses.get(where.slug) ?? null;
      },
      create: async (args) => {
        record('course', 'create', args);
        const data = arg<Omit<StoredCourse, 'id'>>(args, 'data');
        const row = { ...data, id: id('course') };
        courses.set(row.slug, row);
        return row;
      },
      update: async (args) => {
        record('course', 'update', args);
        const where = arg<{ slug: string }>(args, 'where');
        const data = arg<Partial<StoredCourse>>(args, 'data');
        const existing = courses.get(where.slug);
        if (!existing) throw new Error(`No course ${where.slug}`);
        const row = { ...existing, ...data };
        courses.set(row.slug, row);
        return row;
      },
    },
    courseModule: {
      findUnique: async (args) => {
        record('courseModule', 'findUnique', args);
        const where = arg<{
          courseId_slug: { courseId: string; slug: string };
        }>(args, 'where');
        return (
          modules.get(
            `${where.courseId_slug.courseId}#${where.courseId_slug.slug}`,
          ) ?? null
        );
      },
      create: async (args) => {
        record('courseModule', 'create', args);
        const data = arg<Omit<StoredModule, 'id'>>(args, 'data');
        const row = { ...data, id: id('module') };
        modules.set(`${row.courseId}#${row.slug}`, row);
        return row;
      },
      update: async (args) => {
        record('courseModule', 'update', args);
        const where = arg<{
          courseId_slug: { courseId: string; slug: string };
        }>(args, 'where');
        const data = arg<Partial<StoredModule>>(args, 'data');
        const k = `${where.courseId_slug.courseId}#${where.courseId_slug.slug}`;
        const existing = modules.get(k);
        if (!existing) throw new Error(`No module ${k}`);
        const row = { ...existing, ...data };
        modules.set(k, row);
        return row;
      },
    },
    lesson: {
      findUnique: async (args) => {
        record('lesson', 'findUnique', args);
        const where = arg<{
          moduleId_slug: { moduleId: string; slug: string };
        }>(args, 'where');
        return (
          lessons.get(
            `${where.moduleId_slug.moduleId}#${where.moduleId_slug.slug}`,
          ) ?? null
        );
      },
      create: async (args) => {
        record('lesson', 'create', args);
        const data = arg<Omit<StoredLesson, 'id'>>(args, 'data');
        const row = { ...data, id: id('lesson') };
        lessons.set(`${row.moduleId}#${row.slug}`, row);
        return row;
      },
      update: async (args) => {
        record('lesson', 'update', args);
        const where = arg<{
          moduleId_slug: { moduleId: string; slug: string };
        }>(args, 'where');
        const data = arg<Partial<StoredLesson>>(args, 'data');
        const k = `${where.moduleId_slug.moduleId}#${where.moduleId_slug.slug}`;
        const existing = lessons.get(k);
        if (!existing) throw new Error(`No lesson ${k}`);
        const row = { ...existing, ...data };
        lessons.set(k, row);
        return row;
      },
    },
  };

  const client = {
    memberGroup: {
      findFirst: async (args: unknown) => {
        record('memberGroup', 'findFirst', args);
        return { key: DEFAULT_COHORT_KEY };
      },
    },
    // A-4: touching this is a test failure, not a silent placeholder user.
    user: new Proxy(
      {},
      {
        get(_t, prop) {
          throw new Error(
            `The seed touched prisma.user.${String(prop)}(). A-4 forbids ` +
              'fabricating a User row: User is the table entitlement derives from (A-2).',
          );
        },
      },
    ),
    $transaction: async <T>(fn: (t: SeedTransactionClient) => Promise<T>) => {
      record('$transaction', 'open', {});
      return fn(tx);
    },
  } as unknown as SeedPrismaClient;

  const WRITE_VERBS = new Set(['create', 'update']);
  return {
    client,
    calls,
    categories,
    topics,
    posts,
    courses,
    modules,
    lessons,
    writes: () => calls.filter((c) => WRITE_VERBS.has(c.verb)),
  };
}

/** Copy the real export to a temp file after applying one mutation. */
function fixtureFromExport(
  name: string,
  mutate: (parsed: Record<string, never>) => void,
): string {
  const parsed = JSON.parse(exportText);
  mutate(parsed);
  const path = join(tmpdir(), `ptah-seed-${name}-${process.pid}.json`);
  writeFileSync(path, JSON.stringify(parsed), 'utf8');
  return path;
}

const seed = (client: SeedPrismaClient, exportPath: string, refresh = false) =>
  runCommunitySeed(client, { refreshBodies: refresh, exportPath });

// ---------------------------------------------------------------------------

describe('community seed — MG-1', () => {
  describe('assertion 1: the census (MG-1.6)', () => {
    it('the export holds exactly 4 categories, 19 topics and 21 posts', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      expect(data.categories).toHaveLength(EXPECTED_CATEGORY_COUNT);
      expect(data.topics).toHaveLength(EXPECTED_TOPIC_COUNT);
      expect(data.topics.reduce((n, t) => n + t.posts.length, 0)).toBe(
        EXPECTED_POST_COUNT,
      );
    });

    it('the 19 source topics split into 10 curriculum + 9 imported, with no overlap', () => {
      expect(CURRICULUM_TOPIC_IDS).toHaveLength(10);
      expect(IMPORTED_TOPIC_IDS).toHaveLength(9);
      expect(CURRICULUM_TOPIC_IDS.length + IMPORTED_TOPIC_IDS.length).toBe(
        EXPECTED_TOPIC_COUNT,
      );
      const overlap = IMPORTED_TOPIC_IDS.filter((id) =>
        CURRICULUM_TOPIC_IDS.includes(id),
      );
      expect(overlap).toEqual([]);

      const data = readDiscourseExport(EXPORT_PATH);
      const sourceIds = data.topics.map((t) => t.id).sort((a, b) => a - b);
      const covered = [...IMPORTED_TOPIC_IDS, ...CURRICULUM_TOPIC_IDS].sort(
        (a, b) => a - b,
      );
      expect(covered).toEqual(sourceIds);
    });

    it('writes 9 topics and 10 posts against a recording double', async () => {
      const db = createRecordingPrisma();
      const result = await seed(db.client, EXPORT_PATH);

      expect(result.categories).toEqual({ created: 4, updated: 0 });
      expect(result.topics).toEqual({ created: 9, updated: 0 });
      // 🔴 10, NOT the exit gate's 11. The export's 11th post — topic 13 post #2
      // — has an empty `raw` and is skipped rather than written as a blank
      // reply. See SKIP_EMPTY_BODY_POSTS in map-topics.ts and the
      // EXPECTED_NON_EMPTY_BODY_POSTS docblock; both record why.
      expect(result.posts).toEqual({ created: 10, updated: 0 });
      expect(result.summary.skippedEmptyBodies).toEqual([
        { topicSlug: 'start-here-how-this-cohort-works', postNumber: 2 },
      ]);
      expect(db.categories.size).toBe(4);
      expect(db.topics.size).toBe(9);
      expect(db.posts.size).toBe(10);
    });

    it('carries 20 non-empty source bodies, which is one fewer than the post count', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      const nonEmpty = data.topics.reduce(
        (n, t) => n + t.posts.filter((p) => p.raw.length > 0).length,
        0,
      );
      expect(nonEmpty).toBe(EXPECTED_NON_EMPTY_BODY_POSTS);
      expect(EXPECTED_NON_EMPTY_BODY_POSTS).toBe(EXPECTED_POST_COUNT - 1);
    });
  });

  describe('byte fidelity — the check the deleted container used to provide', () => {
    it('every mapped bodyMarkdown is byte-for-byte the export raw', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      const sourceByTopicId = new Map(data.topics.map((t) => [t.id, t]));
      const { topics } = buildTopicRows(data);

      let compared = 0;
      for (const topic of topics) {
        const source = sourceByTopicId.get(topic.sourceId);
        expect(source).toBeDefined();
        for (const post of topic.posts) {
          const sourcePost = source?.posts.find(
            (p) => p.postNumber === post.postNumber,
          );
          expect(sourcePost).toBeDefined();
          // Compared as UTF-8 bytes, not as strings: two different strings can
          // compare equal after normalisation, and a normalising transform is
          // exactly the kind of "helpful" change this assertion exists to catch.
          expect(Buffer.from(post.bodyMarkdown, 'utf8')).toEqual(
            Buffer.from(sourcePost?.raw ?? '<missing>', 'utf8'),
          );
          compared++;
        }
      }
      expect(compared).toBe(10);
    });

    /**
     * ⚠️ THIS TEST EXISTS BECAUSE THE ONE ABOVE IS VACUOUS AGAINST THE MOST
     * LIKELY TRANSFORMS, AND THAT WAS PROVEN, NOT ASSUMED. Adding `.trim()` to
     * the mapper leaves all 37 other assertions green: not one of the export's
     * 20 non-empty bodies has leading or trailing whitespace, and none contains
     * a CR. A byte comparison against a corpus that happens to be invariant
     * under a transform cannot detect that transform — the same shape as Batch
     * 6's trigram `EXPLAIN`, which was vacuous at 0 rows.
     *
     * The synthetic body below is deliberately sensitive to every normalisation
     * a well-meaning contributor might add: surrounding whitespace (`.trim()`),
     * CRLF (line-ending normalisation), an HTML entity (entity decoding),
     * a literal tag (tag stripping — correct for `Category.description`, wrong
     * here), a non-ASCII em-dash (re-encoding) and a trailing double newline
     * (paragraph re-wrapping).
     */
    it('preserves a body that is sensitive to every plausible transform', () => {
      const HOSTILE = '  \r\n\t**bold** &amp; <b>tag</b> — em nbsp\r\n\r\n  ';
      const path = fixtureFromExport('hostile-body', (parsed) => {
        const p = parsed as unknown as {
          topics: { posts: { raw: string }[] }[];
        };
        const post = p.topics[0]?.posts[0];
        if (!post) throw new Error('fixture shape changed');
        post.raw = HOSTILE;
      });

      const data = readDiscourseExport(path);
      const { topics } = buildTopicRows(data);
      const mutatedTopicId = data.topics[0]?.id;
      const mapped = topics
        .find((t) => t.sourceId === mutatedTopicId)
        ?.posts.find((p) => p.postNumber === 1);

      expect(mapped).toBeDefined();
      expect(Buffer.from(mapped?.bodyMarkdown ?? '', 'utf8')).toEqual(
        Buffer.from(HOSTILE, 'utf8'),
      );
      expect(mapped?.bodyMarkdown).toBe(HOSTILE);
    });

    it('every mapped timestamp is the source instant, never now()', () => {
      const before = Date.now();
      const data = readDiscourseExport(EXPORT_PATH);
      const sourceByTopicId = new Map(data.topics.map((t) => [t.id, t]));
      const { topics } = buildTopicRows(data);

      for (const topic of topics) {
        const source = sourceByTopicId.get(topic.sourceId);
        expect(topic.createdAt.toISOString()).toBe(
          new Date(source?.createdAt ?? 0).toISOString(),
        );
        // Every source instant predates this test run by months; a row that fell
        // through to @default(now()) would land after `before`.
        expect(topic.createdAt.getTime()).toBeLessThan(before);
        for (const post of topic.posts) {
          const sourcePost = source?.posts.find(
            (p) => p.postNumber === post.postNumber,
          );
          expect(post.createdAt.toISOString()).toBe(
            new Date(sourcePost?.createdAt ?? 0).toISOString(),
          );
        }
      }
    });

    it('writes createdAt explicitly on every topic and post row', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);
      const rowWrites = db
        .writes()
        .filter((c) => c.model === 'topic' || c.model === 'post');
      expect(rowWrites).toHaveLength(19); // 9 topics + 10 posts
      for (const call of rowWrites) {
        expect(call.args['data']).toHaveProperty('createdAt');
        expect(
          (call.args['data'] as { createdAt: Date }).createdAt,
        ).toBeInstanceOf(Date);
      }
    });
  });

  describe('assertion 2: a malformed file aborts and writes nothing (MG-1.2)', () => {
    it('rejects a file that is not JSON', async () => {
      const db = createRecordingPrisma();
      await expect(
        seed(db.client, join(FIXTURES, 'malformed.json')),
      ).rejects.toBeInstanceOf(ExportValidationError);
      expect(db.writes()).toEqual([]);
      expect(db.calls).toEqual([]);
    });

    it('rejects well-formed JSON of the wrong shape', async () => {
      const db = createRecordingPrisma();
      await expect(
        seed(db.client, join(FIXTURES, 'structurally-invalid.json')),
      ).rejects.toBeInstanceOf(ExportValidationError);
      expect(db.writes()).toEqual([]);
    });

    it('rejects a file that does not exist', async () => {
      const db = createRecordingPrisma();
      await expect(
        seed(db.client, join(FIXTURES, 'no-such-file.json')),
      ).rejects.toBeInstanceOf(ExportValidationError);
      expect(db.writes()).toEqual([]);
    });
  });

  describe('assertion 3: a raw:null fixture aborts and writes nothing (RK-9)', () => {
    it('aborts, naming the offending path', async () => {
      const path = fixtureFromExport('raw-null', (parsed) => {
        const p = parsed as unknown as {
          topics: { posts: { raw: string | null }[] }[];
        };
        // The exact shape of the original defect: the body key is present and
        // null, because /t/{id}.json returns the post without its markdown.
        (p.topics[0] as { posts: { raw: string | null }[] }).posts[0].raw =
          null;
      });

      const db = createRecordingPrisma();
      await expect(seed(db.client, path)).rejects.toBeInstanceOf(
        ExportValidationError,
      );
      await expect(seed(db.client, path)).rejects.toThrow(
        /topics\.0\.posts\.0\.raw/,
      );
      expect(db.writes()).toEqual([]);
    });

    it('the same fixture, unmutated, validates — so the abort is caused by the mutation', () => {
      const path = fixtureFromExport('control', () => {
        /* no mutation */
      });
      expect(() => readDiscourseExport(path)).not.toThrow();
    });
  });

  describe('assertion 4: a U+FFFD fixture aborts and writes nothing', () => {
    it('aborts on mojibake that still looks like markdown', async () => {
      const path = fixtureFromExport('mojibake', (parsed) => {
        const p = parsed as unknown as {
          topics: { posts: { raw: string }[] }[];
        };
        const post = p.topics[0]?.posts[0];
        if (!post) throw new Error('fixture shape changed');
        // A mangled em-dash. The body still renders as valid markdown, which is
        // precisely why a human reviewer waves it through.
        post.raw = `Ptah Builders ${String.fromCharCode(0xfffd)} week one`;
      });

      const db = createRecordingPrisma();
      await expect(seed(db.client, path)).rejects.toBeInstanceOf(
        ExportValidationError,
      );
      await expect(seed(db.client, path)).rejects.toThrow(/U\+FFFD/);
      expect(db.writes()).toEqual([]);
    });
  });

  describe('assertion 5: a second run produces zero creates (MG-1.3, §7.4)', () => {
    it('creates on the first run and only updates on the second', async () => {
      const db = createRecordingPrisma();
      const first = await seed(db.client, EXPORT_PATH);
      const second = await seed(db.client, EXPORT_PATH);

      expect(first.categories.created).toBe(4);
      expect(second.categories).toEqual({ created: 0, updated: 4 });
      expect(second.topics).toEqual({ created: 0, updated: 9 });
      expect(second.posts).toEqual({ created: 0, updated: 10 });

      // Idempotency is only meaningful if the match key is the right one. These
      // are the schema's natural uniques (AD-15): no synthetic sourceRef column
      // exists, and RK-1 rejected adding one.
      expect(db.categories.size).toBe(4);
      expect(db.topics.size).toBe(9);
      expect(db.posts.size).toBe(10);
    });

    it('matches on the natural keys, not on row order or a synthetic id', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);
      await seed(db.client, EXPORT_PATH);

      const categoryLookups = db.calls.filter(
        (c) => c.model === 'category' && c.verb === 'findUnique',
      );
      for (const call of categoryLookups) {
        expect(Object.keys(call.args['where'] as object)).toEqual(['slug']);
      }
      const topicLookups = db.calls.filter(
        (c) => c.model === 'topic' && c.verb === 'findUnique',
      );
      for (const call of topicLookups) {
        expect(Object.keys(call.args['where'] as object)).toEqual(['slug']);
      }
      const postLookups = db.calls.filter(
        (c) => c.model === 'post' && c.verb === 'findUnique',
      );
      expect(postLookups.length).toBeGreaterThan(0);
      for (const call of postLookups) {
        expect(Object.keys(call.args['where'] as object)).toEqual([
          'topicId_postNumber',
        ]);
      }
    });
  });

  describe('assertion 6: --refresh-bodies (§7.4)', () => {
    const EDITED = 'An admin fixed a typo in this seeded post.';

    it('a default re-run does NOT overwrite an edited body', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);

      const key = [...db.posts.keys()][0] as string;
      const row = db.posts.get(key);
      if (!row) throw new Error('no seeded post');
      db.posts.set(key, { ...row, bodyMarkdown: EDITED });

      const result = await seed(db.client, EXPORT_PATH);
      expect(db.posts.get(key)?.bodyMarkdown).toBe(EDITED);
      expect(result.summary.refreshedBodies).toEqual([]);
    });

    it('--refresh-bodies overwrites it and logs the row', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);

      const key = [...db.posts.keys()][0] as string;
      const row = db.posts.get(key);
      if (!row) throw new Error('no seeded post');
      const original = row.bodyMarkdown;
      db.posts.set(key, { ...row, bodyMarkdown: EDITED });

      const result = await seed(db.client, EXPORT_PATH, true);
      expect(db.posts.get(key)?.bodyMarkdown).toBe(original);
      expect(result.summary.refreshedBodies).toHaveLength(1);
      // Per row, with enough to reconstruct what was destroyed — a bulk
      // "N bodies refreshed" line cannot do that.
      expect(result.summary.refreshedBodies[0]).toMatchObject({
        postNumber: row.postNumber,
        previousLength: EDITED.length,
        newLength: original.length,
      });
      expect(formatSummary(result.summary)).toContain('refreshed:');
    });

    it('--refresh-bodies logs nothing when no body actually differs', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);
      const result = await seed(db.client, EXPORT_PATH, true);
      expect(result.summary.refreshedBodies).toEqual([]);
    });

    it('is off by default and rejects any other flag', () => {
      expect(parseArgs([])).toEqual({ refreshBodies: false });
      expect(parseArgs(['--refresh-bodies'])).toEqual({ refreshBodies: true });
      expect(() => parseArgs(['--force'])).toThrow(/Unrecognised argument/);
      expect(() => parseArgs(['--reset'])).toThrow(/Unrecognised argument/);
      // A misspelling must fail rather than be silently ignored.
      expect(() => parseArgs(['--refresh-bodys'])).toThrow(
        /Unrecognised argument/,
      );
    });
  });

  describe('assertion 7: AD-8 / NFR-S10 — the rendered-HTML field is quarantined', () => {
    /**
     * ⚠️ THE NEEDLE IS ASSEMBLED FROM FRAGMENTS SO THIS FILE DOES NOT MATCH
     * ITSELF. The assertion greps every file in `prisma/seed/`, this spec
     * included; a literal would make the test that enforces the quarantine the
     * first thing to violate it.
     */
    const FORBIDDEN_FIELD = ['coo', 'ked'].join('');

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });

    it('the field name appears in no file under prisma/seed/', () => {
      const files = walk(SEED_DIR);
      // Guard against a glob that silently matches nothing and passes. The floor
      // moved from 11 to 12 when Batch 11 added `map-course.ts`: a floor that
      // does not move with the directory lets a new file drop out of the scan
      // while the assertion stays green.
      expect(files.length).toBeGreaterThanOrEqual(12);

      const offenders = files.filter((f) =>
        readFileSync(f, 'utf8').includes(FORBIDDEN_FIELD),
      );
      expect(offenders).toEqual([]);
    });

    it("covers Batch 11's new module by name, not just by count", () => {
      const files = walk(SEED_DIR);
      expect(files).toContain(join(SEED_DIR, 'map-course.ts'));
      expect(files).toContain(join(SEED_DIR, 'community-seed.ts'));
      expect(files).toContain(join(SEED_DIR, 'summary.ts'));
    });

    it('the parsed export does not carry the field at run time either', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      const post = data.topics[0]?.posts[0];
      expect(post).toBeDefined();
      // Stripped by the Zod object schema, which is stronger than typing it
      // `unknown`: there is nothing left in memory to read, not merely nothing
      // usefully typed.
      expect(Object.keys(post as object).sort()).toEqual([
        'createdAt',
        'postNumber',
        'raw',
        'username',
      ]);
      expect(FORBIDDEN_FIELD in (post as object)).toBe(false);
    });

    it('but the field IS present in the source file — so the strip is real', () => {
      expect(exportText).toContain(FORBIDDEN_FIELD);
    });
  });

  describe('assertion 9: no User row is created (A-4, MG-1.8)', () => {
    it('never touches the user delegate', async () => {
      const db = createRecordingPrisma();
      // The double's `user` delegate throws on any property access, so this
      // resolving at all is the assertion.
      await expect(seed(db.client, EXPORT_PATH)).resolves.toBeDefined();
      expect(db.calls.some((c) => c.model === 'user')).toBe(false);
    });

    it('writes authorId: null on every topic and post', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);
      for (const topic of db.topics.values()) {
        expect(topic.authorId).toBeNull();
      }
      for (const post of db.posts.values()) {
        expect(post.authorId).toBeNull();
      }
    });

    it('reports every source username as unmatched, counting all 21 source posts', async () => {
      const db = createRecordingPrisma();
      const { summary } = await seed(db.client, EXPORT_PATH);
      expect(summary.unmatchedUsernames).toEqual([
        { username: 'system', postCount: EXPECTED_POST_COUNT },
      ]);
      expect(formatSummary(summary)).toContain(
        `unmatched usernames: system (${EXPECTED_POST_COUNT} posts)`,
      );
    });
  });

  describe('category mapping (Task 8.4, MG-1.4)', () => {
    it('maps by source id, not by the misremembered MG-1.6 breakdown', async () => {
      const data = readDiscourseExport(EXPORT_PATH);
      const rows = buildCategoryRows(data, DEFAULT_COHORT_KEY);
      expect(
        rows.map((r) => [r.slug, r.visibility, r.sortOrder, r.cohortKeys]),
      ).toEqual([
        ['general', 'member', 10, []],
        ['builders-lounge', 'cohort', 20, [DEFAULT_COHORT_KEY]],
        ['site-feedback', 'member', 30, []],
        ['staff', 'staff', 40, []],
      ]);
      // "Start here" and "Questions" are in Builders Lounge in the export, not
      // in General as MG-1.6 remembers (plan §7.1's correction).
      const { topics } = buildTopicRows(data);
      const bySlug = new Map(topics.map((t) => [t.slug, t.categorySourceId]));
      expect(bySlug.get('start-here-how-this-cohort-works')).toBe(5);
      expect(bySlug.get('questions-ask-anything-here')).toBe(5);
      expect(bySlug.get('welcome-to-the-ptah-community')).toBe(4);
    });

    it('only the cohort category carries a cohort key', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      const rows = buildCategoryRows(data, DEFAULT_COHORT_KEY);
      for (const row of rows) {
        if (row.visibility === 'cohort') expect(row.cohortKeys).toHaveLength(1);
        else expect(row.cohortKeys).toEqual([]);
      }
      expect(
        CATEGORY_MAPPING.filter((r) => r.visibility === 'cohort'),
      ).toHaveLength(1);
    });

    it('aborts when no default MemberGroup exists rather than gating on nothing', async () => {
      const db = createRecordingPrisma();
      const client = {
        ...db.client,
        memberGroup: { findFirst: async () => null },
      } as unknown as SeedPrismaClient;

      await expect(seed(client, EXPORT_PATH)).rejects.toThrow(
        /No MemberGroup has isDefault = true/,
      );
      expect(db.writes()).toEqual([]);
    });

    it('stores descriptions as plain text, with no markup surviving', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      const rows = buildCategoryRows(data, DEFAULT_COHORT_KEY);
      for (const row of rows) {
        if (row.description === null) continue;
        expect(row.description).not.toMatch(/[<>]/);
        expect(row.description).not.toMatch(/&[a-zA-Z#][a-zA-Z0-9]*;/);
      }
      expect(rows.find((r) => r.slug === 'general')?.description).toBe(
        'Create topics here that don’t fit into any other existing category.',
      );
      // A null source description stays null rather than becoming ''.
      expect(
        rows.find((r) => r.slug === 'builders-lounge')?.description,
      ).toBeNull();
    });

    it('aborts rather than storing markup the fixed regex cannot flatten', () => {
      expect(() => stripHtmlToPlainText('<p>a &amp; b</p>')).toThrow(
        /HTML entity/,
      );
      expect(() => stripHtmlToPlainText('<p>1 < 2</p>')).toThrow(
        /angle brackets/,
      );
      expect(stripHtmlToPlainText('<p>plain  sentence.</p>')).toBe(
        'plain sentence.',
      );
    });
  });

  describe('topic mapping (Task 8.5, AD-9, AD-11)', () => {
    it('carries pinned from the source for exactly topics 5 and 13', () => {
      const { topics } = buildTopicRows(readDiscourseExport(EXPORT_PATH));
      const pinned = topics.filter((t) => t.pinned).map((t) => t.sourceId);
      expect(pinned.sort((a, b) => a - b)).toEqual([5, 13]);
    });

    it('computes postCount as replies only, and lastPostedAt from the imported posts', () => {
      const { topics } = buildTopicRows(readDiscourseExport(EXPORT_PATH));
      for (const topic of topics) {
        expect(topic.postCount).toBe(
          topic.posts.filter((p) => p.postNumber > 1).length,
        );
        expect(topic.lastPostedAt.getTime()).toBe(
          Math.max(...topic.posts.map((p) => p.createdAt.getTime())),
        );
        expect(topic.lastPostedAt.getTime()).toBeGreaterThanOrEqual(
          topic.createdAt.getTime(),
        );
      }
      // Topic 4 keeps its reply; topic 13's only reply is the skipped empty one.
      expect(topics.find((t) => t.sourceId === 4)?.postCount).toBe(1);
      expect(topics.find((t) => t.sourceId === 13)?.postCount).toBe(0);
    });

    it('makes post #2 a top-level reply, never a child of post #1 (RK-12)', () => {
      const { topics } = buildTopicRows(readDiscourseExport(EXPORT_PATH));
      for (const topic of topics) {
        for (const post of topic.posts) {
          expect(post.parentId).toBeNull();
        }
      }
    });

    it('reuses the export slug rather than regenerating it, which would break idempotency', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      const { topics } = buildTopicRows(data);
      const sourceBySlug = new Map(data.topics.map((t) => [t.id, t.slug]));
      for (const topic of topics) {
        expect(topic.slug).toBe(sourceBySlug.get(topic.sourceId));
      }
      // And every one conforms to the character set the create-path generator
      // in libs/api/forum/src/lib/common/slug.ts emits.
      for (const topic of topics) {
        expect(topic.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
    });

    it('imports no curriculum topic — those are Batch 11 lessons', () => {
      const { topics } = buildTopicRows(readDiscourseExport(EXPORT_PATH));
      for (const topic of topics) {
        expect(CURRICULUM_TOPIC_IDS).not.toContain(topic.sourceId);
        expect(topic.slug).not.toMatch(/^day-\d/);
      }
    });
  });

  // =========================================================================
  // Batch 11 — the curriculum course (MG-1.5, §7.3, Tasks 11.2–11.5)
  // =========================================================================

  describe('curriculum course — counts and the consumed split (MG-1.5)', () => {
    it('writes 1 course, 10 modules and 10 lessons against the recording double', async () => {
      const db = createRecordingPrisma();
      const result = await seed(db.client, EXPORT_PATH);

      expect(result.courses).toEqual({ created: 1, updated: 0 });
      expect(result.modules).toEqual({ created: 10, updated: 0 });
      expect(result.lessons).toEqual({ created: 10, updated: 0 });
      expect(db.courses.size).toBe(1);
      expect(db.modules.size).toBe(CURRICULUM_TOPIC_IDS.length);
      expect(db.lessons.size).toBe(CURRICULUM_TOPIC_IDS.length);

      // The community half is untouched by the curriculum writer.
      expect(result.categories).toEqual({ created: 4, updated: 0 });
      expect(result.topics).toEqual({ created: 9, updated: 0 });
      expect(result.posts).toEqual({ created: 10, updated: 0 });
    });

    it('CURRICULUM_TOPIC_IDS is now CONSUMED by a writer, not merely excluded by one', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);

      const data = readDiscourseExport(EXPORT_PATH);
      const titleById = new Map(data.topics.map((t) => [t.id, t.title]));
      const lessonTitles = [...db.lessons.values()].map((l) => l.title);

      // Every curriculum id contributed exactly one lesson, titled with its
      // SOURCE topic title — the "Day N build thread — " prefix retained (§7.3).
      for (const id of CURRICULUM_TOPIC_IDS) {
        expect(lessonTitles).toContain(titleById.get(id));
      }
      expect(lessonTitles).toHaveLength(CURRICULUM_TOPIC_IDS.length);
      for (const title of lessonTitles) {
        // 🔴 FR-SLUG-3: `\d{1,2}`, NOT `\d`. Titles are UNPADDED ("Day 1" …
        // "Day 10"), so a single `\d` silently excludes exactly one of the ten
        // and the other nine make the failure read as a data defect. The
        // tripwire below pins that.
        expect(title).toMatch(/^Day \d{1,2} build thread — /);
      }

      // And the community half still refuses them, which now means something
      // stronger than before: not "dropped", but "written in the other shape".
      for (const topic of db.topics.values()) {
        expect(topic.slug).not.toMatch(/^day-\d/);
      }
    });

    it('lays the modules out sparsely at 100…1000, one lesson each at 100', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);

      const ordered = [...db.modules.values()].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      expect(ordered.map((m) => m.slug)).toEqual([
        'day-01',
        'day-02',
        'day-03',
        'day-04',
        'day-05',
        'day-06',
        'day-07',
        'day-08',
        'day-09',
        'day-10',
      ]);
      expect(ordered.map((m) => m.sortOrder)).toEqual([
        100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
      ]);
      // R8.8: sparse, so one later insert does not force a full renumber.
      expect(SORT_ORDER_STEP).toBe(100);
      for (const lesson of db.lessons.values()) {
        expect(lesson.sortOrder).toBe(100);
        // §7.3: the lesson slug equals its module slug.
        // 🔴 FR-SLUG-3: slugs are PADDED, so this takes the explicit
        // alternation rather than a quantifier — `/^day-\d{1,2}$/` would also
        // admit an unpadded `day-1` that this seed must never emit.
        expect(lesson.slug).toMatch(/^day-(0[1-9]|10)$/);
      }
      const modulesById = new Map(
        [...db.modules.values()].map((m) => [m.id, m]),
      );
      for (const lesson of db.lessons.values()) {
        expect(modulesById.get(lesson.moduleId)?.slug).toBe(lesson.slug);
      }
    });

    it('carries the §7.3 course row, with the cohort key RESOLVED not hard-coded', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);

      const course = db.courses.get(COURSE_SLUG);
      expect(course).toBeDefined();
      expect(course?.title).toBe(COURSE_TITLE);
      expect(course?.visibility).toBe('cohort');
      expect(course?.published).toBe(true);
      // 🔴 Deliberately false: the source has no completion gate and MG-1.5 asks
      // to preserve ordering, not to invent gating.
      expect(course?.sequential).toBe(false);
      expect(course?.sortOrder).toBe(COURSE_SORT_ORDER);
      // A-4: no User row, so no author.
      expect(course?.createdBy).toBeNull();
      // The key came from the memberGroup lookup, not from a literal in the
      // mapper: build the rows against a different key and the row follows.
      expect(course?.cohortKeys).toEqual([DEFAULT_COHORT_KEY]);
      const data = readDiscourseExport(EXPORT_PATH);
      expect(
        buildCourseRows(data, 'some-other-cohort').course.cohortKeys,
      ).toEqual(['some-other-cohort']);
    });

    /**
     * 🔴 THE ANTI-VACUITY WITNESS, RE-FOUNDED — AND IT IS NOW A WEAKER
     * PROPERTY THAN THE ONE IT REPLACES. SAY SO RATHER THAN LET THE NEXT
     * REVIEWER DISCOVER IT.
     *
     * The old witness (TASK_2026_177) leaned on a genuine divergence: source
     * topic 21 said "Week 7 build thread — Hardening — tests, policies,
     * observability" while the module table said only "Hardening". No
     * derivation from the source title could produce the table's answer, so
     * the table was PROVABLY editorial.
     *
     * TASK_2026_202's FR-TITLE-1 removes that divergence BY DESIGN: every
     * source title is now exactly `Day ${n} build thread — ${MODULE_TITLES[n-1]}`.
     * Deleting this test along with the defect it witnessed would quietly lose
     * the guard (R4), so it is re-founded on the divergence that survives for
     * all ten — the PREFIX ASYMMETRY. The lesson title keeps the
     * `Day N build thread — ` prefix (`map-course.ts` lesson row) and the
     * module title never carries it.
     *
     * ⚠️ WHAT THIS NO LONGER PROVES. After FR-TITLE-1 a derivation
     * `source.title.slice('Day N build thread — '.length)` WOULD produce the
     * right module titles, so the surviving property is only the weaker "a
     * module title is not a COPY of its source title". The compensating
     * control is FR-TITLE-2 (`map-course.ts` `buildCourseRows`): the two
     * halves are still authored in two separate files and their AGREEMENT is
     * now a build failure rather than a hope — see the mismatch abort in
     * "curriculum course — the aborts" below. That guard, not this test, is
     * what keeps the table honest now.
     */
    it('takes the module titles from the table, and a module title is never its lesson title', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      const { modules } = buildCourseRows(data, DEFAULT_COHORT_KEY);
      expect(modules.map((m) => m.title)).toEqual([...MODULE_TITLES]);

      expect(modules).toHaveLength(10);
      modules.forEach((m, i) => {
        expect(m.lesson.title).not.toBe(m.title);
        expect(m.lesson.title).toBe(`Day ${i + 1} build thread — ${m.title}`);
        expect(m.title).not.toMatch(/^Day \d{1,2} build thread/);
      });
    });

    /**
     * 🔴 R1 — THE ONE-DIGIT REGEX TRAP, ASSERTED RATHER THAN REMEMBERED.
     *
     * The pre-TASK_2026_202 assertion was `/^Week \d build thread — /`. The
     * mechanical rename to `/^Day \d build thread — /` passes EIGHT of the ten
     * titles and fails only "Day 10", so the report reads as one bad row in the
     * export rather than as a wrong quantifier — which is why R1 is rated the
     * single most likely way this change ships broken.
     *
     * FR-SLUG-3 is the rule this test pins: titles are UNPADDED so any regex
     * against a title takes `\d{1,2}`; slugs are PADDED so any regex against a
     * slug takes the explicit `(0[1-9]|10)` alternation.
     */
    it('Day 10 is covered by the title regex — the one-digit form is NOT', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      const { modules } = buildCourseRows(data, DEFAULT_COHORT_KEY);
      const dayTen = modules[9];

      expect(dayTen?.lesson.title).toMatch(/^Day \d{1,2} build thread — /);
      // 🔴 THE TRIPWIRE. If someone re-narrows the quantifier, this fails and
      // names the quantifier instead of the data.
      expect(dayTen?.lesson.title).not.toMatch(/^Day \d build thread — /);
      expect(dayTen?.slug).toBe('day-10');

      // …and the unpadded SLUG form is a prefix trap, which is why FR-SLUG-1
      // pads: `day-1` is a prefix of both `day-1` and `day-10`, so under the
      // unpadded scheme a startsWith filter matches two modules.
      expect('day-1'.startsWith('day-1') && 'day-10'.startsWith('day-1')).toBe(
        true,
      );
      // Padded, every prefix picks out exactly one of the ten this seed emits.
      expect(modules.filter((m) => m.slug.startsWith('day-01'))).toHaveLength(
        1,
      );
      expect(modules.filter((m) => m.slug.startsWith('day-1'))).toHaveLength(1);
    });

    /**
     * FR-TITLE-1, pinned against HAND-WRITTEN LITERALS.
     *
     * ⚠️ `curriculumTopicTitle()` is exported, and this test deliberately does
     * NOT call it. A spec whose only oracle is the same function the mapper
     * calls cannot detect a wrong prefix — both halves would move together and
     * the assertion would stay green. Day 1 and Day 10 are the two anchors: the
     * first day, and the only two-digit one.
     */
    it('titles the Day 1 and Day 10 lessons exactly, checked against literals not the helper', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      const { modules } = buildCourseRows(data, DEFAULT_COHORT_KEY);

      expect(modules[0]?.lesson.title).toBe(
        'Day 1 build thread — The workspace — monorepo, boundaries, first green CI',
      );
      expect(modules[9]?.lesson.title).toBe(
        'Day 10 build thread — Publish, fail, retry — and launch',
      );
    });

    it('emits module slugs that conform to the forum slug character set — verified, not assumed', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);

      const slugs = [...db.modules.values()].map((m) => m.slug);
      expect(slugs).toHaveLength(10);
      for (const slug of slugs) {
        // FR-SLUG-1 says VERIFY the generated form against the character set
        // `libs/api/forum/src/lib/common/slug.ts` emits, not assume a literal
        // built by hand happens to satisfy it.
        expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(slug).toMatch(/^day-(0[1-9]|10)$/);
      }
      expect(new Set(slugs).size).toBe(10);

      // The lesson slug equals its module slug, so it inherits both properties.
      for (const lesson of db.lessons.values()) {
        expect(lesson.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
    });

    it('the ten curriculum export slugs are well formed and unique across all 19', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      const curriculum = data.topics.filter((t) =>
        CURRICULUM_TOPIC_IDS.includes(t.id),
      );
      expect(curriculum).toHaveLength(CURRICULUM_TOPIC_IDS.length);
      for (const topic of curriculum) {
        expect(topic.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(topic.slug).toMatch(/^day-(0[1-9]|10)-build-thread-/);
      }

      // The schema already enforces uniqueness across the whole export; assert
      // it here as well so a collision names the offending slug instead of
      // reporting a count that is one short.
      const all = data.topics.map((t) => t.slug);
      expect(all).toHaveLength(EXPECTED_TOPIC_COUNT);
      expect(all.filter((s, i) => all.indexOf(s) !== i)).toEqual([]);
    });

    it('leaves youtubeVideoId AND videoDurationSeconds null ⇒ manual completion only', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);
      expect(db.lessons.size).toBe(10);
      for (const lesson of db.lessons.values()) {
        expect(lesson.youtubeVideoId).toBeNull();
        // ⚠️ ASSUMPTION-8: the 90% rule keys on the DURATION, not on the id, so
        // this null — not the one above — is what makes the lesson manual-only
        // as the running code evaluates it.
        expect(lesson.videoDurationSeconds).toBeNull();
      }
    });

    it('writes lesson createdAt from the source topic, and NOT now()', async () => {
      const before = Date.now();
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);

      const data = readDiscourseExport(EXPORT_PATH);
      const { modules } = buildCourseRows(data, DEFAULT_COHORT_KEY);
      const sourceById = new Map(data.topics.map((t) => [t.id, t]));

      for (const module of modules) {
        const source = sourceById.get(module.sourceTopicId);
        expect(module.lesson.createdAt.toISOString()).toBe(
          new Date(source?.createdAt ?? 0).toISOString(),
        );
        expect(module.lesson.createdAt.getTime()).toBeLessThan(before);
      }

      const lessonWrites = db
        .writes()
        .filter((c) => c.model === 'lesson' && c.verb === 'create');
      expect(lessonWrites).toHaveLength(10);
      for (const call of lessonWrites) {
        expect(call.args['data']).toHaveProperty('createdAt');
        expect(
          (call.args['data'] as { createdAt: Date }).createdAt,
        ).toBeInstanceOf(Date);
      }
    });

    it('does NOT stamp the course or its modules with a source instant', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);

      // The course and the modules are new editorial objects assembled in
      // 2026-08 from ten sessions authored in one editorial pass; giving them a
      // source instant would be a fabricated claim about when the curriculum was
      // authored. They fall through to @default(now()).
      const structural = db
        .writes()
        .filter((c) => c.model === 'course' || c.model === 'courseModule');
      // 1 course + 10 modules.
      expect(structural).toHaveLength(11);
      for (const call of structural) {
        expect(call.args['data']).not.toHaveProperty('createdAt');
      }
    });
  });

  describe('curriculum course — natural keys and idempotency (AD-15, §7.4)', () => {
    it('matches on Course.slug, [courseId, slug] and [moduleId, slug] — asserted, not claimed', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);
      await seed(db.client, EXPORT_PATH);

      const keysOf = (model: string) =>
        db.calls
          .filter((c) => c.model === model && c.verb === 'findUnique')
          .map((c) => Object.keys(c.args['where'] as object));

      const courseKeys = keysOf('course');
      expect(courseKeys.length).toBeGreaterThan(0);
      for (const keys of courseKeys) expect(keys).toEqual(['slug']);

      const moduleKeys = keysOf('courseModule');
      expect(moduleKeys.length).toBeGreaterThan(0);
      for (const keys of moduleKeys) expect(keys).toEqual(['courseId_slug']);

      const lessonKeys = keysOf('lesson');
      expect(lessonKeys.length).toBeGreaterThan(0);
      for (const keys of lessonKeys) expect(keys).toEqual(['moduleId_slug']);
    });

    it('a second run produces ZERO creates on all three new models', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);
      const second = await seed(db.client, EXPORT_PATH);

      expect(second.courses).toEqual({ created: 0, updated: 1 });
      expect(second.modules).toEqual({ created: 0, updated: 10 });
      expect(second.lessons).toEqual({ created: 0, updated: 10 });
      expect(db.courses.size).toBe(1);
      expect(db.modules.size).toBe(10);
      expect(db.lessons.size).toBe(10);
    });

    it('zero creates on ALL SIX entity lines, which is the exit gate itself', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);
      const second = await seed(db.client, EXPORT_PATH);
      expect(
        second.summary.entities.map((e) => [e.label, e.counts.created]),
      ).toEqual([
        ['categories', 0],
        ['topics', 0],
        ['posts', 0],
        ['courses', 0],
        ['modules', 0],
        ['lessons', 0],
      ]);
      for (const entity of second.summary.entities) {
        expect(entity.counts.updated).toBeGreaterThan(0);
      }
    });

    it('writes the curriculum AFTER the forum rows, with no interleaving', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);

      const models = db.calls
        .filter((c) => c.verb !== 'open' && c.model !== 'memberGroup')
        .map((c) => c.model);
      const firstCurriculum = models.findIndex((m) =>
        ['course', 'courseModule', 'lesson'].includes(m),
      );
      const lastForum = models.reduce(
        (last, m, i) => (['category', 'topic', 'post'].includes(m) ? i : last),
        -1,
      );
      expect(firstCurriculum).toBeGreaterThan(lastForum);

      // One transaction for the whole import (§7.4): opened once, and every
      // write happens after it.
      const opens = db.calls.filter((c) => c.verb === 'open');
      expect(opens).toHaveLength(1);
      expect(db.calls.indexOf(opens[0] as RecordedCall)).toBeLessThan(
        db.calls.findIndex((c) => c.verb === 'create'),
      );
    });
  });

  describe('curriculum course — --refresh-bodies reaches lessons (§7.4)', () => {
    const EDITED = 'An admin rewrote this lesson body in the product.';

    it('a default re-run does NOT overwrite an edited lesson body', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);

      const key = [...db.lessons.keys()][0] as string;
      const row = db.lessons.get(key);
      if (!row) throw new Error('no seeded lesson');
      db.lessons.set(key, { ...row, bodyMarkdown: EDITED });

      const result = await seed(db.client, EXPORT_PATH);
      expect(db.lessons.get(key)?.bodyMarkdown).toBe(EDITED);
      expect(result.summary.refreshedBodies).toEqual([]);
    });

    /**
     * ⚠️ THIS IS THE CASE MOST LIKELY TO BE MISSING, AND ITS ABSENCE IS SILENT.
     * Wiring the new writes and forgetting the flag leaves `--refresh-bodies`
     * looking like it works — it still refreshes posts — while lesson bodies go
     * stale for ever.
     */
    it('--refresh-bodies restores it and logs exactly one line naming both slugs', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);

      const key = [...db.lessons.keys()][0] as string;
      const row = db.lessons.get(key);
      if (!row) throw new Error('no seeded lesson');
      const original = row.bodyMarkdown;
      db.lessons.set(key, { ...row, bodyMarkdown: EDITED });

      const result = await seed(db.client, EXPORT_PATH, true);
      expect(db.lessons.get(key)?.bodyMarkdown).toBe(original);
      expect(result.summary.refreshedBodies).toHaveLength(1);
      expect(result.summary.refreshedBodies[0]).toEqual({
        kind: 'lesson',
        moduleSlug: row.slug,
        lessonSlug: row.slug,
        previousLength: EDITED.length,
        newLength: original.length,
      });
      // Enough to reconstruct what was destroyed, on ONE logger shared with the
      // post variant rather than a second one that could silently go unwired.
      expect(formatSummary(result.summary)).toContain(
        `refreshed: ${row.slug}/${row.slug} lesson`,
      );
    });

    it('logs nothing when no lesson body actually differs', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);
      const result = await seed(db.client, EXPORT_PATH, true);
      expect(result.summary.refreshedBodies).toEqual([]);
    });
  });

  describe('curriculum course — byte fidelity, MADE SENSITIVE (RK-9)', () => {
    it('every lesson body is byte-for-byte its source topic post #1 raw', async () => {
      const db = createRecordingPrisma();
      await seed(db.client, EXPORT_PATH);

      const data = readDiscourseExport(EXPORT_PATH);
      const sourceById = new Map(data.topics.map((t) => [t.id, t]));
      const { modules } = buildCourseRows(data, DEFAULT_COHORT_KEY);
      const storedBySlug = new Map(
        [...db.lessons.values()].map((l) => [l.slug, l]),
      );

      let compared = 0;
      for (const module of modules) {
        const source = sourceById.get(module.sourceTopicId);
        const raw = source?.posts.find((p) => p.postNumber === 1)?.raw;
        expect(typeof raw).toBe('string');
        expect(Buffer.from(module.lesson.bodyMarkdown, 'utf8')).toEqual(
          Buffer.from(raw ?? '<missing>', 'utf8'),
        );
        // …and what actually reached the writer, not only what the mapper built.
        expect(
          Buffer.from(
            storedBySlug.get(module.slug)?.bodyMarkdown ?? '',
            'utf8',
          ),
        ).toEqual(Buffer.from(raw ?? '<missing>', 'utf8'));
        compared++;
      }
      expect(compared).toBe(CURRICULUM_TOPIC_IDS.length);
    });

    /**
     * 🔴 THE ASSERTION ABOVE IS VACUOUS AGAINST THE MOST LIKELY TRANSFORMS AND
     * THIS ONE IS NOT. Batch 8's Finding 6: adding `.trim()` to the post mapper
     * left all 37 assertions green, because not one export body has leading or
     * trailing whitespace or a CR. The ten curriculum bodies are no different
     * — every one begins with `**` and ends with `.`. A byte comparison against
     * a corpus that happens to be invariant under a transform detects nothing.
     *
     * The body below is hostile to every normalisation a well-meaning
     * contributor might add: surrounding whitespace (`.trim()`), a tab, CRLF
     * (line-ending normalisation), an HTML entity (entity decoding), a literal
     * tag (tag stripping — correct for `Category.description`, wrong here), a
     * non-ASCII em-dash (re-encoding) and a trailing blank line (paragraph
     * re-wrapping). It is applied to a CURRICULUM topic, so it exercises the
     * lesson write specifically.
     */
    it('preserves a LESSON body that is sensitive to every plausible transform', async () => {
      const HOSTILE = '  \r\n\t**bold** &amp; <b>tag</b> — em nbsp\r\n\r\n  ';
      const targetId = CURRICULUM_TOPIC_IDS[0] as number;
      const path = fixtureFromExport('hostile-lesson', (parsed) => {
        const p = parsed as unknown as {
          topics: {
            id: number;
            posts: { postNumber: number; raw: string }[];
          }[];
        };
        const topic = p.topics.find((t) => t.id === targetId);
        const post = topic?.posts.find((x) => x.postNumber === 1);
        if (!post) throw new Error('fixture shape changed');
        post.raw = HOSTILE;
      });

      const db = createRecordingPrisma();
      await seed(db.client, path);

      // 🔴 TWO occurrences of the slug in one template literal — the map key is
      // `${moduleId}#${lessonSlug}`. A rename that moves only the first leaves
      // `stored` undefined and the failure points at the fixture, not the key.
      const stored = db.lessons.get(
        `${[...db.modules.values()].find((m) => m.slug === 'day-01')?.id}#day-01`,
      );
      expect(stored).toBeDefined();
      expect(Buffer.from(stored?.bodyMarkdown ?? '', 'utf8')).toEqual(
        Buffer.from(HOSTILE, 'utf8'),
      );
      expect(stored?.bodyMarkdown).toBe(HOSTILE);
    });
  });

  describe('curriculum course — the aborts (MG-1.2, RK-9)', () => {
    /**
     * 🔴 AN EMPTY CURRICULUM BODY ABORTS; IT IS NOT SKIPPED. The community half
     * skips one empty small-action reply because the thread still reads
     * correctly without it. A lesson body is the whole lesson: there is nothing
     * to skip to, and a blank lesson would ship silently.
     */
    it('a curriculum topic with an empty post #1 aborts at the census, writing nothing', async () => {
      const targetId = CURRICULUM_TOPIC_IDS[3] as number;
      const path = fixtureFromExport('empty-lesson-body', (parsed) => {
        const p = parsed as unknown as {
          topics: {
            id: number;
            posts: { postNumber: number; raw: string }[];
          }[];
        };
        const post = p.topics
          .find((t) => t.id === targetId)
          ?.posts.find((x) => x.postNumber === 1);
        if (!post) throw new Error('fixture shape changed');
        post.raw = '';
      });

      const db = createRecordingPrisma();
      // The FIRST control to fire is the export census: 19 non-empty bodies
      // where EXPECTED_NON_EMPTY_BODY_POSTS demands 20.
      await expect(seed(db.client, path)).rejects.toBeInstanceOf(
        ExportValidationError,
      );
      expect(db.calls).toEqual([]);
    });

    it('…and aborts in the MAPPER too, when the census is compensated', async () => {
      // Two mutations, and the second exists only to get past the census so the
      // mapper's own guard is the thing under test: blank a curriculum body AND
      // fill the one legitimately-empty community reply, keeping the non-empty
      // total at 20. Without this the mapper guard would never be reached and
      // "a blank lesson aborts" would be asserted only against the schema.
      const targetId = CURRICULUM_TOPIC_IDS[3] as number;
      const path = fixtureFromExport('empty-lesson-compensated', (parsed) => {
        const p = parsed as unknown as {
          topics: {
            id: number;
            posts: { postNumber: number; raw: string }[];
          }[];
        };
        const blanked = p.topics
          .find((t) => t.id === targetId)
          ?.posts.find((x) => x.postNumber === 1);
        const filled = p.topics
          .find((t) => t.id === 13)
          ?.posts.find((x) => x.postNumber === 2);
        if (!blanked || !filled) throw new Error('fixture shape changed');
        blanked.raw = '';
        filled.raw = 'A body where the export has a small-action marker.';
      });

      const db = createRecordingPrisma();
      await expect(seed(db.client, path)).rejects.toBeInstanceOf(
        CourseMappingError,
      );
      await expect(seed(db.client, path)).rejects.toThrow(/empty post #1 body/);
      // Mapping happens before the transaction opens, so nothing is written and
      // nothing is even read.
      expect(db.writes()).toEqual([]);
      expect(db.calls.filter((c) => c.verb === 'open')).toEqual([]);
    });

    /**
     * 🔴 FR-TITLE-2 — THE COMPENSATING CONTROL FOR THE WEAKENED ANTI-VACUITY
     * WITNESS ABOVE.
     *
     * The export title and `MODULE_TITLES` are authored in two different files
     * and their AGREEMENT is the check. Before TASK_2026_202 a divergence
     * (source topic 21's "Hardening") sat in the tree unnoticed for months and
     * was recorded as a comment; it is now a build failure. This is the test
     * that proves the guard fires, and that it fires BEFORE `$transaction`
     * opens — so a mismatch writes nothing and reads nothing.
     */
    it('aborts when an export title and MODULE_TITLES disagree, writing and reading nothing', async () => {
      const targetId = CURRICULUM_TOPIC_IDS[6] as number;
      const path = fixtureFromExport('title-mismatch', (parsed) => {
        const p = parsed as unknown as {
          topics: { id: number; title: string }[];
        };
        const topic = p.topics.find((t) => t.id === targetId);
        if (!topic) throw new Error('fixture shape changed');
        // The exact historical defect, restored on purpose: the descriptive
        // half truncated to a single word while the table says otherwise.
        topic.title = 'Day 7 build thread — Hardening';
      });

      const db = createRecordingPrisma();
      await expect(seed(db.client, path)).rejects.toBeInstanceOf(
        CourseMappingError,
      );
      await expect(seed(db.client, path)).rejects.toThrow(
        new RegExp(`Curriculum topic ${targetId} is titled`),
      );
      // Mapping happens before the transaction opens: nothing written, nothing
      // read, no transaction even started.
      expect(db.writes()).toEqual([]);
      expect(db.calls.filter((c) => c.verb === 'open')).toEqual([]);
      expect(db.courses.size).toBe(0);
      expect(db.modules.size).toBe(0);
      expect(db.lessons.size).toBe(0);
    });

    it('the cohort abort writes NO course either — not a member-visibility downgrade', async () => {
      const db = createRecordingPrisma();
      const client = {
        ...db.client,
        memberGroup: { findFirst: async () => null },
      } as unknown as SeedPrismaClient;

      await expect(seed(client, EXPORT_PATH)).rejects.toThrow(
        /No MemberGroup has isDefault = true/,
      );
      expect(db.writes()).toEqual([]);
      expect(db.courses.size).toBe(0);
      expect(db.modules.size).toBe(0);
      expect(db.lessons.size).toBe(0);
      // Not a fallback to 'founding', not an empty cohortKeys, not a downgrade
      // to visibility: 'member'. The seed refuses to write an ungated course.
      expect(
        db.calls.filter((c) =>
          ['course', 'courseModule', 'lesson'].includes(c.model),
        ),
      ).toEqual([]);
    });

    it('the raw:null and U+FFFD fixtures still write no course, module or lesson', async () => {
      for (const [name, mutate] of [
        [
          'raw-null-b11',
          (p: { topics: { posts: { raw: string | null }[] }[] }) => {
            (p.topics[0] as { posts: { raw: string | null }[] }).posts[0].raw =
              null;
          },
        ],
        [
          'mojibake-b11',
          (p: { topics: { posts: { raw: string | null }[] }[] }) => {
            (p.topics[0] as { posts: { raw: string | null }[] }).posts[0].raw =
              `Ptah ${String.fromCharCode(0xfffd)} week one`;
          },
        ],
      ] as const) {
        const path = fixtureFromExport(name, mutate as never);
        const db = createRecordingPrisma();
        await expect(seed(db.client, path)).rejects.toBeInstanceOf(
          ExportValidationError,
        );
        expect(db.calls).toEqual([]);
        expect(db.courses.size).toBe(0);
        expect(db.modules.size).toBe(0);
        expect(db.lessons.size).toBe(0);
      }
    });

    it('aborts rather than zipping a mismatched title table against the topic ids', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      expect(MODULE_TITLES).toHaveLength(CURRICULUM_TOPIC_IDS.length);
      expect(() => buildCourseRows(data, '')).toThrow(CourseMappingError);
      expect(() => buildCourseRows(data, '')).toThrow(/gated on nothing/);
    });
  });

  describe('curriculum course — A-4 and the summary arithmetic (Task 11.4)', () => {
    it('creates no User row while writing the curriculum', async () => {
      const db = createRecordingPrisma();
      // The poisoned `user` delegate throws on any property access, so the run
      // resolving at all is the assertion — now with 21 more writes to do it in
      // (1 course + 10 modules + 10 lessons).
      await expect(seed(db.client, EXPORT_PATH)).resolves.toBeDefined();
      expect(db.calls.some((c) => c.model === 'user')).toBe(false);
      expect(db.lessons.size).toBe(10);
      for (const course of db.courses.values()) {
        expect(course.createdBy).toBeNull();
      }
    });

    it('closes both §7.5 assertion lines with computed numbers on both sides', async () => {
      const db = createRecordingPrisma();
      const { summary } = await seed(db.client, EXPORT_PATH);
      const text = formatSummary(summary);

      expect(summary.assertions[0]).toBe(
        `source topics ${EXPECTED_TOPIC_COUNT} = ${CURRICULUM_TOPIC_IDS.length} curriculum + ` +
          `${IMPORTED_TOPIC_IDS.length} topics OK`,
      );
      // 🔴 21 = 10 written + 1 skipped + 10 curriculum, NOT the plan's 11 + 10.
      // The 11th post is the empty small-action marker Batch 8 skips. The
      // `10 written` and `1 skipped` literals are the FORUM half and did not
      // move under TASK_2026_202 — only the curriculum term went 8 → 10.
      expect(summary.assertions[1]).toBe(
        `source posts ${EXPECTED_POST_COUNT} = 10 written + 1 skipped (empty source body) + ` +
          `${CURRICULUM_TOPIC_IDS.length} curriculum bodies OK`,
      );
      expect(summary.assertions.join('\n')).not.toContain('MISMATCH');

      // Six entity lines, in §7.5's order.
      expect(summary.entities.map((e) => e.label)).toEqual([
        'categories',
        'topics',
        'posts',
        'courses',
        'modules',
        'lessons',
      ]);
      expect(text).toContain('courses:');
      expect(text).toContain('modules:');
      expect(text).toContain('lessons:');
    });

    it("reports 20 bodies imported — the export's non-empty total, now fully written", async () => {
      const db = createRecordingPrisma();
      const { summary } = await seed(db.client, EXPORT_PATH);
      expect(summary.bodies.imported).toBe(EXPECTED_NON_EMPTY_BODY_POSTS);
      expect(summary.bodies.total).toBe(EXPECTED_NON_EMPTY_BODY_POSTS);
      expect(summary.bodies.transformed).toBe(0);
      expect(formatSummary(summary)).toContain(
        `bodies: ${EXPECTED_NON_EMPTY_BODY_POSTS}/${EXPECTED_NON_EMPTY_BODY_POSTS} imported from \`raw\`; 0 transformed`,
      );
    });

    it('still names every source post as system-authored, and the count now closes', async () => {
      const db = createRecordingPrisma();
      const { summary } = await seed(db.client, EXPORT_PATH);
      expect(summary.unmatchedUsernames).toEqual([
        { username: 'system', postCount: EXPECTED_POST_COUNT },
      ]);
      const text = formatSummary(summary);
      expect(text).toContain(
        `unmatched usernames: system (${EXPECTED_POST_COUNT} posts)`,
      );
      // Batch 8's clause said the count was a superset of what the run wrote.
      // It is not any more, and the wording moved with the fact.
      expect(text).toContain('now fully accounted for');
      expect(text).not.toContain('Batch 11 writes the rest');
    });
  });

  describe('the export path points at the committed source (MG-1.1)', () => {
    it('resolves to docs/community/discourse-export.json in the repo root', () => {
      expect(EXPORT_PATH).toBe(
        resolve(SEED_DIR, '../../../../docs/community/discourse-export.json'),
      );
      expect(() => readFileSync(EXPORT_PATH, 'utf8')).not.toThrow();
    });

    it('records why the per-post fetch is necessary, so the shortcut is not reintroduced', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      expect(data.note.length).toBeGreaterThan(0);
      expect(() =>
        validateDiscourseExport({ ...JSON.parse(exportText), note: '' }),
      ).toThrow(ExportValidationError);
    });
  });
});
