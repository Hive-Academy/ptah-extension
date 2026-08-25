import type { MemberContext } from '@ptah-api/membership';

import {
  asPrismaService,
  createMockPrisma,
  type MockLearningPrisma,
} from '../../testing/mock-learning-prisma';

import { ProgressService, toMemberLessonProgress } from './progress.service';

/**
 * R2.3.1 – R2.3.7, §4.6.5, §4.6.6, NFR-S4, ASSUMPTION-8.
 *
 * 🔴 THIS SPEC COVERS THE **WRITE** DIRECTION OF THE UNIT HAZARD, WHICH IS THE
 * HALF `completion.spec.ts` CANNOT SEE.
 *
 * Batch 6.1's finding was that `postCount` and `lastReadPostNumber` were
 * "consistent with each other and all wrong" across four sites, and that ONE of
 * those sites was a WRITE that stored one unit into the other's column — which
 * is why the obvious one-line fix to the read would have created a louder
 * defect. A pure-function spec over `isAutoComplete` cannot detect a service
 * that stores a DURATION into `furthestPositionSeconds`, or that compares the
 * submitted position against the wrong column. So the tests below drive the
 * REAL service against an in-memory model of `lesson_progress`, and after every
 * step they assert what is IN THE TABLE, not what the service returned.
 *
 * ⚠️ THE MOCK IMPLEMENTS THE PRISMA OPERATORS THIS SERVICE EMITS, AND THROWS ON
 * ANY OTHER. Monotonicity and auto-completion are both expressed as `where`
 * conditions evaluated by Postgres (`furthestPositionSeconds: { lt: n }`,
 * `{ gte: t }`, `completedAt: null`) — a mock that ignored the `where` and
 * applied every `updateMany` would make the two most important tests here pass
 * against a service that had no conditions at all. {@link matchesWhere} models
 * them, and refuses an operator it does not implement rather than returning
 * `false` and silently skipping a write.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

/** R2.3.2's threshold, DECLARED HERE and never imported — see `completion.spec.ts`. */
const NINETY_PERCENT = 0.9;

/* -------------------------------------------------------------------------- */
/* An in-memory model of `course_lessons` + `lesson_progress`                  */
/* -------------------------------------------------------------------------- */

interface LessonRow {
  readonly id: string;
  readonly videoDurationSeconds: number | null;
}

interface ProgressRow {
  userId: string;
  lessonId: string;
  furthestPositionSeconds: number;
  completedAt: Date | null;
  completionSource: string | null;
}

interface World {
  lessons: LessonRow[];
  progress: ProgressRow[];
}

type Scalar = string | number | Date | null | undefined;
type Condition = Scalar | { lt?: number; gte?: number; in?: string[] };

/**
 * Does one stored row satisfy a `where` clause?
 *
 * ⚠️ IT THROWS ON AN OPERATOR IT DOES NOT MODEL. That is the guard: a future
 * `where` using, say, `not` would otherwise evaluate to `false`, the write
 * would silently not happen, and the test asserting monotonicity would pass for
 * the wrong reason.
 */
function matchesWhere(
  row: ProgressRow,
  where: Record<string, Condition>,
): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const actual = (row as unknown as Record<string, Scalar>)[key];

    if (
      condition !== null &&
      typeof condition === 'object' &&
      !(condition instanceof Date)
    ) {
      const operators = Object.keys(condition);
      const unsupported = operators.filter(
        (op) => op !== 'lt' && op !== 'gte' && op !== 'in',
      );
      if (unsupported.length > 0) {
        throw new Error(
          `progress.service.spec.ts models only 'lt', 'gte' and 'in'; the ` +
            `service emitted: ${unsupported.join(', ')} on "${key}". Extend the model.`,
        );
      }
      if (condition.lt !== undefined && !((actual as number) < condition.lt)) {
        return false;
      }
      if (
        condition.gte !== undefined &&
        !((actual as number) >= condition.gte)
      ) {
        return false;
      }
      if (
        condition.in !== undefined &&
        !condition.in.includes(actual as string)
      ) {
        return false;
      }
      continue;
    }

    if (actual !== condition) return false;
  }
  return true;
}

