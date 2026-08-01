import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ptah-api/core';
import { PrismaService } from '@ptah-api/core';
import { AuditLogService } from '../audit/audit-log.service';
import { MemberGroupsService } from './member-groups.service';

/**
 * Unit tests for `MemberGroupsService`.
 *
 * Focus:
 *   - Atomic default swap on create/update (previous default demoted in tx).
 *   - Idempotent bulk-assign (already-member → skipped) + email resolution
 *     (case-insensitive) + unknown-id/email skips.
 *   - Idempotent `assignDefaultGroup` (upsert) + no-default no-op.
 *   - Audit rows for create/update/assign/unassign.
 *   - Member/discourse group projections for a user.
 *
 * Strategy: a hand-rolled Prisma mock (no shared factory dependency) whose
 * `$transaction(cb)` runs the callback inline with the same mock as `tx`.
 */

interface GroupDelegate {
  findMany: jest.Mock;
  findFirst: jest.Mock;
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
}
interface AssignmentDelegate {
  findMany: jest.Mock;
  findUnique: jest.Mock;
  create: jest.Mock;
  upsert: jest.Mock;
  deleteMany: jest.Mock;
  /** TASK_2026_169: backs the paginated group-members drill-down. */
  count: jest.Mock;
}
interface UserDelegate {
  findMany: jest.Mock;
}
interface MockPrisma {
  memberGroup: GroupDelegate;
  memberGroupAssignment: AssignmentDelegate;
  user: UserDelegate;
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    memberGroup: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    memberGroupAssignment: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'assign-1' }),
      upsert: jest.fn().mockResolvedValue({ id: 'assign-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: MockPrisma) => Promise<unknown>)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  return prisma;
}

function createAuditMock(): jest.Mocked<Pick<AuditLogService, 'write'>> {
  return {
    write: jest.fn().mockResolvedValue('audit-id'),
  } as unknown as jest.Mocked<Pick<AuditLogService, 'write'>>;
}

function build(prisma: MockPrisma, audit = createAuditMock()) {
  const service = new MemberGroupsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditLogService,
  );
  return { service, audit };
}

