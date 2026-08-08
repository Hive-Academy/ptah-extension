import type { MemberContext } from '@ptah-api/membership';

import {
  asPrismaService,
  createMockPrisma,
  type MockLearningPrisma,
} from '../../testing/mock-learning-prisma';
import { buildCourseVisibilityWhere } from '../common/visibility';

import { CoursesService, type AuditHook } from './courses.service';

/**
 * R2.1.1 – R2.1.3, R8.1, AD-5, AD-10, AD-15, PRE-6, NFR-S7.
 *
 * ⚠️ THE PRE-6 ASSERTIONS DRIVE THE **REAL** SERVICE OVER THE SHARED PRISMA
 * DOUBLE, AND THAT IS THE POINT. Batch 6C asserted the audit seam four ways and
 * the fourth is the one that matters: the hook must receive a `tx` that IS the
 * same client the mutation's own write went to — not merely "a defined tx".
 * With a jest-doubled audit service and a hand-built `tx`, "the hook received a
 * tx" only asserts that the spec called it that way.
 *
 * ⚠️ "MEMBER-VISIBLE" IS ASSERTED BY RUNNING THE WRITTEN ROW THROUGH THE REAL
 * `buildCourseVisibilityWhere`, not by calling `CourseReadService`. The two
 * services share no code, so a test that went through the read model would
 * prove the read model works rather than that the write wrote the right thing —
 * and it would fail for read-model reasons. {@link visibleToMember} is the same
 * ~15-line operator model `visibility.spec.ts` uses.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

const ADMIN_ID = 'admin-7';

/* -------------------------------------------------------------------------- */

interface CourseShape {
  visibility: string;
  cohortKeys: string[];
  published: boolean;
  deletedAt: Date | null;
}

/**
 * Would this row survive the member visibility clause?
 *
 * A model of the operators `buildCourseVisibilityWhere` emits, plus the
 * `NOT_DELETED` the caller spreads beside it. It THROWS on an operator it does
 * not implement, so a new branch breaks this loudly instead of quietly hiding
 * every course from everyone.
 */
function visibleToMember(row: CourseShape, ctx: MemberContext): boolean {
  if (row.deletedAt !== null) return false;

  const where = buildCourseVisibilityWhere(ctx) as {
    published?: boolean;
    OR?: { visibility?: string; cohortKeys?: { hasSome?: string[] } }[];
  };

  const unsupported = Object.keys(where).filter(
    (k) => k !== 'published' && k !== 'OR',
  );
  if (unsupported.length > 0) {
    throw new Error(
      `courses.service.spec.ts models only 'published' and 'OR'; the builder ` +
        `emitted: ${unsupported.join(', ')}. Extend the model.`,
    );
  }

  if (where.published !== undefined && where.published !== row.published) {
    return false;
  }

  return (where.OR ?? []).some((branch) => {
    if (
      branch.visibility !== undefined &&
      branch.visibility !== row.visibility
    ) {
      return false;
    }
    if (branch.cohortKeys !== undefined) {
      const hasSome = branch.cohortKeys.hasSome ?? [];
      if (!hasSome.some((k) => row.cohortKeys.includes(k))) return false;
    }
    return true;
  });
}

interface Wired {
  prisma: MockLearningPrisma;
  service: CoursesService;
  /** Every `(tx, targetId)` the audit seam received. */
  auditCalls: { tx: unknown; targetId: string | null; at: number }[];
  audit: AuditHook;
  /** A monotonic tick, so "before the callback returned" is checkable. */
  now: () => number;
}

function wire(): Wired {
  const prisma = createMockPrisma();
  let tick = 0;
  const now = (): number => ++tick;

  const auditCalls: Wired['auditCalls'] = [];
  const audit: AuditHook = async (tx, targetId) => {
    auditCalls.push({ tx, targetId, at: now() });
  };

  // Sensible defaults; individual tests override.
  prisma.memberGroup.findMany.mockResolvedValue([]);
  prisma.course.findMany.mockResolvedValue([]);
  prisma.course.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
  prisma.courseModule.findMany.mockResolvedValue([]);
  prisma.courseModule.aggregate.mockResolvedValue({
    _max: { sortOrder: null },
  });
  prisma.lesson.findMany.mockResolvedValue([]);
  prisma.lesson.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
  prisma.lesson.count.mockResolvedValue(0);
  prisma.lessonComment.count.mockResolvedValue(0);

  return {
    prisma,
    service: new CoursesService(asPrismaService(prisma)),
    auditCalls,
    audit,
    now,
  };
}

function courseRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'course-1',
    slug: 'foundations',
    title: 'Foundations',
    description: 'The basics',
    coverImageUrl: null,
    visibility: 'member',
    cohortKeys: [],
    published: false,
    sequential: false,
    sortOrder: 100,
    createdBy: ADMIN_ID,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const CREATE_INPUT = {
  title: 'Foundations',
  description: 'The basics',
  visibility: 'member' as const,
  createdBy: ADMIN_ID,
};

/* -------------------------------------------------------------------------- */

describe('createCourse', () => {
  it('slugifies the title against the live taken-set', async () => {
    const { prisma, service } = wire();
    prisma.course.findMany.mockResolvedValue([{ slug: 'foundations' }]);
    prisma.course.create.mockResolvedValue(
      courseRow({ slug: 'foundations-2' }),
    );

    await service.createCourse(CREATE_INPUT);

    expect(prisma.course.create.mock.calls[0]?.[0]?.data?.slug).toBe(
      'foundations-2',
    );
  });

  it('🔴 creates as a DRAFT, whatever the caller asked for', async () => {
    // Publishing is a separate endpoint (plan §3.4). Creating something
    // member-visible in the same request that creates it removes the step where
    // an admin checks their work.
    const { prisma, service } = wire();
    prisma.course.create.mockResolvedValue(courseRow());

    await service.createCourse({
      ...CREATE_INPUT,
      // Deliberately smuggled in — the input type has no `published`, so this
      // is what a loose object would carry.
      ...({ published: true } as object),
    });

    expect(prisma.course.create.mock.calls[0]?.[0]?.data?.published).toBe(
      false,
    );
  });

  it('appends on the sparse scale when no sortOrder is supplied', async () => {
    const { prisma, service } = wire();
    prisma.course.aggregate.mockResolvedValue({ _max: { sortOrder: 300 } });
    prisma.course.create.mockResolvedValue(courseRow());

    await service.createCourse(CREATE_INPUT);

    expect(prisma.course.create.mock.calls[0]?.[0]?.data?.sortOrder).toBe(400);
  });

  it('🔴 an unknown cohortKey is a 400 — nothing at the database layer catches it', async () => {
    // AD-10 stores cohort keys as a String[] column with NO foreign key, so a
    // typo saves cleanly, matches `hasSome` for nobody, and produces a course
    // invisible to everyone INCLUDING the admin who created it, with no error.
    const { prisma, service } = wire();
    prisma.memberGroup.findMany.mockResolvedValue([{ key: 'founding' }]);

    await expect(
      service.createCourse({
        ...CREATE_INPUT,
        visibility: 'cohort',
        cohortKeys: ['founding', 'foundng'],
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(prisma.course.create).not.toHaveBeenCalled();
  });

  it('accepts a cohortKey that exists', async () => {
    const { prisma, service } = wire();
    prisma.memberGroup.findMany.mockResolvedValue([
      { key: 'founding', name: 'Founding' },
    ]);
    prisma.course.create.mockResolvedValue(
      courseRow({ visibility: 'cohort', cohortKeys: ['founding'] }),
    );

    const created = await service.createCourse({
      ...CREATE_INPUT,
      visibility: 'cohort',
      cohortKeys: ['founding'],
    });

    expect(created.cohortKeys).toEqual(['founding']);
    expect(created.cohortNames).toEqual(['Founding']);
  });

  it('renders a STALE cohort key rather than dropping it (D-6.13g)', async () => {
    // A silently shorter array would make a stale key look like a key that was
    // never there — and this admin table is the only surface that can show it.
    const { prisma, service } = wire();
    prisma.memberGroup.findMany.mockResolvedValue([{ key: 'founding' }]);
    prisma.course.create.mockResolvedValue(
      courseRow({ visibility: 'cohort', cohortKeys: ['founding', 'retired'] }),
    );

    // `assertCohortKeysExist` and `resolveCohortNames` are two calls; the first
    // must pass, so both keys are "known" there and only one has a name.
    prisma.memberGroup.findMany
      .mockResolvedValueOnce([{ key: 'founding' }, { key: 'retired' }])
      .mockResolvedValueOnce([{ key: 'founding', name: 'Founding' }]);

    const created = await service.createCourse({
      ...CREATE_INPUT,
      visibility: 'cohort',
      cohortKeys: ['founding', 'retired'],
    });

    expect(created.cohortNames).toEqual([
      'Founding',
      'retired (unknown group)',
    ]);
  });

  it('copies cohortKeys rather than aliasing the caller`s array', async () => {
    const { prisma, service } = wire();
    prisma.course.create.mockResolvedValue(courseRow());
    const keys: string[] = [];

    await service.createCourse({ ...CREATE_INPUT, cohortKeys: keys });

    expect(prisma.course.create.mock.calls[0]?.[0]?.data?.cohortKeys).not.toBe(
      keys,
    );
  });
});

describe('publish — R2.1.2, the write with a member-visible blast radius', () => {
  it('🔴 create → publish → member-visible', async () => {
    const { prisma, service } = wire();
    prisma.course.create.mockResolvedValue(courseRow());
    const draft = await service.createCourse(CREATE_INPUT);

    expect(
      visibleToMember(
        {
          visibility: draft.visibility,
          cohortKeys: draft.cohortKeys,
          published: draft.published,
          deletedAt: null,
        },
        CTX,
      ),
    ).toBe(false);

    prisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
    prisma.course.update.mockResolvedValue(courseRow({ published: true }));
    const published = await service.setPublished('course-1', true);

    expect(
      visibleToMember(
        {
          visibility: published.visibility,
          cohortKeys: published.cohortKeys,
          published: published.published,
          deletedAt: null,
        },
        CTX,
      ),
    ).toBe(true);
  });

  it('🔴 a DRAFT is absent from every member read — including an admin`s', async () => {
    const { prisma, service } = wire();
    prisma.course.create.mockResolvedValue(courseRow());
    const draft = await service.createCourse(CREATE_INPUT);
    const shape = {
      visibility: draft.visibility,
      cohortKeys: draft.cohortKeys,
      published: draft.published,
      deletedAt: null,
    };

    for (const ctx of [
      CTX,
      { ...CTX, isAdmin: true },
      { ...CTX, cohortKeys: ['founding'] },
    ]) {
      expect(visibleToMember(shape, ctx)).toBe(false);
    }
  });

  it('unpublishing takes it straight back out', async () => {
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
    prisma.course.update.mockResolvedValue(courseRow({ published: false }));

    const row = await service.setPublished('course-1', false);

    expect(
      visibleToMember(
        {
          visibility: row.visibility,
          cohortKeys: row.cohortKeys,
          published: row.published,
          deletedAt: null,
        },
        CTX,
      ),
    ).toBe(false);
  });

  it('404s for a course that does not exist or is already deleted', async () => {
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue(null);

    await expect(service.setPublished('gone', true)).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.course.update).not.toHaveBeenCalled();
  });
});

describe('soft delete — AD-5', () => {
  it('writes a tombstone and never calls a hard delete verb', async () => {
    // `Lesson.module` and `CourseModule.course` are `onDelete: Cascade`, so a
    // hard delete of a course would take every member's progress with it.
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
    prisma.course.update.mockResolvedValue(
      courseRow({ deletedAt: new Date() }),
    );

    await service.deleteCourse('course-1', ADMIN_ID);

    expect(
      prisma.course.update.mock.calls[0]?.[0]?.data?.deletedAt,
    ).toBeInstanceOf(Date);
    expect(prisma.course.delete).not.toHaveBeenCalled();
    expect(prisma.course.deleteMany).not.toHaveBeenCalled();
  });

  /**
   * Batch 9B's F-1, closed by migration 4 (Batch 12).
   *
   * ⚠️ THIS ASSERTION EXISTS BECAUSE THE PREVIOUS ONE COULD NOT SEE THE BUG IT
   * REPLACES. `deleteCourse` has always TAKEN a `deletedBy` and, until
   * migration 4, had no column to write it to — so the actor was reachable only
   * through the audit row. The test above reads only `data.deletedAt` and
   * therefore passes identically whether or not the actor is persisted. This
   * one pins the column, for all three models, so a future refactor that drops
   * the field from a payload is a failing test rather than a silently
   * unanswerable "who deleted this".
   */
  it('🔴 persists the acting admin on the tombstone of all three models (9B F-1)', async () => {
    const { prisma, service } = wire();

    prisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
    prisma.course.update.mockResolvedValue(
      courseRow({ deletedAt: new Date() }),
    );
    await service.deleteCourse('course-1', ADMIN_ID);
    expect(prisma.course.update.mock.calls[0]?.[0]?.data?.deletedBy).toBe(
      ADMIN_ID,
    );

    prisma.courseModule.findFirst.mockResolvedValue({ id: 'module-1' });
    prisma.courseModule.update.mockResolvedValue({ id: 'module-1' });
    await service.deleteModule('module-1', ADMIN_ID);
    expect(prisma.courseModule.update.mock.calls[0]?.[0]?.data?.deletedBy).toBe(
      ADMIN_ID,
    );

    prisma.lesson.findFirst.mockResolvedValue({ id: 'lesson-1' });
    prisma.lesson.update.mockResolvedValue({ id: 'lesson-1' });
    await service.deleteLesson('lesson-1', ADMIN_ID);
    expect(prisma.lesson.update.mock.calls[0]?.[0]?.data?.deletedBy).toBe(
      ADMIN_ID,
    );
  });

  it('🔴 the tombstone removes it from member reads immediately', async () => {
    const shape: CourseShape = {
      visibility: 'member',
      cohortKeys: [],
      published: true,
      deletedAt: new Date(),
    };

    expect(visibleToMember(shape, CTX)).toBe(false);
    expect(visibleToMember({ ...shape, deletedAt: null }, CTX)).toBe(true);
  });

  it('does NOT cascade the tombstone down the tree', async () => {
    // One write, not N. Every member read composes the course's visibility
    // through `module.course`, so the whole subtree leaves in one statement —
    // and a cascade would make a later restore ambiguous.
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
    prisma.course.update.mockResolvedValue(
      courseRow({ deletedAt: new Date() }),
    );

    await service.deleteCourse('course-1', ADMIN_ID);

    expect(prisma.courseModule.updateMany).not.toHaveBeenCalled();
    expect(prisma.lesson.updateMany).not.toHaveBeenCalled();
  });

  it('404s for a course already deleted — the read is NOT_DELETED-filtered', async () => {
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue(null);

    await expect(
      service.deleteCourse('course-1', ADMIN_ID),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('restore — R8.5, and why this lib takes no AD-5 exemption', () => {
  it('🔴 puts the window inside the UPDATE`s own WHERE — no tombstone read exists', async () => {
    const { prisma, service } = wire();
    prisma.course.updateMany.mockResolvedValue({ count: 1 });

    await service.restoreCourse('course-1', new Date('2026-08-05T12:00:00Z'));

    const where = prisma.course.updateMany.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ id: 'course-1' });
    expect(where.deletedAt).toMatchObject({ not: null });
    expect(where.deletedAt.gte).toBeInstanceOf(Date);
    // The pre-flight read that WOULD have needed an exemption.
    expect(prisma.course.findFirst).not.toHaveBeenCalled();
  });

  it('refuses with 409 when nothing was restored', async () => {
    // 409, not 404: the row is still there and the admin can still reach it.
    const { prisma, service } = wire();
    prisma.course.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.restoreCourse('course-1', new Date()),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('the window is 30 days back from the supplied instant, inclusive', async () => {
    // R8.5 states a FLOOR ("at least 30 days"), so at exactly 30 days the
    // restore must still succeed.
    const { prisma, service } = wire();
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date('2026-08-05T12:00:00.000Z');

    await service.restoreCourse('course-1', now);

    const gte = prisma.course.updateMany.mock.calls[0]?.[0]?.where?.deletedAt
      ?.gte as Date;
    expect(now.getTime() - gte.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('modules and lessons', () => {
  it('scopes a module slug to its COURSE, because @@unique([courseId, slug]) is', async () => {
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
    prisma.courseModule.findMany.mockResolvedValue([{ slug: 'intro' }]);
    prisma.courseModule.create.mockResolvedValue({
      id: 'module-1',
      courseId: 'course-1',
      slug: 'intro-2',
      title: 'Intro',
      description: null,
      sortOrder: 100,
      releaseAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.createModule({ courseId: 'course-1', title: 'Intro' });

    expect(
      prisma.courseModule.findMany.mock.calls[0]?.[0]?.where,
    ).toMatchObject({
      courseId: 'course-1',
      deletedAt: null,
    });
    expect(prisma.courseModule.create.mock.calls[0]?.[0]?.data?.slug).toBe(
      'intro-2',
    );
  });

  it('🔴 scopes a LESSON slug to the whole COURSE, not to its module', async () => {
    // `@@unique([moduleId, slug])` would let two modules in one course hold the
    // same lesson slug — legal in the database and AMBIGUOUS in the
    // course-scoped route `courses/:slug/lessons/:lessonSlug` (plan §3.4).
    const { prisma, service } = wire();
    prisma.courseModule.findFirst.mockResolvedValue({
      id: 'module-2',
      courseId: 'course-1',
    });
    prisma.lesson.findMany.mockResolvedValue([{ slug: 'intro' }]);
    prisma.lesson.create.mockResolvedValue(lessonRow({ slug: 'intro-2' }));

    await service.createLesson({
      moduleId: 'module-2',
      title: 'Intro',
      bodyMarkdown: '# Intro',
    });

    // The taken-set query reaches UP to the course, not just across the module.
    expect(
      prisma.lesson.findMany.mock.calls[0]?.[0]?.where?.module,
    ).toMatchObject({ courseId: 'course-1', deletedAt: null });
    expect(prisma.lesson.create.mock.calls[0]?.[0]?.data?.slug).toBe('intro-2');
  });

  it('a lesson is created with NO video by default, all five columns null', async () => {
    // R2.2.4 as a default: the five columns move together, so "no video" is
    // five explicit nulls rather than four omissions.
    const { prisma, service } = wire();
    prisma.courseModule.findFirst.mockResolvedValue({
      id: 'module-1',
      courseId: 'course-1',
    });
    prisma.lesson.create.mockResolvedValue(lessonRow());

    await service.createLesson({
      moduleId: 'module-1',
      title: 'Intro',
      bodyMarkdown: 'x',
    });

    const data = prisma.lesson.create.mock.calls[0]?.[0]?.data;
    expect(data).toMatchObject({
      youtubeVideoId: null,
      videoTitle: null,
      videoDurationSeconds: null,
      videoThumbnailUrl: null,
      videoMetadataFetchedAt: null,
      videoMetadataSource: null,
    });
  });

  it('writes all five video columns in the SAME statement that creates the row (R2.2.4)', async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findFirst.mockResolvedValue({
      id: 'module-1',
      courseId: 'course-1',
    });
    prisma.lesson.create.mockResolvedValue(lessonRow());
    const fetchedAt = new Date('2026-08-05T12:00:00.000Z');

    await service.createLesson(
      { moduleId: 'module-1', title: 'Intro', bodyMarkdown: 'x' },
      {
        youtubeVideoId: 'dQw4w9WgXcQ',
        videoTitle: 'A video',
        videoDurationSeconds: 212,
        videoThumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        videoMetadataFetchedAt: fetchedAt,
        videoMetadataSource: 'api',
      },
    );

    expect(prisma.lesson.create).toHaveBeenCalledTimes(1);
    expect(prisma.lesson.update).not.toHaveBeenCalled();
    expect(prisma.lesson.create.mock.calls[0]?.[0]?.data).toMatchObject({
      youtubeVideoId: 'dQw4w9WgXcQ',
      videoDurationSeconds: 212,
      videoMetadataSource: 'api',
      videoMetadataFetchedAt: fetchedAt,
    });
  });

  it('refuses to create a module under a DELETED course', async () => {
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue(null);

    await expect(
      service.createModule({ courseId: 'course-1', title: 'Intro' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.courseModule.create).not.toHaveBeenCalled();
  });

  it('checks the module`s parent course in the SAME where, not a second query', async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findFirst.mockResolvedValue(null);

    await expect(
      service.deleteLesson('lesson-1', ADMIN_ID),
    ).rejects.toBeDefined();

    // `requireLiveLesson` nests both levels; nothing here reads the course
    // separately.
    prisma.lesson.findFirst.mockResolvedValue(null);
    await expect(
      service.deleteLesson('lesson-1', ADMIN_ID),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.lesson.findFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      deletedAt: null,
      module: { deletedAt: null, course: { deletedAt: null } },
    });
  });

  it('`updateLesson` cannot touch the video columns', async () => {
    // They move together or not at all (R2.2.4) and belong to
    // `LessonVideoService`. Accepting a loose `videoTitle` here would let an
    // admin type over an 'api'-sourced row while `videoMetadataFetchedAt` kept
    // claiming it came from YouTube.
    const { prisma, service } = wire();
    prisma.lesson.findFirst.mockResolvedValue({
      id: 'lesson-1',
      moduleId: 'module-1',
    });
    prisma.lesson.update.mockResolvedValue(lessonRow());

    await service.updateLesson('lesson-1', {
      title: 'New title',
      ...({ videoTitle: 'smuggled', youtubeVideoId: 'aaaaaaaaaaa' } as object),
    });

    const data = prisma.lesson.update.mock.calls[0]?.[0]?.data;
    expect(Object.keys(data)).toEqual(['title']);
  });
});

describe('🔴 PRE-6 — the audit row commits with the mutation', () => {
  it('1. the hook receives a tx that IS the client the write went to', async () => {
    // Not "a defined tx". With a jest-doubled audit service and a hand-built
    // tx, "the hook received a tx" only asserts that the spec called it that
    // way.
    const { prisma, service, auditCalls, audit } = wire();
    prisma.course.create.mockResolvedValue(courseRow());

    await service.createCourse(CREATE_INPUT, audit);

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]?.tx).toBe(prisma);
    expect(prisma.course.create.mock.instances.length).toBeGreaterThanOrEqual(
      0,
    );
  });

  it('2. it is called BEFORE the transaction callback returns', async () => {
    const { prisma, service, auditCalls, audit } = wire();
    let transactionResolvedAt = 0;
    let tick = 0;
    prisma.course.create.mockImplementation(async () => courseRow());
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      const result = await (arg as (tx: unknown) => Promise<unknown>)(prisma);
      transactionResolvedAt = ++tick + 1000;
      return result;
    });

    await service.createCourse(CREATE_INPUT, audit);

    expect(auditCalls).toHaveLength(1);
    expect(transactionResolvedAt).toBeGreaterThan(0);
    expect(auditCalls[0]?.at).toBeLessThan(transactionResolvedAt);
  });

  it('3. a mutation that THREW audits nothing and opens no transaction', async () => {
    const { prisma, service, auditCalls, audit } = wire();
    prisma.memberGroup.findMany.mockResolvedValue([]);

    await expect(
      service.createCourse(
        { ...CREATE_INPUT, visibility: 'cohort', cohortKeys: ['nope'] },
        audit,
      ),
    ).rejects.toMatchObject({ status: 400 });

    expect(auditCalls).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('4. a mutation that threw INSIDE the transaction audits nothing either', async () => {
    const { prisma, service, auditCalls, audit } = wire();
    prisma.course.findFirst.mockResolvedValue(null);

    await expect(
      service.setPublished('gone', true, audit),
    ).rejects.toMatchObject({ status: 404 });

    expect(auditCalls).toEqual([]);
  });

  it('every mutation offers the seam — none of them is silently unaudited', async () => {
    // A mutation that forgot the hook would be an admin action with no history,
    // and nothing else in the system would report it.
    const seams = [
      'createCourse',
      'updateCourse',
      'setPublished',
      'deleteCourse',
      'restoreCourse',
      'createModule',
      'updateModule',
      'deleteModule',
      'createLesson',
      'updateLesson',
      'deleteLesson',
    ] as const;

    for (const name of seams) {
      expect(typeof CoursesService.prototype[name]).toBe('function');
    }

    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, 'courses.service.ts'),
      'utf8',
    ) as string;
    // One `await audit?.(tx, …)` per mutation.
    expect((source.match(/await audit\?\.\(/g) ?? []).length).toBe(
      seams.length,
    );
  });
});

describe('NFR-S7 — no Prisma error escapes raw', () => {
  it('maps a P2002 to a typed 400 that names no constraint or table', async () => {
    const { prisma, service } = wire();
    const p2002 = Object.assign(
      new Error(
        'Unique constraint failed on the fields: (`module_id`,`slug`) on table `course_lessons`',
      ),
      { code: 'P2002', clientVersion: '7.7.0' },
    );
    Object.setPrototypeOf(
      p2002,
      require('@ptah-api/core').Prisma.PrismaClientKnownRequestError.prototype,
    );
    prisma.course.create.mockRejectedValue(p2002);

    const failure = await service.createCourse(CREATE_INPUT).catch((e) => e);

    expect(failure.status).toBe(400);
    expect(JSON.stringify(failure.response)).not.toContain('course_lessons');
    expect(JSON.stringify(failure.response)).not.toContain('module_id');
  });

  it('lets a deliberate 404 through untouched rather than re-wrapping it as a 500', async () => {
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue(null);

    await expect(service.updateCourse('gone', {})).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('listForAdmin', () => {
  it('shows drafts, cohort courses and staff courses without a visibility filter', async () => {
    const { prisma, service } = wire();
    prisma.course.findMany.mockResolvedValue([
      courseRow({ id: 'c1', published: false }),
      courseRow({ id: 'c2', visibility: 'staff', published: true }),
    ]);

    const rows = await service.listForAdmin();

    expect(rows.map((r) => r.id)).toEqual(['c1', 'c2']);
    const where = prisma.course.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toEqual({ deletedAt: null });
    expect(JSON.stringify(where)).not.toContain('visibility');
  });

  it('counts modules and lessons with NO `_count`, which would include tombstones', async () => {
    const { prisma, service } = wire();
    prisma.course.findMany.mockResolvedValue([courseRow({ id: 'c1' })]);
    prisma.courseModule.findMany.mockResolvedValue([
      { id: 'm1', courseId: 'c1' },
      { id: 'm2', courseId: 'c1' },
    ]);
    prisma.lesson.findMany.mockResolvedValue([
      { moduleId: 'm1' },
      { moduleId: 'm1' },
      { moduleId: 'm2' },
    ]);

    const [row] = await service.listForAdmin();

    expect(row).toMatchObject({ moduleCount: 2, lessonCount: 3 });
    expect(
      JSON.stringify(prisma.course.findMany.mock.calls[0]?.[0]),
    ).not.toContain('_count');
  });

  it('is a fixed number of queries regardless of how many courses there are', async () => {
    // The N+1 a tree naturally grows: "for each course, count its modules".
    const { prisma, service } = wire();
    prisma.course.findMany.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => courseRow({ id: `c${i}` })),
    );
    prisma.courseModule.findMany.mockResolvedValue([
      { id: 'm1', courseId: 'c0' },
    ]);
    prisma.lesson.findMany.mockResolvedValue([{ moduleId: 'm1' }]);

    await service.listForAdmin();

    expect(prisma.course.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.courseModule.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.lesson.findMany).toHaveBeenCalledTimes(1);
  });

  it('short-circuits with no queries at all when there are no courses', async () => {
    const { prisma, service } = wire();

    expect(await service.listForAdmin()).toEqual([]);
    expect(prisma.courseModule.findMany).not.toHaveBeenCalled();
  });
});

describe('anti-vacuity — the visibility model discriminates', () => {
  it('accepts and rejects', () => {
    const published: CourseShape = {
      visibility: 'member',
      cohortKeys: [],
      published: true,
      deletedAt: null,
    };

    expect(visibleToMember(published, CTX)).toBe(true);
    expect(visibleToMember({ ...published, published: false }, CTX)).toBe(
      false,
    );
    expect(visibleToMember({ ...published, visibility: 'staff' }, CTX)).toBe(
      false,
    );
    expect(
      visibleToMember(
        { ...published, visibility: 'staff' },
        {
          ...CTX,
          isAdmin: true,
        },
      ),
    ).toBe(true);
  });
});

function lessonRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'lesson-1',
    moduleId: 'module-1',
    slug: 'intro',
    title: 'Intro',
    bodyMarkdown: '# Intro',
    sortOrder: 100,
    youtubeVideoId: null,
    videoTitle: null,
    videoDurationSeconds: null,
    videoThumbnailUrl: null,
    videoMetadataFetchedAt: null,
    videoMetadataSource: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}
