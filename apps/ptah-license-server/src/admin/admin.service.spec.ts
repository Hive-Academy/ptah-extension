import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated-prisma-client/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/services/email.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AdminService, DeleteUserActor } from './admin.service';
import { DeleteUserDto } from './dto/delete-user.dto';

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
  trialReminder: { count: jest.Mock };
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
    trialReminder: { count: jest.fn().mockResolvedValue(0) },
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
      trialReminders: 0,
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
        trialReminders: 0,
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
        trialReminders: 0,
        sessionRequests: 0,
      });
      expect(prisma.user.delete).toHaveBeenCalledTimes(1);

      const writeArg = auditLog.write.mock.calls[0][0];
      expect(writeArg.metadata).toMatchObject({
        cascadedCounts: {
          subscriptions: 0,
          licenses: 0,
          trialReminders: 0,
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
      prisma.trialReminder.count.mockResolvedValueOnce(1);
      prisma.sessionRequest.count.mockResolvedValueOnce(1);

      const result = await service.deleteUserCascade('user-1', baseDto, actor);

      expect(result.cascaded).toEqual({
        subscriptions: 1,
        licenses: 1,
        trialReminders: 1,
        sessionRequests: 1,
      });

      const writeArg = auditLog.write.mock.calls[0][0];
      expect(writeArg.metadata).toMatchObject({
        cascadedCounts: {
          subscriptions: 1,
          licenses: 1,
          trialReminders: 1,
          sessionRequests: 1,
        },
      });
    });

    it('user with 100 of each: counts forwarded + happy path executes well under perf budget (< 500ms)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(makeUser());
      prisma.subscription.count.mockResolvedValueOnce(100);
      prisma.license.count.mockResolvedValueOnce(100);
      prisma.trialReminder.count.mockResolvedValueOnce(100);
      prisma.sessionRequest.count.mockResolvedValueOnce(100);

      const start = Date.now();
      const result = await service.deleteUserCascade('user-1', baseDto, actor);
      const elapsedMs = Date.now() - start;

      expect(result.cascaded).toEqual({
        subscriptions: 100,
        licenses: 100,
        trialReminders: 100,
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
