import {
  asPrismaService,
  createMockPrisma,
  type MockLearningPrisma,
} from '../../testing/mock-learning-prisma';
import { SORT_ORDER_STEP, renumberSparse } from '../common/sort-order';

import type { AuditHook } from './courses.service';
import { ReorderService } from './reorder.service';

/**
 * R8.8 — ONE request, ONE transaction, a sparse renumber.
 *
 * ⚠️ THE EXPECTED NUMBERS COME FROM `renumberSparse`, NOT FROM A HAND-TYPED
 * `[100, 200, 300]`. Restating the arithmetic here would make this spec an echo
 * of the implementation — the same accomplice shape Batch 6.1 found in the
 * unread tests. `sort-order.spec.ts` is what pins the numbers themselves, as
 * PROPERTIES (strictly increasing, a step-sized gap, starting at the step); this
 * file asserts that the service writes exactly what that function returned.
 */

interface Wired {
  prisma: MockLearningPrisma;
  service: ReorderService;
  auditCalls: { tx: unknown; targetId: string | null }[];
  audit: AuditHook;
}

function wire(): Wired {
  const prisma = createMockPrisma();
  const auditCalls: Wired['auditCalls'] = [];
  const audit: AuditHook = async (tx, targetId) => {
    auditCalls.push({ tx, targetId });
  };

  prisma.course.update.mockResolvedValue({});
  prisma.courseModule.update.mockResolvedValue({});
  prisma.lesson.update.mockResolvedValue({});

  return {
    prisma,
    service: new ReorderService(asPrismaService(prisma)),
    auditCalls,
    audit,
  };
}

/** The `{ id, sortOrder }` pairs a delegate's `update` calls actually wrote. */
function writtenPositions(
  update: jest.Mock,
): { id: string; sortOrder: number }[] {
  return update.mock.calls.map(([args]) => ({
    id: args.where.id as string,
    sortOrder: args.data.sortOrder as number,
  }));
}

const IDS = ['c', 'a', 'b'];

/* -------------------------------------------------------------------------- */

describe('reorderCourses — the happy path', () => {
  it('writes exactly what renumberSparse returned, in the submitted order', async () => {
    const { prisma, service } = wire();
    prisma.course.findMany.mockResolvedValue(IDS.map((id) => ({ id })));

    const result = await service.reorderCourses(IDS);

    expect(result).toEqual({ reordered: 3 });
    expect(writtenPositions(prisma.course.update)).toEqual(renumberSparse(IDS));
  });

  it('🔴 is ONE transaction, not one per row', async () => {
    // R8.8's whole point. Per-row requests produce a half-ordered course when
    // the fourth one fails, and cost an admin twelve round trips for one drag.
    const { prisma, service } = wire();
    prisma.course.findMany.mockResolvedValue(IDS.map((id) => ({ id })));

    await service.reorderCourses(IDS);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.course.update).toHaveBeenCalledTimes(3);
  });

  it('uses the SPARSE scale, leaving room for a later single insert', async () => {
    const { prisma, service } = wire();
    prisma.course.findMany.mockResolvedValue(IDS.map((id) => ({ id })));

    await service.reorderCourses(IDS);
    const orders = writtenPositions(prisma.course.update).map(
      (p) => p.sortOrder,
    );

    expect(orders.slice(0, 2)).toEqual([SORT_ORDER_STEP, SORT_ORDER_STEP * 2]);
  });

  it('🔴 the ORDER OF THE UPDATES DOES NOT MATTER — there is no unique constraint to dodge', async () => {
    // Plan §1.4 deliberately does NOT declare `@@unique([courseId, sortOrder])`
    // (R8.8): a uniqueness constraint would force these UPDATEs to be sequenced
    // through a temporary value to avoid transient collisions. The property is
    // asserted by replaying the same writes in reverse and getting the same
    // final assignment — which is only true if no write depends on another
    // having landed first.
    const { prisma, service } = wire();
    prisma.course.findMany.mockResolvedValue(IDS.map((id) => ({ id })));

    await service.reorderCourses(IDS);
    const forward = writtenPositions(prisma.course.update);
    const replayed = [...forward].reverse();

    const asMap = (
      rows: { id: string; sortOrder: number }[],
    ): Record<string, number> =>
      Object.fromEntries(rows.map((r) => [r.id, r.sortOrder]));

    expect(asMap(replayed)).toEqual(asMap(forward));
    // And a swap of two adjacent siblings needs no third, temporary value.
    expect(new Set(forward.map((p) => p.sortOrder)).size).toBe(forward.length);
  });

  it('🔴 writes ONE audit row for the whole reorder, with a null target', async () => {
    // The intent is "the admin reordered these siblings". Twelve rows would
    // make the log useless for the one case it exists for. Batch 7's bulk-lock
    // decision is the INVERSE of this and both are right.
    const { prisma, service, auditCalls, audit } = wire();
    prisma.course.findMany.mockResolvedValue(IDS.map((id) => ({ id })));

    await service.reorderCourses(IDS, audit);

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]?.targetId).toBeNull();
    expect(auditCalls[0]?.tx).toBe(prisma);
  });
});

