import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../app/auth/auth.module';
import { DiscourseController } from './discourse.controller';
import { DiscourseSsoService } from './discourse-sso.service';
import { DiscourseAdminProvider } from './discourse-admin.provider';
import { DiscourseProvisioningService } from './discourse-provisioning.service';

/**
 * DiscourseModule — DiscourseConnect SSO provider + admin group-sync for the
 * paid Builders forum.
 *
 * Declared `@Global()` (mirroring `CircleModule`) so
 * `DiscourseProvisioningService` is injectable into the Paddle webhook fan-out
 * without threading an explicit import through `PaddleModule`.
 *
 * Imports `AuthModule` for `AuthService` (the SSO endpoint validates the
 * ptah_auth JWT cookie to identify the caller).
 *
 * Provides:
 * - `DiscourseSsoService` — pure DiscourseConnect codec (sign/validate).
 * - `DiscourseAdminProvider` — non-throwing admin API client (group sync).
 * - `DiscourseProvisioningService` — best-effort provision/deprovision.
 *
 * Feature-off: when the Discourse env vars are unset the integration no-ops
 * (logged once) and the SSO endpoint rejects with a generic 403.
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule, AuthModule],
  controllers: [DiscourseController],
  providers: [
    DiscourseSsoService,
    DiscourseAdminProvider,
    DiscourseProvisioningService,
  ],
  exports: [DiscourseProvisioningService, DiscourseSsoService],
})
export class DiscourseModule {}
