import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IdentityModule } from '@ptah-api/identity';
import { AdminGuard } from '@ptah-api/identity';
import { AdminThrottlerGuard } from '@ptah-api/identity';
import { AdminPacksController } from './admin-packs.controller';
import { PacksService } from './packs.service';

/**
 * PacksModule — the ADMIN-ONLY Builders pack registry (TASK_2026_169).
 *
 * Guard providers (`AdminGuard`, `AdminThrottlerGuard`) are declared locally
 * rather than importing `AdminModule`, to keep the module graph acyclic — both
 * are stateless and only depend on `ConfigService` / the global ThrottlerModule
 * providers. `IdentityModule` supplies `JwtAuthGuard`. This mirrors
 * `MemberGroupsModule` exactly.
 *
 * `PrismaModule` + `AuditModule` are `@Global()` — no import needed here.
 *
 * ⚠️ REGISTRATION ORDER IS LOAD-BEARING. This module MUST appear in
 * `app.module.ts` BEFORE `AdminModule`: `AdminController` is
 * `@Controller('v1/admin')` with `@Get(':model')` / `@Get(':model/:id')`
 * wildcards, and a sibling `@Controller('v1/admin/packs')` only wins the route
 * match when its module is registered first. Registered after, every
 * `/api/v1/admin/packs` request falls through to the generic admin CRUD and
 * 400s with "Unknown admin model: packs". Regression test G3 covers this.
 *
 * ⚠️ NOT `@Global()`, unlike its sibling feature modules. `PacksService` has
 * exactly one consumer — `AdminPacksController`, in this module. Exporting it
 * globally would make a member-facing injection possible from anywhere, which
 * is precisely the shape this design excludes.
 *
 * ⛔ NO MEMBER-FACING CONTROLLER. Distribution happens on GitHub; Ptah stores
 * a bookkeeping row and nothing else. This module injects neither
 * `BuildersMembershipService` nor `MemberGroupsService`. Structural test G6
 * asserts every controller here is mounted under `v1/admin/`.
 */
@Module({
  imports: [ConfigModule, IdentityModule],
  controllers: [AdminPacksController],
  providers: [PacksService, AdminGuard, AdminThrottlerGuard],
})
export class PacksModule {}
