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
 * ⚠️ FIVE CONTROLLERS, TWO SERVICES, ONE MODULE (TASK_2026_170 R2).
 * `AdminController` used to be a single 306-line class carrying four unrelated
 * concerns — generic model CRUD, user administration, licence issuance and
 * waitlist invitation — under `@Controller('v1/admin')` with three `:model`
 * wildcards that contested ten sibling admin routes. The CONTROLLERS split by
 * resource; the MODULE did not, because "the native admin dashboard backend" is
 * genuinely one concern and `AdminService` is shared. The `imports` array is
 * unchanged: it already covered every dependency of every new controller.
 *
 * ⚠️ `WaitlistApprovalService` IS A SECOND SERVICE, NOT A METHOD ON
 * `AdminService`, and that is deliberate. `AdminService` is generic model CRUD
 * plus bulk email over nine Prisma models; the approval orchestrator owns one
 * transactional workflow across four libs (licensing, marketing, community,
 * email) and a five-value outcome taxonomy. Folding it in would give
 * `AdminService` a second reason to change and put a transaction boundary
 * inside a class whose other methods have none.
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
    AdminGuard,
    AdminThrottlerGuard,
  ],
  exports: [AdminThrottlerGuard],
})
export class AdminModule {}
