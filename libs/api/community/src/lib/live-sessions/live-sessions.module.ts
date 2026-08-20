import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '@ptah-api/audit';
import { PrismaModule } from '@ptah-api/core';
import {
  AdminGuard,
  AdminThrottlerGuard,
  IdentityModule,
} from '@ptah-api/identity';
import { MembershipModule } from '@ptah-api/membership';
import { YoutubeModule } from '@ptah-api/youtube';

import { AdminLiveSessionsController } from './admin-live-sessions.controller';
import { LiveFeedService } from './live-feed.service';
import { LiveSessionsService } from './live-sessions.service';
import { MemberLiveController } from './member-live.controller';

/**
 * `LiveSessionsModule` — the Ptah-authored live schedule and the merged member
 * feed (plan §2.9, §2.11, R3).
 *
 * Two controllers — one member (`v1/members/live`) and one admin
 * (`v1/admin/live-sessions`) — and two services.
 *
 * ⚠️ THE PRIVATE-SESSION HALF OF PHASE 4 IS **NOT** HERE. `SessionRequestsService`
 * and its two controllers live in `GoogleSessionsModule`, because they extend
 * `SessionRequest` and the Calendar write path that module already owns (AD-6).
 * Splitting them out would have meant a second module holding
 * `GoogleCalendarProvider`, which is exactly the "one integration, two owners"
 * shape that produces two `loggedDisabled` flags and two abort budgets.
 *
 * ── ⚠️ `NotificationsModule` IS STILL ABSENT, AND SO IS ANY PRODUCER (RISK-L)
 *
 * 🔴 `libs/api/notifications` NOW EXISTS — Phase 5 (TASK_2026_177) built it, and
 * `session_request.status` IS one of its four producers. That producer is
 * written ONE DIRECTORY AWAY, in `google-sessions/session-requests.service.ts`,
 * and NOT here. AD-6 is why: a `SessionRequest` and the Calendar write path
 * belong to `GoogleSessionsModule`, while a `LiveSession` is a row of ours that
 * merely MAY claim a Calendar event. Nothing in THIS module writes a
 * `Notification`, and the proximity is exactly what makes the mistake plausible.
 *
 * ⚠️ AND EVEN A PRODUCER HERE WOULD NOT NEED THE IMPORT. `NotificationsModule`
 * is `@Global()` and exports `NotificationsService`. That is the same reason
 * this module does not import `GoogleSessionsModule` although `LiveFeedService`
 * reads it — see the assertion below, which was already making this argument for
 * a different global before Phase 5 existed.
 *
 * `live-sessions.module.spec.ts` asserts BOTH that the import is absent AND that
 * no source file under `live-sessions/` reaches `@ptah-api/notifications` — the
 * second being the half that still bites now that the import would resolve.
 *
 * ── ⚠️ `AdminGuard` AND `AdminThrottlerGuard` ARE DECLARED LOCALLY ──────────
 * Not by importing `AdminModule`. That is the acyclicity idiom
 * `MemberGroupsModule` established and `ForumModule` / `LearningModule` follow:
 * a guard with constructor dependencies is instantiated in the CONSUMING
 * module's injector, so `@UseGuards(AdminGuard)` on a controller here requires
 * `AdminGuard` to be resolvable from THIS module. Importing `AdminModule` to get
 * it would make a feature module depend on the admin dashboard module for a
 * stateless guard that needs only `ConfigService` and the global throttler
 * providers.
 *
 * 🔴 `MemberGuard` NEEDS NO EQUIVALENT AND MUST NOT BE RE-DECLARED.
 * `MembershipModule` is `@Global()` and exports it, and a second declaration
 * would create a second instance resolving entitlement out of a different
 * injector — a member's `cohortKeys` computed by one copy and their
 * `entitled` by another. The asymmetry with `AdminGuard` is real, not an
 * oversight.
 *
 * ── ⚠️ `YoutubeModule` IS A NORMAL IMPORT, NOT `@Optional()` ────────────────
 * The feature-off posture lives INSIDE `YouTubeMetadataProvider`
 * (`isEnabled()` → `{ ok: false, skipped: true }`, logged once), so an unset
 * `YOUTUBE_API_KEY` is a supported runtime state and not a missing dependency. A
 * missing `YoutubeModule`, by contrast, is a WIRING MISTAKE and should fail at
 * boot rather than degrade authoring silently.
 *
 * ⚠️ AND IT IS IMPORTED HERE RATHER THAN REGISTERED IN `app.module.ts`. A second
 * registration would create a second provider instance and therefore a second
 * `loggedDisabled` flag, which is how "logged exactly once" becomes "logged once
 * per module that happened to touch it".
 *
 * ── 🔴 `SessionsService` IS NOT IMPORTED, AND THAT IS THE POINT ─────────────
 * `LiveFeedService` needs it for the AD-3 merge, and it is exported by the
 * `@Global()` `GoogleSessionsModule` — so it is injected `@Optional()`, exactly
 * as `SessionsSection` does. An unregistered `GoogleSessionsModule` then
 * degrades `calendarAvailable` to `false` (R3.6) rather than failing this
 * module's construction and taking the whole live surface down with it.
 * Importing it explicitly would turn that graceful degradation into a boot
 * failure, and would introduce an import edge between two modules that are
 * otherwise siblings.
 *
 * ── NOT `@Global()`, DELIBERATELY ──────────────────────────────────────────
 * `app.module.ts` imports it explicitly. The global scope is reserved for the
 * cross-cutting definitions (`MembershipModule`, `MemberGroupsModule`,
 * `PrismaModule`, `AuditModule`) that genuinely span libs.
 *
 * `ConfigModule`, `PrismaModule` and `AuditModule` are imported although all
 * three are already global in `app.module.ts`, so the module stays resolvable in
 * isolation under `Test.createTestingModule({ imports: [LiveSessionsModule] })`.
 *
 * ── EXPORTS: ONE SERVICE, AND NOT ONE MORE (§2.9) ──────────────────────────
 * `LiveFeedService` — the member read model the hub's `sessions` section
 * composes (Task 12.15). `LiveSessionsService` stays internal: it carries every
 * WRITE path and the YouTube authoring path, and it is reachable only through
 * this module's own admin controller, i.e. only behind `JwtAuthGuard` +
 * `AdminGuard`. Exporting it would let a future consumer create or delete a live
 * session having passed through none of that chain.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    IdentityModule,
    MembershipModule,
    AuditModule,
    YoutubeModule,
  ],
  controllers: [MemberLiveController, AdminLiveSessionsController],
  providers: [
    LiveSessionsService,
    LiveFeedService,
    AdminGuard,
    AdminThrottlerGuard,
  ],
  exports: [LiveFeedService],
})
export class LiveSessionsModule {}
