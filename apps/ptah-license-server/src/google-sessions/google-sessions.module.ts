import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../app/auth/auth.module';
import { AdminGuard } from '../admin/admin.guard';
import { AdminThrottlerGuard } from '../admin/admin-throttler.guard';
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
 * Imports `AuthModule` for `JwtAuthGuard` (the members endpoint requires the
 * ptah_auth cookie).
 *
 * Feature-off: when GOOGLE_OAUTH_* are unset the integration no-ops (logged
 * once) — the members endpoint still returns `{ sessions: [], communityUrl }`
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
  imports: [ConfigModule, PrismaModule, AuthModule],
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
