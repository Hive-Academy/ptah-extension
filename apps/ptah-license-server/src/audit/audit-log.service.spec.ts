import { Prisma } from '../generated-prisma-client/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';

/**
 * Unit tests for AuditLogService (TASK_2025_292 T-B1-04).
 *
 * Strategy: mock `PrismaService.adminAuditLog.create` via a typed factory so
 * we don't need an `as any` cast. The mock is passed to the NestJS
 * TestingModule via `useValue` — the service only touches
 * `adminAuditLog.create`, so a minimal shape suffices at runtime and is
 * cast once to the full Prisma transaction client shape for type-checking.
 */

type MockCreate = jest.Mock<Promise<{ id: string }>, [unknown]>;

interface MockPrisma {
  adminAuditLog: { create: MockCreate };
}

function createMockPrisma(): MockPrisma {
  return {
    adminAuditLog: {
      create: jest.fn(),
    },
  };
}

// Cast helper: the spec only exercises `adminAuditLog.create`; casting the
// mock once at the DI boundary keeps the individual tests free of casts.
function asTx(mock: MockPrisma): Prisma.TransactionClient {
  return mock as unknown as Prisma.TransactionClient;
}

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.adminAuditLog.create.mockResolvedValue({ id: 'audit-row-id-1' });

    // Instantiate directly — AuditLogService only depends on PrismaService,
    // no decorator metadata resolution needed for this unit test.
    service = new AuditLogService(prisma as unknown as PrismaService);
  });

  it('writes a row with all fields set and returns the created row id', async () => {
    const id = await service.write({
      actorEmail: 'admin@example.com',
      action: 'user.delete',
      targetType: 'User',
      targetId: 'user-uuid-1',
      targetSnapshot: { email: 'deleted@example.com' },
      metadata: { reason: 'GDPR request' },
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla/5.0',
    });

    expect(id).toBe('audit-row-id-1');
    expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorEmail: 'admin@example.com',
        action: 'user.delete',
        targetType: 'User',
        targetId: 'user-uuid-1',
        targetSnapshot: { email: 'deleted@example.com' },
        metadata: { reason: 'GDPR request' },
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
      },
      select: { id: true },
    });
  });

  it('uses tx.adminAuditLog.create when tx is supplied, never the PrismaService', async () => {
    const txMock = createMockPrisma();
    txMock.adminAuditLog.create.mockResolvedValue({ id: 'tx-audit-id' });

    const id = await service.write({
      actorEmail: 'admin@example.com',
      action: 'license.complimentary.issue',
      targetType: 'License',
      targetId: 'license-uuid-1',
      tx: asTx(txMock),
    });

    expect(id).toBe('tx-audit-id');
    expect(txMock.adminAuditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('omits null/undefined fields from the Prisma create payload', async () => {
    await service.write({
      actorEmail: 'admin@example.com',
      action: 'marketing.campaign.send',
      targetType: 'MarketingCampaign',
      // targetId omitted
      // targetSnapshot omitted
      // metadata omitted
      // ipAddress omitted
      // userAgent omitted
    });

    expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
    const call = prisma.adminAuditLog.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };

    expect(call.data).toEqual({
      actorEmail: 'admin@example.com',
      action: 'marketing.campaign.send',
      targetType: 'MarketingCampaign',
    });
    // Explicitly assert the optional keys were not passed at all
    expect(call.data).not.toHaveProperty('targetId');
    expect(call.data).not.toHaveProperty('targetSnapshot');
    expect(call.data).not.toHaveProperty('metadata');
    expect(call.data).not.toHaveProperty('ipAddress');
    expect(call.data).not.toHaveProperty('userAgent');
  });

  it('accepts null actorEmail (system-originated actions) without stripping it', async () => {
    await service.write({
      actorEmail: null,
      action: 'user.bounced',
      targetType: 'User',
      targetId: 'user-uuid-2',
    });

    const call = prisma.adminAuditLog.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(call.data['actorEmail']).toBeNull();
    expect(call.data['action']).toBe('user.bounced');
  });

  it('returns the id from the created row', async () => {
    prisma.adminAuditLog.create.mockResolvedValueOnce({ id: 'custom-id-42' });

    const id = await service.write({
      actorEmail: 'admin@example.com',
      action: 'user.unsubscribe',
      targetType: 'User',
      targetId: 'user-uuid-3',
    });

    expect(id).toBe('custom-id-42');
  });
});
