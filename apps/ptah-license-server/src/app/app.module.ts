import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from '../prisma/prisma.module';
import { LicenseModule } from '../license/license.module';
import { AuthModule } from './auth/auth.module';
import { PaddleModule } from '../paddle/paddle.module';
import { EventsModule } from '../events/events.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TrialReminderModule } from '../trial-reminder/trial-reminder.module';

/**
 * AppModule - Root application module
 *
 * Configures global modules and imports all feature modules:
 * - ConfigModule: Global environment variable access via ConfigService
 * - ThrottlerModule: Rate limiting for API protection (TASK_2025_125)
 * - PrismaModule: Database access via Prisma ORM
 * - LicenseModule: License management API endpoints
 * - AuthModule: WorkOS authentication with PKCE flow
 * - PaddleModule: Paddle payment webhook handling
 * - SubscriptionModule: User-facing subscription management APIs (TASK_2025_123)
 *
 * IMPORTANT: ConfigModule.forRoot({ isGlobal: true }) makes ConfigService
 * available to ALL modules without explicit import. This is required for
 * modules that need environment variables (AuthModule, PaddleModule, etc.).
 *
 * TASK_2025_125: Rate Limiting Configuration
 * - Global default: 100 requests per minute
 * - License verify endpoint: 10 requests per minute (stricter)
 * - Admin endpoints: 30 requests per minute
 * - ThrottlerGuard is applied globally via APP_GUARD
 */
@Module({
  imports: [
    // Global configuration - makes ConfigService available everywhere
    ConfigModule.forRoot({ isGlobal: true }),

    // TASK_2025_125: Rate limiting to prevent abuse and DoS attacks
    // Default: 100 requests per minute per IP (generous for normal usage)
    // Stricter limits applied per-endpoint via @Throttle decorator
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 1 minute window
        limit: 100, // 100 requests per minute
      },
    ]),

    // Event emitter for async event handling
    EventEmitterModule.forRoot(),

    // Core infrastructure
    PrismaModule,

    // Feature modules
    LicenseModule,
    AuthModule,
    PaddleModule,
    EventsModule,
    SubscriptionModule, // TASK_2025_123: Subscription management APIs
    TrialReminderModule, // TASK_2025_142: Trial reminder email notifications
  ],
  providers: [
    // TASK_2025_125: Apply ThrottlerGuard globally to all routes
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