/**
 * Wire the shared mock to the world so the REAL service drives real state.
 *
 * The `lesson.findFirst` stub deliberately IGNORES the visibility clause's
 * contents and only records it — visibility is `visibility.spec.ts`'s subject;
 * what matters here is that this file passes one through, which is asserted
 * separately below.
 */
function wire(world: World): {
  prisma: MockLearningPrisma;
  service: ProgressService;
} {
  const prisma = createMockPrisma();

  prisma.lesson.findFirst.mockImplementation(
    async (args: { where: { id: string } }) =>
      world.lessons.find((lesson) => lesson.id === args.where.id) ?? null,
  );

  const find = (userId: string, lessonId: string): ProgressRow | undefined =>
    world.progress.find(
      (row) => row.userId === userId && row.lessonId === lessonId,
    );

  prisma.lessonProgress.upsert.mockImplementation(
    async (args: {
      where: { userId_lessonId: { userId: string; lessonId: string } };
      create: Partial<ProgressRow> & { userId: string; lessonId: string };
      update: Partial<ProgressRow>;
    }) => {
      const { userId, lessonId } = args.where.userId_lessonId;
      const existing = find(userId, lessonId);

      if (existing) {
        Object.assign(existing, args.update);
        return existing;
      }

      const created: ProgressRow = {
        furthestPositionSeconds: 0,
        completedAt: null,
        completionSource: null,
        ...args.create,
        userId,
        lessonId,
      };
      world.progress.push(created);
      return created;
    },
  );

  prisma.lessonProgress.updateMany.mockImplementation(
    async (args: {
      where: Record<string, Condition>;
      data: Partial<ProgressRow>;
    }) => {
      const hit = world.progress.filter((row) => matchesWhere(row, args.where));
      for (const row of hit) Object.assign(row, args.data);
      return { count: hit.length };
    },
  );

  prisma.lessonProgress.findUnique.mockImplementation(
    async (args: {
      where: { userId_lessonId: { userId: string; lessonId: string } };
    }) => {
      const { userId, lessonId } = args.where.userId_lessonId;
      return find(userId, lessonId) ?? null;
    },
  );

  prisma.lessonProgress.findMany.mockImplementation(
    async (args: { where: Record<string, Condition> }) =>
      world.progress.filter((row) => matchesWhere(row, args.where)),
  );

  return { prisma, service: new ProgressService(asPrismaService(prisma)) };
}

/** The row as it actually sits in the table — the assertion target. */
function stored(world: World, lessonId: string): ProgressRow | undefined {
  return world.progress.find(
    (row) => row.userId === CTX.userId && row.lessonId === lessonId,
  );
}

const LESSON_WITH_VIDEO: LessonRow = {
  id: 'lesson-video',
  videoDurationSeconds: 600,
};

/**
 * The fixture lesson's duration, narrowed once.
 *
 * ⚠️ A NAMED CONSTANT RATHER THAN `LESSON_WITH_VIDEO.videoDurationSeconds!` AT
 * EACH CALL SITE. The `!` would be right today and silently wrong the moment
 * the fixture is edited to a `null` duration, which is a plausible edit in a
 * file whose whole subject is the null-duration branch.
 */
const VIDEO_DURATION = 600;
const LESSON_NO_DURATION: LessonRow = {
  id: 'lesson-manual',
  videoDurationSeconds: null,
};
const LESSON_ZERO_DURATION: LessonRow = {
  id: 'lesson-pt0s',
  videoDurationSeconds: 0,
};

function freshWorld(): World {
  return {
    lessons: [LESSON_WITH_VIDEO, LESSON_NO_DURATION, LESSON_ZERO_DURATION],
    progress: [],
  };
}

/* -------------------------------------------------------------------------- */

