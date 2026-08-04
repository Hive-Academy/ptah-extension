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
 */
@Global()
@Module({
  // EmailModule supplies the session-welcome mail sent to a newly provisioned
  // member. It is imported (not relied on globally) because EmailModule is not
  // @Global(); `SessionsService` still injects it @Optional() so a deployment
  // without Resend configured degrades to "no welcome sent" rather than to a
  // failed provisioning.
  imports: [ConfigModule, PrismaModule, IdentityModule, EmailModule],
  controllers: [MembersController, AdminSessionsController],
  providers: [
    GoogleAuthProvider,
    GoogleCalendarProvider,
    SessionsService,
    AdminSessionsService,
    AdminGuard,
    AdminThrottlerGuard,
  ],
  exports: [SessionsService],
})
export class GoogleSessionsModule {}
