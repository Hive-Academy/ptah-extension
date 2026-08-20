import { Module } from '@nestjs/common';
import { IdentityModule } from '@ptah-api/identity';
import { MembershipModule } from '@ptah-api/membership';

import { MemberPacksController } from './member-packs.controller';
import { MemberPacksService } from './member-packs.service';

/**
 * `MemberPacksModule` — the member-facing half of the pack registry
 * (TASK_2026_177 Phase 5, R5.1, R5.3, plan §2.9/§3.6).
 *
 * ── 🔴 WHY THIS IS A SEPARATE MODULE FROM `PacksModule` (RISK-AG) ──────────
 * `member-packs.{controller,service}.ts` live in the SAME DIRECTORY as the
 * admin pack files, because the plan's file layout groups the table's two
 * surfaces together. A directory is not a module. `admin-guards.spec.ts` G6
 * asserts that every controller registered in `PacksModule` is mounted under
 * `v1/admin/`, and `MemberPacksController` is mounted at `v1/members/packs` —
 * so registering it there would fail G6, and G6 is the executable form of the
 * decision that packs may never acquire a member endpoint by accident. Phase 5
 * gives packs a member endpoint DELIBERATELY, by adding a second module, which
 * leaves G6 true and unweakened rather than negotiated. **Co-location is not
 * co-registration**, and `admin-guards.spec.ts` G6 is the test that proves it.
 *
 * ── IT IMPORTS NOTHING FROM `PacksModule`, IN EITHER DIRECTION ─────────────
 * No import edge exists between the two modules and none may be added.
 * `PacksModule` refuses `@Global()` precisely so `PacksService` — which owns
 * every pack MUTATION and writes the audit rows — is unreachable from a
 * member-facing injector. This module provides its OWN `MemberPacksService`,
 * whose only dependency is `PrismaService` and whose absent dependencies
 * (`CohortResolver`, `MembershipService`, `MemberGroupsService`) are asserted as
 * source text in `member-packs.service.spec.ts`.
 *
 * ── THIS MODULE IS NOT `@Global()` EITHER ─────────────────────────────────
 * For the same reason `PacksModule` is not: a global export would make the
 * member read path injectable from ANYWHERE, which is the thing that must stay
 * impossible. What it does instead is EXPORT `MemberPacksService` to modules
 * that import this one explicitly — today exactly one, `MemberHubModule`.
 *
 * 🔴 CORRECTION, TASK 14.16 (disclosed rather than silently overwritten). This
 * paragraph previously said the hub's `packs` section would read the table
 * "through its own resolver, not by injecting this service". That was written
 * before the section existed and it is the WRONG design, for the reason
 * exit-gate clause 1 exists: `toMemberPack` — the explicit-field mapper that
 * makes `notes` structurally unable to reach a member — lives inside this
 * service. A hub resolver with its own `prisma.pack.findMany` would need its own
 * `where` AND its own mapper, giving `memberVisible: true` two homes and NFR-S5
 * two places to leak from. The repo already settled this shape elsewhere:
 * `CommunitySection` injects `TopicsReadService` and `LearningSection` injects
 * `CourseReadService`, each exported for the hub and for nothing else, and
 * neither section touches Prisma.
 *
 * The property the old paragraph was protecting is unharmed. An explicit export
 * to an explicitly-importing module is VISIBLE on the dependency graph and in
 * `member-hub.module.ts`'s import list; the module is still not `@Global()`, so
 * nothing acquires this service by accident. And the hub controller sits behind
 * the same `JwtAuthGuard` + `MemberGuard` chain this module's own controller
 * does — the read is not escaping a gate, it is arriving through a second one.
 *
 * ── WHY BOTH `IdentityModule` AND `MembershipModule` ARE IMPORTED ────────
 * A guard named in `@UseGuards(SomeGuard)` is instantiated in the CONSUMING
 * module's injector, so `JwtAuthGuard` and `MemberGuard` must both be resolvable
 * HERE. `MembershipModule` is `@Global()` and would supply `MemberGuard` at app
 * scope anyway; importing it explicitly keeps this module resolvable in
 * isolation, which is what `ForumModule` does for the identical reason.
 *
 * 🔴 NEITHER GUARD IS RE-PROVIDED. A second `MemberGuard` declaration would
 * build a SECOND instance resolving entitlement out of a different injector —
 * the asymmetry with `AdminGuard` (which every admin module DOES re-declare) is
 * real, and `forum.module.spec.ts` pins it.
 *
 * `PrismaModule` is `@Global()`, so it needs no import either. `AuditModule` is
 * not imported at all — a read is not an admin action and writes no audit row.
 */
@Module({
  imports: [IdentityModule, MembershipModule],
  controllers: [MemberPacksController],
  providers: [MemberPacksService],
  // ONE export, to ONE importer (`MemberHubModule`, Task 14.16). See the
  // docblock: the mapper that drops `notes` lives in this service, so a second
  // reader of the `packs` table would be a second place NFR-S5 can fail.
  exports: [MemberPacksService],
})
export class MemberPacksModule {}
