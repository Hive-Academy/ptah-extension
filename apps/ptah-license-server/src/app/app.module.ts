import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SentryModule } from '../sentry/sentry.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LicenseModule } from '../license/license.module';
import { AuthModule } from './auth/auth.module';
import { PaddleModule } from '../paddle/paddle.module';
import { EventsModule } from '../events/events.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { ContactModule } from '../contact/contact.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { SessionModule } from '../session/session.module';
import { HealthModule } from '../health/health.module';
import { AdminModule } from '../admin/admin.module';
import { AuditModule } from '../audit/audit.module';
import { MarketingModule } from '../marketing/marketing.module';
import { CircleModule } from '../circle/circle.module';
import { GoogleSessionsModule } from '../google-sessions/google-sessions.module';
import { DiscourseModule } from '../discourse/discourse.module';
import { MemberGroupsModule } from '../member-groups/member-groups.module';
import { PacksModule } from '../packs/packs.module';

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
    ConfigModule.forRoot({ isGlobal: true }),
    SentryModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 1 minute window
        limit: 100, // 100 requests per minute
      },
    ]),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuditModule,
    CircleModule, // Circle community provisioning for paid Builders members
    GoogleSessionsModule, // Google Calendar/Meet Builders sessions + members area
    DiscourseModule, // DiscourseConnect SSO + builders group sync
    MemberGroupsModule, // Member cohorts (groups) + assignment (@Global)
    // TASK_2026_169: admin-only Builders pack registry.
    // ⚠️ MUST stay ABOVE AdminModule. AdminController is @Controller('v1/admin')
    // with @Get(':model') wildcards, so a sibling @Controller('v1/admin/packs')
    // only wins the route match when its module is registered first. Move this
    // below AdminModule and GET /api/v1/admin/packs silently 400s with
    // "Unknown admin model: packs". Same reason MemberGroupsModule sits here.
    PacksModule,
    LicenseModule,
    AuthModule,
    PaddleModule,
    EventsModule,
    SubscriptionModule, // TASK_2025_123: Subscription management APIs
    ContactModule, // Contact form message handling
    WaitlistModule, // Builders premium-tier waitlist signup
    SessionModule, // Training session request handling
    HealthModule, // Health check with DB validation (TASK_2025_180)
    MarketingModule, // TASK_2025_292: marketing backend foundation
    AdminModule, // TASK_2025_290: native admin dashboard
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
