/**
 * Sentry Instrumentation - MUST be imported before all other modules
 *
 * This file initializes Sentry for error tracking and performance monitoring.
 * It must be the very first import in main.ts to ensure all modules are
 * properly instrumented.
 *
 * Configuration:
 * - SENTRY_DSN: Required in production, optional in development
 * - NODE_ENV: Controls environment tag and sample rates
 * - Gracefully skips initialization when SENTRY_DSN is not set (dev mode)
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nestjs/
 */

import * as Sentry from '@sentry/nestjs';

const dsn = process.env['SENTRY_DSN'];
const environment = process.env['NODE_ENV'] || 'development';
const isProduction = environment === 'production';

if (dsn) {
  Sentry.init({
    dsn,
    environment,

    // Performance monitoring: capture 100% of transactions in production
    // since this is a low-traffic license server. Reduce if traffic grows.
    tracesSampleRate: isProduction ? 1.0 : 0.1,

    // Send default PII (IP addresses, user details) for better debugging
    // in production. Disable if GDPR compliance requires it.
    sendDefaultPii: true,
  });

  // eslint-disable-next-line no-console
  console.log(
    `[Sentry] Initialized for environment: ${environment} (DSN configured)`,
  );
} else {
  // eslint-disable-next-line no-console
  console.log(
    '[Sentry] Skipping initialization - SENTRY_DSN not set (expected in development)',
  );
}
