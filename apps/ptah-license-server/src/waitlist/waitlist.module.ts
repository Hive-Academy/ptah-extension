import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';

/**
 * WaitlistModule - Builders premium-tier waitlist.
 *
 * Provides:
 * - POST /api/v1/waitlist endpoint (public, rate-limited to 5/min)
 * - Dedupe + persistence of leads (Waitlist table)
 * - Confirmation email on first join (best-effort)
 *
 * Dependencies:
 * - PrismaModule (Waitlist persistence)
 * - EmailModule (confirmation email via Resend)
 */
@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [WaitlistController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