describe('updateProgress — R2.3.1, monotonic in the DATABASE', () => {
  it('records a first position for a lesson never opened', async () => {
    const world = freshWorld();
    const { service } = wire(world);

    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 120);

    expect(stored(world, LESSON_WITH_VIDEO.id)).toMatchObject({
      furthestPositionSeconds: 120,
      completedAt: null,
      completionSource: null,
    });
  });

  it('🔴 seeking backwards does NOT regress the stored position', async () => {
    const world = freshWorld();
    const { service } = wire(world);

    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 400);
    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 30);

    expect(stored(world, LESSON_WITH_VIDEO.id)?.furthestPositionSeconds).toBe(
      400,
    );
  });

  it('the monotonic guard is a `where` condition, not a JavaScript comparison', () => {
    // The property that closes the two-tabs TOCTOU gap. Asserted structurally
    // as well as behaviourally, because a service that read the row, compared
    // in JS and wrote unconditionally would pass the test above whenever the
    // two calls do not interleave — i.e. always, in a test.
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, 'progress.service.ts'),
      'utf8',
    ) as string;

    expect(source).toContain('furthestPositionSeconds: { lt: position }');
  });

  it('advances through a whole playback, in order', async () => {
    const world = freshWorld();
    const { service } = wire(world);

    for (const position of [0, 60, 55, 180, 179, 300]) {
      await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, position);
    }

    expect(stored(world, LESSON_WITH_VIDEO.id)?.furthestPositionSeconds).toBe(
      300,
    );
  });

  it('rejects a negative position with 400 and writes nothing', async () => {
    const world = freshWorld();
    const { prisma, service } = wire(world);

    await expect(
      service.updateProgress(CTX, LESSON_WITH_VIDEO.id, -1),
    ).rejects.toMatchObject({ status: 400 });

    expect(world.progress).toEqual([]);
    // Not even the lesson lookup — the argument is refused at the boundary.
    expect(prisma.lesson.findFirst).not.toHaveBeenCalled();
  });

  it('clamps a position past the end rather than rejecting it', async () => {
    // §4.6.5 — the final tick after `ended` routinely lands past the persisted
    // duration, and refusing it would prevent the completing write from ever
    // landing.
    const world = freshWorld();
    const { service } = wire(world);

    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 604);

    expect(stored(world, LESSON_WITH_VIDEO.id)?.furthestPositionSeconds).toBe(
      600,
    );
  });

  it('a hostile client cannot buy completion with a large number — it is clamped first', async () => {
    const world = freshWorld();
    const { service } = wire(world);

    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 10 ** 9);

    expect(stored(world, LESSON_WITH_VIDEO.id)?.furthestPositionSeconds).toBe(
      600,
    );
  });

  it('404s for a lesson the member cannot see, and writes nothing', async () => {
    const world = freshWorld();
    const { service } = wire(world);

    await expect(
      service.updateProgress(CTX, 'lesson-in-a-draft-course', 10),
    ).rejects.toMatchObject({ status: 404 });

    expect(world.progress).toEqual([]);
  });

  it('resolves the lesson through the visibility clause AND the soft-delete filter', async () => {
    // The two things that make an invisible lesson a 404 rather than a 403 or a
    // silent write. Asserted on the emitted `where`, so removing either is a
    // red test rather than an unnoticed hole.
    const world = freshWorld();
    const { prisma, service } = wire(world);

    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 10);
    const where = prisma.lesson.findFirst.mock.calls[0]?.[0]?.where;

    expect(where).toMatchObject({
      id: LESSON_WITH_VIDEO.id,
      deletedAt: null,
      module: { course: { published: true } },
    });
  });
});

describe('updateProgress — R2.3.2, completion computed SERVER-SIDE', () => {
  it('does not complete below the threshold', async () => {
    const world = freshWorld();
    const { service } = wire(world);

    // Derived from the domain fact, not from the implementation's constant.
    const belowThreshold = Math.ceil(VIDEO_DURATION * NINETY_PERCENT) - 1;
    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, belowThreshold);

    expect(stored(world, LESSON_WITH_VIDEO.id)?.completedAt).toBeNull();
  });

  it('completes at the threshold, with source `auto`', async () => {
    const world = freshWorld();
    const { service } = wire(world);

    const atThreshold = Math.ceil(VIDEO_DURATION * NINETY_PERCENT);
    const result = await service.updateProgress(
      CTX,
      LESSON_WITH_VIDEO.id,
      atThreshold,
    );

    expect(stored(world, LESSON_WITH_VIDEO.id)?.completionSource).toBe('auto');
    expect(result.completionSource).toBe('auto');
    expect(result.completedAt).not.toBeNull();
  });

  it('completes on the FIRST write when that write is already past the threshold', async () => {
    // The create branch of the upsert has to carry the verdict too — a service
    // that only computed completion in the update branch would leave a member
    // who opened and watched a short lesson in one go permanently incomplete.
    const world = freshWorld();
    const { service } = wire(world);

    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 600);

    expect(stored(world, LESSON_WITH_VIDEO.id)?.completionSource).toBe('auto');
  });

  it('the client sends a POSITION and nothing else — a `completed` flag is unrepresentable', () => {
    // §4.6.6. `updateProgress` takes a plain number, so there is no object for
    // a client-supplied completion to travel in. 9C's `UpdateProgressDto` binds
    // to this signature; the DTO census is that dispatch's.
    expect(ProgressService.prototype.updateProgress).toHaveLength(3);
  });

  it('does not re-stamp an ALREADY complete lesson', async () => {
    // `completedAt: null` in the auto-completion `where`. Without it, every
    // subsequent progress ping would rewrite the timestamp, and a manual
    // completion would be silently converted to 'auto'.
    const world = freshWorld();
    const { service } = wire(world);

    await service.setCompletion(CTX, LESSON_WITH_VIDEO.id, true);
    const firstStamp = stored(world, LESSON_WITH_VIDEO.id)?.completedAt;

    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 600);

    expect(stored(world, LESSON_WITH_VIDEO.id)?.completionSource).toBe(
      'manual',
    );
    expect(stored(world, LESSON_WITH_VIDEO.id)?.completedAt).toBe(firstStamp);
  });
});

