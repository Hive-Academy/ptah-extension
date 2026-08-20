import { Global, Module } from '@nestjs/common';
import { IdentityModule } from '@ptah-api/identity';
import { MembershipModule } from '@ptah-api/membership';

import { MemberNotificationsController } from './member-notifications.controller';
import { NotificationRetentionService } from './notification-retention.service';
import { NotificationsService } from './notifications.service';

/**
 * `NotificationsModule` — the member-owned in-app inbox (R10, plan §2.7).
 *
 * ── 🔴 WHY THIS ONE IS `@Global()` WHEN `PacksModule` REFUSES TO BE ────────
 * The two decisions look contradictory and are the same decision, applied to
 * opposite shapes.
 *
 * `PacksModule` refuses `@Global()` because `PacksService` has exactly ONE
 * consumer, in its own module, and a global export would make a member-facing
 * injection possible from anywhere — the precise shape that design excludes.
 *
 * `NotificationsService` has FOUR consumers and they live in THREE OTHER LIBS:
 * `forum` (`topic.reply`, `post.child_reply`, `post.accepted`) and `community`
 * (`session_request.status`). An explicit import in each would put an edge from
 * every producer lib into this one on the dependency graph, for a service whose
 * whole public surface is "write one row, unless the actor is the recipient".
 * The rule that makes the global export safe is that this service **grants no
 * authority a producer does not already have** — it writes to a table the
 * producer could write to anyway, and the only thing it adds is the R10.2
 * suppression that producers must not be able to skip.
 *
 * ── ASSUMPTION-19: THIS LIB COPIES NO `common/` HELPERS, AND THAT IS A
 *    DECISION RATHER THAN AN OMISSION ─────────────────────────────────────
 * `forum`, `learning` and `community` each carry their own `member-context.ts`,
 * `admin-audit.ts` and `soft-delete.ts` (ASSUMPTION-11), so the symmetric move
 * would be a fourth set here. There is nothing for them to do:
 *
 *   - **no visibility rule.** A notification is owned by exactly one user and
 *     read by exactly that user. There is no cohort clause, no category gate and
 *     no `buildXVisibilityWhere` — `userId: ctx.userId` IS the whole rule;
 *   - **no soft delete.** `Notification` has no `deletedAt`. Rows leave by the
 *     retention prune (R10.6) and by `onDelete: Cascade` when the recipient's
 *     account goes. A tombstone would be an inbox entry a member cannot dismiss;
 *   - **no admin mutation.** Nothing here is an admin action, so no
 *     `AuditLogService` and no `AuditModule` import. R10 is a member-owned inbox
 *     and there is deliberately no admin surface over it (the contracts lib says
 *     so in terms).
 *
 * `MemberContext` is imported as a TYPE from `@ptah-api/membership`, the way the
 * hub sections do. **Do not add a `common/` directory here by symmetry.**
 *
 * ── WHAT IT EXPORTS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────
 * `NotificationsService` ONLY. Not `PrismaService`, not a `where`-builder, not
 * {@link NotificationRetentionService} — the prune is a global `deleteMany` with
 * no `userId` in its `where`, and a lib that could inject it could delete
 * another member's notifications from a request handler. It is provided so the
 * scheduler can find it and exported to nobody.
 *
 * ── WHY `IdentityModule` AND `MembershipModule` ARE IMPORTED ─────────────
 * A guard named in `@UseGuards(SomeGuard)` is instantiated in the CONSUMING
 * module's injector, so both `JwtAuthGuard` and `MemberGuard` must be resolvable
 * HERE. `MembershipModule` is `@Global()` and would supply `MemberGuard` at app
 * scope anyway; it is imported explicitly so this module also resolves in
 * isolation (`Test.createTestingModule({ imports: [NotificationsModule] })`),
 * which is exactly what `notification-retention.service.spec.ts` does to prove
 * the cron is wired. Neither guard is re-PROVIDED: a second `MemberGuard`
 * declaration would build a second instance resolving entitlement out of a
 * different injector.
 *
 * `PrismaModule` is `@Global()` and needs no import.
 *
 * ── 🔴 `ScheduleModule.forRoot()` IS NOT HERE, AND ITS ABSENCE IS DELIBERATE
 * It is registered ONCE, in `apps/ptah-license-server/src/app/app.module.ts`.
 * `forRoot()` in a lib module that three other libs import globally would
 * register the scheduler root more than once. The cost of putting it in the app
 * is that it can be forgotten, and RISK-AE is precisely that failure — so
 * `notification-retention.service.spec.ts` asserts the job is REGISTERED in a
 * booted `SchedulerRegistry` rather than merely callable.
 */
@Global()
@Module({
  imports: [IdentityModule, MembershipModule],
  controllers: [MemberNotificationsController],
  providers: [NotificationsService, NotificationRetentionService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
