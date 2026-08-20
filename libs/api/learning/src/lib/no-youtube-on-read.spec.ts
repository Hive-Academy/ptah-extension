import 'reflect-metadata';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import ts from 'typescript';
import type { YouTubeMetadataProvider } from '@ptah-api/youtube';
import type { MemberContext } from '@ptah-api/membership';

import {
  asPrismaService,
  createMockPrisma,
  type MockLearningPrisma,
} from '../testing/mock-learning-prisma';

import { LessonCommentsService } from './comments/lesson-comments.service';
import { CourseReadService } from './courses/course-read.service';
import { ModuleLockService } from './courses/module-lock.service';
import { LessonVideoService } from './lessons/lesson-video.service';
import { ProgressService } from './progress/progress.service';

/**
 * 🔴 NFR-P6 — **NO YOUTUBE REQUEST FIRES ON A MEMBER LESSON READ.**
 * Exit-gate clause 4 for Phase 3's backend half, and the mitigation for RISK-P.
 *
 * ⚠️ WHY THIS FILE EXISTS RATHER THAN ONE ASSERTION SOMEWHERE.
 * "We did not call it" is TRIVIALLY TRUE of a test that exercises nothing. That
 * is RISK-P, rated HIGH, and this task has already produced the same failure
 * twice in other shapes: Batch 6's carried item 2 (a trigram `EXPLAIN` that was
 * vacuous at 0 rows) and Batch 8's Finding 6 (a byte comparison against a corpus
 * the transform left unchanged). Batch 8's was found only because somebody tried
 * to make the test fail.
 *
 * So the property is asserted TWO INDEPENDENT WAYS, and each half is written so
 * that it cannot pass on an empty set:
 *
 *   (a) STRUCTURALLY — the set of files importing `@ptah-api/youtube` is
 *       asserted BY NAME, by exact equality, the way
 *       `markdown-chokepoint.spec.ts` pins its importers. Plus anti-vacuity: the
 *       scan must have seen at least `MIN_SCANNED_FILES` files, and the one
 *       known CONSUMER must really import it.
 *
 *   (b) BEHAVIOURALLY — the REAL member read path (`CourseReadService.getLesson`)
 *       runs against a `YouTubeMetadataProvider` double whose `fetchVideo`
 *       THROWS, over a lesson that HAS a `youtubeVideoId` and full persisted
 *       metadata. The read must return that metadata from the persisted columns
 *       and the double must record ZERO calls.
 *
 * ⚠️ "HAS A VIDEO AND FULL METADATA" IS WHAT STOPS (b) BEING VACUOUS. A lesson
 * with `youtubeVideoId: null` proves nothing — there would be nothing to fetch —
 * and ⚠️ EVERY SEEDED LESSON IN THIS WORKSPACE HAS EXACTLY THAT (plan §7.3), so
 * the fixture is constructed deliberately rather than borrowed.
 *
 * ⚠️ COMMENTS ARE STRIPPED BEFORE THE STRUCTURAL SCAN, AND WITH THE TYPESCRIPT
 * COMPILER RATHER THAN A REGEXP. Half the files in this lib DISCUSS this rule in
 * their docblocks — telling the next reader not to import the package is exactly
 * the documentation the rule wants. Matching raw text would make every warning a
 * violation, and the only way to stay green would be to delete the warnings.
 * A regexp cannot tell `//` inside a URL from a line comment, and truncating at
 * `https://` would create a place a needle could hide; Batch 7's Task 7.9 hit
 * exactly this and `ts.transpileModule({ removeComments: true })` is its
 * solution.
 *
 * ⚠️ THE IMPORTER SET IS **TWO** FILES, NOT ONE, AND THE SECOND IS UNAVOIDABLE.
 * `learning.module.ts` must import `YoutubeModule` to make the provider
 * injectable — that is Nest wiring, and there is no way to register a provider
 * without naming the module that exports it. It is separated from the CONSUMER
 * set below and asserted to bind only the module token, which has no
 * `fetchVideo` on it. So the property that matters — exactly one file in this
 * lib can issue a YouTube request — is asserted directly rather than approximated
 * by a file count.
 */

/** `src/lib` — this file lives at its root. */
const LIB_ROOT = resolve(__dirname);

/**
 * Anti-vacuity floor for the walk.
 *
 * A glob that silently matches nothing turns every "the set is exactly X"
 * assertion into a comparison of two empty arrays. `libs/api/learning/src/lib`
 * held 40 non-spec `.ts` files when Batch 9C closed; 25 is a floor with room for
 * a refactor that consolidates files, not a target.
 */
const MIN_SCANNED_FILES = 25;