describe('ASSUMPTION-8 — a lesson with no usable duration is MANUAL-ONLY', () => {
  it('never auto-completes, however far the position goes — and STILL RECORDS the position', async () => {
    // ⚠️ The seeded curriculum course has `youtubeVideoId: null` on all 8
    // lessons (§7.3), so this is the LIVE path for every lesson in this
    // workspace — the branch Batch 10 and Batch 11 actually exercise.
    const world = freshWorld();
    const { service } = wire(world);

    await service.updateProgress(CTX, LESSON_NO_DURATION.id, 100_000);

    expect(stored(world, LESSON_NO_DURATION.id)).toMatchObject({
      furthestPositionSeconds: 100_000,
      completedAt: null,
      completionSource: null,
    });
  });

  it('🔴 a PT0S lesson (duration 0) does not complete on the first frame', async () => {
    // Batch 9A's Finding 4. With a naive threshold, `0 >= 0.9 * 0` is TRUE and
    // every such lesson is complete the instant a member opens it.
    const world = freshWorld();
    const { service } = wire(world);

    await service.updateProgress(CTX, LESSON_ZERO_DURATION.id, 0);

    expect(stored(world, LESSON_ZERO_DURATION.id)?.completedAt).toBeNull();
  });

  it('issues NO auto-completion statement at all for a manual-only lesson', async () => {
    // Not just "the verdict is false" — the query is skipped, which is what
    // makes `completionThresholdSeconds`'s refusal unreachable rather than
    // caught.
    const world = freshWorld();
    const { prisma, service } = wire(world);

    await service.updateProgress(CTX, LESSON_NO_DURATION.id, 5);

    // One updateMany: the monotonic advance. Not two.
    expect(prisma.lessonProgress.updateMany).toHaveBeenCalledTimes(1);
  });

  it('does not clamp on a lesson with no duration — there is no ceiling', async () => {
    const world = freshWorld();
    const { service } = wire(world);

    await service.updateProgress(CTX, LESSON_NO_DURATION.id, 4_000);

    expect(stored(world, LESSON_NO_DURATION.id)?.furthestPositionSeconds).toBe(
      4_000,
    );
  });
});

