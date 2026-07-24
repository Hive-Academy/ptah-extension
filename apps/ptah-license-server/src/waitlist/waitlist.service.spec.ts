import { EmailService } from '../email/services/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistService } from './waitlist.service';

describe('WaitlistService', () => {
  let service: WaitlistService;
  let mockPrisma: {
    waitlist: {
      findUnique: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let mockEmail: {
    sendWaitlistConfirmation: jest.Mock;
    sendFoundingInvite: jest.Mock;
  };

  beforeEach(() => {
    mockPrisma = {
      waitlist: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'wl-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 'wl-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mockEmail = {
      sendWaitlistConfirmation: jest.fn().mockResolvedValue(undefined),
      sendFoundingInvite: jest.fn().mockResolvedValue(undefined),
    };

    service = new WaitlistService(
      mockPrisma as unknown as PrismaService,
      mockEmail as unknown as EmailService,
    );
  });

  it('records a new signup, lowercases the email, and returns "joined"', async () => {
    const result = await service.join({
      email: '  New.User@Example.COM ',
      source: 'landing',
    });

    expect(result).toEqual({ status: 'joined' });
    expect(mockPrisma.waitlist.findUnique).toHaveBeenCalledWith({
      where: { email: 'new.user@example.com' },
      select: { id: true },
    });
    expect(mockPrisma.waitlist.create).toHaveBeenCalledWith({
      data: { email: 'new.user@example.com', source: 'landing' },
    });
    expect(mockEmail.sendWaitlistConfirmation).toHaveBeenCalledWith({
      email: 'new.user@example.com',
    });
  });

  it('normalizes an empty/whitespace source to null', async () => {
    await service.join({ email: 'a@b.com', source: '   ' });

    expect(mockPrisma.waitlist.create).toHaveBeenCalledWith({
      data: { email: 'a@b.com', source: null },
    });
  });

  it('dedupes an existing email without creating or emailing', async () => {
    mockPrisma.waitlist.findUnique.mockResolvedValue({ id: 'existing' });

    const result = await service.join({ email: 'Dup@Example.com' });

    expect(result).toEqual({ status: 'already_joined' });
    expect(mockPrisma.waitlist.create).not.toHaveBeenCalled();
    expect(mockEmail.sendWaitlistConfirmation).not.toHaveBeenCalled();
  });

  it('treats a concurrent unique-constraint race (P2002) as already_joined', async () => {
    mockPrisma.waitlist.create.mockRejectedValue({ code: 'P2002' });

    const result = await service.join({ email: 'race@example.com' });

    expect(result).toEqual({ status: 'already_joined' });
    expect(mockEmail.sendWaitlistConfirmation).not.toHaveBeenCalled();
  });

  it('rethrows non-unique persistence errors', async () => {
    mockPrisma.waitlist.create.mockRejectedValue(new Error('db down'));

    await expect(service.join({ email: 'x@y.com' })).rejects.toThrow('db down');
  });

  it('still returns "joined" when the confirmation email fails', async () => {
    mockEmail.sendWaitlistConfirmation.mockRejectedValue(
      new Error('Resend error'),
    );

    const result = await service.join({ email: 'ok@example.com' });

    expect(result).toEqual({ status: 'joined' });
    expect(mockPrisma.waitlist.create).toHaveBeenCalled();
  });

  describe('markConverted', () => {
    it('stamps convertedAt on the matching un-converted row (lowercased)', async () => {
      mockPrisma.waitlist.updateMany.mockResolvedValue({ count: 1 });

      await service.markConverted('  Buyer@Example.COM ');

      expect(mockPrisma.waitlist.updateMany).toHaveBeenCalledWith({
        where: { email: 'buyer@example.com', convertedAt: null },
        data: { convertedAt: expect.any(Date) },
      });
    });

    it('is a no-op (does not throw) when no matching row exists', async () => {
      mockPrisma.waitlist.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.markConverted('nobody@example.com'),
      ).resolves.toBeUndefined();
    });
  });

  describe('inviteBatch', () => {
    it('invites the N oldest un-notified rows when only batchSize is given', async () => {
      mockPrisma.waitlist.findMany.mockResolvedValue([
        { id: 'a', email: 'a@x.com', notifiedAt: null },
        { id: 'b', email: 'b@x.com', notifiedAt: null },
      ]);

      const result = await service.inviteBatch({ batchSize: 2 });

      expect(mockPrisma.waitlist.findMany).toHaveBeenCalledWith({
        where: { notifiedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 2,
        select: { id: true, email: true, notifiedAt: true },
      });
      expect(mockEmail.sendFoundingInvite).toHaveBeenCalledTimes(2);
      expect(mockPrisma.waitlist.update).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        invited: 2,
        skipped: 0,
        invitedIds: ['a', 'b'],
      });
    });

    it('lets ids override batchSize and skips already-notified rows', async () => {
      mockPrisma.waitlist.findMany.mockResolvedValue([
        { id: 'a', email: 'a@x.com', notifiedAt: null },
        { id: 'b', email: 'b@x.com', notifiedAt: new Date('2026-01-01') },
      ]);

      const result = await service.inviteBatch({
        ids: ['a', 'b'],
        batchSize: 99,
      });

      expect(mockPrisma.waitlist.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['a', 'b'] } },
        select: { id: true, email: true, notifiedAt: true },
      });
      // Only the un-notified row is emailed + stamped; the notified one is skipped.
      expect(mockEmail.sendFoundingInvite).toHaveBeenCalledTimes(1);
      expect(mockEmail.sendFoundingInvite).toHaveBeenCalledWith({
        email: 'a@x.com',
      });
      expect(mockPrisma.waitlist.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ invited: 1, skipped: 1, invitedIds: ['a'] });
    });

    it('does NOT stamp notifiedAt when the invite email fails (retry-safe)', async () => {
      mockPrisma.waitlist.findMany.mockResolvedValue([
        { id: 'a', email: 'a@x.com', notifiedAt: null },
        { id: 'b', email: 'b@x.com', notifiedAt: null },
      ]);
      mockEmail.sendFoundingInvite
        .mockRejectedValueOnce(new Error('Resend down'))
        .mockResolvedValueOnce(undefined);

      const result = await service.inviteBatch({ batchSize: 2 });

      // 'a' failed → not stamped, not invited; 'b' succeeded → stamped, invited.
      expect(mockPrisma.waitlist.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.waitlist.update).toHaveBeenCalledWith({
        where: { id: 'b' },
        data: { notifiedAt: expect.any(Date) },
      });
      expect(result).toEqual({ invited: 1, skipped: 0, invitedIds: ['b'] });
    });
  });
});
