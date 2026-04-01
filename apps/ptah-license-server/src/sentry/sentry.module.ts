/**
 * SentryModule - Global Sentry integration for NestJS
 *
 * Provides:
 * - SentryGlobalFilter: Catches all unhandled exceptions and reports to Sentry
 * - Automatic transaction/span creation for HTTP requests (via Sentry NestJS SDK)
 *
 * This module is imported as a global module in AppModule. The actual Sentry
 * initialization happens in instrument.ts (imported before everything else in main.ts).
 *
 * When SENTRY_DSN is not set, the filter still works but Sentry calls are no-ops,
 * so this module is safe to include in all environments.
 *
 * @see ../instrument.ts - Sentry SDK initialization
 * @see https://docs.sentry.io/platforms/javascript/guides/nestjs/
 */

import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

// Use require() for @sentry/nestjs/setup because the tsconfig uses
// moduleResolution: "node" which can't resolve package.json "exports" subpaths.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SentryGlobalFilter, SentryModule: SentrySdkModule } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@sentry/nestjs/setup');

@Module({
  imports: [SentrySdkModule.forRoot()],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class SentryModule {}
