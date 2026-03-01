import { Module } from '@nestjs/common';
import { AuthModule } from '../app/auth/auth.module';
import { EmailModule } from '../email/email.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

/**
 * ContactModule - Contact form message handling
 *
 * Provides:
 * - POST /api/v1/contact endpoint (authenticated, rate-limited)
 * - Sends contact messages to help@ptah.live via Resend
 *
 * Dependencies:
 * - EmailModule (email delivery)
 * - AuthModule (JwtAuthGuard + AuthService)
 */
@Module({
  imports: [AuthModule, EmailModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
