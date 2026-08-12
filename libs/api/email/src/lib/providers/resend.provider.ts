import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * Resend Mail Service Interface
 *
 * Typed interface for the Resend email client to enable
 * proper dependency injection and testability.
 */
export interface ResendMailService {
  emails: {
    send(params: {
      from: string;
      to: string[];
      subject: string;
      html: string;
      replyTo?: string;
      headers?: Record<string, string>;
      tags?: Array<{ name: string; value: string }>;
    }): Promise<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>;
  };
}

/**
 * Injection token for Resend mail service
 */
export const RESEND_MAIL_SERVICE = 'RESEND_MAIL_SERVICE';

/**
 * Resend Mail Provider
 *
 * Factory provider that initializes and configures the Resend email client.
 *
 * REQUIRED: This provider throws an error if RESEND_API_KEY is not configured.
 * The application will fail to start without proper Resend configuration.
 *
 * Usage in services:
 * ```typescript
 * constructor(
 *   @Inject(RESEND_MAIL_SERVICE)
 *   private readonly mailService: ResendMailService,
 * ) {}
 * ```
 *
 * Configuration (environment variables):
 * - RESEND_API_KEY: Resend API key (required)
 * - FROM_EMAIL: Sender email address
 * - FROM_NAME: Sender display name
 */
export const ResendMailProvider: Provider = {
  provide: RESEND_MAIL_SERVICE,
  useFactory: (configService: ConfigService): ResendMailService => {
    const logger = new Logger('ResendProvider');
    const apiKey = configService.get<string>('RESEND_API_KEY');

    if (!apiKey) {
      const error =
        'RESEND_API_KEY is not configured. Please set it in your .env file.';
      logger.error(error);
      throw new Error(error);
    }

    const resend = new Resend(apiKey);
    logger.log('Resend mail client initialized successfully');

    return resend as unknown as ResendMailService;
  },
  inject: [ConfigService],
};
