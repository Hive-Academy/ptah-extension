import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IdentityModule } from '@ptah-api/identity';
import { EmailModule } from '@ptah-api/email';
import { LicenseModule } from '../license/license.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { AdminLicensesController } from './admin-licenses.controller';
import { AdminRecordsController } from './admin-records.controller';
import { AdminStatsController } from './admin-stats.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminWaitlistController } from './admin-waitlist.controller';
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
 *   - `WaitlistModule` re-exports `WaitlistService` (invite waves).
 *   - `forwardRef(() => LicenseModule)` for `LicenseService` (complimentary
 *     licences) — circular because `LicenseModule` consumes `AdminThrottlerGuard`.
 *
 * `PrismaModule` and `AuditModule` are `@Global()` — no import needed here.
 *
 * ⚠️ FIVE CONTROLLERS, ONE SERVICE, ONE MODULE (TASK_2026_170 R2).
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
    AdminWaitlistController,
    AdminLicensesController,
  ],
  providers: [AdminService, AdminGuard, AdminThrottlerGuard],
  exports: [AdminThrottlerGuard],
})
export class AdminModule {}
