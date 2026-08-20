import type { MemberContext } from '@ptah-api/membership';

import {
  asPrismaService,
  countQueries,
  createMockPrisma,
  queryBreakdown,
  type MockLearningPrisma,
} from '../../testing/mock-learning-prisma';
import { LessonCommentsService } from '../comments/lesson-comments.service';
import { ProgressService } from '../progress/progress.service';

import { CourseReadService } from './course-read.service';
import { ModuleLockService } from './module-lock.service';

/**
 * R2.1.2, R2.1.4, R2.1.5, R2.3.5, R2.3.6, R2.4.4, NFR-P4, NFR-P6, NFR-S4.
 *
 * ⚠️ THE SERVICE IS WIRED TO **REAL** COLLABORATORS — `ModuleLockService`,
 * `ProgressService` and `LessonCommentsService`, all against the same Prisma
 * double. Stubbing them would measure only this file, and the query budget
 * below would score a per-row query hidden inside a collaborator as zero. It is
 * the same call `topics-read.service.spec.ts` made for the forum feed, for the
 * same reason.
 */

const CTX: MemberContext = {
  userId: 'member-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

const AN_HOUR = 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function lesson(
  id: string,
  sortOrder: number,
  durationSeconds: number | null = 600,
): Record<string, unknown> {
  return {
    id,
    slug: id,
    title: `Lesson ${id}`,
    sortOrder,
    videoDurationSeconds: durationSeconds,
  };
}

function courseModule(
  id: string,
  sortOrder: number,
  lessons: Record<string, unknown>[],
  releaseAt: Date | null = null,
): Record<string, unknown> {
  return {
    id,
    slug: id,
    title: `Module ${id}`,
    description: null,
    sortOrder,
    releaseAt,
    lessons,
  };
}

/**
 * A three-module course: m1 has two lessons, m2 has two, m3 has one. That is
 * what makes "the last lesson of module 2 has the first lesson of module 3 as
 * its next" a real crossing rather than a coincidence.
 */
function courseTree(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'course-1',
    slug: 'foundations',
    title: 'Foundations',
    description: 'The basics',
    coverImageUrl: null,
    sequential: false,
    modules: [
      courseModule('m1', 100, [lesson('l1', 100), lesson('l2', 200)]),
      courseModule('m2', 200, [lesson('l3', 100), lesson('l4', 200)]),
      courseModule('m3', 300, [lesson('l5', 100)]),
    ],
    ...overrides,
  };
}

interface Wired {
  prisma: MockLearningPrisma;
  service: CourseReadService;
}

function wire(trees: Record<string, unknown>[] = [courseTree()]): Wired {
  const prisma = createMockPrisma();
  prisma.course.findMany.mockResolvedValue(trees);
  prisma.lessonProgress.findMany.mockResolvedValue([]);
  prisma.lesson.findFirst.mockResolvedValue({
    bodyMarkdown: '# The lesson body',
    youtubeVideoId: 'dQw4w9WgXcQ',
    videoTitle: 'A video',
    videoDurationSeconds: 600,
    videoThumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  });
  prisma.lessonComment.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);

  const progress = new ProgressService(asPrismaService(prisma));
  const locks = new ModuleLockService();

  return {
    prisma,
    service: new CourseReadService(
      asPrismaService(prisma),
      locks,
      progress,
      new LessonCommentsService(asPrismaService(prisma), locks, progress),
    ),
  };
}

function completedRows(...lessonIds: string[]): Record<string, unknown>[] {
  return lessonIds.map((lessonId) => ({
    lessonId,
    furthestPositionSeconds: 600,
    completedAt: new Date('2026-08-01T00:00:00.000Z'),
    completionSource: 'auto',
  }));
}

/* -------------------------------------------------------------------------- */

