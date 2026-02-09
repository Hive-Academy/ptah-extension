import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { TrialReminderService } from './services/trial-reminder.service';
import { TrialReminderController } from './controllers/trial-reminder.controller';

/**
 * TrialReminderModule - Scheduled trial reminder email notifications
 *
 * TASK_2025_142: Requirement 4
 * TASK_2025_143: Added admin controller for manual testing
 *
 * Provides:
 * - ScheduleModule for cron job support
 * - TrialReminderService with daily cron job
 * - EmailService integration for sending reminders
 * - Admin endpoint for manual trigger (testing)
 *
 * Cron Schedule: Daily at 9:00 AM UTC
 *
 * Reminder Types:
 * - 7_day: 7 days before trial expires
 * - 3_day: 3 days before trial expires
 * - 1_day: 1 day before trial expires
 * - expired: Day trial expires (triggers auto-downgrade)
 *
 * Admin Endpoint:
 * - POST /admin/trial-reminder/trigger - Requires X-Admin-Secret header
 */
@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, EmailModule],
  controllers: [TrialReminderController],
  providers: [TrialReminderService],
  exports: [TrialReminderService],
})
export class TrialReminderModule {}
