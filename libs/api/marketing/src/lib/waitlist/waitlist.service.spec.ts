import { EmailService } from '@ptah-api/email';
import { Prisma, PrismaService } from '@ptah-api/core';
import { WaitlistService } from './waitlist.service';

/**
 * The `tx` handle `claimForApproval` runs on. Deliberately separate from
 * `mockPrisma`: the claim MUST go through the caller's transaction, never the
 * base client, so keeping the two mocks distinct makes a regression that reaches
 * for `this.prisma` fail loudly instead of passing on a shared spy.
 */
interface MockTx {
  waitlist: {
    findUnique: jest.Mock;
    updateMany: jest.Mock;
  };
}

function createMockTx(): MockTx {
  return {
    waitlist: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

function asTx(tx: MockTx): Prisma.TransactionClient {
  return tx as unknown as Prisma.TransactionClient;
}

describe('WaitlistService', () => {
  let service: WaitlistService;
  let mockPrisma: {
    waitlist: {
      findUnique: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let mockEmail: {
    sendWaitlistConfirmation: jest.Mock;
  };

  beforeEach(() => {
    mockPrisma = {
      waitlist: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'wl-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mockEmail = {
      sendWaitlistConfirmation: jest.fn().mockResolvedValue(undefined),
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

  describe('markApproved', () => {
    it('stamps approvedAt on the matching un-approved row (lowercased)', async () => {
      mockPrisma.waitlist.updateMany.mockResolvedValue({ count: 1 });

      await service.markApproved('  Gifted@Example.COM ');

      expect(mockPrisma.waitlist.updateMany).toHaveBeenCalledWith({
        where: { email: 'gifted@example.com', approvedAt: null },
        data: { approvedAt: expect.any(Date) },
      });
    });

    it('never moves an existing stamp — the approvedAt: null guard is the whole point (R4.6)', async () => {
      // An already-stamped row matches nothing, so the update reports count 0
      // and the caller sees a clean no-op rather than a moved timestamp.
      mockPrisma.waitlist.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.markApproved('already@example.com'),
      ).resolves.toBeUndefined();

      expect(mockPrisma.waitlist.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.waitlist.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ approvedAt: null }),
        }),
      );
    });

    it('is a no-op (does not throw) for an unknown email', async () => {
      mockPrisma.waitlist.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.markApproved('nobody@example.com'),
      ).resolves.toBeUndefined();
    });

    it('does NOT touch convertedAt — a gift is not a conversion (R4.3)', async () => {
      await service.markApproved('gift@example.com');

      const [call] = mockPrisma.waitlist.updateMany.mock.calls;
      expect(call[0].data).not.toHaveProperty('convertedAt');
      expect(call[0].where).not.toHaveProperty('convertedAt');
    });
  });

  describe('claimForApproval', () => {
    it('claims an un-approved row through the CALLER transaction and returns the row', async () => {
      const tx = createMockTx();
      tx.waitlist.findUnique.mockResolvedValue({
        id: 'wl-1',
        email: 'lead@example.com',
        notifiedAt: null,
        approvedAt: null,
      });
      tx.waitlist.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.claimForApproval(asTx(tx), 'wl-1');

      expect(result).toEqual({
        outcome: 'claimed',
        row: {
          id: 'wl-1',
          email: 'lead@example.com',
          notifiedAt: null,
          approvedAt: null,
        },
      });
      expect(tx.waitlist.findUnique).toHaveBeenCalledWith({
        where: { id: 'wl-1' },
        select: { id: true, email: true, notifiedAt: true, approvedAt: true },
      });
      // The exact conditional claim of R5 — id AND approvedAt IS NULL.
      expect(tx.waitlist.updateMany).toHaveBeenCalledWith({
        where: { id: 'wl-1', approvedAt: null },
        data: { approvedAt: expect.any(Date) },
      });
      // R5.5: the claim is a transaction write. Nothing may reach the base
      // client, or a rollback could not release it.
      expect(mockPrisma.waitlist.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.waitlist.updateMany).not.toHaveBeenCalled();
    });

    it('reports already_approved when the conditional claim matches nothing', async () => {
      const tx = createMockTx();
      tx.waitlist.findUnique.mockResolvedValue({
        id: 'wl-2',
        email: 'done@example.com',
        notifiedAt: null,
        approvedAt: new Date('2026-08-01'),
      });
      tx.waitlist.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.claimForApproval(asTx(tx), 'wl-2');

      expect(result.outcome).toBe('already_approved');
      expect(result).toHaveProperty('row.email', 'done@example.com');
    });

    it('reports not_found without attempting a write', async () => {
      const tx = createMockTx();
      tx.waitlist.findUnique.mockResolvedValue(null);

      const result = await service.claimForApproval(asTx(tx), 'ghost');

      expect(result).toEqual({ outcome: 'not_found' });
      expect(tx.waitlist.updateMany).not.toHaveBeenCalled();
    });

    it('lets exactly ONE of two claimers win the same row (R5.2)', async () => {
      // One shared row, one shared claim counter — the shape a real
      // Read-Committed row lock produces: the loser re-evaluates
      // `approved_at IS NULL` after the winner commits and gets count 0.
      const tx = createMockTx();
      const row = {
        id: 'wl-3',
        email: 'race@example.com',
        notifiedAt: null,
        approvedAt: null,
      };
      tx.waitlist.findUnique.mockResolvedValue(row);
      tx.waitlist.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValue({ count: 0 });

      const first = await service.claimForApproval(asTx(tx), 'wl-3');
      const second = await service.claimForApproval(asTx(tx), 'wl-3');

      expect(first.outcome).toBe('claimed');
      expect(second.outcome).toBe('already_approved');
    });

    it('surfaces the advisory read even on already_approved, so the caller can still name the row', async () => {
      // The findUnique is advisory: it exists ONLY to tell not_found from
      // already_approved. A racer that stamps between the read and the update
      // leaves `row.approvedAt` null here — which is exactly why `outcome`, not
      // `row.approvedAt`, is the truth.
      const tx = createMockTx();
      tx.waitlist.findUnique.mockResolvedValue({
        id: 'wl-4',
        email: 'raced@example.com',
        notifiedAt: new Date('2026-07-01'),
        approvedAt: null,
      });
      tx.waitlist.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.claimForApproval(asTx(tx), 'wl-4');

      expect(result.outcome).toBe('already_approved');
      expect(result).toHaveProperty('row.approvedAt', null);
      expect(result).toHaveProperty('row.notifiedAt', new Date('2026-07-01'));
    });
  });
});
