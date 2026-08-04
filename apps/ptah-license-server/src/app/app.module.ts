import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SentryModule } from '@ptah-api/core';
import { PrismaModule } from '@ptah-api/core';
import { LicenseModule } from '@ptah-api/licensing';
import { AuthModule } from '@ptah-api/licensing';
import { PaddleModule } from '@ptah-api/billing';
import { EventsModule } from '@ptah-api/licensing';
import { SubscriptionModule } from '@ptah-api/billing';
import { ContactModule } from '@ptah-api/marketing';
import { WaitlistModule } from '@ptah-api/marketing';
import { SessionModule } from '@ptah-api/marketing';
import { HealthModule } from '../health/health.module';
import { AdminModule } from '@ptah-api/admin';
import { AuditModule } from '@ptah-api/audit';
import { MarketingModule } from '@ptah-api/marketing';
import { MembershipModule } from '@ptah-api/membership';
import { CircleModule } from '@ptah-api/community';
import { GoogleSessionsModule } from '@ptah-api/community';
import { DiscourseModule } from '@ptah-api/community';
import { MemberGroupsModule } from '@ptah-api/community';
import { PacksModule } from '@ptah-api/community';

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
    // TASK_2026_177 P1a — THE membership definition (@Global). R7.3 requires it
    // to be registered BEFORE every consumer: `MemberGuard` and
    // `MembershipService` are resolved out of the global provider scope, which
    // only exists once this module has been instantiated. Every member
    // controller in P2–P5 declares `@UseGuards(JwtAuthGuard, MemberGuard)`.
    MembershipModule,
    CircleModule, // Circle community provisioning for paid Builders members
    GoogleSessionsModule, // Google Calendar/Meet Builders sessions + members area
    DiscourseModule, // DiscourseConnect SSO + builders group sync
    MemberGroupsModule, // Member cohorts (groups) + assignment (@Global)
    // THIS ARRAY'S ORDER NO LONGER ARBITRATES ROUTE MATCHING (TASK_2026_170 R2).
    // It used to: AdminController was @Controller('v1/admin') with @Get(':model')
    // wildcards, so ten sibling admin routes — packs, groups, sessions,
    // community/*, marketing/* — resolved correctly ONLY because their modules
    // appeared above AdminModule here. R2 moved those wildcards under the
    // literal `v1/admin/records`, and `src/common/route-map.spec.ts` (RI-1/RI-2)
    // now asserts that no two controllers can contest a path at all. Order this
    // array for readability; a routing bug can no longer hide in it.
    PacksModule, // TASK_2026_169: admin-only Builders pack registry

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