describe('R2.1.2 — a draft or invisible course is 404, by the query`s own result', () => {
  it('getCourse throws the 404-shaped error when the clause finds nothing', async () => {
    const { service } = wire([]);

    await expect(service.getCourse(CTX, 'foundations')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('and it is never a 403 — nothing in the read path learns the row existed', async () => {
    const { service } = wire([]);

    const failure = await service.getCourse(CTX, 'draft').catch((e) => e);

    expect(failure.status).toBe(404);
    expect(failure.status).not.toBe(403);
  });

  it('the tree read composes visibility, `published: true` and NOT_DELETED', async () => {
    const { prisma, service } = wire();

    await service.listCourses(CTX);
    const where = prisma.course.findMany.mock.calls[0]?.[0]?.where;

    expect(where).toMatchObject({ deletedAt: null, published: true });
    expect(where.OR).toEqual([{ visibility: 'member' }]);
  });

  it('a cohort course is invisible to a zero-cohort member — the clause omits hasSome', async () => {
    // The live gate: the dev account holds the entitlement, is in ADMIN_EMAILS
    // and has ZERO member_group_assignments.
    const { prisma, service } = wire();

    await service.listCourses(CTX);

    expect(
      JSON.stringify(prisma.course.findMany.mock.calls[0]?.[0]?.where),
    ).not.toContain('hasSome');
  });

  it('listCourses returns [] and issues no progress query for a member with no courses', async () => {
    const { prisma, service } = wire([]);

    expect(await service.listCourses(CTX)).toEqual([]);
    expect(prisma.lessonProgress.findMany).not.toHaveBeenCalled();
  });
});

describe('🔴 R2.3.5 — the percentage is computed from COUNTS, never from seconds', () => {
  it('3 of 5 lessons complete ⇒ 60', async () => {
    const { prisma, service } = wire();
    prisma.lessonProgress.findMany.mockResolvedValue(
      completedRows('l1', 'l2', 'l3'),
    );

    const [course] = await service.listCourses(CTX);

    expect(course).toMatchObject({
      completedLessons: 3,
      totalLessons: 5,
      percent: 60,
    });
  });

  it('a member who watched 89% of EVERY lesson is at 0 — the threshold is per-lesson', async () => {
    // The confusion this assertion exists for: `percent` is not "seconds
    // watched over seconds total". Averaging watch positions across lessons of
    // different lengths produces a number that means nothing and disagrees with
    // the completion ticks beside it.
    const { prisma, service } = wire();
    prisma.lessonProgress.findMany.mockResolvedValue(
      ['l1', 'l2', 'l3', 'l4', 'l5'].map((lessonId) => ({
        lessonId,
        furthestPositionSeconds: 534, // 89% of 600
        completedAt: null,
        completionSource: null,
      })),
    );

    const [course] = await service.listCourses(CTX);

    expect(course?.percent).toBe(0);
    expect(course?.completedLessons).toBe(0);
  });

  it('🔴 totalLessons === 0 ⇒ percent 0, never NaN', async () => {
    // A course with no lessons is a REAL state — an admin creates the shell
    // first — and `NaN%` on the member home screen is the visible failure.
    const { service } = wire([courseTree({ modules: [] })]);

    const [course] = await service.listCourses(CTX);

    expect(course?.percent).toBe(0);
    expect(Number.isNaN(course?.percent)).toBe(false);
  });

  it('a module with zero lessons does not distort the denominator', async () => {
    const { prisma, service } = wire([
      courseTree({
        modules: [
          courseModule('m1', 100, [lesson('l1', 100)]),
          courseModule('m2', 200, []),
        ],
      }),
    ]);
    prisma.lessonProgress.findMany.mockResolvedValue(completedRows('l1'));

    const [course] = await service.listCourses(CTX);

    expect(course).toMatchObject({ totalLessons: 1, percent: 100 });
  });

  it('nothing in the read model imports the completion arithmetic', () => {
    // 🔴 THE STRUCTURAL HALF OF RISK-O. `percent` is a THIRD unit; a service
    // that reached for `completion.ts` would be one edit away from computing it
    // from seconds.
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, 'course-read.service.ts'),
      'utf8',
    ) as string;

    expect(source).not.toContain("from '../progress/completion'");
    expect(source).not.toContain('COMPLETION_THRESHOLD_RATIO');
    expect(source).not.toContain('isAutoComplete');
    expect(source).not.toMatch(/\*\s*0\.9/);
  });
});

describe('🔴 R2.1.5 — prev/next cross MODULE boundaries', () => {
  it('the LAST lesson of module 2 has the FIRST lesson of module 3 as its next', async () => {
    const { service } = wire();

    const detail = await service.getLesson(CTX, 'foundations', 'l4');

    expect(detail.next).toEqual({
      slug: 'l5',
      title: 'Lesson l5',
      moduleTitle: 'Module m3',
    });
    expect(detail.previous?.slug).toBe('l3');
  });

  it('the FIRST lesson of the course has previous: null', async () => {
    const { service } = wire();

    const detail = await service.getLesson(CTX, 'foundations', 'l1');

    expect(detail.previous).toBeNull();
    expect(detail.next?.slug).toBe('l2');
  });

  it('the LAST lesson of the course has next: null', async () => {
    const { service } = wire();

    const detail = await service.getLesson(CTX, 'foundations', 'l5');

    expect(detail.next).toBeNull();
    expect(detail.previous?.slug).toBe('l4');
  });

  it('🔴 traversal goes THROUGH a locked module, it does not skip it', async () => {
    // R2.4.4 says a locked module's titles may be visible, so skipping its
    // lessons would make `next` jump a module — and the outline and the player
    // would disagree about what comes next.
    const { service } = wire([
      courseTree({
        modules: [
          courseModule('m1', 100, [lesson('l1', 100)]),
          courseModule(
            'm2',
            200,
            [lesson('l2', 100)],
            new Date(Date.now() + 24 * AN_HOUR),
          ),
          courseModule('m3', 300, [lesson('l3', 100)]),
        ],
      }),
    ]);

    const detail = await service.getLesson(CTX, 'foundations', 'l1');

    expect(detail.next?.slug).toBe('l2');
  });

  it('a ref carries the module title, because the neighbour is often in another module', async () => {
    const { service } = wire();

    const detail = await service.getLesson(CTX, 'foundations', 'l2');

    expect(detail.next).toEqual({
      slug: 'l3',
      title: 'Lesson l3',
      moduleTitle: 'Module m2',
    });
  });

  it('the order comes from DETERMINISTIC_ORDER_BY at every level', async () => {
    const { prisma, service } = wire();

    await service.getCourse(CTX, 'foundations');
    const args = prisma.course.findMany.mock.calls[0]?.[0];
    const expected = [
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ];

    expect(args.orderBy).toEqual(expected);
    expect(args.select.modules.orderBy).toEqual(expected);
    expect(args.select.modules.select.lessons.orderBy).toEqual(expected);
  });
});

describe('🔴 R2.4.4 — the outline`s redaction is STRUCTURAL', () => {
  it("a locked module's lesson objects have NO bodyMarkdown, youtubeVideoId or comments KEY AT ALL", async () => {
    // `undefined` is not enough: `JSON.stringify` drops it, but a later
    // `?? null` on the client would not, and the field would silently reappear
    // as an explicit null the day someone adds a spread.
    const { service } = wire([
      courseTree({
        modules: [
          courseModule(
            'm1',
            100,
            [lesson('l1', 100)],
            new Date(Date.now() + 24 * AN_HOUR),
          ),
        ],
      }),
    ]);

    const detail = await service.getCourse(CTX, 'foundations');
    const [module] = detail.modules;
    const [outlineLesson] = module?.lessons ?? [];

    expect(module?.locked).toBe(true);
    expect(Object.keys(outlineLesson ?? {}).sort()).toEqual([
      'completed',
      'durationSeconds',
      'id',
      'slug',
      'sortOrder',
      'title',
    ]);
    expect('bodyMarkdown' in (outlineLesson ?? {})).toBe(false);
    expect('youtubeVideoId' in (outlineLesson ?? {})).toBe(false);
    expect('comments' in (outlineLesson ?? {})).toBe(false);
  });

  it('an UNLOCKED module`s outline lessons carry exactly the same keys', async () => {
    // The redaction is a property of the TYPE, not of the lock — which is what
    // makes it impossible for a mapper to forget it for one module.
    const { service } = wire();

    const detail = await service.getCourse(CTX, 'foundations');

    expect(detail.modules[0]?.locked).toBe(false);
    expect(Object.keys(detail.modules[0]?.lessons[0] ?? {}).sort()).toEqual([
      'completed',
      'durationSeconds',
      'id',
      'slug',
      'sortOrder',
      'title',
    ]);
  });

  it('a locked module still lists its lessons — it is not omitted', async () => {
    const { service } = wire([
      courseTree({
        modules: [
          courseModule(
            'm1',
            100,
            [lesson('l1', 100), lesson('l2', 200)],
            new Date(Date.now() + 24 * AN_HOUR),
          ),
        ],
      }),
    ]);

    const detail = await service.getCourse(CTX, 'foundations');

    expect(detail.modules[0]?.lessons).toHaveLength(2);
    expect(detail.modules[0]?.lockReason).toBe('not_released');
    expect(detail.modules[0]?.unlocksAt).toEqual(expect.any(String));
  });

  it('🔴 requesting a lesson in a locked module is 403 with the machine reason, NOT 404', async () => {
    // §8.2 P3 exit-gate clause 1: the refusal comes from the API, not a CSS
    // state. And it is 403 rather than 404 because `getCourse` already showed
    // this member the module — answering "not found" would contradict the
    // response they are looking at.
    const { service } = wire([
      courseTree({
        modules: [
          courseModule(
            'm1',
            100,
            [lesson('l1', 100)],
            new Date(Date.now() + 24 * AN_HOUR),
          ),
        ],
      }),
    ]);

    const failure = await service
      .getLesson(CTX, 'foundations', 'l1')
      .catch((e) => e);

    expect(failure.status).toBe(403);
    expect(failure.response.reason).toBe('not_released');
    expect(failure.response.unlocksAt).toEqual(expect.any(String));
  });

  it('and the 403 fires BEFORE the body is read — no withheld text is even fetched', async () => {
    const { prisma, service } = wire([
      courseTree({
        modules: [
          courseModule(
            'm1',
            100,
            [lesson('l1', 100)],
            new Date(Date.now() + 24 * AN_HOUR),
          ),
        ],
      }),
    ]);

    await service.getLesson(CTX, 'foundations', 'l1').catch(() => undefined);

    expect(prisma.lesson.findFirst).not.toHaveBeenCalled();
    expect(prisma.lessonComment.findMany).not.toHaveBeenCalled();
  });

  it('a sequential lock refuses with its own reason and a null unlocksAt', async () => {
    const { service } = wire([courseTree({ sequential: true })]);

    const failure = await service
      .getLesson(CTX, 'foundations', 'l3')
      .catch((e) => e);

    expect(failure.status).toBe(403);
    expect(failure.response.reason).toBe('previous_module_incomplete');
    expect(failure.response.unlocksAt).toBeNull();
  });
});

describe('R2.3.6 — resume is the first incomplete lesson in COURSE order', () => {
  it('crosses module boundaries', async () => {
    const { prisma, service } = wire();
    prisma.lessonProgress.findMany.mockResolvedValue(
      completedRows('l1', 'l2', 'l3'),
    );

    const detail = await service.getCourse(CTX, 'foundations');

    expect(detail.resumeLesson).toEqual({
      slug: 'l4',
      title: 'Lesson l4',
      moduleTitle: 'Module m2',
    });
  });

  it('is the FIRST lesson when nothing is complete', async () => {
    const { service } = wire();

    expect(
      (await service.getCourse(CTX, 'foundations')).resumeLesson?.slug,
    ).toBe('l1');
  });

  it('is null when every lesson is complete', async () => {
    const { prisma, service } = wire();
    prisma.lessonProgress.findMany.mockResolvedValue(
      completedRows('l1', 'l2', 'l3', 'l4', 'l5'),
    );

    expect(
      (await service.getCourse(CTX, 'foundations')).resumeLesson,
    ).toBeNull();
  });

  it('is null for a course with no lessons', async () => {
    const { service } = wire([courseTree({ modules: [] })]);

    expect(
      (await service.getCourse(CTX, 'foundations')).resumeLesson,
    ).toBeNull();
  });

  it('skips a completed lesson even in the MIDDLE of a module', async () => {
    // The negative control for "resume = first lesson of first incomplete
    // module", which is a different and wrong derivation.
    const { prisma, service } = wire();
    prisma.lessonProgress.findMany.mockResolvedValue(completedRows('l1'));

    expect(
      (await service.getCourse(CTX, 'foundations')).resumeLesson?.slug,
    ).toBe('l2');
  });
});

describe('🔴 the query budget, with its exact composition', () => {
  it('listCourses costs exactly 2 queries and does not grow with the number of courses', async () => {
    const { prisma, service } = wire(
      Array.from({ length: 12 }, (_, i) =>
        courseTree({ id: `c${i}`, slug: `c${i}` }),
      ),
    );

    await service.listCourses(CTX);

    expect(queryBreakdown(prisma)).toEqual([
      'course.findMany x1', // visible, published, live courses + their tree
      'lessonProgress.findMany x1', // this member's rows, ONE `in` clause
    ]);
    expect(countQueries(prisma)).toBe(2);
  });

  it('getCourse costs exactly 2 queries', async () => {
    // `tasks.md` targets three (course · modules-with-lessons · progress); the
    // nested select folds the first two into one round trip.
    const { prisma, service } = wire();

    await service.getCourse(CTX, 'foundations');

    expect(queryBreakdown(prisma)).toEqual([
      'course.findMany x1',
      'lessonProgress.findMany x1',
    ]);
  });

  it('getLesson costs exactly 5 queries, and the composition is the assertion', async () => {
    // 🔴 STATED RATHER THAN ADJUSTED. `tasks.md` targets three; achieved five,
    // and two of the extra ones are queries the target's own list omits (the
    // comment author names) or deliberately separates (the lesson body — see
    // the service docblock). A count with an unstated composition drifts
    // invisibly, which is what Batch 6C's deviation note records.
    const { prisma, service } = wire();
    prisma.lessonComment.findMany.mockResolvedValue([
      {
        id: 'c1',
        lessonId: 'l1',
        parentId: null,
        bodyMarkdown: 'hi',
        authorId: 'u1',
        answeredAt: null,
        deletedAt: null,
        createdAt: new Date(),
        editedAt: null,
      },
    ]);

    await service.getLesson(CTX, 'foundations', 'l1');

    expect(queryBreakdown(prisma)).toEqual([
      'course.findMany x1', // the tree: the course, its modules, its lessons
      'lesson.findFirst x1', // the target lesson's body + video columns
      'lessonComment.findMany x1', // the thread
      'lessonProgress.findMany x1', // this member's progress across the course
      'user.findMany x1', // ONE batched author-name lookup
    ]);
    expect(countQueries(prisma)).toBe(5);
  });

  it('getLesson costs ONE fewer query when the thread has no live authors', async () => {
    const { prisma, service } = wire();

    await service.getLesson(CTX, 'foundations', 'l1');

    expect(countQueries(prisma)).toBe(4);
  });

  it('🔴 the count does not grow with the number of LESSONS — the N+1 signature', async () => {
    const { prisma, service } = wire([
      courseTree({
        modules: [
          courseModule(
            'm1',
            100,
            Array.from({ length: 40 }, (_, i) => lesson(`l${i}`, i * 100)),
          ),
        ],
      }),
    ]);

    await service.getCourse(CTX, 'foundations');

    expect(countQueries(prisma)).toBe(2);
  });

  it('never uses findUnique or a per-row findFirst on the tree', async () => {
    const { prisma, service } = wire();

    await service.getCourse(CTX, 'foundations');

    expect(prisma.course.findUnique).not.toHaveBeenCalled();
    expect(prisma.courseModule.findFirst).not.toHaveBeenCalled();
    expect(prisma.lesson.findMany).not.toHaveBeenCalled();
  });
});

describe('AD-5 — NOT_DELETED at every level, including the nested ones', () => {
  it('the tree query filters course, modules AND lessons', async () => {
    // 🔴 THE NESTED ONES ARE THE ONES THAT MATTER. An unfiltered `lessons`
    // relation counts tombstones, which inflates `totalLessons`, which deflates
    // every percentage in the product — silently, consistently, and invisibly
    // to any call-expression scan.
    const { prisma, service } = wire();

    await service.getCourse(CTX, 'foundations');
    const args = prisma.course.findMany.mock.calls[0]?.[0];

    expect(args.where.deletedAt).toBeNull();
    expect(args.select.modules.where).toEqual({ deletedAt: null });
    expect(args.select.modules.select.lessons.where).toEqual({
      deletedAt: null,
    });
  });

  it('carries NO `_count` anywhere — the silent lesson-count inflator', async () => {
    const { prisma, service } = wire();

    await service.getCourse(CTX, 'foundations');

    expect(
      JSON.stringify(prisma.course.findMany.mock.calls[0]?.[0]),
    ).not.toContain('_count');
  });

  it('the body read is NOT_DELETED-filtered too', async () => {
    const { prisma, service } = wire();

    await service.getLesson(CTX, 'foundations', 'l1');

    expect(prisma.lesson.findFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      deletedAt: null,
    });
  });
});

