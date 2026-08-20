import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@ptah-api/core';
import { PrismaService } from '@ptah-api/core';
import { EmailService } from '@ptah-api/email';
import { AuditLogService } from '@ptah-api/audit';
import { AdminService, DeleteUserActor } from './admin.service';
import { DeleteUserDto } from './dto/delete-user.dto';
import { ListQueryDto } from './admin.dto';
import { ADMIN_MODELS } from './admin-models.config';

/**
 * Unit tests for `AdminService.deleteUserCascade` (TASK_2025_292 T-B2-05).
 *
 * Strategy: mock `PrismaService` with a thin callback-capable `$transaction`
 * stub. The mock's `$transaction` fn accepts the service's `async (tx) => …`
 * callback and re-uses the same mock object as `tx` — that lets us assert
 * `tx.user.delete` was called exactly once per happy-path run.
 *
 * `AuditLogService.write` is mocked to resolve an id; we assert it received
 * the captured pre-delete snapshot + `tx` handle (R8 — audit + mutation
 * atomic).
 */

interface MockUserDelegate {
  findUnique: jest.Mock;
  delete: jest.Mock;
  count: jest.Mock;
}
interface MockCountOnlyDelegate {
  count: jest.Mock;
  findFirst: jest.Mock;
}

interface MockPrisma {
  user: MockUserDelegate;
  subscription: MockCountOnlyDelegate;
  license: { count: jest.Mock };
  sessionRequest: { count: jest.Mock };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    user: {
      findUnique: jest.fn(),
      delete: jest.fn().mockResolvedValue({ id: 'user-1' }),
      count: jest.fn(),
    },
    subscription: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    license: { count: jest.fn().mockResolvedValue(0) },
    sessionRequest: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(),
  };
  // Default: run the callback inline with the mock as `tx`.
  prisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: MockPrisma) => Promise<unknown>)(prisma);
    }
    // Array-form $transaction (used by getUserDeletionPreview). Not
    // exercised by deleteUserCascade tests but kept for completeness.
    return Promise.all(arg as Promise<unknown>[]);
  });
  return prisma;
}

