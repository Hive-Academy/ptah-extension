import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '@ptah-api/core';
import { EmailModule } from '@ptah-api/email';

import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  AuthService,
  WorkosUserService,
  JwtTokenService,
  PkceService,
  TicketService,
  MagicLinkService,
  UserSyncService,
} from './services';
import {
  WorkOSClientProvider,
  WORKOS_CLIENT,
} from './providers/workos.provider';

/**
 * Identity Module — authentication, session tokens and authorization guards.
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
 * ⚠️ THIS MODULE DECLARES NO CONTROLLERS, AND THAT IS THE POINT.
 * Its predecessor (`AuthModule`, in the app) declared `AuthController`, which
 * needs `LicenseService` — so `AuthModule` imported `LicenseModule`, while
 * `LicenseModule` imported `AuthModule` for `JwtAuthGuard`. That mutual import
 * survived inside one project behind `forwardRef()`, but Nx forbids a cycle
 * BETWEEN projects, so it had to be cut before identity could become a lib.
 *
 * The cut: identity owns the auth capability and nothing that consumes
 * licensing. `AuthController` stays in the app, where a slimmed `AuthModule`
 * declares it and imports BOTH this module and `LicenseModule`. Licensing then
 * imports this module directly. The result is acyclic in both directions —
 * neither side needs `forwardRef()` any more.
 *
 * When `api-licensing` lands, `AuthController` can move to a thin endpoints lib
 * depending on identity + licensing. Until then the app is that thin layer.
 *
 * **Exports**:
 * - `AuthService`: For authentication operations
 * - `JwtAuthGuard` / `AdminGuard` / `AdminThrottlerGuard`: route protection
 * - `JwtModule`: For services that need JwtService
 * - `WORKOS_CLIENT`: For services that need direct WorkOS access
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
            'JWT_SECRET is not configured. Please set it in your .env file.',
          );
        }

        return {
          secret,
          signOptions: {
            expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ||
              '7d') as never,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [
    WorkOSClientProvider,
    PkceService,
    WorkosUserService,
    JwtTokenService,
    UserSyncService,
    AuthService,
    JwtAuthGuard,
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
export class IdentityModule {}
