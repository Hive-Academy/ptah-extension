import {
  CanActivate,
  ExecutionContext,
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
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Extract JWT token from HTTP-only cookie
    const token = request.cookies?.access_token;

    if (!token) {
      throw new UnauthorizedException(
        'No authentication token provided. Please login.'
      );
    }

    try {
      // Validate token and extract user information
      const user = await this.authService.validateToken(token);

      // ✅ CRITICAL: Attach user to request
      // This makes user context available to:
      // 1. Neo4j security decorators (fixes "No request context" error)
      // 2. ChromaDB @TenantAware decorator (tenant isolation)
      // 3. LangGraph workflow context (user-aware workflows)
      request.user = user;

      return true;
    } catch (error: any) {
      throw new UnauthorizedException(
        `Authentication failed: ${error.message}`
      );
    }
  }
}
