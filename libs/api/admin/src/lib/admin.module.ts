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
import { AdminGuard } from '@ptah-api/identity';
import { AdminThrottlerGuard } from '@ptah-api/identity';
import { AdminService } from './admin.service';

/**
 * AdminModule — native admin dashboard for 6 Prisma models.
 *
 * Imports:
 *   - `ConfigModule` for `AdminGuard`'s `ADMIN_EMAILS` lookup.
 *   - `IdentityModule` re-exports `JwtAuthGuard` (used in controller's guard chain).
 *   - `EmailModule` re-exports `EmailService` (used for bulk marketing email).
 *   - `WaitlistModule` re-exports `WaitlistService` (waitlist stamps).
 *   - `forwardRef(() => LicenseModule)` for `LicenseService` (complimentary
 *     licences) — circular because `LicenseModule` consumes `AdminThrottlerGuard`.
 *
 * `PrismaModule` and `AuditModule` are `@Global()` — no import needed here.
 *
 * ⚠️ `WaitlistModule` CURRENTLY HAS NO CONSUMER IN THIS MODULE and is retained
 * deliberately. TASK_2026_201 deleted `AdminWaitlistController` (the invite
 * wave, context.md C2) ahead of the approve endpoint that replaces it; the
 * replacement `WaitlistApprovalService` injects `WaitlistService`, so dropping
 * the import here would only be re-added by the very next batch. A module
 * import with no current injector is inert, not an error.
 *
 * ⚠️ FOUR CONTROLLERS, ONE SERVICE, ONE MODULE (TASK_2026_170 R2; was FIVE
 * until TASK_2026_201 deleted the waitlist-invite controller).
 * `AdminController` used to be a single 306-line class carrying four unrelated
 * concerns — generic model CRUD, user administration, licence issuance and
 * waitlist invitation — under `@Controller('v1/admin')` with three `:model`
 * wildcards that contested ten sibling admin routes. The CONTROLLERS split by
 * resource; the MODULE did not, because "the native admin dashboard backend" is
 * genuinely one concern and `AdminService` is shared. The `imports` array is
 * unchanged: it already covered every dependency of every new controller.
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
  ],
  providers: [AdminService, AdminGuard, AdminThrottlerGuard],
  exports: [AdminThrottlerGuard],
})
export class AdminModule {}
