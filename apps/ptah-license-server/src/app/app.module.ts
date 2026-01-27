import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { LicenseModule } from '../license/license.module';
import { AuthModule } from './auth/auth.module';
import { PaddleModule } from '../paddle/paddle.module';
import { EventsModule } from '../events/events.module';
import { SubscriptionModule } from '../subscription/subscription.module';

/**
 * AppModule - Root application module
 *
 * Configures global modules and imports all feature modules:
 * - ConfigModule: Global environment variable access via ConfigService
 * - PrismaModule: Database access via Prisma ORM
 * - LicenseModule: License management API endpoints
 * - AuthModule: WorkOS authentication with PKCE flow
 * - PaddleModule: Paddle payment webhook handling
 * - SubscriptionModule: User-facing subscription management APIs (TASK_2025_123)
 *
 * IMPORTANT: ConfigModule.forRoot({ isGlobal: true }) makes ConfigService
 * available to ALL modules without explicit import. This is required for
 * modules that need environment variables (AuthModule, PaddleModule, etc.).
 */
@Module({
  imports: [
    // Global configuration - makes ConfigService available everywhere
    ConfigModule.forRoot({ isGlobal: true }),

    // Core infrastructure
    PrismaModule,

    // Feature modules
    LicenseModule,
    AuthModule,
    PaddleModule,
    EventsModule,
    SubscriptionModule, // TASK_2025_123: Subscription management APIs
  ],
})
export class AppModule {}
