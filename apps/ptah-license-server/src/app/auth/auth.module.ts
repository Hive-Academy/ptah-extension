import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
// Services
import {
  AuthService,
  WorkosUserService,
  JwtTokenService,
  PkceService,
  TicketService,
  MagicLinkService,
  UserSyncService,
} from './services';
// Infrastructure
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../../email/email.module';
import {
  WorkOSClientProvider,
  WORKOS_CLIENT,
} from './providers/workos.provider';

/**
 * Authentication Module
 *
 * Provides JWT-based authentication with WorkOS integration.
 *
 * **Architecture** (Single Responsibility Services):
 * - `PkceService`: OAuth 2.1 PKCE state management
 * - `WorkosUserService`: WorkOS User Management API operations
 * - `JwtTokenService`: JWT generation and validation
 * - `UserSyncService`: Database synchronization
 * - `AuthService`: Orchestrator that coordinates the above
 *
 * **Features**:
 * - WorkOS AuthKit integration (hosted authentication)
 * - Email/password authentication with email verification
 * - OAuth (GitHub, Google) authentication
 * - Magic link passwordless authentication
 * - JWT token generation and validation
 * - HTTP-only cookie session management
 *
 * **Exports**:
 * - `AuthService`: For authentication operations
 * - `JwtAuthGuard`: For protecting routes with `@UseGuards(JwtAuthGuard)`
 * - `JwtModule`: For services that need JwtService
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    EmailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error(
            'JWT_SECRET is not configured. Please set it in your .env file.'
          );
        }

        return {
          secret,
          signOptions: {
            expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ||
              '7d') as any,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    // WorkOS Client
    WorkOSClientProvider,
    // Auth Services (ordered by dependency)
    PkceService,
    WorkosUserService,
    JwtTokenService,
    UserSyncService,
    AuthService,
    // Guards
    JwtAuthGuard,
    // Other Services
    TicketService,
    MagicLinkService,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    TicketService,
    MagicLinkService,
    JwtModule, // Required for guards that depend on JwtService
    WORKOS_CLIENT, // Export for services that need direct WorkOS access
  ],
})
export class AuthModule {}
