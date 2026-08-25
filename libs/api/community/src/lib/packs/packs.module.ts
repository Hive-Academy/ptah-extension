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
 * is precisely the shape this design excludes. Phase 5 made that refusal MORE
 * valuable, not less: now that a member surface for this table exists, "the
 * admin service is not reachable from it" is a fact the module graph enforces
 * rather than a convention.
 *
 * ⛔ NO MEMBER-FACING CONTROLLER IN THIS MODULE. Structural test G6 asserts
 * every controller here is mounted under `v1/admin/`, and Phase 5 did NOT
 * weaken it. `GET /v1/members/packs` is served by `MemberPacksController` in
 * `MemberPacksModule` — same directory, different module, its own
 * `MemberPacksService` whose only dependency is `PrismaService`. Nothing here
 * imports that module and nothing there imports this one.
 *
 * Distribution still happens on GitHub; Ptah stores a bookkeeping row and
 * provisions no access (R5.7). This module injects neither `MembershipService`
 * nor `MemberGroupsService`.
 */
@Module({
  imports: [ConfigModule, IdentityModule],
  controllers: [AdminPacksController],
  providers: [PacksService, AdminGuard, AdminThrottlerGuard],
})
export class PacksModule {}
