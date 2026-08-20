import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(JwtAuthGuard.name);

  /**
   * Fixed, non-revealing 401 body for every token-rejection reason.
   *
   * The underlying message comes from JWT verification ('jwt expired',
   * 'invalid signature', 'jwt malformed', …) and leaks token shape, expiry
   * state and signing behaviour to an unauthenticated caller. Per CLAUDE.md,
   * raw `error.message` must never reach a client — the detail is logged
   * server-side instead.
   */
  private static readonly REJECTION_MESSAGE =
    'Authentication failed. Please login again.';

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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Token validation rejected: ${message}`);

      throw new UnauthorizedException(JwtAuthGuard.REJECTION_MESSAGE);
    }
  }
}
