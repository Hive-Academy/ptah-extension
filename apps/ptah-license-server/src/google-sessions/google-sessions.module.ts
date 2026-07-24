import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../app/auth/auth.module';
import { GoogleAuthProvider } from './google-auth.provider';
import { GoogleCalendarProvider } from './google-calendar.provider';
import { SessionsService } from './sessions.service';
import { MembersController } from './members.controller';

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
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule, AuthModule],
  controllers: [MembersController],
  providers: [GoogleAuthProvider, GoogleCalendarProvider, SessionsService],
  exports: [SessionsService],
})
export class GoogleSessionsModule {}
