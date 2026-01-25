import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './services/email.service';
import {
  SendGridMailProvider,
  SENDGRID_MAIL_SERVICE,
} from './providers/sendgrid.provider';

/**
 * EmailModule - Email delivery services for license server
 *
 * Provides:
 * - SendGrid mail client (properly initialized via DI)
 * - EmailService for email delivery with retry logic
 * - License key email delivery
 * - Magic link email delivery
 *
 * Dependencies:
 * - ConfigModule (for SENDGRID_API_KEY, SENDGRID_FROM_EMAIL, etc.)
 *
 * Configuration Required:
 * - SENDGRID_API_KEY: SendGrid API key
 * - SENDGRID_FROM_EMAIL: Sender email address
 * - SENDGRID_FROM_NAME: Sender display name
 * - FRONTEND_URL: Customer portal URL
 */
@Module({
  imports: [ConfigModule],
  providers: [SendGridMailProvider, EmailService],
  exports: [EmailService, SENDGRID_MAIL_SERVICE],
})
export class EmailModule {}
