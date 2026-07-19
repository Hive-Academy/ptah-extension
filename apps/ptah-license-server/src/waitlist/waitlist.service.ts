import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/services/email.service';

export type WaitlistJoinStatus = 'joined' | 'already_joined';

export interface WaitlistJoinResult {
  status: WaitlistJoinStatus;
}

/**
 * WaitlistService - Builders premium-tier lead capture.
 *
 * Dedupes by lowercased email. On first join, persists the row and fires a
 * confirmation email (best-effort — email failure never fails the signup).
 */
@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailService) private readonly emailService: EmailService,
  ) {}

  /**
   * Join the Builders waitlist.
   *
   * @returns `{ status: 'joined' }` on first join, `{ status: 'already_joined' }`
   *          when the (lowercased) email is already present.
   */
  async join(params: {
    email: string;
    source?: string;
  }): Promise<WaitlistJoinResult> {
    const email = this.normalizeEmail(params.email);
    const source = params.source?.trim() || null;

    const existing = await this.prisma.waitlist.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      this.logger.log(`Waitlist signup ignored — already joined (${email})`);
      return { status: 'already_joined' };
    }

    try {
      await this.prisma.waitlist.create({
        data: { email, source },
      });
    } catch (error: unknown) {
      // Handle the concurrent-signup race: two requests for the same email can
      // both pass the findUnique check, and the second create hits the unique
      // constraint (Prisma error code P2002). Treat that as an idempotent join.
      if (this.isUniqueConstraintError(error)) {
        this.logger.log(`Waitlist signup raced — already joined (${email})`);
        return { status: 'already_joined' };
      }
      throw error;
    }

    this.logger.log(
      `Waitlist signup recorded (${email}, source: ${source ?? 'unknown'})`,
    );

    // Confirmation email is best-effort: a delivery failure must not turn a
    // successful signup into an error for the caller.
    try {
      await this.emailService.sendWaitlistConfirmation({ email });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Waitlist confirmation email failed for ${email}: ${message}`,
      );
    }

    return { status: 'joined' };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}
