import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../services/auth.service';

/**
 * JWT Authentication Guard
 *
 * Protects routes by validating JWT tokens from HTTP-only cookies.
 * Attaches validated user information to the request object.
 *
 * Uses unified `ptah_auth` cookie for all authentication methods:
 * - OAuth (GitHub, Google)
 * - Email/password login
 * - Magic link login
 *
 * **CRITICAL**: This guard populates `request.user` which is required by:
 * - Neo4j security decorators (`@RequireAuth`, `@TenantIsolation`)
 * - ChromaDB `@TenantAware` decorator
 * - LangGraph workflow context injection
 *
 * @example
 * ```typescript
 * @UseGuards(JwtAuthGuard)
 * @Get('protected-route')
 * async protectedRoute(@Req() request: Request) {
 *   const userId = request.user.id;
 *   const tenantId = request.user.tenantId;
 *   // ...
 * }
 * ```
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.['ptah_auth'];

    if (!token) {
      throw new UnauthorizedException(
        'No authentication token provided. Please login.',
      );
    }

    try {
      const user = await this.authService.validateToken(token);
      request.user = user;

      return true;
    } catch (error: any) {
      throw new UnauthorizedException(
        `Authentication failed: ${error.message}`,
      );
    }
  }
}
