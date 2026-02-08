import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/services/email.service';

/**
 * Reminder type enum for type safety
 */
type ReminderType = '7_day' | '3_day' | '1_day' | 'expired';

/**
 * TrialReminderService - Daily cron job for trial expiration email reminders
 *
 * TASK_2025_142: Requirement 4
 *
 * Runs daily at 9:00 AM UTC to:
 * 1. Find trials expiring at 7, 3, 1, and 0 days
 * 2. Filter out users who already received that reminder type
 * 3. Filter out users who have already upgraded (non-trialing status)
 * 4. Send appropriate reminder email
 * 5. Record sent reminder to prevent duplicates
 *
 * Rate limiting: Batches of 50 emails, 100 emails/minute max
 */
@Injectable()
export class TrialReminderService {
  private readonly logger = new Logger(TrialReminderService.name);

  /**
   * Batch size for email sends (memory efficiency)
   */
  private readonly BATCH_SIZE = 50;

  /**
   * Delay between batches (rate limiting: 100/minute = ~600ms between 50-email batches)
   * Using 30 seconds for safety margin
   */
  private readonly BATCH_DELAY_MS = 30000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService
  ) {}

  /**
   * Daily cron job - runs at 9:00 AM UTC
   *
   * CronExpression format: second minute hour day-of-month month day-of-week
   * '0 9 * * *' = At 09:00 every day
   */
  @Cron('0 9 * * *', {
    name: 'trial-reminder-job',
    timeZone: 'UTC',
  })
  async handleTrialReminders(): Promise<void> {
    this.logger.log('Starting daily trial reminder job');

    const startTime = Date.now();
    let totalSent = 0;

    try {
      // STEP 1: Downgrade expired trials to Community plan
      // This must run BEFORE sending reminders to ensure clean state
      const downgraded = await this.downgradeExpiredTrials();
      this.logger.log(`Downgraded ${downgraded} expired trials to Community`);

      // STEP 2: Process reminder emails for upcoming expirations
      // Order matters: closest to expiry first (1_day, 3_day, 7_day)
      // Note: We no longer send 'expired' reminder - users are auto-downgraded instead
      const reminderConfigs: { type: ReminderType; daysFromExpiry: number }[] =
        [
          { type: '1_day', daysFromExpiry: 1 },
          { type: '3_day', daysFromExpiry: 3 },
          { type: '7_day', daysFromExpiry: 7 },
        ];

      for (const config of reminderConfigs) {
        const sent = await this.processReminderType(
          config.type,
          config.daysFromExpiry
        );
        totalSent += sent;
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Trial reminder job completed: ${downgraded} downgraded, ${totalSent} reminders sent in ${duration}ms`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Trial reminder job failed: ${errorMessage}`);
    }
  }

  /**
   * Downgrade expired trials to Community plan
   *
   * TASK_2025_143: Auto-downgrade instead of leaving in "trial_ended" state
   *
   * Finds all subscriptions where:
   * - status = 'trialing'
   * - trial_end < NOW() (trial has expired)
   *
   * Then updates:
   * - subscription.status = 'expired'
   * - license.plan = 'community'
   *
   * And sends a "Welcome to Community" email
   *
   * @returns Number of users downgraded
   */
  private async downgradeExpiredTrials(): Promise<number> {
    this.logger.debug('Processing expired trial downgrades');

    const now = new Date();

    // Find all expired trials that haven't been downgraded yet
    const expiredTrials = await this.prisma.subscription.findMany({
      where: {
        status: 'trialing',
        trialEnd: {
          lt: now, // Trial end is in the past
        },
      },
      include: {
        user: {
          include: {
            licenses: true,
          },
        },
      },
      take: 1000, // Safety limit
    });

    if (expiredTrials.length === 1000) {
      this.logger.warn(
        'Hit 1000 subscription limit for downgrades - some users may not be processed. Consider implementing pagination.'
      );
    }

    this.logger.debug(
      `Found ${expiredTrials.length} expired trials to downgrade`
    );

    if (expiredTrials.length === 0) {
      return 0;
    }

    let downgradedCount = 0;

    for (const subscription of expiredTrials) {
      try {
        // Use a transaction to ensure atomicity
        await this.prisma.$transaction(async (tx) => {
          // 1. Update subscription status to 'expired'
          await tx.subscription.update({
            where: { id: subscription.id },
            data: { status: 'expired' },
          });

          // 2. Update user's license to 'community' plan
          // Find the active license for this user
          const activeLicense = subscription.user.licenses.find(
            (l) => l.status === 'active'
          );

          if (activeLicense) {
            await tx.license.update({
              where: { id: activeLicense.id },
              data: { plan: 'community' },
            });
          }

          // 3. Record the 'expired' reminder to track that we processed this user
          // This also prevents re-processing on next cron run
          await tx.trialReminder.create({
            data: {
              userId: subscription.userId,
              reminderType: 'expired',
              emailSentTo: subscription.user.email,
            },
          });
        });

        // 4. Send "Welcome to Community" email (outside transaction)
        await this.emailService.sendTrialDowngradedToCommunity({
          email: subscription.user.email,
          firstName: subscription.user.firstName,
        });

        downgradedCount++;
        this.logger.debug(
          `Downgraded ${subscription.user.email} to Community plan`
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Failed to downgrade ${subscription.user.email}: ${errorMessage}`
        );
      }
    }

    return downgradedCount;
  }

  /**
   * Process a specific reminder type (7_day, 3_day, 1_day, expired)
   *
   * @param type - Reminder type to process
   * @param daysFromExpiry - Days from trial expiry (0 = expiring today)
   * @returns Number of emails sent
   */
  private async processReminderType(
    type: ReminderType,
    daysFromExpiry: number
  ): Promise<number> {
    this.logger.debug(
      `Processing ${type} reminders (${daysFromExpiry} days from expiry)`
    );

    // Calculate target date range (start of day to end of day for the target date)
    const now = new Date();
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + daysFromExpiry);

    const startOfDay = new Date(targetDate);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    // Find subscriptions with trialing status where trialEnd is within target date
    // Exclude users who already received this reminder type
    const eligibleSubscriptions = await this.prisma.subscription.findMany({
      where: {
        status: 'trialing',
        trialEnd: {
          gte: startOfDay,
          lte: endOfDay,
        },
        user: {
          // Exclude users who already received this reminder
          trialReminders: {
            none: {
              reminderType: type,
            },
          },
        },
      },
      include: {
        user: true,
      },
      take: 1000, // Safety limit to prevent memory issues
    });

    // Warn if limit is reached - some users may be missed
    if (eligibleSubscriptions.length === 1000) {
      this.logger.warn(
        `[${type}] Hit 1000 subscription limit - some users may not receive reminders. Consider implementing pagination.`
      );
    }

    this.logger.debug(
      `Found ${eligibleSubscriptions.length} eligible users for ${type} reminder`
    );

    if (eligibleSubscriptions.length === 0) {
      return 0;
    }

    // Process in batches for rate limiting
    let sentCount = 0;
    for (let i = 0; i < eligibleSubscriptions.length; i += this.BATCH_SIZE) {
      const batch = eligibleSubscriptions.slice(i, i + this.BATCH_SIZE);

      for (const subscription of batch) {
        try {
          // Skip if trialEnd is null (shouldn't happen for trialing status, but defensive check)
          if (!subscription.trialEnd) {
            this.logger.warn(
              `Skipping subscription ${subscription.id}: trialEnd is null despite trialing status`
            );
            continue;
          }

          // Send the appropriate email based on reminder type
          await this.sendReminderEmail(
            type,
            subscription.user.email,
            subscription.user.firstName,
            subscription.trialEnd
          );

          // Record sent reminder to prevent duplicates (idempotency)
          await this.prisma.trialReminder.create({
            data: {
              userId: subscription.userId,
              reminderType: type,
              emailSentTo: subscription.user.email,
            },
          });

          sentCount++;
        } catch (error) {
          // Log error but continue processing other users
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `Failed to send ${type} reminder to ${subscription.user.email}: ${errorMessage}`
          );
        }
      }

      // Delay between batches for rate limiting (avoid Resend throttling)
      if (i + this.BATCH_SIZE < eligibleSubscriptions.length) {
        await this.sleep(this.BATCH_DELAY_MS);
      }
    }

    this.logger.debug(`Sent ${sentCount} ${type} reminders`);
    return sentCount;
  }

  /**
   * Send the appropriate reminder email based on type
   *
   * @param type - Reminder type (7_day, 3_day, 1_day, expired)
   * @param email - User's email address
   * @param firstName - User's first name (may be null)
   * @param trialEnd - Trial end date
   */
  private async sendReminderEmail(
    type: ReminderType,
    email: string,
    firstName: string | null,
    trialEnd: Date
  ): Promise<void> {
    switch (type) {
      case '7_day':
        await this.emailService.sendTrialReminder7Day({
          email,
          firstName,
          trialEnd,
        });
        break;
      case '3_day':
        await this.emailService.sendTrialReminder3Day({
          email,
          firstName,
          trialEnd,
        });
        break;
      case '1_day':
        await this.emailService.sendTrialReminder1Day({
          email,
          firstName,
          trialEnd,
        });
        break;
      case 'expired':
        await this.emailService.sendTrialExpired({ email, firstName });
        break;
      default: {
        // Exhaustive check - TypeScript will error if a new ReminderType is added without handling
        const _exhaustiveCheck: never = type;
        throw new Error(`Unhandled reminder type: ${_exhaustiveCheck}`);
      }
    }
  }

  /**
   * Sleep utility for batch delay (rate limiting)
   *
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Manual trigger for testing (not exposed via controller)
   * Can be called via CLI or test framework
   *
   * @example
   * // In test:
   * await trialReminderService.triggerManually();
   */
  async triggerManually(): Promise<void> {
    this.logger.log('Manually triggering trial reminder job');
    await this.handleTrialReminders();
  }
}
