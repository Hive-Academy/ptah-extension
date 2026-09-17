import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IdentityModule } from '@ptah-api/identity';
import { EmailModule } from '@ptah-api/email';
import { LicenseModule } from '@ptah-api/licensing';
import { WaitlistModule } from '@ptah-api/marketing';
import { AdminLicensesController } from './admin-licenses.controller';
import { AdminRecordsController } from './admin-records.controller';
import { AdminStatsController } from './admin-stats.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminWaitlistController } from './admin-waitlist.controller';
import { AdminGuard } from '@ptah-api/identity';
import { AdminThrottlerGuard } from '@ptah-api/identity';
import { AdminService } from './admin.service';
import { AdminWaitlistService } from './admin-waitlist.service';
import { WaitlistApprovalService } from './waitlist-approval/waitlist-approval.service';

/**
 * AdminModule — native admin dashboard for 6 Prisma models.
 *
 * Imports:
 *   - `ConfigModule` for `AdminGuard`'s `ADMIN_EMAILS` lookup.
 *   - `IdentityModule` re-exports `JwtAuthGuard` (used in controller's guard chain).
 *   - `EmailModule` re-exports `EmailService` (bulk marketing email, and the
 *     founding-cohort welcome sent after each approval).
 *   - `WaitlistModule` re-exports `WaitlistService` (waitlist stamps and the
 *     `tx`-aware approval claim).
 *   - `forwardRef(() => LicenseModule)` for `LicenseService` (complimentary
 *     licences) — circular because `LicenseModule` consumes `AdminThrottlerGuard`.
 *
 * `PrismaModule`, `AuditModule` and `MemberGroupsModule` are `@Global()` — no
 * import needed here, which is why `WaitlistApprovalService` can inject
 * `MemberGroupsService` with no new module edge.
 *
 * ⚠️ FIVE CONTROLLERS, THREE SERVICES, ONE MODULE.
 * Controllers split by resource; the module provides AdminService (generic CRUD),
 * WaitlistApprovalService (founding cohort grant mutation orchestration), and
 * AdminWaitlistService (pipeline list, eligible-ids, CSV export, details).
 *
 * Leaf module: exports only `AdminThrottlerGuard` (consumed by sibling admin
 * surfaces in other modules).
 */
@Module({
  imports: [
    ConfigModule,
    IdentityModule,
    EmailModule,
    WaitlistModule,
    forwardRef(() => LicenseModule),
  ],
  controllers: [
    AdminRecordsController,
    AdminUsersController,
    AdminStatsController,
    AdminLicensesController,
    AdminWaitlistController,
  ],
  providers: [
    AdminService,
    WaitlistApprovalService,
    AdminWaitlistService,
    AdminGuard,
    AdminThrottlerGuard,
  ],
  exports: [AdminThrottlerGuard],
})
export class AdminModule {}
