import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../app/auth/auth.module';
import { AdminGuard } from '../admin/admin.guard';
import { AdminThrottlerGuard } from '../admin/admin-throttler.guard';
import { MemberGroupsController } from './member-groups.controller';
import { MemberGroupsService } from './member-groups.service';

/**
 * MemberGroupsModule — member cohort (group) CRUD + assignment.
 *
 * Declared `@Global()` so `MemberGroupsService` is injectable into the Paddle
 * provisioning fan-out, the Discourse provisioning extension, the license
 * `/me` endpoint, the members-area endpoint, and the admin stats surface
 * WITHOUT threading explicit imports through each module.
 *
 * Guard providers (`AdminGuard`, `AdminThrottlerGuard`) are declared locally
 * (rather than importing `AdminModule`) to keep the module graph acyclic —
 * both are stateless and only depend on `ConfigService` / the global
 * ThrottlerModule providers. `AuthModule` supplies `JwtAuthGuard`.
 *
 * `PrismaModule` + `AuditModule` are `@Global()` — no import needed here.
 */
@Global()
@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [MemberGroupsController],
  providers: [MemberGroupsService, AdminGuard, AdminThrottlerGuard],
  exports: [MemberGroupsService],
})
export class MemberGroupsModule {}
