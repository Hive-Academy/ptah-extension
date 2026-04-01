/**
 * SentryModule - Global Sentry integration for NestJS
 *
 * Provides SentryGlobalFilter to catch all unhandled exceptions and report to Sentry.
 * The actual SDK initialization happens in instrument.ts (first import in main.ts).
 * Safe in all environments — when SENTRY_DSN is not set, Sentry calls are no-ops.
 *
 * @see ../instrument.ts
 */

import {
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';

// Uses import-require syntax (same pattern as cookie-parser in main.ts) because
// moduleResolution: "node" can't resolve package.json "exports" subpaths.
import SentrySetup = require('@sentry/nestjs/setup');

@Injectable()
class SentryShutdownService implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await Sentry.close(2000);
  }
}

@Module({
  imports: [SentrySetup.SentryModule.forRoot()],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentrySetup.SentryGlobalFilter,
    },
    SentryShutdownService,
  ],
})
export class SentryModule {}
