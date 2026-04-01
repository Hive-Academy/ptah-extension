/* eslint-disable no-console */
/**
 * Sentry Instrumentation - MUST be imported before all other modules.
 * Initializes Sentry for error tracking and performance monitoring.
 *
 * Environment variables:
 * - SENTRY_DSN: Required in production, skip initialization when absent
 * - SENTRY_TRACES_SAMPLE_RATE: Override trace sampling (default: 1.0 prod, 0.1 dev)
 * - SENTRY_SEND_PII: Set to "false" to disable PII collection (default: true)
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nestjs/
 */

import * as Sentry from '@sentry/nestjs';

const dsn = process.env['SENTRY_DSN'];
const environment = process.env['NODE_ENV'] || 'development';
const isProduction = environment === 'production';

if (dsn) {
  const tracesSampleRate = parseFloat(
    process.env['SENTRY_TRACES_SAMPLE_RATE'] || (isProduction ? '1.0' : '0.1'),
  );
  const sendDefaultPii = process.env['SENTRY_SEND_PII'] !== 'false';

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate,
    sendDefaultPii,
  });

  console.log(
    `[Sentry] Initialized for environment: ${environment} (DSN configured)`,
  );
} else {
  console.log(
    '[Sentry] Skipping initialization - SENTRY_DSN not set (expected in development)',
  );
}