describe('🔴 NFR-S4 / R2.3.7 — every progress read is scoped to ctx.userId', () => {
  it('and to nothing else', async () => {
    const { prisma, service } = wire();

    await service.listCourses(CTX);
    await service.getCourse(CTX, 'foundations');
    await service.getLesson(CTX, 'foundations', 'l1');

    const calls = prisma.lessonProgress.findMany.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [args] of calls) {
      expect(args.where.userId).toBe(CTX.userId);
    }
  });

  it('the returned progress is the caller`s own and carries no other member', async () => {
    const { prisma, service } = wire();
    prisma.lessonProgress.findMany.mockResolvedValue([
      {
        lessonId: 'l1',
        furthestPositionSeconds: 412,
        completedAt: null,
        completionSource: null,
      },
    ]);

    const detail = await service.getLesson(CTX, 'foundations', 'l1');

    expect(detail.progress).toEqual({
      furthestPositionSeconds: 412,
      completedAt: null,
      completionSource: null,
    });
    expect(JSON.stringify(detail)).not.toContain('userId');
  });

  it('a lesson never opened reports position 0 rather than an error', async () => {
    const { service } = wire();

    expect(
      (await service.getLesson(CTX, 'foundations', 'l1')).progress,
    ).toEqual({
      furthestPositionSeconds: 0,
      completedAt: null,
      completionSource: null,
    });
  });
});

