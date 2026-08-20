import { BadRequestException, NotFoundException } from '@nestjs/common';

import {
  asPrismaService,
  createMockPrisma,
  type MockLearningPrisma,
} from '../../testing/mock-learning-prisma';
import { DETERMINISTIC_ORDER_BY } from '../common/sort-order';

import {
  CourseScheduleService,
  type ScheduleAuditHook,
  type ScheduleChange,
} from './course-schedule.service';

/**
 * C4 — `CourseScheduleService`.
 *
 * THE THREE PROPERTIES THIS FILE EXISTS FOR, all of which are the guard rather
 * than the feature:
 *
 *   1. The PREVIEW writes nothing and audits nothing — otherwise a rehearsal
 *      has side effects and is not a rehearsal.
 *   2. The ECHO refuses a wrong `confirmModuleCount` or `confirmLastReleaseDate`
 *      with ZERO writes and ZERO audit rows. This is the whole defence against
 *      a mis-typed start date silently shifting ten member-visible dates.
 *   3. Only CHANGED rows are written, so a second identical apply reports
 *      `changedCount: 0` — the same observable as the seed's "second run, zero
 *      creates".
 *
 * ⚠️ THE EXPECTED DATES ARE NOT RECOMPUTED HERE. `weekday-schedule.spec.ts`
 * pins the arithmetic against hand-written literals; this file asserts that the
 * service WROTE what the helper returned, which is the `reorder.service.spec.ts`
 * division of labour exactly.
 */

/** The founder's cohort-1 inputs (`context.md` C3), used throughout. */
const COHORT_1 = {
  courseId: 'course-1',
  startDate: '2026-09-01',
  timeOfDay: '09:00',
  timeZone: 'UTC',
} as const;

/** Day 10 of that cohort — Monday 14 September 2026. The echo value. */
const LAST_RELEASE_DATE = '2026-09-14';

interface Wired {
  prisma: MockLearningPrisma;
  service: CourseScheduleService;
  auditCalls: { tx: unknown; changed: readonly ScheduleChange[] }[];
  audit: ScheduleAuditHook;
}

function wire(): Wired {
  const prisma = createMockPrisma();
  const auditCalls: Wired['auditCalls'] = [];
  const audit: ScheduleAuditHook = async (tx, changed) => {
    auditCalls.push({ tx, changed });
  };

  prisma.course.findFirst.mockResolvedValue({
    id: 'course-1',
    slug: 'cohort-1',
  });
  prisma.courseModule.update.mockResolvedValue({});

  return {
    prisma,
    service: new CourseScheduleService(asPrismaService(prisma)),
    auditCalls,
    audit,
  };
}

