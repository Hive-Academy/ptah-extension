import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@ptah-api/core';
import { AuthModule } from '../app/auth/auth.module';
import { AdminGuard } from '../admin/admin.guard';
import { AdminThrottlerGuard } from '../admin/admin-throttler.guard';
import { DiscourseController } from './discourse.controller';
import { CommunityController } from './community.controller';
import { AdminCommunityController } from './admin-community.controller';
import { DiscourseSsoService } from './discourse-sso.service';
import { DiscourseAdminProvider } from './discourse-admin.provider';
import { DiscourseProvisioningService } from './discourse-provisioning.service';
import { BuildersMembershipService } from './builders-membership.service';
import { AdminCommunityService } from './admin-community.service';

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
 *
 * TASK_2026_169 adds `AdminCommunityController` — a READ-ONLY admin triage
 * surface — alongside the existing Builders-gated `CommunityController`. The
 * two are co-located on purpose so a reviewer sees both gates in one directory:
 * `CommunityController` requires an active Builders membership,
 * `AdminCommunityController` requires `AdminGuard`. Separate authorized paths;
 * the member gate is untouched.
 *
 * Guard providers (`AdminGuard`, `AdminThrottlerGuard`) are declared LOCALLY
 * rather than by importing `AdminModule`, to keep the module graph acyclic.
 * Mirrors `MemberGroupsModule`. `AdminThrottlerGuard` is registered for
 * consistency with the other feature modules even though the admin community
 * surface is entirely read-only and applies no per-route throttle override.
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule, AuthModule],
  controllers: [
    DiscourseController,
    CommunityController,
    AdminCommunityController,
  ],
  providers: [
    DiscourseSsoService,
    DiscourseAdminProvider,
    DiscourseProvisioningService,
    BuildersMembershipService,
    AdminCommunityService,
    AdminGuard,
    AdminThrottlerGuard,
  ],
  exports: [
    DiscourseProvisioningService,
    DiscourseSsoService,
    BuildersMembershipService,
  ],
})
export class DiscourseModule {}
