import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
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
import { MemberHubModule } from '@ptah-api/member-hub';
import { ForumModule } from '@ptah-api/forum';
import { LearningModule } from '@ptah-api/learning';
import { CircleModule } from '@ptah-api/community';
import { GoogleSessionsModule } from '@ptah-api/community';
// TASK_2026_177 Phase 4. Registered in the same region as ForumModule and
// LearningModule: a feature module the hub composes, imported explicitly rather
// than made @Global(). Its private-session half rides GoogleSessionsModule above
// (AD-6) and needs no separate registration.
import { LiveSessionsModule } from '@ptah-api/community';
import { MemberGroupsModule } from '@ptah-api/community';
import { PacksModule } from '@ptah-api/community';
// TASK_2026_177 Phase 5 — the member-facing half of the pack registry. A
// SEPARATE module from PacksModule on purpose (RISK-AG): `admin-guards.spec.ts`
// G6 asserts every controller in PacksModule is mounted under `v1/admin/`, so
// the member controller lives in the same DIRECTORY and a different MODULE.
import { MemberPacksModule } from '@ptah-api/community';
// TASK_2026_177 Phase 5 — the member-owned in-app notification inbox (R10).
import { NotificationsModule } from '@ptah-api/notifications';

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
    // 🔴 TASK_2026_177 Phase 5 — THE FIRST SCHEDULED JOB IN THIS SERVER, AND
    // THIS LINE IS WHAT MAKES IT RUN AT ALL (RISK-AE).
    //
    // `@nestjs/schedule` has been a dependency of this repo for months and was
    // imported NOWHERE: zero `ScheduleModule`, zero `@Cron`. It exists for
    // `NotificationRetentionService.prune()`
    // (`libs/api/notifications`), which deletes READ notifications older than
    // 90 days (R10.6) at 04:00 daily.
    //
    // ⚠️ A `@Cron` WITHOUT THIS REGISTRATION IS INERT, SILENT AND
    // UNIT-TEST-GREEN FOREVER. Every natural test calls `prune()` directly, so
    // the decorator's wiring is never exercised and the job passes its spec
    // while never running once in production — a failure invisible until the
    // table is years old. `notification-retention.service.spec.ts` therefore
    // boots a real injector, resolves `SchedulerRegistry` and asserts a cron
    // job named `PRUNE_JOB_NAME` is REGISTERED. Delete this line and that one
    // test goes red; nothing else does.
    //
    // ⚠️ IT IS REGISTERED HERE AND NOT INSIDE `NotificationsModule`, because
    // that module is `@Global()` and imported by the producer libs — a
    // `forRoot()` inside it would register the scheduler root more than once.
    //
    // ⚠️ THE "trial-reminder cron" NAMED IN THIS APP'S CLAUDE.md IS NOT
    // `@nestjs/schedule` AND IS NOT A PRECEDENT. Nothing about it changes here.
    ScheduleModule.forRoot(),
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
    // TASK_2026_177 P5 — `GET v1/members/packs`. Registered beside PacksModule
    // because they read one table, and as a SEPARATE entry because they are
    // separate modules: nothing here imports anything from there, and
    // `MemberPacksService` injects only PrismaService (no CohortResolver — A-1).
    // AFTER MembershipModule (R7.3): the controller declares
    // `@UseGuards(JwtAuthGuard, MemberGuard)`.
    MemberPacksModule,
    // TASK_2026_177 P1d — GET v1/members/hub + GET v1/members/entitlement.
    // AFTER MembershipModule (R7.3): the hub controller declares
    // `@UseGuards(JwtAuthGuard, MemberGuard)` and both controllers inject
    // `MembershipService` / `CohortResolver` out of that @Global scope, which
    // exists only once MembershipModule has been instantiated.
    // AFTER GoogleSessionsModule too, though with a softer consequence: the
    // hub's sessions resolver takes `SessionsService` with `@Optional()`, so
    // the wrong order would degrade one card rather than fail the boot.
    MemberHubModule,
    // TASK_2026_177 P2 — the native community forum. Five controllers:
    // `v1/members/{community,search}` and `v1/admin/community/{categories,
    // topics,posts}`.
    //
    // AFTER MembershipModule (R7.3), for the same reason as MemberHubModule:
    // both member controllers declare `@UseGuards(JwtAuthGuard, MemberGuard)`,
    // and `MemberGuard` is resolved out of MembershipModule's @Global provider
    // scope — which exists only once that module has been instantiated.
    //
    // BEFORE MemberHubModule would ALSO work and is not required: nothing here
    // is @Global, and MemberHubModule imports ForumModule explicitly for the
    // two services it composes its `community` section from. Placed after it
    // because that is the reading order — the hub is the older wiring.
    //
    // ⚠️ ForumModule DOES NOT IMPORT NotificationsModule, ALTHOUGH IT NOW
    // PRODUCES THREE NOTIFICATION KINDS (Phase 5, RISK-L). `PostsService` and
    // `AcceptedAnswerService` inject `NotificationsService` out of the @Global
    // scope registered below — the same shape LiveSessionsModule uses to reach
    // `SessionsService` without importing GoogleSessionsModule. See
    // ForumModule's docblock for why the import was not added.
    ForumModule,
    // TASK_2026_177 P3 — the course curriculum. Five controllers:
    // `v1/members/{courses,lesson-comments}` and
    // `v1/admin/{courses,course-modules,lessons}`.
    //
    // AFTER MembershipModule (R7.3), for the same reason as ForumModule and
    // MemberHubModule: both member controllers declare
    // `@UseGuards(JwtAuthGuard, MemberGuard)`, and `MemberGuard` is resolved out
    // of MembershipModule's @Global provider scope — which exists only once that
    // module has been instantiated. That ordering is a REQUIREMENT.
    //
    // Its position relative to MemberHubModule is NOT a requirement, even though
    // MemberHubModule imports this one for `CourseReadService`. Nothing here is
    // @Global, and a Nest module's imports are resolved by the injector rather
    // than by array position — MemberHubModule names LearningModule explicitly,
    // so it gets the same singleton whichever appears first. Placed after
    // ForumModule because that is the reading order: P2 then P3.
    //
    // ⚠️ YoutubeModule is NOT registered here. `LearningModule` imports it (and
    // Batch 12's community lib will too). A second registration would create a
    // second provider instance and therefore a second `loggedDisabled` flag,
    // which is how "the disabled notice is logged exactly once" quietly becomes
    // "once per module that touched it".
    //
    // ⚠️ LearningModule PRODUCES NO NOTIFICATION AT ALL (Phase 5, RISK-L).
    // R10.1's producer set is exactly four kinds across ForumModule and
    // GoogleSessionsModule; lesson-comment replies are NOT in it. Its spec now
    // asserts that no source file in that lib reaches
    // `@ptah-api/notifications` — an import-list assertion could not, because
    // the module below is @Global.
    LearningModule,

    // TASK_2026_177 Phase 4 — the Ptah-authored live schedule and the AD-3
    // merged member feed (`v1/members/live`, `v1/admin/live-sessions`).
    //
    // ⚠️ IT IMPORTS `YoutubeModule` ITSELF, for the reason stated above
    // LearningModule: one registration, one provider instance, one
    // `loggedDisabled` flag.
    //
    // ⚠️ IT DOES NOT IMPORT `GoogleSessionsModule`, although `LiveFeedService`
    // reads `SessionsService`. That module is `@Global()` and exports it, and
    // the injection is `@Optional()` — so an unregistered Google integration
    // degrades `calendarAvailable` to `false` (R3.6) rather than failing this
    // module's construction and taking the whole live surface with it.
    //
    // ⚠️ THE PRIVATE-SESSION HALF OF PHASE 4 IS NOT A SEPARATE ENTRY. R4 extends
    // `SessionRequest` and the Calendar write path, so its service and its two
    // controllers ride `GoogleSessionsModule` above (AD-6).
    //
    // ⚠️ LiveSessionsModule PRODUCES NO NOTIFICATION EITHER (Phase 5, RISK-L).
    // `session_request.status` IS a Phase-5 producer, and it is written one
    // directory away in `google-sessions/session-requests.service.ts` per AD-6 —
    // not here. The proximity is exactly what makes the mistake plausible, which
    // is why that lib's spec scans the directory rather than the import list.
    LiveSessionsModule,

    // TASK_2026_177 Phase 5 — the in-app notification inbox
    // (`v1/members/notifications`), R10.
    //
    // ⚠️ `@Global()`, AND THEREFORE ORDER-SENSITIVE IN THE SAME WAY
    // `MembershipModule` IS (R7.3). A `@Global()` module's exports are visible
    // only once it has been INSTANTIATED, and Batch 14's producers inject
    // `NotificationsService` out of that global scope from `ForumModule` and
    // `GoogleSessionsModule`. Both are registered ABOVE this line, which works
    // because Nest resolves providers after scanning every module rather than
    // in array order — but the safe reading is "notifications is global, so
    // nothing needs to import it", not "the array position is load-bearing".
    //
    // ⚠️ IT IS **NOT** ADDED TO `ForumModule` / `LearningModule` /
    // `LiveSessionsModule` / `GoogleSessionsModule`'s OWN `imports`, AND TASK
    // 14.14 DECIDED THAT DELIBERATELY RATHER THAN DEFERRING IT. All four RISK-L
    // assertions were kept and re-justified: `@Global()` makes the import
    // redundant for the two libs that DO produce, and the other two produce
    // nothing. Keeping a true assertion and changing its reason is strictly more
    // information than deleting it — and `live-sessions.module.spec.ts` was
    // already making this exact argument about `GoogleSessionsModule` before
    // Phase 5 existed.
    NotificationsModule,

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
