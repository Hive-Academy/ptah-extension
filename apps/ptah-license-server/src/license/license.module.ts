import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LicenseService } from './services/license.service';
import { LicenseController } from './controllers/license.controller';
import { AdminController } from './controllers/admin.controller';
import { PrismaModule } from '@ptah-api/core';
import { EmailModule } from '@ptah-api/email';
import { IdentityModule } from '@ptah-api/identity';
import { EventsModule } from '../events/events.module';
import { WaitlistModule } from '@ptah-api/marketing';

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
    EventsModule,
    WaitlistModule,
    IdentityModule,
  ],
  controllers: [LicenseController, AdminController],
  providers: [LicenseService],
  exports: [LicenseService],
})
export class LicenseModule {}
