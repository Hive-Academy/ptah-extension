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
});