function makeGroup(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'grp-1',
    key: 'founding',
    name: 'Founding Members',
    description: null,
    discourseGroup: 'builders-founding',
    sessionEventId: null,
    isDefault: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('MemberGroupsService', () => {
  describe('listWithCounts', () => {
    it('maps the assignment _count into memberCount', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findMany.mockResolvedValue([
        { ...makeGroup(), _count: { assignments: 7 } },
      ]);
      const { service } = build(prisma);

      const list = await service.listWithCounts();

      expect(list).toEqual([
        expect.objectContaining({ key: 'founding', memberCount: 7 }),
      ]);
    });
  });

  describe('create', () => {
    it('clears the previous default atomically when isDefault=true and audits', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.create.mockResolvedValue(makeGroup({ id: 'grp-new' }));
      const { service, audit } = build(prisma);

      const result = await service.create(
        {
          key: 'founding',
          name: 'Founding Members',
          discourseGroup: 'builders-founding',
          isDefault: true,
        },
        'admin@example.com',
      );

      expect(prisma.memberGroup.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result.memberCount).toBe(0);
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'group.create',
          targetType: 'MemberGroup',
          targetId: 'grp-new',
        }),
      );
    });

    it('does NOT clear defaults when isDefault is omitted/false', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.create.mockResolvedValue(
        makeGroup({ id: 'grp-x', isDefault: false }),
      );
      const { service } = build(prisma);

      await service.create({ key: 'charter', name: 'Charter' }, null);

      expect(prisma.memberGroup.updateMany).not.toHaveBeenCalled();
    });

    it('translates a duplicate-key (P2002) into a 409 ConflictException', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      const { service } = build(prisma);

      await expect(
        service.create({ key: 'founding', name: 'Founding' }, null),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('demotes the prior default (excluding self) when isDefault=true', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findUnique.mockResolvedValue(makeGroup());
      prisma.memberGroup.update.mockResolvedValue({
        ...makeGroup(),
        _count: { assignments: 2 },
      });
      const { service, audit } = build(prisma);

      await service.update('grp-1', { isDefault: true }, 'admin@example.com');

      expect(prisma.memberGroup.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true, NOT: { id: 'grp-1' } },
        data: { isDefault: false },
      });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'group.update', targetId: 'grp-1' }),
      );
    });

    it('throws 404 when the group does not exist', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findUnique.mockResolvedValue(null);
      const { service } = build(prisma);

      await expect(
        service.update('missing', { name: 'X' }, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('only writes supplied fields (null clears description)', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findUnique.mockResolvedValue(makeGroup());
      prisma.memberGroup.update.mockResolvedValue({
        ...makeGroup(),
        _count: { assignments: 0 },
      });
      const { service } = build(prisma);

      await service.update('grp-1', { description: null }, null);

      const updateArg = prisma.memberGroup.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(updateArg.data).toEqual({ description: null });
    });
  });

  describe('assignDefaultGroup', () => {
    it('upserts an idempotent assignment to the default group', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findFirst.mockResolvedValue({
        id: 'grp-def',
        key: 'founding',
        name: 'Founding Members',
        discourseGroup: 'builders-founding',
      });
      const { service } = build(prisma);

      await service.assignDefaultGroup('user-1');

      expect(prisma.memberGroupAssignment.upsert).toHaveBeenCalledWith({
        where: { userId_groupId: { userId: 'user-1', groupId: 'grp-def' } },
        create: {
          userId: 'user-1',
          groupId: 'grp-def',
          source: 'auto_provisioning',
        },
        update: {},
      });
    });

    it('no-ops when there is no default group', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findFirst.mockResolvedValue(null);
      const { service } = build(prisma);

      await service.assignDefaultGroup('user-1');

      expect(prisma.memberGroupAssignment.upsert).not.toHaveBeenCalled();
    });
  });

  describe('assignMany', () => {
    it('resolves emails case-insensitively, skips already-members + unknowns, audits', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findUnique.mockResolvedValue({
        id: 'grp-1',
        key: 'founding',
        discourseGroup: 'builders-founding',
      });
      // Two of three emails resolve; third is unknown (skipped).
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', email: 'a@e.com' },
        { id: 'u2', email: 'b@e.com' },
      ]);
      // u1 already assigned (skipped); u2 is new (assigned).
      prisma.memberGroupAssignment.findUnique
        .mockResolvedValueOnce({ id: 'existing' })
        .mockResolvedValueOnce(null);
      const { service, audit } = build(prisma);

      const result = await service.assignMany(
        'grp-1',
        { emails: ['A@E.com', 'b@e.com', 'unknown@e.com'] },
        'admin@example.com',
      );

      // user lookup is lowercased.
      const findManyArg = prisma.user.findMany.mock.calls[0][0] as {
        where: { email: { in: string[] } };
      };
      expect(findManyArg.where.email.in).toEqual([
        'a@e.com',
        'b@e.com',
        'unknown@e.com',
      ]);

      expect(result.assigned).toBe(1); // u2
      expect(result.skipped).toBe(2); // u1 already-member + 1 unknown email
      expect(result.syncedUsers).toEqual([{ userId: 'u2', email: 'b@e.com' }]);
      expect(result.discourseGroup).toBe('builders-founding');
      expect(prisma.memberGroupAssignment.create).toHaveBeenCalledWith({
        data: { userId: 'u2', groupId: 'grp-1', source: 'admin' },
      });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'group.assign',
          targetId: 'grp-1',
          metadata: expect.objectContaining({ assigned: 1, skipped: 2 }),
        }),
      );
    });

    it('throws 404 when the target group is missing', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findUnique.mockResolvedValue(null);
      const { service } = build(prisma);

      await expect(
        service.assignMany('missing', { userIds: [] }, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unassign', () => {
    it('audits and reports removed=true when a row was deleted', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroupAssignment.deleteMany.mockResolvedValue({ count: 1 });
      const { service, audit } = build(prisma);

      const result = await service.unassign('grp-1', 'u1', 'admin@example.com');

      expect(result).toEqual({ removed: true });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'group.unassign',
          targetId: 'grp-1',
          metadata: { userId: 'u1' },
        }),
      );
    });

    it('is a silent no-op (removed=false, no audit) when nothing matched', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroupAssignment.deleteMany.mockResolvedValue({ count: 0 });
      const { service, audit } = build(prisma);

      const result = await service.unassign('grp-1', 'u1', null);

      expect(result).toEqual({ removed: false });
      expect(audit.write).not.toHaveBeenCalled();
    });
  });

  describe('user projections', () => {
    it('getGroupsForUser maps to {key,name}', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroupAssignment.findMany.mockResolvedValue([
        { group: { key: 'founding', name: 'Founding Members' } },
      ]);
      const { service } = build(prisma);

      await expect(service.getGroupsForUser('u1')).resolves.toEqual([
        { key: 'founding', name: 'Founding Members' },
      ]);
    });

    it('getDiscourseGroupsForUser drops null names', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroupAssignment.findMany.mockResolvedValue([
        { group: { discourseGroup: 'builders-founding' } },
        { group: { discourseGroup: null } },
      ]);
      const { service } = build(prisma);

      await expect(service.getDiscourseGroupsForUser('u1')).resolves.toEqual([
        'builders-founding',
      ]);
    });
  });

  /**
   * Cohort-aware live sessions: each cohort may name its own Google Calendar
   * master event, so two cohorts (e.g. English + Arabic) can run concurrently.
   */
  describe('session event resolution', () => {
    describe('getSessionEventIdForUser', () => {
      it('asks the DB for the most-recent assignment among cohorts THAT HAVE an event', async () => {
        const prisma = createMockPrisma();
        prisma.memberGroupAssignment.findMany.mockResolvedValue([
          { group: { key: 'arabic', sessionEventId: 'evt_arabic' } },
        ]);
        const { service } = build(prisma);

        await expect(service.getSessionEventIdForUser('u1')).resolves.toBe(
          'evt_arabic',
        );

        // The rule lives in the query, so assert the query itself:
        //   - cohorts without an event are excluded (they must never shadow a
        //     configured one by merely being assigned later),
        //   - newest assignment first (the admin's placement always post-dates
        //     the auto_provisioning default assignment),
        //   - group.key ascending as a total tie-break.
        expect(prisma.memberGroupAssignment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: 'u1', group: { sessionEventId: { not: null } } },
            orderBy: [{ assignedAt: 'desc' }, { group: { key: 'asc' } }],
          }),
        );
      });

      it('takes the FIRST row, i.e. the most recently assigned cohort', async () => {
        const prisma = createMockPrisma();
        // Ordered by the query: admin-assigned Arabic (newer) ahead of the
        // auto-provisioned English default (older).
        prisma.memberGroupAssignment.findMany.mockResolvedValue([
          { group: { key: 'arabic', sessionEventId: 'evt_arabic' } },
          { group: { key: 'english', sessionEventId: 'evt_english' } },
        ]);
        const { service } = build(prisma);

        await expect(service.getSessionEventIdForUser('u1')).resolves.toBe(
          'evt_arabic',
        );
      });

      it('skips whitespace-only ids and falls through to the next cohort', async () => {
        const prisma = createMockPrisma();
        prisma.memberGroupAssignment.findMany.mockResolvedValue([
          { group: { key: 'broken', sessionEventId: '   ' } },
          { group: { key: 'english', sessionEventId: ' evt_english ' } },
        ]);
        const { service } = build(prisma);

        // Also trims — a pasted id with stray spaces still matches in Calendar.
        await expect(service.getSessionEventIdForUser('u1')).resolves.toBe(
          'evt_english',
        );
      });

      it('returns null for a user in no event-configured cohort (env fallback)', async () => {
        const prisma = createMockPrisma();
        prisma.memberGroupAssignment.findMany.mockResolvedValue([]);
        const { service } = build(prisma);

        await expect(
          service.getSessionEventIdForUser('u1'),
        ).resolves.toBeNull();
      });
    });

    describe('listSessionEventIds', () => {
      it('returns distinct, trimmed, non-empty ids', async () => {
        const prisma = createMockPrisma();
        prisma.memberGroup.findMany.mockResolvedValue([
          { sessionEventId: 'evt_english' },
          { sessionEventId: ' evt_english ' }, // same event, sloppy paste
          { sessionEventId: 'evt_arabic' },
          { sessionEventId: '  ' },
        ]);
        const { service } = build(prisma);

        await expect(service.listSessionEventIds()).resolves.toEqual([
          'evt_english',
          'evt_arabic',
        ]);
      });

      it('returns [] when no cohort configures an event (single-cohort deployment)', async () => {
        const prisma = createMockPrisma();
        prisma.memberGroup.findMany.mockResolvedValue([]);
        const { service } = build(prisma);

        // This empty result is the signal every caller uses to keep the exact
        // pre-cohort behaviour.
        await expect(service.listSessionEventIds()).resolves.toEqual([]);
      });
    });

    describe('admin configuration', () => {
      it('normalizes a blank sessionEventId to null on create', async () => {
        const prisma = createMockPrisma();
        prisma.memberGroup.create.mockResolvedValue(makeGroup({ id: 'grp-n' }));
        const { service } = build(prisma);

        await service.create(
          { key: 'arabic', name: 'Arabic', sessionEventId: '   ' },
          null,
        );

        expect(prisma.memberGroup.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ sessionEventId: null }),
          }),
        );
      });

      it('stores a trimmed sessionEventId on create', async () => {
        const prisma = createMockPrisma();
        prisma.memberGroup.create.mockResolvedValue(makeGroup({ id: 'grp-n' }));
        const { service } = build(prisma);

        await service.create(
          { key: 'arabic', name: 'Arabic', sessionEventId: ' evt_arabic ' },
          null,
        );

        expect(prisma.memberGroup.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ sessionEventId: 'evt_arabic' }),
          }),
        );
      });

      it('patches sessionEventId when present and CLEARS it on explicit null', async () => {
        const prisma = createMockPrisma();
        prisma.memberGroup.findUnique.mockResolvedValue(makeGroup());
        prisma.memberGroup.update.mockResolvedValue({
          ...makeGroup(),
          sessionEventId: null,
          _count: { assignments: 0 },
        });
        const { service } = build(prisma);

        await service.update('grp-1', { sessionEventId: null }, null);

        expect(prisma.memberGroup.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ sessionEventId: null }),
          }),
        );
      });

      it('leaves sessionEventId untouched when the key is absent from the patch', async () => {
        const prisma = createMockPrisma();
        prisma.memberGroup.findUnique.mockResolvedValue(makeGroup());
        prisma.memberGroup.update.mockResolvedValue({
          ...makeGroup(),
          _count: { assignments: 0 },
        });
        const { service } = build(prisma);

        await service.update('grp-1', { name: 'Renamed' }, null);

        const data = prisma.memberGroup.update.mock.calls[0][0].data as Record<
          string,
          unknown
        >;
        // Omission must not clear the column — only an explicit null does.
        expect('sessionEventId' in data).toBe(false);
      });

      it('projects sessionEventId onto the admin list shape', async () => {
        const prisma = createMockPrisma();
        prisma.memberGroup.findMany.mockResolvedValue([
          {
            ...makeGroup({ sessionEventId: 'evt_arabic' }),
            _count: { assignments: 3 },
          },
        ]);
        const { service } = build(prisma);

        await expect(service.listWithCounts()).resolves.toEqual([
          expect.objectContaining({ sessionEventId: 'evt_arabic' }),
        ]);
      });
    });
  });

  /**
   * TASK_2026_169 — the group-members drill-down. Closes the gap the admin
   * frontend flagged in its own docblock: `DELETE /groups/:id/members/:userId`
   * existed with no way to browse a group's members and pick one.
   */
  describe('listMembers', () => {
    const ASSIGNMENT = {
      assignedAt: new Date('2026-02-01T00:00:00Z'),
      source: 'admin',
      user: {
        id: 'usr-1',
        email: 'member@example.com',
        firstName: 'Mem',
        lastName: 'Ber',
      },
    };

    it('returns a paginated envelope with the joined user fields', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findUnique.mockResolvedValue({ id: 'grp-1' });
      prisma.memberGroupAssignment.findMany.mockResolvedValue([ASSIGNMENT]);
      prisma.memberGroupAssignment.count.mockResolvedValue(1);
      const { service } = build(prisma);

      const page = await service.listMembers('grp-1', {
        page: 1,
        pageSize: 25,
      });

      expect(page).toEqual({
        members: [
          {
            userId: 'usr-1',
            email: 'member@example.com',
            firstName: 'Mem',
            lastName: 'Ber',
            assignedAt: '2026-02-01T00:00:00.000Z',
            source: 'admin',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      });
    });

    it('computes skip/take from page and pageSize, newest assignment first', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findUnique.mockResolvedValue({ id: 'grp-1' });
      const { service } = build(prisma);

      await service.listMembers('grp-1', { page: 3, pageSize: 10 });

      expect(prisma.memberGroupAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
          orderBy: { assignedAt: 'desc' },
        }),
      );
    });

    it('defaults to page 1 / pageSize 25 when omitted', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findUnique.mockResolvedValue({ id: 'grp-1' });
      const { service } = build(prisma);

      const page = await service.listMembers('grp-1', {});

      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(25);
      expect(prisma.memberGroupAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 25 }),
      );
    });

    it('filters on the FIXED user.email column, never a caller-named field', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findUnique.mockResolvedValue({ id: 'grp-1' });
      const { service } = build(prisma);

      await service.listMembers('grp-1', { search: 'member@' });

      const where =
        prisma.memberGroupAssignment.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        groupId: 'grp-1',
        user: { email: { contains: 'member@', mode: 'insensitive' } },
      });
    });

    it('omits the search predicate entirely when no search is supplied', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findUnique.mockResolvedValue({ id: 'grp-1' });
      const { service } = build(prisma);

      await service.listMembers('grp-1', {});

      expect(
        prisma.memberGroupAssignment.findMany.mock.calls[0][0].where,
      ).toEqual({ groupId: 'grp-1' });
    });

    it('throws 404 for an unknown group rather than returning an empty page', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findUnique.mockResolvedValue(null);
      const { service } = build(prisma);

      await expect(service.listMembers('nope', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.memberGroupAssignment.findMany).not.toHaveBeenCalled();
    });

    it('runs the page read and the count in a single transaction', async () => {
      const prisma = createMockPrisma();
      prisma.memberGroup.findUnique.mockResolvedValue({ id: 'grp-1' });
      const { service } = build(prisma);

      await service.listMembers('grp-1', {});

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
