import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './services/email.service';
import {
  ResendMailProvider,
  RESEND_MAIL_SERVICE,
} from './providers/resend.provider';

/**
 * EmailModule - Email delivery services for license server
 *
 * Provides:
 * - Resend mail client (properly initialized via DI)
 * - EmailService for email delivery with retry logic
 * - License key email delivery
 * - Magic link email delivery
 *
 * Dependencies:
 * - ConfigModule (for RESEND_API_KEY, FROM_EMAIL, etc.)
 *
 * Configuration Required:
 * - RESEND_API_KEY: Resend API key
 * - FROM_EMAIL: Sender email address
 * - FROM_NAME: Sender display name
 * - FRONTEND_URL: Customer portal URL
 */
@Module({
  imports: [ConfigModule],
  providers: [ResendMailProvider, EmailService],
  exports: [EmailService, RESEND_MAIL_SERVICE],
})
export class EmailModule {}
