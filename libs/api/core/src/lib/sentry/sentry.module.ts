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
// Named imports, not `import ... = require(...)`. That construct has no ESM
// equivalent, and `libs/api/**` must compile to ESM because NestJS 12 ships
// `type: module`. `@sentry/nestjs/setup` publishes a real ESM build with these
// two named exports, so nothing here depends on interop.
import {
  SentryGlobalFilter,
  SentryModule as SentrySetupModule,
} from '@sentry/nestjs/setup';

@Injectable()
class SentryShutdownService implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await Sentry.close(2000);
  }
}

@Module({
  imports: [SentrySetupModule.forRoot()],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    SentryShutdownService,
  ],
})
export class SentryModule {}
