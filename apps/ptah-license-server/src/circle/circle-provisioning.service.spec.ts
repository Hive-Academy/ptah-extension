/**
 * Unit tests for `CircleProvisioningService`.
 *
 * Focus: the three guarantees the Paddle webhook path relies on —
 *   1. Happy path: successful invite persists `circleMemberId` + writes audit.
 *   2. Non-fatal failure: an upstream/API failure NEVER throws and does NOT
 *      corrupt the user row.
 *   3. Feature-off: when Circle is disabled (token unset) nothing is called.
 *
 * All collaborators are hand-rolled mocks so the service is exercised in
 * isolation without the Nest DI container.
 */

import { CircleProvisioningService } from './circle-provisioning.service';
import type { CircleProvider } from './circle.provider';
import type { AuditLogService } from '../audit/audit-log.service';
import type { PrismaService } from '../prisma/prisma.service';

interface CircleProviderMock {
  isEnabled: jest.Mock<boolean, []>;
  inviteMember: jest.Mock;
  removeMember: jest.Mock;
}

interface PrismaMock {
  user: {
    update: jest.Mock;
    findUnique: jest.Mock;
  };
}

interface AuditMock {
  write: jest.Mock;
}

function createCircleMock(enabled = true): CircleProviderMock {
  return {
    isEnabled: jest.fn().mockReturnValue(enabled),
    inviteMember: jest.fn(),
    removeMember: jest.fn(),
  };
}

function createPrismaMock(): PrismaMock {
  return {
    user: {
      update: jest.fn().mockResolvedValue(undefined),
      findUnique: jest.fn(),
    },
  };
}

function createAuditMock(): AuditMock {
  return { write: jest.fn().mockResolvedValue('audit-id') };
}

function build(
  circle: CircleProviderMock,
  prisma: PrismaMock,
  audit: AuditMock,
): CircleProvisioningService {
  return new CircleProvisioningService(
    circle as unknown as CircleProvider,
    prisma as unknown as PrismaService,
    audit as unknown as AuditLogService,
  );
}

describe('CircleProvisioningService', () => {
  describe('provisionBuildersMember', () => {
    it('persists circleMemberId and writes an audit row on a successful invite', async () => {
      const circle = createCircleMock(true);
      circle.inviteMember.mockResolvedValue({
        ok: true,
        status: 200,
        memberId: '4242',
      });
      const prisma = createPrismaMock();
      const audit = createAuditMock();

      await build(circle, prisma, audit).provisionBuildersMember(
        'usr_1',
        'buyer@example.com',
      );

      expect(circle.inviteMember).toHaveBeenCalledWith('buyer@example.com');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
        data: { circleMemberId: '4242' },
      });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'circle.member.invite',
          targetType: 'User',
          targetId: 'usr_1',
          metadata: expect.objectContaining({ ok: true, memberId: '4242' }),
        }),
      );
    });

    it('does not persist a member id when the invite succeeds without one', async () => {
      const circle = createCircleMock(true);
      circle.inviteMember.mockResolvedValue({ ok: true, status: 200 });
      const prisma = createPrismaMock();
      const audit = createAuditMock();

      await build(circle, prisma, audit).provisionBuildersMember(
        'usr_2',
        'x@e.com',
      );

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'circle.member.invite' }),
      );
    });

    it('is non-fatal when the invite fails: no user update, audit records failure, no throw', async () => {
      const circle = createCircleMock(true);
      circle.inviteMember.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Circle API returned status 500',
      });
      const prisma = createPrismaMock();
      const audit = createAuditMock();

      await expect(
        build(circle, prisma, audit).provisionBuildersMember(
          'usr_3',
          'y@e.com',
        ),
      ).resolves.toBeUndefined();

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'circle.member.invite',
          metadata: expect.objectContaining({ ok: false, status: 500 }),
        }),
      );
    });

    it('swallows a thrown error from the provider (never rethrows into the webhook path)', async () => {
      const circle = createCircleMock(true);
      circle.inviteMember.mockRejectedValue(new Error('boom'));
      const prisma = createPrismaMock();
      const audit = createAuditMock();

      await expect(
        build(circle, prisma, audit).provisionBuildersMember(
          'usr_4',
          'z@e.com',
        ),
      ).resolves.toBeUndefined();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('skips cleanly (no invite, no update, no audit) when Circle is disabled', async () => {
      const circle = createCircleMock(false);
      const prisma = createPrismaMock();
      const audit = createAuditMock();

      await build(circle, prisma, audit).provisionBuildersMember(
        'usr_5',
        'off@e.com',
      );

      expect(circle.inviteMember).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });
  });

  describe('deprovisionBuildersMember', () => {
    it('removes by stored circleMemberId, clears the field, and audits', async () => {
      const circle = createCircleMock(true);
      circle.removeMember.mockResolvedValue({ ok: true, status: 200 });
      const prisma = createPrismaMock();
      prisma.user.findUnique.mockResolvedValue({
        circleMemberId: '4242',
        email: 'buyer@example.com',
      });
      const audit = createAuditMock();

      await build(circle, prisma, audit).deprovisionBuildersMember('usr_1');

      expect(circle.removeMember).toHaveBeenCalledWith('4242');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
        data: { circleMemberId: null },
      });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'circle.member.remove',
          metadata: expect.objectContaining({ ok: true }),
        }),
      );
    });

    it('falls back to email when no circleMemberId is stored', async () => {
      const circle = createCircleMock(true);
      circle.removeMember.mockResolvedValue({ ok: true, status: 204 });
      const prisma = createPrismaMock();
      prisma.user.findUnique.mockResolvedValue({
        circleMemberId: null,
        email: 'buyer@example.com',
      });
      const audit = createAuditMock();

      await build(circle, prisma, audit).deprovisionBuildersMember('usr_1');

      expect(circle.removeMember).toHaveBeenCalledWith('buyer@example.com');
      // No stored id -> nothing to clear.
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('no-ops when the user has neither a member id nor an email', async () => {
      const circle = createCircleMock(true);
      const prisma = createPrismaMock();
      prisma.user.findUnique.mockResolvedValue(null);
      const audit = createAuditMock();

      await build(circle, prisma, audit).deprovisionBuildersMember('ghost');

      expect(circle.removeMember).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('is non-fatal when removal fails and does not clear the stored id', async () => {
      const circle = createCircleMock(true);
      circle.removeMember.mockResolvedValue({
        ok: false,
        status: 502,
        error: 'Circle API returned status 502',
      });
      const prisma = createPrismaMock();
      prisma.user.findUnique.mockResolvedValue({
        circleMemberId: '4242',
        email: 'buyer@example.com',
      });
      const audit = createAuditMock();

      await expect(
        build(circle, prisma, audit).deprovisionBuildersMember('usr_1'),
      ).resolves.toBeUndefined();

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'circle.member.remove',
          metadata: expect.objectContaining({ ok: false, status: 502 }),
        }),
      );
    });

    it('skips cleanly when Circle is disabled', async () => {
      const circle = createCircleMock(false);
      const prisma = createPrismaMock();
      const audit = createAuditMock();

      await build(circle, prisma, audit).deprovisionBuildersMember('usr_1');

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(circle.removeMember).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });
  });
});