describe('the three rejection shapes — R8.8 property 2', () => {
  it('a PARTIAL list is a 400 and writes nothing', async () => {
    // Renumbering a subset interleaves the renumbered rows with untouched ones
    // at values nobody chose, so the result is neither the old order nor the
    // new one — and it can create ties, which DETERMINISTIC_ORDER_BY then
    // breaks by createdAt, i.e. by an order the admin never expressed.
    const { prisma, service } = wire();
    prisma.course.findMany.mockResolvedValue(
      ['a', 'b', 'c', 'd'].map((id) => ({ id })),
    );

    await expect(service.reorderCourses(['a', 'b'])).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it('a DUPLICATED id is a 400 — one row cannot hold two positions', async () => {
    const { prisma, service } = wire();

    await expect(service.reorderCourses(['a', 'b', 'a'])).rejects.toMatchObject(
      { status: 400 },
    );
    // Refused without even opening a transaction: it is a property of the
    // request alone.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a FOREIGN-PARENT id is a 400 and writes nothing', async () => {
    // The module list of course A must not renumber a module of course B.
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
    prisma.courseModule.findMany.mockResolvedValue([
      { id: 'm1' },
      { id: 'm2' },
    ]);

    await expect(
      service.reorderModules('course-1', ['m1', 'from-another-course']),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.courseModule.update).not.toHaveBeenCalled();
  });

  it('the refusal reports a COUNT, not which ids exist elsewhere', async () => {
    // Echoing which of the caller's ids are real rows somewhere else would turn
    // a reorder into an existence probe over the whole table.
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
    prisma.courseModule.findMany.mockResolvedValue([{ id: 'm1' }]);

    const failure = await service
      .reorderModules('course-1', ['m1', 'secret-module-id'])
      .catch((e) => e);

    expect(JSON.stringify(failure.response)).not.toContain('secret-module-id');
  });

  it('an EMPTY list against a non-empty sibling set is a 400', async () => {
    const { prisma, service } = wire();
    prisma.course.findMany.mockResolvedValue([{ id: 'a' }]);

    await expect(service.reorderCourses([])).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('completeness is checked INSIDE the transaction', () => {
  it('the sibling read happens on the transaction client, not on the singleton', async () => {
    // Checked outside, a lesson created by another admin between the check and
    // the writes would be left at a stale number — renumbered out of the order
    // without ever appearing in the request. Batch 6C's D-6.6a.
    const { prisma, service } = wire();
    let readInsideTransaction = false;

    prisma.course.findMany.mockImplementation(async () => {
      readInsideTransaction = prisma.$transaction.mock.calls.length > 0;
      return IDS.map((id) => ({ id }));
    });

    await service.reorderCourses(IDS);

    expect(readInsideTransaction).toBe(true);
  });

  it('the sibling read is NOT_DELETED-filtered — a tombstone is not a sibling', async () => {
    const { prisma, service } = wire();
    prisma.course.findMany.mockResolvedValue(IDS.map((id) => ({ id })));

    await service.reorderCourses(IDS);

    expect(prisma.course.findMany.mock.calls[0]?.[0]?.where).toEqual({
      deletedAt: null,
    });
  });
});

describe('scoping — a reorder never crosses a parent', () => {
  it('reorderModules scopes to the SUPPLIED courseId, never to the first id`s course', async () => {
    // Inferring the parent would make a request mixing two courses' modules
    // look valid for whichever course the first id belonged to, and would
    // silently renumber a course the admin was not editing.
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue({ id: 'course-1' });
    prisma.courseModule.findMany.mockResolvedValue([{ id: 'm1' }]);

    await service.reorderModules('course-1', ['m1']);

    expect(prisma.courseModule.findMany.mock.calls[0]?.[0]?.where).toEqual({
      deletedAt: null,
      courseId: 'course-1',
    });
  });

  it('reorderModules 404s for a course that does not exist or is deleted', async () => {
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue(null);

    await expect(service.reorderModules('gone', ['m1'])).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.courseModule.update).not.toHaveBeenCalled();
  });

  it('reorderLessons scopes to the module AND checks the module`s course is live', async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findFirst.mockResolvedValue({ id: 'module-1' });
    prisma.lesson.findMany.mockResolvedValue([{ id: 'l1' }, { id: 'l2' }]);

    await service.reorderLessons('module-1', ['l2', 'l1']);

    expect(
      prisma.courseModule.findFirst.mock.calls[0]?.[0]?.where,
    ).toMatchObject({
      id: 'module-1',
      deletedAt: null,
      course: { deletedAt: null },
    });
    expect(writtenPositions(prisma.lesson.update)).toEqual(
      renumberSparse(['l2', 'l1']),
    );
  });

  it('reorderLessons 404s for a deleted module', async () => {
    const { prisma, service } = wire();
    prisma.courseModule.findFirst.mockResolvedValue(null);

    await expect(service.reorderLessons('gone', ['l1'])).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('the three entry points share one implementation', () => {
  it('all three reject a duplicate the same way', async () => {
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue({ id: 'p' });
    prisma.courseModule.findFirst.mockResolvedValue({ id: 'p' });

    const failures = await Promise.all([
      service.reorderCourses(['a', 'a']).catch((e) => e.status),
      service.reorderModules('p', ['a', 'a']).catch((e) => e.status),
      service.reorderLessons('p', ['a', 'a']).catch((e) => e.status),
    ]);

    expect(failures).toEqual([400, 400, 400]);
  });

  it('all three write ONE audit row with a null target', async () => {
    const { prisma, service, auditCalls, audit } = wire();
    prisma.course.findFirst.mockResolvedValue({ id: 'p' });
    prisma.courseModule.findFirst.mockResolvedValue({ id: 'p' });
    prisma.course.findMany.mockResolvedValue([{ id: 'a' }]);
    prisma.courseModule.findMany.mockResolvedValue([{ id: 'a' }]);
    prisma.lesson.findMany.mockResolvedValue([{ id: 'a' }]);

    await service.reorderCourses(['a'], audit);
    await service.reorderModules('p', ['a'], audit);
    await service.reorderLessons('p', ['a'], audit);

    expect(auditCalls).toHaveLength(3);
    expect(auditCalls.every((c) => c.targetId === null)).toBe(true);
  });
});
