import { Module } from '@nestjs/common';
import { IdentityModule } from '@ptah-api/identity';
import { PrismaModule } from '@ptah-api/core';
import { EmailModule } from '@ptah-api/email';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';

/**
 * SessionModule - Training session request handling
 *
 * Provides:
 * - GET /api/v1/sessions/eligibility (free session check)
 * - POST /api/v1/sessions/request (submit session registration)
 *
 * Dependencies:
 * - IdentityModule (JwtAuthGuard + AuthService)
 * - PrismaModule (database access for SessionRequest)
 * - EmailModule (notification and confirmation emails)
 */
@Module({
  imports: [IdentityModule, PrismaModule, EmailModule],
  controllers: [SessionController],
  providers: [SessionService],
})
export class SessionModule {}