function makeUser(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 'user-1',
    email: 'target@example.com',
    firstName: 'Target',
    lastName: 'User',
    workosId: null,
    paddleCustomerId: null,
    emailVerified: true,
    marketingOptIn: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('AdminService.deleteUserCascade', () => {
  let prisma: MockPrisma;
  let email: jest.Mocked<EmailService>;
  let auditLog: jest.Mocked<AuditLogService>;
  let config: jest.Mocked<ConfigService>;
  let service: AdminService;

  const actor: DeleteUserActor = {
    email: 'admin@example.com',
    ip: '10.0.0.1',
    userAgent: 'Mozilla/5.0',
  };

  const baseDto: DeleteUserDto = {
    confirmEmail: 'target@example.com',
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    email = {
      sendCustomEmail: jest.fn(),
    } as unknown as jest.Mocked<EmailService>;
    auditLog = {
      write: jest.fn().mockResolvedValue('audit-row-1'),
    } as unknown as jest.Mocked<AuditLogService>;
    config = {
      get: jest.fn().mockReturnValue('admin@example.com'),
    } as unknown as jest.Mocked<ConfigService>;

    service = new AdminService(
      prisma as unknown as PrismaService,
      email,
      auditLog,
      config,
    );
  });

  it('happy path: writes audit log + calls tx.user.delete + returns snapshot', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(makeUser());

    const result = await service.deleteUserCascade('user-1', baseDto, actor);

    expect(result.deleted).toBe(true);
    expect(result.user.email).toBe('target@example.com');
    expect(result.cascaded).toEqual({
      subscriptions: 0,
      licenses: 0,
      sessionRequests: 0,
    });
    expect(result.auditLogId).toBe('audit-row-1');

    expect(auditLog.write).toHaveBeenCalledTimes(1);
    const writeArg = auditLog.write.mock.calls[0][0];
    expect(writeArg.action).toBe('user.delete');
    expect(writeArg.targetType).toBe('User');
    expect(writeArg.targetId).toBe('user-1');
    expect(writeArg.actorEmail).toBe('admin@example.com');
    expect(writeArg.ipAddress).toBe('10.0.0.1');
    expect(writeArg.userAgent).toBe('Mozilla/5.0');
    expect(writeArg.tx).toBeDefined(); // R8: audit write enlisted in tx
    expect(writeArg.metadata).toEqual({
      cascadedCounts: {
        subscriptions: 0,
        licenses: 0,
        sessionRequests: 0,
      },
      acknowledgedPaidSubscription: false,
    });

    expect(prisma.user.delete).toHaveBeenCalledTimes(1);
    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
  });

  it('throws 409 ACTIVE_PAID_SUBSCRIPTION when active sub present and no override', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(makeUser());
    prisma.subscription.findFirst.mockResolvedValueOnce({
      paddleSubscriptionId: 'sub_abc123',
    });

    await expect(
      service.deleteUserCascade('user-1', baseDto, actor),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(auditLog.write).not.toHaveBeenCalled();
  });

  it('bypasses active-paid gate when acknowledgePaidSubscription: true', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(makeUser());
    prisma.subscription.findFirst.mockResolvedValueOnce({
      paddleSubscriptionId: 'sub_abc123',
    });

    const result = await service.deleteUserCascade(
      'user-1',
      { ...baseDto, acknowledgePaidSubscription: true },
      actor,
    );

    expect(result.deleted).toBe(true);
    expect(prisma.user.delete).toHaveBeenCalledTimes(1);
    expect(auditLog.write).toHaveBeenCalledTimes(1);
    const writeArg = auditLog.write.mock.calls[0][0];
    expect(writeArg.metadata).toMatchObject({
      acknowledgedPaidSubscription: true,
    });
  });

  it('throws 400 CONFIRM_EMAIL_MISMATCH when typed email does not match', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(makeUser());

    await expect(
      service.deleteUserCascade(
        'user-1',
        { confirmEmail: 'wrong@example.com' },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(auditLog.write).not.toHaveBeenCalled();
  });

  it('confirm email comparison is case-insensitive', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(
      makeUser({ email: 'Target@Example.COM' }),
    );

    const result = await service.deleteUserCascade(
      'user-1',
      { confirmEmail: 'target@example.com' },
      actor,
    );

    expect(result.deleted).toBe(true);
  });

  it('throws 403 CANNOT_DELETE_ADMIN when target email is on ADMIN_EMAILS', async () => {
    // Make the target user an admin themselves.
    config.get.mockReturnValue('other@example.com,target@example.com');
    prisma.user.findUnique.mockResolvedValueOnce(makeUser());

    await expect(
      service.deleteUserCascade('user-1', baseDto, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(auditLog.write).not.toHaveBeenCalled();
  });

  it('throws 404 when user does not exist at start of transaction', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.deleteUserCascade('missing-id', baseDto, actor),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(auditLog.write).not.toHaveBeenCalled();
  });

  it('maps Prisma P2025 (race on delete) to 404 NotFoundException', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(makeUser());
    // Simulate the row being deleted concurrently between findUnique + delete.
    const p2025 = new Prisma.PrismaClientKnownRequestError(
      'Record to delete does not exist.',
      { code: 'P2025', clientVersion: 'test' },
    );
    prisma.user.delete.mockRejectedValueOnce(p2025);

    await expect(
      service.deleteUserCascade('user-1', baseDto, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ===========================================================================
  // F1 — Cascade Deletion Integration Scenarios (TASK_2025_292 B7-T01)
  // ===========================================================================
  //
  // These build on the unit-level coverage above and exercise the user-impact
  // matrix called out in task-description §8 F1: row-count fan-out, performance,
  // and atomic audit-log writes inside the same Prisma interactive transaction.

  describe('F1 — cascade integration scenarios', () => {
    it('user with 0 related rows: cascadedCounts all zero, audit row recorded', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(makeUser());
      // All count delegates default to 0 in createMockPrisma().

      const result = await service.deleteUserCascade('user-1', baseDto, actor);

      expect(result.cascaded).toEqual({
        subscriptions: 0,
        licenses: 0,
        sessionRequests: 0,
      });
      expect(prisma.user.delete).toHaveBeenCalledTimes(1);

      const writeArg = auditLog.write.mock.calls[0][0];
      expect(writeArg.metadata).toMatchObject({
        cascadedCounts: {
          subscriptions: 0,
          licenses: 0,
          sessionRequests: 0,
        },
      });
    });

    it('user with 1 of each related type: cascadedCounts surface correctly in audit metadata', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(makeUser());
      // Subscription.count is called twice — once for active-paid gate guard
      // (mocked via findFirst above, returns null) and once inside the snapshot
      // Promise.all. The other three count() calls map 1:1.
      prisma.subscription.count.mockResolvedValueOnce(1);
      prisma.license.count.mockResolvedValueOnce(1);
      prisma.sessionRequest.count.mockResolvedValueOnce(1);

      const result = await service.deleteUserCascade('user-1', baseDto, actor);

      expect(result.cascaded).toEqual({
        subscriptions: 1,
        licenses: 1,
        sessionRequests: 1,
      });

      const writeArg = auditLog.write.mock.calls[0][0];
      expect(writeArg.metadata).toMatchObject({
        cascadedCounts: {
          subscriptions: 1,
          licenses: 1,
          sessionRequests: 1,
        },
      });
    });

    it('user with 100 of each: counts forwarded + happy path executes well under perf budget (< 500ms)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(makeUser());
      prisma.subscription.count.mockResolvedValueOnce(100);
      prisma.license.count.mockResolvedValueOnce(100);
      prisma.sessionRequest.count.mockResolvedValueOnce(100);

      const start = Date.now();
      const result = await service.deleteUserCascade('user-1', baseDto, actor);
      const elapsedMs = Date.now() - start;

      expect(result.cascaded).toEqual({
        subscriptions: 100,
        licenses: 100,
        sessionRequests: 100,
      });
      // p95 perf target — service-layer logic (no real DB) must stay tiny.
      // Real DB perf is gated separately in the e2e suite; this guards
      // against accidental N^2 logic creeping into the cascade path.
      expect(elapsedMs).toBeLessThan(500);
    });

    it('audit-log write enlists in the same Prisma transaction as the user.delete (R8)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(makeUser());

      await service.deleteUserCascade('user-1', baseDto, actor);

      // R8: audit + delete must share one tx. Our $transaction mock aliases
      // `tx` to the prisma mock, so the `tx` arg passed to auditLog.write is
      // the same client used to call user.delete.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(auditLog.write).toHaveBeenCalledTimes(1);
      expect(prisma.user.delete).toHaveBeenCalledTimes(1);

      const writeArg = auditLog.write.mock.calls[0][0];
      expect(writeArg.tx).toBe(prisma); // same handle threaded through
    });

    it('audit row is rolled back when user.delete fails after audit.write succeeded', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(makeUser());
      // Simulate a generic DB failure on delete (not P2025) — should bubble.
      const dbErr = new Error('connection reset');
      prisma.user.delete.mockRejectedValueOnce(dbErr);

      await expect(
        service.deleteUserCascade('user-1', baseDto, actor),
      ).rejects.toThrow('connection reset');

      // Audit was *attempted* in tx, but Prisma would roll back the row when
      // the outer tx callback throws. We can't observe Postgres-level rollback
      // in unit tests — what we CAN assert is that write was called with the
      // tx handle (so it would roll back) and that delete was attempted.
      const writeArg = auditLog.write.mock.calls[0][0];
      expect(writeArg.tx).toBe(prisma);
    });
  });
});