describe('🔴 NFR-P6 — no YouTube import, and no YouTube call on a member read', () => {
  it('this file does not import @ptah-api/youtube', () => {
    // ⚠️ IT CHECKS THE **IMPORT**, NOT THE TOKEN. The docblock in the file
    // under test names the package in order to explain why it must not import
    // it — so a raw `toContain` fails on the very documentation that states the
    // rule. Three checks in this batch hit that before this pattern was
    // settled; the honest thing to look at is the module specifier, because an
    // identifier can only enter through one.
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, 'course-read.service.ts'),
      'utf8',
    ) as string;

    const imports = source.match(/import[\s\S]*?from\s+'[^']+';/g) ?? [];

    expect(imports.length).toBeGreaterThan(0);
    expect(
      imports.filter((stmt) => stmt.includes('@ptah-api/youtube')),
    ).toEqual([]);
  });

  it('a member lesson read makes NO network request, over a lesson that HAS a video', async () => {
    // The behavioural half, over the case that would actually be tempting: a
    // fully-configured lesson with an id and persisted metadata. `fetch` is
    // spied and asserted never called — a service that reached for live
    // metadata "just to be fresh" would fail here.
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(
        new Error('no network call may happen on a member read'),
      );

    try {
      const { service } = wire();
      const detail = await service.getLesson(CTX, 'foundations', 'l1');

      expect(detail.youtubeVideoId).toBe('dQw4w9WgXcQ');
      expect(detail.videoTitle).toBe('A video');
      expect(detail.videoDurationSeconds).toBe(600);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('every video field comes from the persisted columns', async () => {
    const { prisma, service } = wire();

    const detail = await service.getLesson(CTX, 'foundations', 'l1');
    const select = prisma.lesson.findFirst.mock.calls[0]?.[0]?.select;

    expect(Object.keys(select).sort()).toEqual([
      'bodyMarkdown',
      'videoDurationSeconds',
      'videoThumbnailUrl',
      'videoTitle',
      'youtubeVideoId',
    ]);
    expect(detail.videoThumbnailUrl).toContain('i.ytimg.com');
  });
});

describe('404s that are not about visibility', () => {
  it('a lesson slug that is not in this course is 404', async () => {
    const { service } = wire();

    await expect(
      service.getLesson(CTX, 'foundations', 'no-such-lesson'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('a course with no lessons still renders an outline rather than failing', async () => {
    const { service } = wire([courseTree({ modules: [] })]);

    await expect(service.getCourse(CTX, 'foundations')).resolves.toMatchObject({
      modules: [],
      totalLessons: 0,
      percent: 0,
    });
  });
});
