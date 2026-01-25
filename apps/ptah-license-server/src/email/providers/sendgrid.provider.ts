import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';

/**
 * SendGrid Mail Service Interface
 *
 * Typed interface for the SendGrid mail client to enable
 * proper dependency injection and testability.
 */
export interface SendGridMailService {
  setApiKey(apiKey: string): void;
  send(
    data: sgMail.MailDataRequired | sgMail.MailDataRequired[]
  ): Promise<[sgMail.ClientResponse, object]>;
}

/**
 * Injection token for SendGrid mail service
 */
export const SENDGRID_MAIL_SERVICE = 'SENDGRID_MAIL_SERVICE';

/**
 * SendGrid Mail Provider
 *
 * Factory provider that initializes and configures the SendGrid mail client.
 * Handles ESM/CJS import compatibility issues by accessing the default export.
 *
 * REQUIRED: This provider throws an error if SENDGRID_API_KEY is not configured.
 * The application will fail to start without proper SendGrid configuration.
 *
 * Usage in services:
 * ```typescript
 * constructor(
 *   @Inject(SENDGRID_MAIL_SERVICE)
 *   private readonly mailService: SendGridMailService,
 * ) {}
 * ```
 *
 * Configuration (environment variables):
 * - SENDGRID_API_KEY: SendGrid API key (required)
 * - SENDGRID_FROM_EMAIL: Sender email address
 * - SENDGRID_FROM_NAME: Sender display name
 */
export const SendGridMailProvider: Provider = {
  provide: SENDGRID_MAIL_SERVICE,
  useFactory: (configService: ConfigService): SendGridMailService => {
    const logger = new Logger('SendGridProvider');
    const apiKey = configService.get<string>('SENDGRID_API_KEY');

    if (!apiKey) {
      const error =
        'SENDGRID_API_KEY is not configured. Please set it in your .env file.';
      logger.error(error);
      throw new Error(error);
    }

    // Package is marked as external in webpack.config.js
    // Node.js loads it directly, so imports work as expected
    sgMail.setApiKey(apiKey);
    logger.log('SendGrid mail client initialized successfully');

    return sgMail as SendGridMailService;
  },
  inject: [ConfigService],
};
