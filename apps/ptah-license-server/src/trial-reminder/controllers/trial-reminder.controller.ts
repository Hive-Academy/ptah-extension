import {
  Controller,
  Inject,
  Post,
  Headers,
  UnauthorizedException,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { TrialReminderService } from '../services/trial-reminder.service';

/**
 * TrialReminderController - Admin endpoint for manual cron job trigger
 *
 * TASK_2025_143: Testing endpoint for trial reminder workflow
 *
 * Provides:
 * - POST /admin/trial-reminder/trigger - Manually trigger the cron job
 *
 * Security:
 * - Requires X-Admin-Secret header matching ADMIN_SECRET env var
 * - Not exposed in production unless ADMIN_SECRET is set
 *
 * Usage:
 *   curl -X POST http://localhost:3000/admin/trial-reminder/trigger \
 *     -H "X-Admin-Secret: your-secret-here"
 */
@Controller('admin/trial-reminder')
export class TrialReminderController {
  private readonly logger = new Logger(TrialReminderController.name);
  private readonly adminSecret: string | undefined;

  constructor(
    @Inject(TrialReminderService)
    private readonly trialReminderService: TrialReminderService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.adminSecret = this.configService.get<string>('ADMIN_SECRET');

    if (!this.adminSecret) {
      this.logger.warn(
        'ADMIN_SECRET not set - admin endpoints will be disabled',
      );
    }
  }

  /**
   * Constant-time secret comparison using SHA-256 hashing.
   * Prevents timing attacks by always comparing fixed-length hashes.
   */
  private isSecretValid(provided: string, expected: string): boolean {
    const providedHash = createHash('sha256').update(provided).digest();
    const expectedHash = createHash('sha256').update(expected).digest();
    return timingSafeEqual(providedHash, expectedHash);
  }

  /**
   * POST /admin/trial-reminder/trigger
   *
   * Manually triggers the trial reminder cron job.
   * Useful for testing the workflow without waiting for the daily schedule.
   *
   * @param adminSecret - X-Admin-Secret header
   * @returns Result of the cron job execution
   */
  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  async triggerCronJob(
    @Headers('x-admin-secret') adminSecret: string,
  ): Promise<{ success: boolean; message: string }> {
    // Validate admin secret
    if (!this.adminSecret) {
      throw new UnauthorizedException(
        'Admin endpoints are disabled (ADMIN_SECRET not configured)',
      );
    }

    if (!adminSecret || !this.isSecretValid(adminSecret, this.adminSecret)) {
      this.logger.warn('Invalid admin secret attempt');
      throw new UnauthorizedException('Invalid admin secret');
    }

    this.logger.log('Manual trigger requested via admin endpoint');

    try {
      // Call the actual cron job handler
      await this.trialReminderService.triggerManually();

      return {
        success: true,
        message: 'Trial reminder cron job executed successfully',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Manual trigger failed: ${errorMessage}`);

      return {
        success: false,
        message: `Cron job failed: ${errorMessage}`,
      };
    }
  }
}
