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
  writes(): RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const categories = new Map<string, StoredCategory>();
  const topics = new Map<string, StoredTopic>();
  /** Keyed `${topicId}#${postNumber}` — the schema's @@unique. */
  const posts = new Map<string, StoredPost>();
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
    it('the export holds exactly 4 categories, 17 topics and 19 posts', () => {
      const data = readDiscourseExport(EXPORT_PATH);
      expect(data.categories).toHaveLength(EXPECTED_CATEGORY_COUNT);
      expect(data.topics).toHaveLength(EXPECTED_TOPIC_COUNT);
      expect(data.topics.reduce((n, t) => n + t.posts.length, 0)).toBe(
        EXPECTED_POST_COUNT,
      );
    });

    it('the 17 source topics split into 8 curriculum + 9 imported, with no overlap', () => {
      expect(CURRICULUM_TOPIC_IDS).toHaveLength(8);
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

    it('carries 18 non-empty source bodies, which is one fewer than the post count', () => {
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
     * 18 non-empty bodies has leading or trailing whitespace, and none contains
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
      // Guard against a glob that silently matches nothing and passes.
      expect(files.length).toBeGreaterThanOrEqual(8);

      const offenders = files.filter((f) =>
        readFileSync(f, 'utf8').includes(FORBIDDEN_FIELD),
      );
      expect(offenders).toEqual([]);
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

    it('reports every source username as unmatched, counting all 19 source posts', async () => {
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
        expect(topic.slug).not.toMatch(/^week-\d/);
      }
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