/**
 * THE ONE FILE THAT MAY CONSUME `@ptah-api/youtube` — the authoring-time
 * fetch-and-persist path.
 *
 * Metadata is fetched ONCE, here, and persisted onto `Lesson`. Plan §4.5:
 * persistence IS the cache, because there is no read-path call to cache.
 */
const KNOWN_CONSUMER = 'lessons/lesson-video.service.ts';

/** The wiring file, which imports the MODULE token and cannot fetch anything. */
const KNOWN_WIRING = 'learning.module.ts';

/** The directories a member read is served from. None may reach the package. */
const MEMBER_READ_DIRS = ['courses', 'progress', 'comments'] as const;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

/** Every non-spec `.ts` under `src/lib`, as `/`-separated relative paths. */
const SCANNED: readonly string[] = walk(LIB_ROOT)
  .filter((file) => !file.endsWith('.spec.ts'))
  .map((file) =>
    file
      .slice(LIB_ROOT.length + 1)
      .split(sep)
      .join('/'),
  )
  .sort();

/**
 * The module specifiers a file imports, with COMMENTS REMOVED first.
 *
 * `ts.transpileModule` re-emits the source without comments; the import
 * statements are then read off the emitted text. Reading specifiers rather than
 * searching for a substring also means an alias, a re-export or a
 * `import type` cannot hide.
 */
function importSpecifiersOf(relativePath: string): string[] {
  const source = readFileSync(
    join(LIB_ROOT, ...relativePath.split('/')),
    'utf8',
  );

  const stripped = ts.transpileModule(source, {
    compilerOptions: {
      removeComments: true,
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.ESNext,
      // Keep `import type` in the output so a type-only import of the provider
      // still counts as reaching the package.
      verbatimModuleSyntax: false,
      isolatedModules: true,
    },
  }).outputText;

  return [...stripped.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1] as string,
  );
}

const IMPORTERS: readonly string[] = SCANNED.filter((file) =>
  importSpecifiersOf(file).includes('@ptah-api/youtube'),
);

/* -------------------------------------------------------------------------- */
/* (b) — the behavioural half's fixtures                                       */
/* -------------------------------------------------------------------------- */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

/**
 * 🔴 A LESSON THAT **HAS** A VIDEO AND FULL PERSISTED METADATA.
 *
 * Every field below is what an `'api'`-sourced authoring write left behind. If
 * `youtubeVideoId` were `null` here, the behavioural assertion would be vacuous:
 * there would be nothing for a read path to look up, and a read path that DID
 * call YouTube would still record zero calls.
 */
const PERSISTED_VIDEO = {
  youtubeVideoId: 'dQw4w9WgXcQ',
  videoTitle: 'Persisted at authoring time',
  videoDurationSeconds: 300,
  videoThumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
} as const;

const COURSE_TREE = {
  id: 'c-1',
  slug: 'foundations',
  title: 'Foundations',
  description: 'The basics.',
  coverImageUrl: null,
  sequential: false,
  modules: [
    {
      id: 'm-1',
      slug: 'getting-started',
      title: 'Getting started',
      description: null,
      sortOrder: 100,
      releaseAt: null,
      lessons: [
        {
          id: 'l-1',
          slug: 'intro',
          title: 'Intro',
          sortOrder: 100,
          videoDurationSeconds: PERSISTED_VIDEO.videoDurationSeconds,
        },
      ],
    },
  ],
};

/**
 * A provider whose `fetchVideo` THROWS.
 *
 * ⚠️ THROWS RATHER THAN RESOLVES. A stub that resolved a value would let a read
 * path that called it still return a correct-looking response, and the only
 * evidence would be the call count — which is precisely the assertion a
 * refactor is most likely to delete. Throwing makes the wrong behaviour a
 * FAILED TEST rather than a missing expectation.
 */
function throwingProvider(calls: string[]): YouTubeMetadataProvider {
  return {
    isEnabled: () => true,
    fetchVideo: (videoId: string) => {
      calls.push(videoId);
      throw new Error(
        'NFR-P6 VIOLATION: a member lesson read reached the YouTube Data API.',
      );
    },
  } as unknown as YouTubeMetadataProvider;
}

/** The REAL member read path, with its REAL collaborators. */
function readPath(prisma: MockLearningPrisma): CourseReadService {
  const client = asPrismaService(prisma);
  const locks = new ModuleLockService();
  const progress = new ProgressService(client);

  return new CourseReadService(
    client,
    locks,
    progress,
    // The REAL comments service, with its REAL lock and progress collaborators
    // — so a YouTube call hidden inside a collaborator is exercised too.
    // Stubbing it would have measured only `course-read.service.ts`.
    new LessonCommentsService(client, locks, progress),
  );
}

/* -------------------------------------------------------------------------- */

