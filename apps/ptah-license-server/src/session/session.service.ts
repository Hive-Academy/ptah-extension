import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/services/email.service';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailService) private readonly emailService: EmailService,
  ) {}

  /**
   * Check if user is eligible for a free session
   *
   * Community members get ONE free session. If they've already used it, they must pay.
   */
  async checkEligibility(userId: string): Promise<{
    hasFreeSession: boolean;
    usedFreeSession: boolean;
  }> {
    const freeSessionCount = await this.prisma.sessionRequest.count({
      where: { userId, isFreeSession: true },
    });

    return {
      hasFreeSession: freeSessionCount === 0,
      usedFreeSession: freeSessionCount > 0,
    };
  }

  /**
   * Create a session request
   *
   * Determines if the session is free or paid based on eligibility and payment info.
   */
  async createRequest(params: {
    userId: string;
    userEmail: string;
    sessionTopicId: string;
    additionalNotes?: string;
    paddleTransactionId?: string;
  }): Promise<{ success: boolean; isFreeSession: boolean }> {
    const {
      userId,
      userEmail,
      sessionTopicId,
      additionalNotes,
      paddleTransactionId,
    } = params;

    // Check free eligibility
    const { hasFreeSession } = await this.checkEligibility(userId);
    const isFreeSession = hasFreeSession && !paddleTransactionId;

    // Create the session request record
    await this.prisma.sessionRequest.create({
      data: {
        userId,
        sessionTopicId,
        additionalNotes,
        isFreeSession,
        status: 'pending',
        paymentStatus: isFreeSession
          ? 'none'
          : paddleTransactionId
            ? 'pending'
            : 'none',
        paddleTransactionId,
      },
    });

    this.logger.log(
      `Session request created for ${userEmail} (topic: ${sessionTopicId}, free: ${isFreeSession})`,
    );

    // Send notification email to team
    try {
      await this.emailService.sendSessionRequestNotification({
        userEmail,
        sessionTopicId,
        additionalNotes,
        isFreeSession,
      });
    } catch (error) {
      this.logger.error(
        'Failed to send session request notification:',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }

    // Send confirmation email to user
    try {
      await this.emailService.sendSessionConfirmation({
        userEmail,
        sessionTopicId,
        isFreeSession,
      });
    } catch (error) {
      this.logger.error(
        'Failed to send session confirmation:',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }

    return { success: true, isFreeSession };
  }
}
