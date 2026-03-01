import { Module } from '@nestjs/common';
import { AuthModule } from '../app/auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
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
 * - AuthModule (JwtAuthGuard + AuthService)
 * - PrismaModule (database access for SessionRequest)
 * - EmailModule (notification and confirmation emails)
 */
@Module({
  imports: [AuthModule, PrismaModule, EmailModule],
  controllers: [SessionController],
  providers: [SessionService],
})
export class SessionModule {}
