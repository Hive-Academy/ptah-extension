import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './services/email.service';

/**
 * EmailModule - Email delivery services for license server
 *
 * Provides:
 * - EmailService for SendGrid integration
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
  providers: [EmailService],
  exports: [EmailService], // Export for use in LicenseModule (AdminController)
})
export class EmailModule {}
