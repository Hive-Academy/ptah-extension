import { InjectionToken } from '@angular/core';

/**
 * Paddle configuration interface
 *
 * Defines all configuration parameters needed for Paddle SDK initialization
 * and checkout operations.
 *
 * TASK_2025_128: Freemium model - only Pro plan uses Paddle checkout.
 * Community tier is FREE with no Paddle integration.
 */
export interface PaddleConfig {
  /**
   * Paddle environment mode
   * - 'sandbox': Test environment for development
   * - 'production': Live payment processing
   */
  environment: 'sandbox' | 'production';

  /**
   * Client-side token for Paddle.js SDK authentication
   * - Sandbox: starts with 'test_'
   * - Production: starts with 'live_'
   * @see https://developer.paddle.com/getting-started/client-side-token
   */
  token: string;

  /**
   * Pro plan monthly subscription price ID from Paddle dashboard
   * Example: 'pri_01htxv8fqjyj5r3qj5t4qj5t4q'
   */
  proPriceIdMonthly: string;

  /**
   * Pro plan yearly subscription price ID from Paddle dashboard
   * Example: 'pri_01htxv8fqjyj5r3qj5t4qj5t4r'
   */
  proPriceIdYearly: string;

  /**
   * Maximum number of retry attempts for SDK loading
   * @default 3
   */
  maxRetries?: number;

  /**
   * Base delay in milliseconds for retry backoff
   * @default 1000
   */
  baseRetryDelay?: number;

  /**
   * Number of retry attempts for license verification
   * @default 3
   */
  licenseVerifyRetries?: number;

  /**
   * Delay in milliseconds between license verification retries
   * @default 2000
   */
  licenseVerifyDelay?: number;
}

/**
 * Injection token for Paddle configuration
 *
 * Use this token to inject Paddle configuration throughout the application
 * instead of direct environment imports.
 *
 * @example
 * ```typescript
 * export class MyService {
 *   private readonly config = inject(PADDLE_CONFIG);
 * }
 * ```
 */
export const PADDLE_CONFIG = new InjectionToken<PaddleConfig>('PADDLE_CONFIG');

/**
 * Provider factory for Paddle configuration
 *
 * Creates an Angular provider that supplies Paddle configuration from environment.
 *
 * @param config - Paddle configuration object
 * @returns Angular provider
 *
 * @example
 * ```typescript
 * // In app.config.ts
 * import { providePaddleConfig } from './config/paddle.config';
 * import { environment } from '../environments/environment';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     providePaddleConfig({
 *       environment: environment.paddle.environment,
 *       token: environment.paddle.token,
 *       proPriceIdMonthly: environment.paddle.proPriceIdMonthly,
 *       proPriceIdYearly: environment.paddle.proPriceIdYearly,
 *       maxRetries: 3,
 *       baseRetryDelay: 1000,
 *       licenseVerifyRetries: 3,
 *       licenseVerifyDelay: 2000,
 *     }),
 *   ],
 * };
 * ```
 */
export function providePaddleConfig(config: PaddleConfig) {
  return {
    provide: PADDLE_CONFIG,
    useValue: config,
  };
}