describe('AdminService.getStats', () => {
  interface StatsMockPrisma {
    waitlist: { count: jest.Mock };
    license: { count: jest.Mock };
    failedWebhook: { count: jest.Mock };
    subscription: { count: jest.Mock };
    sessionRequest: { count: jest.Mock };
    $transaction: jest.Mock;
  }

  function build(counts: {
    total: number;
    notified: number;
    /** TASK_2026_201 R4.5 — free founding grants (`approvedAt` non-null). */
    approved: number;
    converted: number;
    last7Days: number;
    builders: number;
    community: number;
    failedWebhooksUnresolved?: number;
    subscriptionsPastDue?: number;
    sessionRequestsPending?: number;
  }): { service: AdminService; prisma: StatsMockPrisma } {
    const prisma: StatsMockPrisma = {
      waitlist: { count: jest.fn() },
      license: { count: jest.fn() },
      failedWebhook: { count: jest.fn() },
      subscription: { count: jest.fn() },
      sessionRequest: { count: jest.fn() },
      // Array-form $transaction: resolve the eagerly-created count promises.
      $transaction: jest
        .fn()
        .mockImplementation((arg: Promise<unknown>[]) => Promise.all(arg)),
    };
    // Call order matches getStats(): total, notified, approved, converted,
    // last7Days. ⚠️ `approved` sits BETWEEN notified and converted, mirroring
    // the funnel order in the service. These are positional `Once` mocks, so a
    // stage inserted in the service without a matching insert here silently
    // shifts every later count — which is why the assertions below check the
    // `where` clauses too, not just the numbers.
    prisma.waitlist.count
      .mockResolvedValueOnce(counts.total)
      .mockResolvedValueOnce(counts.notified)
      .mockResolvedValueOnce(counts.approved)
      .mockResolvedValueOnce(counts.converted)
      .mockResolvedValueOnce(counts.last7Days);
    // Then builders, community.
    prisma.license.count
      .mockResolvedValueOnce(counts.builders)
      .mockResolvedValueOnce(counts.community);
    // Then the attention aggregates (tail of the transaction).
    prisma.failedWebhook.count.mockResolvedValueOnce(
      counts.failedWebhooksUnresolved ?? 0,
    );
    prisma.subscription.count.mockResolvedValueOnce(
      counts.subscriptionsPastDue ?? 0,
    );
    prisma.sessionRequest.count.mockResolvedValueOnce(
      counts.sessionRequestsPending ?? 0,
    );

    const service = new AdminService(
      prisma as unknown as PrismaService,
      {} as unknown as EmailService,
      {} as unknown as AuditLogService,
      {} as unknown as ConfigService,
    );
    return { service, prisma };
  }

  it('returns the waitlist funnel + member counts with an ISO updatedAt', async () => {
    const { service } = build({
      total: 42,
      notified: 10,
      approved: 8,
      converted: 3,
      last7Days: 7,
      builders: 5,
      community: 100,
    });

    const stats = await service.getStats();

    expect(stats.waitlist).toEqual({
      total: 42,
      notified: 10,
      approved: 8,
      converted: 3,
      last7Days: 7,
    });
    expect(stats.members).toEqual({ builders: 5, community: 100 });
    expect(typeof stats.updatedAt).toBe('string');
    expect(new Date(stats.updatedAt).toISOString()).toBe(stats.updatedAt);
  });

  it('counts the free-grant stage as ONE aggregate, disjoint from converted', async () => {
    // TASK_2026_201 R4.5. Two properties, and the second is the reason the
    // column exists: `approved` is its own `count` (not a scan, not derived
    // from `converted`), and the two predicates address DIFFERENT columns —
    // a free grant must never register as a paid conversion.
    const { service, prisma } = build({
      total: 100,
      notified: 40,
      approved: 30,
      converted: 7,
      last7Days: 5,
      builders: 9,
      community: 60,
    });

    const stats = await service.getStats();

    expect(stats.waitlist.approved).toBe(30);
    expect(stats.waitlist.converted).toBe(7);
    expect(prisma.waitlist.count).toHaveBeenCalledWith({
      where: { approvedAt: { not: null } },
    });
    expect(prisma.waitlist.count).toHaveBeenCalledWith({
      where: { convertedAt: { not: null } },
    });
    // One aggregate per stage — five waitlist counts, never one per row.
    expect(prisma.waitlist.count).toHaveBeenCalledTimes(5);
  });

  it('surfaces the attention block from cheap count queries', async () => {
    const { service, prisma } = build({
      total: 40,
      notified: 25,
      approved: 12,
      converted: 5,
      last7Days: 3,
      builders: 5,
      community: 100,
      failedWebhooksUnresolved: 2,
      subscriptionsPastDue: 4,
      sessionRequestsPending: 6,
    });

    const stats = await service.getStats();

    expect(stats.attention).toEqual({
      waitlistUninvited: 15, // total 40 − notified 25
      failedWebhooksUnresolved: 2,
      subscriptionsPastDue: 4,
      sessionRequestsPending: 6,
    });
    expect(prisma.failedWebhook.count).toHaveBeenCalledWith({
      where: { resolved: false },
    });
    expect(prisma.subscription.count).toHaveBeenCalledWith({
      where: { status: 'past_due' },
    });
    expect(prisma.sessionRequest.count).toHaveBeenCalledWith({
      where: { status: 'pending' },
    });
  });

  it('includes per-group member counts from MemberGroupsService', async () => {
    const prisma = {
      waitlist: { count: jest.fn().mockResolvedValue(0) },
      license: { count: jest.fn().mockResolvedValue(0) },
      failedWebhook: { count: jest.fn().mockResolvedValue(0) },
      subscription: { count: jest.fn().mockResolvedValue(0) },
      sessionRequest: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest
        .fn()
        .mockImplementation((arg: Promise<unknown>[]) => Promise.all(arg)),
    };
    const memberGroups = {
      listWithCounts: jest.fn().mockResolvedValue([
        { key: 'founding', name: 'Founding Members', memberCount: 12 },
        { key: 'charter', name: 'Charter', memberCount: 3 },
      ]),
    };
    const service = new AdminService(
      prisma as unknown as PrismaService,
      {} as unknown as EmailService,
      {} as unknown as AuditLogService,
      {} as unknown as ConfigService,
      memberGroups as unknown as import('../../../community/src/lib/member-groups/member-groups.service').MemberGroupsService,
    );

    const stats = await service.getStats();

    expect(stats.groups).toEqual([
      { key: 'founding', name: 'Founding Members', memberCount: 12 },
      { key: 'charter', name: 'Charter', memberCount: 3 },
    ]);
  });

  it('falls back to empty groups when MemberGroupsService is unbound', async () => {
    const { service } = build({
      total: 0,
      notified: 0,
      approved: 0,
      converted: 0,
      last7Days: 0,
      builders: 0,
      community: 0,
    });

    const stats = await service.getStats();

    expect(stats.groups).toEqual([]);
  });

  it('counts active members by plan and recent signups by a 7-day window', async () => {
    const { service, prisma } = build({
      total: 1,
      notified: 0,
      approved: 0,
      converted: 0,
      last7Days: 1,
      builders: 0,
      community: 0,
    });

    await service.getStats();

    expect(prisma.license.count).toHaveBeenCalledWith({
      where: { plan: 'builders', status: 'active' },
    });
    expect(prisma.license.count).toHaveBeenCalledWith({
      where: { plan: 'community', status: 'active' },
    });
    // last7Days uses a gte Date lower bound roughly 7 days back. Located by
    // PREDICATE rather than by index: the index moved from 3 to 4 when
    // TASK_2026_201 inserted the `approved` stage into the funnel, and an
    // index-keyed lookup would have silently started asserting against a
    // different count instead of failing.
    const last7DaysCall = (
      prisma.waitlist.count.mock.calls as [
        { where?: { createdAt?: { gte?: Date } } },
      ][]
    )
      .map(([arg]) => arg)
      .find((arg) => arg?.where?.createdAt?.gte instanceof Date);
    const gte = last7DaysCall?.where?.createdAt?.gte as Date;
    expect(gte).toBeInstanceOf(Date);
    const deltaMs = Date.now() - gte.getTime();
    expect(deltaMs).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(deltaMs).toBeLessThan(7.1 * 24 * 60 * 60 * 1000);
  });
});

