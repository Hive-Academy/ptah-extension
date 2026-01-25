import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkOS } from '@workos-inc/node';

/**
 * WorkOS Client Interface
 *
 * Typed interface for the WorkOS client to enable
 * proper dependency injection and testability.
 *
 * Exposes the userManagement API for authentication flows.
 */
export interface WorkOSClient {
  userManagement: WorkOS['userManagement'];
}

/**
 * Injection token for WorkOS client
 */
export const WORKOS_CLIENT = 'WORKOS_CLIENT';

/**
 * WorkOS Client Provider
 *
 * Factory provider that initializes and configures the WorkOS client.
 * Handles ESM/CJS import compatibility issues by accessing the default export.
 *
 * REQUIRED: This provider throws an error if WORKOS_API_KEY is not configured.
 * The application will fail to start without proper WorkOS configuration.
 *
 * Usage in services:
 * ```typescript
 * constructor(
 *   @Inject(WORKOS_CLIENT)
 *   private readonly workos: WorkOSClient,
 * ) {}
 * ```
 *
 * Configuration (environment variables):
 * - WORKOS_API_KEY: WorkOS API key (required)
 * - WORKOS_CLIENT_ID: OAuth client ID
 * - WORKOS_REDIRECT_URI: OAuth callback URL
 */
export const WorkOSClientProvider: Provider = {
  provide: WORKOS_CLIENT,
  useFactory: (configService: ConfigService): WorkOSClient => {
    const logger = new Logger('WorkOSProvider');
    const apiKey = configService.get<string>('WORKOS_API_KEY');

    if (!apiKey) {
      const error =
        'WORKOS_API_KEY is not configured. Please set it in your .env file.';
      logger.error(error);
      throw new Error(error);
    }

    // Package is marked as external in webpack.config.js
    // Node.js loads it directly, so imports work as expected
    const client = new WorkOS(apiKey);
    logger.log('WorkOS client initialized successfully');

    return client as WorkOSClient;
  },
  inject: [ConfigService],
};
