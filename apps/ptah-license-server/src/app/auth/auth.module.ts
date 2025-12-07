import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './services/auth.service';
import { TicketService } from './services/ticket.service';

/**
 * Authentication Module
 *
 * Provides JWT-based authentication with WorkOS integration.
 *
 * **Features**:
 * - WorkOS AuthKit integration (hosted authentication)
 * - JWT token generation and validation
 * - HTTP-only cookie session management
 * - Request user context injection
 *
 * **Exports**:
 * - `AuthService`: For manual token operations
 * - `JwtAuthGuard`: For protecting routes with `@UseGuards(JwtAuthGuard)`
 *
 * **Usage in other modules**:
 * ```typescript
 * @Module({
 *   imports: [AuthModule],
 *   // ...
 * })
 * export class MyModule {}
 *
 * // In controllers:
 * @UseGuards(JwtAuthGuard)
 * @Get('protected')
 * async protected(@Req() req: Request) {
 *   const userId = req.user.id;
 *   // ...
 * }
 * ```
 */
@Module({
  imports: [
    ConfigModule,
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
  providers: [AuthService, JwtAuthGuard, TicketService],
  exports: [AuthService, JwtAuthGuard, TicketService], // Export for use in other modules
})
export class AuthModule {}
