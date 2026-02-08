import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LicenseService } from './services/license.service';
import { LicenseController } from './controllers/license.controller';
import { AdminController } from './controllers/admin.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '../app/auth/auth.module';

/**
 * LicenseModule - License verification and management
 *
 * Provides:
 * - Public license verification endpoint (POST /api/v1/licenses/verify)
 * - Admin license creation endpoint (POST /api/v1/admin/licenses)
 * - License creation service with email integration
 *
 * Dependencies:
 * - PrismaModule (database access)
 * - EmailModule (email delivery via Resend)
 * - ConfigModule (for admin API key validation)
 */
@Module({
  imports: [
    PrismaModule,
    EmailModule,
    ConfigModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [LicenseController, AdminController],
  providers: [LicenseService],
  exports: [LicenseService],
})
export class LicenseModule {}