describe('🔴 NFR-P6 — no YouTube request fires on a member lesson read', () => {
  describe('(a) structurally — the importer set, by name', () => {
    it('is EXACTLY the wiring file and the one consumer', () => {
      expect([...IMPORTERS]).toEqual([KNOWN_WIRING, KNOWN_CONSUMER].sort());
    });

    it('no file under courses/, progress/ or comments/ reaches the package', () => {
      // The directories a member read is actually served from. Stated
      // separately from the exact-equality assertion above so a failure says
      // WHICH member-facing directory acquired the import — which is the fact a
      // reviewer needs.
      const offenders = IMPORTERS.filter((file) =>
        MEMBER_READ_DIRS.some((dir) => file.startsWith(`${dir}/`)),
      );

      expect(offenders).toEqual([]);
    });

    it('the wiring file binds only the MODULE token — it cannot fetch', () => {
      // What makes a two-file set safe. `YoutubeModule` is a Nest module: no
      // `fetchVideo`, no `isEnabled`. Importing it grants the ability to make
      // the provider injectable somewhere else, not the ability to call it.
      //
      // ⚠️ READ FROM THE IMPORT CLAUSE, NOT THE FILE TEXT (Batch 9B's F-5): the
      // module's docblock names the provider in prose to explain why it must not
      // import it.
      const source = readFileSync(
        join(LIB_ROOT, ...KNOWN_WIRING.split('/')),
        'utf8',
      );
      const clauses = [
        ...source.matchAll(
          /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'@ptah-api\/youtube'/g,
        ),
      ].map((match) =>
        (match[1] ?? '')
          .split(',')
          .map((binding) => binding.trim())
          .filter(Boolean)
          .sort(),
      );

      expect(clauses).toEqual([['YoutubeModule']]);
    });

    it('ANTI-VACUITY: the scan saw the whole lib, not an empty set', () => {
      // A walk that silently matched nothing would make every assertion above a
      // comparison of two empty arrays.
      expect(SCANNED.length).toBeGreaterThanOrEqual(MIN_SCANNED_FILES);
      expect(SCANNED).toContain(KNOWN_CONSUMER);
      expect(SCANNED).toContain(KNOWN_WIRING);
      // …and it reached every member-facing directory.
      for (const dir of MEMBER_READ_DIRS) {
        expect(SCANNED.some((file) => file.startsWith(`${dir}/`))).toBe(true);
      }
    });

    it('ANTI-VACUITY: the known consumer really does import the package', () => {
      // If the detector were broken, the exact-equality assertion would pass on
      // an empty set. This is the positive control.
      expect(importSpecifiersOf(KNOWN_CONSUMER)).toContain('@ptah-api/youtube');
    });

    it('ANTI-VACUITY: comments are stripped, so a docblock is not a violation', () => {
      // The specific failure this file is built to avoid. Several files in this
      // lib name the package in prose; if the scan matched raw text they would
      // all be reported and the only way to green would be deleting the
      // warnings. Proved on a fabricated source rather than on a real file, so
      // it keeps working when the real docblocks are reworded.
      const withOnlyAComment = ts.transpileModule(
        [
          "// Do not import '@ptah-api/youtube' from this file.",
          '/** See `@ptah-api/youtube` for the provider. */',
          "export const url = 'https://youtube.com/watch?v=x';",
        ].join('\n'),
        {
          compilerOptions: {
            removeComments: true,
            target: ts.ScriptTarget.ES2021,
            module: ts.ModuleKind.ESNext,
            isolatedModules: true,
          },
        },
      ).outputText;

      const specifiers = [
        ...withOnlyAComment.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g),
      ].map((match) => match[1]);

      expect(specifiers).not.toContain('@ptah-api/youtube');
      // …and a REAL import in the same file IS detected, so the stripper has not
      // simply eaten everything.
      const withARealImport = ts.transpileModule(
        [
          "// Do not import '@ptah-api/youtube' from this file.",
          "import { VIDEO_ID_PATTERN } from '@ptah-api/youtube';",
          'export const p = VIDEO_ID_PATTERN;',
        ].join('\n'),
        {
          compilerOptions: {
            removeComments: true,
            target: ts.ScriptTarget.ES2021,
            module: ts.ModuleKind.ESNext,
            isolatedModules: true,
          },
        },
      ).outputText;

      expect(
        [
          ...withARealImport.matchAll(
            /(?:from|import|require)\s*\(?['"]([^'"]+)['"]/g,
          ),
        ].map((match) => match[1]),
      ).toContain('@ptah-api/youtube');
    });
  });

  describe('(b) behaviourally — the REAL read path against a throwing provider', () => {
    let prisma: MockLearningPrisma;
    let calls: string[];

    beforeEach(() => {
      calls = [];
      prisma = createMockPrisma();

      prisma.course.findMany.mockResolvedValue([COURSE_TREE]);
      prisma.lesson.findFirst.mockResolvedValue({
        bodyMarkdown: '# Intro',
        ...PERSISTED_VIDEO,
      });
      prisma.lessonComment.findMany.mockResolvedValue([]);
      prisma.lessonProgress.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      // 🔴 IT IS NOT INJECTED, AND THAT IS WORTH SAYING PLAINLY RATHER THAN
      // LETTING `expect(calls).toEqual([])` READ AS THE PROOF.
      // `CourseReadService`'s constructor takes four collaborators and NONE of
      // them is a YouTube provider — the property is true BY CONSTRUCTION, which
      // is stronger than any call count, and it is what the structural half
      // above pins. The consequence is that `calls` cannot fire today: it is a
      // tripwire for a future refactor that DOES inject a provider, not the
      // assertion carrying this clause.
      //
      // THE ASSERTION THAT CAN AND DOES FIRE IS THE `globalThis.fetch` SPY
      // below, and it was PROVEN by deliberate failure: a temporary
      // `await globalThis.fetch('https://www.googleapis.com/youtube/v3/videos…')`
      // added to `getLesson` made it fail with
      // `NFR-P6 VIOLATION: a member read issued a network request.`, while the
      // structural half simultaneously named `courses/course-read.service.ts` as
      // an unexpected importer. Both were reverted and re-confirmed green.
      throwingProvider(calls);
    });

    it('returns the PERSISTED metadata and never calls the provider', async () => {
      const detail = await readPath(prisma).getLesson(
        CTX,
        'foundations',
        'intro',
      );

      // 🔴 The lesson HAS a video and FULL metadata — the fixture is what makes
      // this non-vacuous.
      expect(detail.youtubeVideoId).toBe(PERSISTED_VIDEO.youtubeVideoId);
      expect(detail.videoTitle).toBe(PERSISTED_VIDEO.videoTitle);
      expect(detail.videoDurationSeconds).toBe(
        PERSISTED_VIDEO.videoDurationSeconds,
      );
      expect(detail.videoThumbnailUrl).toBe(PERSISTED_VIDEO.videoThumbnailUrl);

      expect(calls).toEqual([]);
    });

    it('issues no NETWORK request of any kind — global fetch is never touched', () => {
      // The belt to the structural braces: even a read path that reached YouTube
      // WITHOUT going through the provider (a hand-rolled `fetch`) would be
      // caught here.
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(
          new Error(
            'NFR-P6 VIOLATION: a member read issued a network request.',
          ),
        );

      return readPath(prisma)
        .getLesson(CTX, 'foundations', 'intro')
        .then(() => {
          expect(fetchSpy).not.toHaveBeenCalled();
        })
        .finally(() => {
          fetchSpy.mockRestore();
        });
    });

    it('the course LIST and the course DETAIL make no request either', async () => {
      // `getLesson` is the route the requirement names, but a member reaches it
      // through two other reads and a leak in either would be just as real.
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('NFR-P6 VIOLATION'));

      try {
        const service = readPath(prisma);
        await service.listCourses(CTX);
        await service.getCourse(CTX, 'foundations');

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('ANTI-VACUITY: the read path really ran and really produced the lesson', async () => {
      // Without this, a `getLesson` that threw early would satisfy "zero calls"
      // perfectly. It asserts the read actually happened AND that the tree query
      // was issued.
      const detail = await readPath(prisma).getLesson(
        CTX,
        'foundations',
        'intro',
      );

      expect(detail.slug).toBe('intro');
      expect(detail.bodyMarkdown).toBe('# Intro');
      expect(prisma.course.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.lesson.findFirst).toHaveBeenCalledTimes(1);
    });

    it('ANTI-VACUITY: the throwing double really does throw when called', async () => {
      // The positive control for the double itself. If `fetchVideo` silently
      // resolved, "zero calls" would be the only thing standing between a
      // regression and a green suite.
      const provider = throwingProvider(calls);

      expect(() => provider.fetchVideo('dQw4w9WgXcQ')).toThrow(
        /NFR-P6 VIOLATION/,
      );
      expect(calls).toEqual(['dQw4w9WgXcQ']);
    });
  });

  describe('the authoring path is where a request DOES belong', () => {
    it('LessonVideoService is constructed WITH a provider — the read model is not', () => {
      // States the asymmetry the whole requirement rests on, as a fact about the
      // two constructors rather than as prose. `CourseReadService` takes four
      // collaborators and none of them can reach YouTube; `LessonVideoService`
      // takes the provider explicitly.
      expect(LessonVideoService.length).toBe(2);
      expect(CourseReadService.length).toBe(4);
    });
  });
});
