import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@ptah-api/core';
import { EmailModule } from '@ptah-api/email';
import { IdentityModule } from '@ptah-api/identity';
import { AdminGuard } from '@ptah-api/identity';
import { AdminThrottlerGuard } from '@ptah-api/identity';
import { GoogleAuthProvider } from './google-auth.provider';
import { GoogleCalendarProvider } from './google-calendar.provider';
import { SessionsService } from './sessions.service';
import { AdminSessionsService } from './admin-sessions.service';
import { MembersController } from './members.controller';
import { AdminSessionsController } from './admin-sessions.controller';
import { SessionRequestsService } from './session-requests.service';
import { AdminSessionRequestsController } from './admin-session-requests.controller';
import { MemberSessionRequestsController } from './member-session-requests.controller';

/**
 * GoogleSessionsModule — Google Calendar/Meet "Builders sessions" integration.
 *
 * Declared `@Global()` (mirroring `CircleModule`/`AuditModule`) so
 * `SessionsService` is injectable into the Paddle webhook fan-out without
 * threading an explicit import through `PaddleModule`. `AuditLogService` is
 * already globally available via `AuditModule`.
 *
 * Imports `IdentityModule` for `JwtAuthGuard` (the members endpoint requires the
 * ptah_auth cookie).
 *
 * Feature-off: when GOOGLE_OAUTH_* are unset the integration no-ops (logged
 * once) — the members endpoint still returns `{ sessions: [], memberGroups }`
 * and the provisioning fan-out skips attendance cleanly.
 *
 * TASK_2026_169 adds the ADMIN write path (`AdminSessionsController` +
 * `AdminSessionsService`) alongside the existing member read path. The two
 * controllers live side by side on purpose: `MembersController` is gated on an
 * active Builders membership, `AdminSessionsController` on `AdminGuard`. They
 * are separate authorized paths — neither delegates to the other, and the
 * member gate is untouched by this feature.
 *
 * Guard providers (`AdminGuard`, `AdminThrottlerGuard`) are declared LOCALLY
 * rather than by importing `AdminModule`, to keep the module graph acyclic —
 * both are stateless and depend only on `ConfigService` / the global
 * ThrottlerModule providers. Mirrors `MemberGroupsModule`.
 *
 * ── TASK_2026_177 PHASE 4: THE PRIVATE-SESSION HALF LANDS HERE ─────────────
 *
 * `SessionRequestsService` plus `MemberSessionRequestsController`
 * (`v1/members/session-requests`) and `AdminSessionRequestsController`
 * (`v1/admin/session-requests`) join the module rather than forming one of their
 * own, and that is AD-6 read literally: R4 extends `SessionRequest` and the
 * Calendar WRITE path this module already owns. A separate module would need its
 * own `GoogleCalendarProvider` — one integration with two owners, therefore two
 * `loggedDisabled` flags, two abort budgets and two places to change a scope.
 *
 * ⚠️ THE LIVE-SESSION HALF IS **NOT** HERE. `LiveSessionsModule` owns
 * `v1/members/live` and `v1/admin/live-sessions`, because a `LiveSession` is a
 * row of ours that merely MAY claim a Calendar event; it needs Prisma and
 * `@ptah-api/youtube` and does not need this module's provider at all. It reads
 * `SessionsService` through the `@Global()` export below, `@Optional()`, so an
 * unregistered module degrades its `calendarAvailable` flag rather than failing
 * to construct.
 *
 * ⚠️ `MemberGuard` IS NOT DECLARED HERE. The two new member routes use it, and
 * `MembershipModule` is `@Global()` and exports it — a second declaration would
 * resolve entitlement out of a different injector.
 *
 * ⚠️ `NotificationsModule` IS DELIBERATELY ABSENT (RISK-L). `libs/api/notifications`
 * does not exist until Batch 14, which owns R10.1's `session_request.status`
 * producer. Importing it now gives an unresolvable module and a red
 * `app.module.spec.ts`. The absence is a decision, not an oversight.
 */
@Global()
@Module({
  // EmailModule supplies the session-welcome mail sent to a newly provisioned
  // member. It is imported (not relied on globally) because EmailModule is not
  // @Global(); `SessionsService` still injects it @Optional() so a deployment
  // without Resend configured degrades to "no welcome sent" rather than to a
  // failed provisioning.
  imports: [ConfigModule, PrismaModule, IdentityModule, EmailModule],
  controllers: [
    MembersController,
    AdminSessionsController,
    MemberSessionRequestsController,
    AdminSessionRequestsController,
  ],
  providers: [
    GoogleAuthProvider,
    GoogleCalendarProvider,
    SessionsService,
    AdminSessionsService,
    SessionRequestsService,
    AdminGuard,
    AdminThrottlerGuard,
  ],
  // `SessionRequestsService` is exported so Task 12.15's hub section can read a
  // member's next ACCEPTED private session. It is a READ the section needs; the
  // three mutations on it are reachable only through this module's own
  // AdminGuard-gated controller.
  exports: [SessionsService, SessionRequestsService],
})
export class GoogleSessionsModule {}
