import { Module } from '@nestjs/common';
import { IdentityModule } from '@ptah-api/identity';
import { EmailModule } from '@ptah-api/email';
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
 * - IdentityModule (JwtAuthGuard + AuthService)
 */
@Module({
  imports: [IdentityModule, EmailModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
