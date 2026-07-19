import { EmailService } from '../email/services/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistService } from './waitlist.service';

describe('WaitlistService', () => {
  let service: WaitlistService;
  let mockPrisma: {
    waitlist: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };
  let mockEmail: { sendWaitlistConfirmation: jest.Mock };

  beforeEach(() => {
    mockPrisma = {
      waitlist: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'wl-1' }),
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
});
