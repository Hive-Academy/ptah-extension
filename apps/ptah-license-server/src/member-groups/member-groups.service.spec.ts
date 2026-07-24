import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated-prisma-client/client';
import { PrismaService } from '../prisma/prisma.service';
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
});