/** `count` module rows in day order, all unscheduled unless overridden. */
function moduleRows(
  count: number,
  overrides: Record<number, { releaseAt: Date | null }> = {},
): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${index + 1}`,
    slug: `day-${String(index + 1).padStart(2, '0')}`,
    title: `Module ${index + 1}`,
    sortOrder: (index + 1) * 100,
    releaseAt: overrides[index]?.releaseAt ?? null,
  }));
}

/** The `{ id, releaseAt }` pairs the service actually wrote. */
function written(update: jest.Mock): { id: string; releaseAt: string }[] {
  return update.mock.calls.map(([args]) => ({
    id: args.where.id as string,
    releaseAt: (args.data.releaseAt as Date).toISOString(),
  }));
}

/* -------------------------------------------------------------------------- */

describe('🔴 preview — computes, writes nothing, audits nothing', () => {
  it('returns the full schedule with applied: false and zero writes', async () => {
    const { prisma, service, auditCalls, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));

    const result = await service.schedule(COHORT_1, false, audit);

    expect(result.applied).toBe(false);
    expect(result.moduleCount).toBe(10);
    expect(result.entries).toHaveLength(10);
    expect(result.lastReleaseDate).toBe(LAST_RELEASE_DATE);
    // 🔴 THE PROPERTY. A preview with side effects is not a rehearsal.
    expect(prisma.courseModule.update).not.toHaveBeenCalled();
    expect(auditCalls).toHaveLength(0);
  });

  it("carries the founder's ten dates, Day 10 alone on Monday 14 September", async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));

    const result = await service.schedule(COHORT_1, false);

    expect(result.entries.map((entry) => entry.localDate)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-14',
    ]);
    expect(result.entries.map((entry) => entry.weekday)).toEqual([
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Mon',
    ]);
  });

  it('needs no audit hook at all — the controller passes none', async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(3));

    await expect(service.schedule(COHORT_1, false)).resolves.toMatchObject({
      applied: false,
      moduleCount: 3,
    });
  });
});

describe('apply — writes only what changed, audits exactly once', () => {
  it('writes one update per module and exactly ONE audit row with a null target', async () => {
    const { prisma, service, auditCalls, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));

    const result = await service.schedule(
      {
        ...COHORT_1,
        confirmModuleCount: 10,
        confirmLastReleaseDate: LAST_RELEASE_DATE,
      },
      true,
      audit,
    );

    expect(result.applied).toBe(true);
    expect(result.changedCount).toBe(10);
    expect(prisma.courseModule.update).toHaveBeenCalledTimes(10);
    // ONE row for the whole schedule — not one per module. "The admin scheduled
    // this course" is one intent, and ten rows would make the log useless.
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].tx).toBe(prisma);
  });

  it("writes the helper's instants, at the requested local time", async () => {
    const { prisma, service, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(3));

    await service.schedule(
      {
        ...COHORT_1,
        confirmModuleCount: 3,
        confirmLastReleaseDate: '2026-09-03',
      },
      true,
      audit,
    );

    expect(written(prisma.courseModule.update)).toEqual([
      { id: 'm-1', releaseAt: '2026-09-01T09:00:00.000Z' },
      { id: 'm-2', releaseAt: '2026-09-02T09:00:00.000Z' },
      { id: 'm-3', releaseAt: '2026-09-03T09:00:00.000Z' },
    ]);
  });

  it('everything runs in ONE transaction', async () => {
    const { prisma, service, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(3));

    await service.schedule(
      {
        ...COHORT_1,
        confirmModuleCount: 3,
        confirmLastReleaseDate: '2026-09-03',
      },
      true,
      audit,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('🔴 a SECOND identical apply reports changedCount: 0 and issues zero updates', async () => {
    // The idempotency observable, and the same shape as the seed's "second run,
    // zero creates". Rows already carrying the exact computed instants.
    const { prisma, service, auditCalls, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(
      moduleRows(3, {
        0: { releaseAt: new Date('2026-09-01T09:00:00.000Z') },
        1: { releaseAt: new Date('2026-09-02T09:00:00.000Z') },
        2: { releaseAt: new Date('2026-09-03T09:00:00.000Z') },
      }),
    );

    const result = await service.schedule(
      {
        ...COHORT_1,
        confirmModuleCount: 3,
        confirmLastReleaseDate: '2026-09-03',
      },
      true,
      audit,
    );

    expect(result.changedCount).toBe(0);
    expect(result.entries.every((entry) => entry.changed === false)).toBe(true);
    // ⚠️ NOT TOUCHED means `updatedAt` does not move either, which is what makes
    // this assertable at all.
    expect(prisma.courseModule.update).not.toHaveBeenCalled();
    // The row is still written: "the admin re-ran the schedule" happened.
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].changed).toEqual([]);
  });

  it('writes ONLY the drifted row when one module is out of step', async () => {
    const { prisma, service, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(
      moduleRows(3, {
        0: { releaseAt: new Date('2026-09-01T09:00:00.000Z') },
        1: { releaseAt: new Date('2026-09-02T09:00:00.000Z') },
        // Day 3 is unscheduled — the only one that should move.
      }),
    );

    const result = await service.schedule(
      {
        ...COHORT_1,
        confirmModuleCount: 3,
        confirmLastReleaseDate: '2026-09-03',
      },
      true,
      audit,
    );

    expect(result.changedCount).toBe(1);
    expect(written(prisma.courseModule.update)).toEqual([
      { id: 'm-3', releaseAt: '2026-09-03T09:00:00.000Z' },
    ]);
  });
});

describe('🔴 the echo guard — a wrong confirmation writes NOTHING', () => {
  it('a confirmLastReleaseDate wrong by ONE DAY is a 400 with zero writes', async () => {
    const { prisma, service, auditCalls, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));

    await expect(
      service.schedule(
        {
          ...COHORT_1,
          confirmModuleCount: 10,
          // The real last date is 2026-09-14. This is the naive answer a reader
          // of `task-description.md` §10's fixed offset table would produce.
          confirmLastReleaseDate: '2026-09-11',
        },
        true,
        audit,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.courseModule.update).not.toHaveBeenCalled();
    expect(auditCalls).toHaveLength(0);
  });

  it('the refusal NAMES both the expected and the received value', async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));

    await expect(
      service.schedule(
        {
          ...COHORT_1,
          confirmModuleCount: 10,
          confirmLastReleaseDate: '2026-09-11',
        },
        true,
      ),
    ).rejects.toThrow(/2026-09-14[\s\S]*2026-09-11/);
  });

  it('a wrong confirmModuleCount is a 400 with zero writes', async () => {
    // The other half of the same failure: an admin who believes he is
    // scheduling ten modules and is in fact scheduling a course that has twelve.
    const { prisma, service, auditCalls, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(12));

    await expect(
      service.schedule(
        {
          ...COHORT_1,
          confirmModuleCount: 10,
          confirmLastReleaseDate: LAST_RELEASE_DATE,
        },
        true,
        audit,
      ),
    ).rejects.toThrow(/expected 12 live module\(s\), received 10/);

    expect(prisma.courseModule.update).not.toHaveBeenCalled();
    expect(auditCalls).toHaveLength(0);
  });

  it('🔴 a TRANSPOSED start date is caught — the named failure mode', async () => {
    // `2026-01-09` for `2026-09-01`. The transposition is the failure this
    // whole design exists for, and it moves the last date, which is why the
    // echo is a DATE rather than a `confirm: true` boolean a copy-paste
    // satisfies.
    const { prisma, service, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));

    await expect(
      service.schedule(
        {
          ...COHORT_1,
          startDate: '2026-01-09',
          confirmModuleCount: 10,
          // The date the admin read off a preview of the CORRECT start date.
          confirmLastReleaseDate: LAST_RELEASE_DATE,
        },
        true,
        audit,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.courseModule.update).not.toHaveBeenCalled();
  });

  it('the echo is not checked on a PREVIEW — that is what the preview is for', async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));

    // No confirm fields at all, and it succeeds.
    await expect(service.schedule(COHORT_1, false)).resolves.toMatchObject({
      applied: false,
      lastReleaseDate: LAST_RELEASE_DATE,
    });
  });
});

describe('modules already carrying a manual releaseAt', () => {
  it('is shown as changed, with currentReleaseAt populated, and IS overwritten', async () => {
    const { prisma, service, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(
      moduleRows(3, {
        1: { releaseAt: new Date('2026-12-25T17:00:00.000Z') },
      }),
    );

    const result = await service.schedule(
      {
        ...COHORT_1,
        confirmModuleCount: 3,
        confirmLastReleaseDate: '2026-09-03',
      },
      true,
      audit,
    );

    const manual = result.entries[1];
    expect(manual.currentReleaseAt).toBe('2026-12-25T17:00:00.000Z');
    expect(manual.changed).toBe(true);
    expect(manual.releaseAt).toBe('2026-09-02T09:00:00.000Z');
    // A TOTAL re-schedule: the hand edit is overwritten, not skipped. Skipping
    // would leave the course on two schedules at once.
    expect(written(prisma.courseModule.update)).toContainEqual({
      id: 'm-2',
      releaseAt: '2026-09-02T09:00:00.000Z',
    });
  });

  it('🔴 and its OLD date reaches the audit metadata — the only recovery record', async () => {
    const { prisma, service, auditCalls, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(
      moduleRows(3, {
        1: { releaseAt: new Date('2026-12-25T17:00:00.000Z') },
      }),
    );

    await service.schedule(
      {
        ...COHORT_1,
        confirmModuleCount: 3,
        confirmLastReleaseDate: '2026-09-03',
      },
      true,
      audit,
    );

    // `CourseModule` has no column holding a previous `releaseAt`. Without this
    // list a wrong re-schedule is unrecoverable.
    expect(auditCalls[0].changed).toContainEqual({
      slug: 'day-02',
      from: '2026-12-25T17:00:00.000Z',
      to: '2026-09-02T09:00:00.000Z',
    });
    // An unscheduled module records `from: null` rather than being omitted.
    expect(auditCalls[0].changed).toContainEqual({
      slug: 'day-01',
      from: null,
      to: '2026-09-01T09:00:00.000Z',
    });
  });
});

describe('what the transaction reads', () => {
  it('🔴 orders by DETERMINISTIC_ORDER_BY, NOT by slug', async () => {
    // "Day order" is the order every member read uses. A course authored
    // through the admin API has slugs derived from TITLES, not `day-NN`, so a
    // slug sort would be arbitrary there — and C4 must work for such a course.
    const { prisma, service } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(3));

    await service.schedule(COHORT_1, false);

    const args = prisma.courseModule.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([...DETERMINISTIC_ORDER_BY]);
    expect(JSON.stringify(args.orderBy)).not.toContain('slug');
  });

  it('excludes soft-deleted modules from the count and never writes them', async () => {
    // The exclusion is a `NOT_DELETED` clause on the `findMany`, so a tombstoned
    // module cannot consume a slot — which would push every later module a day
    // late — and cannot be written.
    const { prisma, service } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(3));

    await service.schedule(COHORT_1, false);

    const args = prisma.courseModule.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ deletedAt: null, courseId: 'course-1' });
  });

  it('reads the course through NOT_DELETED too', async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(3));

    await service.schedule(COHORT_1, false);

    expect(prisma.course.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'course-1',
      deletedAt: null,
    });
  });
});

describe('refusals that are not the echo', () => {
  it('a missing or soft-deleted course is a 404, and nothing is read after it', async () => {
    const { prisma, service, audit } = wire();
    prisma.course.findFirst.mockResolvedValue(null);

    await expect(
      service.schedule(
        {
          ...COHORT_1,
          confirmModuleCount: 10,
          confirmLastReleaseDate: LAST_RELEASE_DATE,
        },
        true,
        audit,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.courseModule.findMany).not.toHaveBeenCalled();
    expect(prisma.courseModule.update).not.toHaveBeenCalled();
  });

  it('a course with ZERO live modules is a 400 with nothing written', async () => {
    const { prisma, service, auditCalls, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue([]);

    await expect(
      service.schedule(
        {
          ...COHORT_1,
          confirmModuleCount: 10,
          confirmLastReleaseDate: LAST_RELEASE_DATE,
        },
        true,
        audit,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.courseModule.update).not.toHaveBeenCalled();
    expect(auditCalls).toHaveLength(0);
  });

  it('🔴 a WEEKEND start is a 400 carrying a WRITTEN sentence, not the raw error', async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));

    // Saturday 5 September 2026.
    await expect(
      service.schedule({ ...COHORT_1, startDate: '2026-09-05' }, false),
    ).rejects.toThrow(
      'The cohort start date falls on a weekend. Supply the first weekday of the cohort.',
    );
  });

  it('🔴 an unknown time zone is a 400 carrying a WRITTEN sentence', async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));

    await expect(
      service.schedule({ ...COHORT_1, timeZone: 'Mars/Olympus' }, false),
    ).rejects.toThrow(
      'Unknown time zone. Use an IANA identifier such as "Europe/Berlin".',
    );
  });

  it('and NEITHER message leaks the raw ScheduleInputError text', async () => {
    // CLAUDE.md / the NestJS rules: never forward `error.message` verbatim. The
    // helper's message names the raw input and is written for the log.
    const { prisma, service } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));

    await expect(
      service.schedule({ ...COHORT_1, timeZone: 'Mars/Olympus' }, false),
    ).rejects.not.toThrow(/Mars\/Olympus/);
  });

  it('a start date that is shaped right but is not a real day is a 400', async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));

    await expect(
      service.schedule({ ...COHORT_1, startDate: '2026-02-30' }, false),
    ).rejects.toThrow('That start date is not a real calendar date.');
  });
});

describe('C4 reusability — cohort 2 and 3 need no code change', () => {
  it('a TWELVE-module course gets twelve dates, from the rows and not a literal', async () => {
    const { prisma, service, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(12));

    const result = await service.schedule(
      {
        ...COHORT_1,
        confirmModuleCount: 12,
        confirmLastReleaseDate: '2026-09-16',
      },
      true,
      audit,
    );

    expect(result.moduleCount).toBe(12);
    expect(result.entries).toHaveLength(12);
    expect(prisma.courseModule.update).toHaveBeenCalledTimes(12);
  });

  it('a course with ONE module works too', async () => {
    const { prisma, service, audit } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(1));

    const result = await service.schedule(
      {
        ...COHORT_1,
        confirmModuleCount: 1,
        confirmLastReleaseDate: '2026-09-01',
      },
      true,
      audit,
    );

    expect(result.moduleCount).toBe(1);
    expect(result.lastReleaseDate).toBe('2026-09-01');
  });

  it('a non-UTC cohort zone is echoed back and drives the instants', async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findMany.mockResolvedValue(moduleRows(1));

    const result = await service.schedule(
      { ...COHORT_1, timeZone: 'Europe/Berlin' },
      false,
    );

    expect(result.timeZone).toBe('Europe/Berlin');
    // 09:00 Berlin in September is CEST (+2) — 07:00Z.
    expect(result.entries[0].releaseAt).toBe('2026-09-01T07:00:00.000Z');
  });
});

describe('preview and apply are the SAME computation (R10)', () => {
  it('the two responses differ ONLY in `applied`', async () => {
    // 🔴 IF THIS EVER FAILS, THE REHEARSAL IS A LIE. One service method, one
    // return type, `apply` as a flag — this is that decision, asserted.
    const preview = wire();
    preview.prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));
    const previewed = await preview.service.schedule(COHORT_1, false);

    const applied = wire();
    applied.prisma.courseModule.findMany.mockResolvedValue(moduleRows(10));
    const result = await applied.service.schedule(
      {
        ...COHORT_1,
        confirmModuleCount: 10,
        confirmLastReleaseDate: LAST_RELEASE_DATE,
      },
      true,
      applied.audit,
    );

    expect({ ...result, applied: false }).toEqual(previewed);
    expect(previewed.applied).toBe(false);
    expect(result.applied).toBe(true);
  });
});