describe('setCompletion — R2.3.3, manual and REVERSIBLE', () => {
  it('completes a lesson the member has never played', async () => {
    const world = freshWorld();
    const { service } = wire(world);

    const result = await service.setCompletion(CTX, LESSON_WITH_VIDEO.id, true);

    expect(result.completionSource).toBe('manual');
    expect(stored(world, LESSON_WITH_VIDEO.id)?.furthestPositionSeconds).toBe(
      0,
    );
  });

  it('🔴 reversing leaves `furthestPositionSeconds` untouched', async () => {
    // The write-direction unit case. Where a member watched to is a different
    // fact from what they claim to have finished; a service that reset the
    // position here would lose their resume point, and one that SET it to the
    // duration would fabricate a playback — and would then auto-complete the
    // lesson again on the next ping, permanently defeating the reversal.
    const world = freshWorld();
    const { service } = wire(world);

    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 412);
    await service.setCompletion(CTX, LESSON_WITH_VIDEO.id, true);
    await service.setCompletion(CTX, LESSON_WITH_VIDEO.id, false);

    expect(stored(world, LESSON_WITH_VIDEO.id)).toMatchObject({
      furthestPositionSeconds: 412,
      completedAt: null,
      completionSource: null,
    });
  });

  it('auto-complete then manual-incomplete is honoured — manual wins', async () => {
    const world = freshWorld();
    const { service } = wire(world);

    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 600);
    expect(stored(world, LESSON_WITH_VIDEO.id)?.completionSource).toBe('auto');

    const reversed = await service.setCompletion(
      CTX,
      LESSON_WITH_VIDEO.id,
      false,
    );

    expect(reversed.completedAt).toBeNull();
    expect(reversed.completionSource).toBeNull();
    expect(stored(world, LESSON_WITH_VIDEO.id)?.furthestPositionSeconds).toBe(
      600,
    );
  });

  it('the stated consequence: replaying past the threshold re-completes it', async () => {
    // ⚠️ NOT A DEFECT — a documented consequence of R2.3.3's "clears
    // completedAt and completionSource". Pinned so it is discovered by reading
    // this suite rather than by a member reporting it, and so that a future
    // sticky "manually incomplete" state is a deliberate change (it needs a
    // column plan §1.4 does not have).
    const world = freshWorld();
    const { service } = wire(world);

    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 600);
    await service.setCompletion(CTX, LESSON_WITH_VIDEO.id, false);
    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 600);

    expect(stored(world, LESSON_WITH_VIDEO.id)?.completionSource).toBe('auto');
  });

  it('is idempotent in both directions', async () => {
    const world = freshWorld();
    const { service } = wire(world);

    await service.setCompletion(CTX, LESSON_WITH_VIDEO.id, true);
    await service.setCompletion(CTX, LESSON_WITH_VIDEO.id, true);
    await service.setCompletion(CTX, LESSON_WITH_VIDEO.id, false);
    await service.setCompletion(CTX, LESSON_WITH_VIDEO.id, false);

    expect(world.progress).toHaveLength(1);
    expect(stored(world, LESSON_WITH_VIDEO.id)?.completedAt).toBeNull();
  });

  it('completes a manual-only lesson, which auto-completion never can', async () => {
    // The other half of ASSUMPTION-8: manual is the ONLY route for these
    // lessons, so it must work for them.
    const world = freshWorld();
    const { service } = wire(world);

    await service.setCompletion(CTX, LESSON_NO_DURATION.id, true);

    expect(stored(world, LESSON_NO_DURATION.id)?.completionSource).toBe(
      'manual',
    );
  });

  it('404s for a lesson the member cannot see', async () => {
    const world = freshWorld();
    const { service } = wire(world);

    await expect(
      service.setCompletion(CTX, 'not-visible', true),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('🔴 NFR-S4 / R2.3.7 — no method can reach another member', () => {
  it('every write and read keys on ctx.userId', async () => {
    const world = freshWorld();
    const { prisma, service } = wire(world);

    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 10);
    await service.setCompletion(CTX, LESSON_WITH_VIDEO.id, true);
    await service.listProgressFor(CTX, [LESSON_WITH_VIDEO.id]);

    const calls = [
      ...prisma.lessonProgress.upsert.mock.calls,
      ...prisma.lessonProgress.updateMany.mock.calls,
      ...prisma.lessonProgress.findUnique.mock.calls,
      ...prisma.lessonProgress.findMany.mock.calls,
    ];

    expect(calls.length).toBeGreaterThan(0);
    for (const [args] of calls) {
      // Either the composite key or a flat `userId` — both carry it.
      expect(JSON.stringify(args.where)).toContain(CTX.userId);
    }
  });

  it('NO public method takes a userId parameter', () => {
    // 🔴 THE CHECKABLE FORM OF THE GUARANTEE. A reviewer can be told "keep the
    // scope right"; this fails the build when someone adds the parameter that
    // would make a cross-member read expressible.
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, 'progress.service.ts'),
      'utf8',
    ) as string;

    // Public method signatures only — `ctx.userId` reads inside bodies are the
    // correct usage and must not be flagged.
    const signatures =
      source.match(/^\s{2}(?:async\s+)?[a-zA-Z]\w*\(\s*$/gm) ?? [];

    expect(signatures.length).toBeGreaterThan(0);
    expect(source).not.toMatch(/^\s+userId:\s*string,\s*$/m);
  });

  it('listProgressFor batches into ONE query for the whole set', async () => {
    // The N+1 a course outline naturally grows. Asserted here as well as in
    // the course-read budget, because this is where the shape is decided.
    const world = freshWorld();
    const { prisma, service } = wire(world);

    await service.updateProgress(CTX, LESSON_WITH_VIDEO.id, 10);
    prisma.lessonProgress.findMany.mockClear();

    await service.listProgressFor(CTX, ['a', 'b', 'c', 'd', 'e']);

    expect(prisma.lessonProgress.findMany).toHaveBeenCalledTimes(1);
    expect(
      prisma.lessonProgress.findMany.mock.calls[0]?.[0]?.where?.lessonId?.in,
    ).toHaveLength(5);
  });

  it('listProgressFor issues NO query for an empty set', async () => {
    const world = freshWorld();
    const { prisma, service } = wire(world);

    const result = await service.listProgressFor(CTX, []);

    expect(result.size).toBe(0);
    expect(prisma.lessonProgress.findMany).not.toHaveBeenCalled();
  });
});

describe('toMemberLessonProgress — the one mapper', () => {
  it('maps a missing row to the "never opened" state', () => {
    // No row is written by a read, so this is the normal state for most
    // lessons. It must be position 0, not an error and not a null object.
    expect(toMemberLessonProgress(null)).toEqual({
      furthestPositionSeconds: 0,
      completedAt: null,
      completionSource: null,
    });
  });

  it('serialises the timestamp as ISO 8601', () => {
    const at = new Date('2026-08-05T12:00:00.000Z');

    expect(
      toMemberLessonProgress({
        furthestPositionSeconds: 10,
        completedAt: at,
        completionSource: 'auto',
      }),
    ).toEqual({
      furthestPositionSeconds: 10,
      completedAt: '2026-08-05T12:00:00.000Z',
      completionSource: 'auto',
    });
  });

  it('reports an unrecognised stored source as null rather than passing it through', () => {
    // The column is a Postgres `String`. Handing a client a value it does not
    // switch on is worse than saying "not complete by any known mechanism".
    expect(
      toMemberLessonProgress({
        furthestPositionSeconds: 10,
        completedAt: new Date(),
        completionSource: 'imported',
      }).completionSource,
    ).toBeNull();
  });

  it('a source with no timestamp is not complete', () => {
    // Reporting the source alone would render a completed badge with no date
    // behind it.
    expect(
      toMemberLessonProgress({
        furthestPositionSeconds: 10,
        completedAt: null,
        completionSource: 'manual',
      }),
    ).toEqual({
      furthestPositionSeconds: 10,
      completedAt: null,
      completionSource: null,
    });
  });
});

describe('anti-vacuity — the model actually discriminates', () => {
  it('matchesWhere rejects as well as accepts', () => {
    const row: ProgressRow = {
      userId: 'u',
      lessonId: 'l',
      furthestPositionSeconds: 100,
      completedAt: null,
      completionSource: null,
    };

    expect(matchesWhere(row, { userId: 'u' })).toBe(true);
    expect(matchesWhere(row, { userId: 'other' })).toBe(false);
    expect(matchesWhere(row, { furthestPositionSeconds: { lt: 200 } })).toBe(
      true,
    );
    expect(matchesWhere(row, { furthestPositionSeconds: { lt: 100 } })).toBe(
      false,
    );
    expect(matchesWhere(row, { furthestPositionSeconds: { gte: 100 } })).toBe(
      true,
    );
    expect(matchesWhere(row, { completedAt: null })).toBe(true);
  });

  it('matchesWhere THROWS on an operator it does not model', () => {
    // Without this, a new `where` operator would evaluate to `false`, the write
    // would silently not happen, and the monotonicity test would go green for
    // the wrong reason.
    expect(() =>
      matchesWhere(
        {
          userId: 'u',
          lessonId: 'l',
          furthestPositionSeconds: 1,
          completedAt: null,
          completionSource: null,
        },
        { furthestPositionSeconds: { not: 1 } as unknown as Condition },
      ),
    ).toThrow(/models only/);
  });
});
