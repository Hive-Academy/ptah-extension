import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Paddle, Environment, type EventEntity } from '@paddle/paddle-node-sdk';

/**
 * Paddle Client Interface
 *
 * Typed interface for the Paddle client to enable
 * proper dependency injection and testability.
 */
export interface PaddleClient {
  webhooks: {
    unmarshal(
      rawBody: string,
      secretKey: string,
      signature: string
    ): Promise<EventEntity>;
  };
}

/**
 * Injection token for Paddle client
 */
export const PADDLE_CLIENT = 'PADDLE_CLIENT';

/**
 * Paddle Client Provider
 *
 * Factory provider that initializes and configures the Paddle SDK client.
 * Handles ESM/CJS import compatibility issues.
 *
 * REQUIRED: This provider throws an error if PADDLE_API_KEY is not configured.
 * The application will fail to start without proper Paddle configuration.
 *
 * Usage in services:
 * ```typescript
 * constructor(
 *   @Inject(PADDLE_CLIENT)
 *   private readonly paddle: PaddleClient,
 * ) {}
 * ```
 *
 * Configuration (environment variables):
 * - PADDLE_API_KEY: Paddle API key (required)
 * - PADDLE_WEBHOOK_SECRET: Webhook signature secret (required for webhooks)
 * - NODE_ENV: Determines sandbox vs production environment
 */
export const PaddleClientProvider: Provider = {
  provide: PADDLE_CLIENT,
  useFactory: (configService: ConfigService): PaddleClient => {
    const logger = new Logger('PaddleProvider');
    const apiKey = configService.get<string>('PADDLE_API_KEY');

    if (!apiKey) {
      const error =
        'PADDLE_API_KEY is not configured. Please set it in your .env file.';
      logger.error(error);
      throw new Error(error);
    }

    const webhookSecret = configService.get<string>('PADDLE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      logger.warn(
        'PADDLE_WEBHOOK_SECRET not configured - webhook verification will fail'
      );
    }

    const nodeEnv = configService.get<string>('NODE_ENV');
    const environment =
      nodeEnv === 'production' ? Environment.production : Environment.sandbox;

    // Package is marked as external in webpack.config.js
    // Node.js loads it directly, so imports work as expected
    const client = new Paddle(apiKey, { environment });
    logger.log(
      `Paddle SDK initialized in ${
        environment === Environment.production ? 'production' : 'sandbox'
      } mode`
    );

    return client as PaddleClient;
  },
  inject: [ConfigService],
};
