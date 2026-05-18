import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../app/auth/auth.module';
import { EmailModule } from '../email/email.module';
import { LicenseModule } from '../license/license.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminThrottlerGuard } from './admin-throttler.guard';
import { AdminService } from './admin.service';

/**
 * AdminModule — native admin dashboard for 6 Prisma models.
 *
 * Imports:
 *   - `ConfigModule` for `AdminGuard`'s `ADMIN_EMAILS` lookup.
 *   - `AuthModule` re-exports `JwtAuthGuard` (used in controller's guard chain).
 *   - `EmailModule` re-exports `EmailService` (used for bulk marketing email).
 *
 * `PrismaModule` is `@Global()` — no import needed here.
 *
 * Leaf module: exports nothing (no other module should consume admin services).
 */
@Module({
  imports: [
    ConfigModule,
    AuthModule,
    EmailModule,
    forwardRef(() => LicenseModule),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard, AdminThrottlerGuard],
  exports: [AdminThrottlerGuard],
})
export class AdminModule {}