describe('AdminService.list filtering', () => {
  function buildList(prismaModel: string): {
    service: AdminService;
    findMany: jest.Mock;
    count: jest.Mock;
  } {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      [prismaModel]: { findMany, count },
      // Array-form $transaction: resolve the eagerly-created promises.
      $transaction: jest
        .fn()
        .mockImplementation((arg: Promise<unknown>[]) => Promise.all(arg)),
    };
    const service = new AdminService(
      prisma as unknown as PrismaService,
      {} as unknown as EmailService,
      {} as unknown as AuditLogService,
      {} as unknown as ConfigService,
    );
    return { service, findMany, count };
  }

  it('translates a boolean filter into a Prisma equality where', async () => {
    const { service, findMany, count } = buildList('failedWebhook');
    await service.list('failed-webhooks', {
      filter: 'resolved:false',
    } as ListQueryDto);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { resolved: false } }),
    );
    expect(count).toHaveBeenCalledWith({ where: { resolved: false } });
  });

  it('translates a datePresence filter into a not-null where', async () => {
    const { service, findMany } = buildList('waitlist');
    await service.list('waitlist', { filter: 'notified:true' } as ListQueryDto);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { notifiedAt: { not: null } } }),
    );
  });

  it('translates a datePresence false filter into a null where', async () => {
    const { service, findMany } = buildList('waitlist');
    await service.list('waitlist', {
      filter: 'notified:false',
    } as ListQueryDto);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { notifiedAt: null } }),
    );
  });

  it('ANDs an allowlisted string filter with the text search', async () => {
    const { service, findMany } = buildList('subscription');
    await service.list('subscriptions', {
      filter: 'status:past_due',
      search: 'cus_123',
    } as ListQueryDto);
    const arg = findMany.mock.calls[0][0] as { where: { AND: unknown[] } };
    expect(arg.where.AND).toEqual([
      { OR: expect.any(Array) },
      { status: 'past_due' },
    ]);
  });

  it('rejects a filter on a non-allowlisted field', async () => {
    const { service } = buildList('subscription');
    await expect(
      service.list('subscriptions', {
        filter: 'priceId:pri_1',
      } as ListQueryDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a string filter value outside the allowlist', async () => {
    const { service } = buildList('subscription');
    await expect(
      service.list('subscriptions', {
        filter: 'status:bogus',
      } as ListQueryDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-true/false boolean filter value', async () => {
    const { service } = buildList('failedWebhook');
    await expect(
      service.list('failed-webhooks', {
        filter: 'resolved:maybe',
      } as ListQueryDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malformed filter string', async () => {
    const { service } = buildList('failedWebhook');
    await expect(
      service.list('failed-webhooks', {
        filter: 'resolvedfalse',
      } as ListQueryDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('translates a relationPreset filter into its hard-coded relation where', async () => {
    const { service, findMany } = buildList('user');
    await service.list('users', {
      filter: 'entitlement:builders',
    } as ListQueryDto);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { licenses: { some: { plan: 'builders', status: 'active' } } },
      }),
    );
  });

  it('translates the `unlinked` reconciliation preset into its AND fragment', async () => {
    const { service, findMany } = buildList('user');
    await service.list('users', {
      filter: 'entitlement:unlinked',
    } as ListQueryDto);
    const arg = findMany.mock.calls[0][0] as { where: { AND: unknown[] } };
    expect(arg.where.AND).toEqual([
      { licenses: { some: { source: 'paddle', status: 'active' } } },
      { subscriptions: { none: {} } },
    ]);
  });

  it('nests a preset AND inside the outer AND when combined with search', async () => {
    const { service, findMany } = buildList('user');
    await service.list('users', {
      filter: 'entitlement:unlinked',
      search: 'abdallah',
    } as ListQueryDto);
    const arg = findMany.mock.calls[0][0] as { where: { AND: unknown[] } };
    expect(arg.where.AND).toEqual([
      { OR: expect.any(Array) },
      { AND: expect.any(Array) },
    ]);
  });

  it('rejects a relationPreset value that names no declared preset', async () => {
    const { service } = buildList('user');
    await expect(
      service.list('users', {
        filter: 'entitlement:whales',
      } as ListQueryDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a copy of the preset so the config is never mutated', async () => {
    const { service, findMany } = buildList('user');
    await service.list('users', {
      filter: 'entitlement:builders',
    } as ListQueryDto);
    const arg = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).not.toBe(
      ADMIN_MODELS.users.filterableFields?.['entitlement'],
    );
  });

  it('preserves pre-filter behavior when no filter is supplied', async () => {
    const { service, findMany } = buildList('failedWebhook');
    await service.list('failed-webhooks', {} as ListQueryDto);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});
