import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { RequestUser } from '../interfaces/request-user.interface';

/**
 * Ptah JWT Authentication Guard
 *
 * Protects portal routes by validating JWT tokens from `ptah_auth` HTTP-only cookie.
 * Used for magic link authentication flow.
 *
 * Difference from JwtAuthGuard:
 * - Checks `ptah_auth` cookie (not `access_token`)
 * - Simplified JWT payload (id, email only - no WorkOS fields)
 * - Used only for portal endpoints (GET /licenses/me)
 * - Fills in default values for tenantId, roles, permissions, tier
 *
 * @example
 * ```typescript
 * @UseGuards(PtahJwtAuthGuard)
 * @Get('me')
 * async getMyLicense(@Req() request: Request) {
 *   const userId = request.user.id;
 *   const email = request.user.email;
 *   // ...
 * }
 * ```
 */
@Injectable()
export class PtahJwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Extract JWT token from ptah_auth HTTP-only cookie
    const token = request.cookies?.ptah_auth;

    if (!token) {
      throw new UnauthorizedException(
        'No authentication token provided. Please login via magic link.'
      );
    }

    try {
      // Validate token and extract user information
      const payload = this.jwtService.verify(token);

      // Attach user to request (fill in RequestUser interface with defaults)
      const user: RequestUser = {
        id: payload.sub,
        email: payload.email,
        tenantId: `user_${payload.sub}`, // User-scoped tenant (no organization)
        roles: ['user'], // Default role
        permissions: ['read:docs'], // Default permissions
        tier: 'free', // Default tier (actual tier determined by license verification)
      };

      request.user = user;

      return true;
    } catch (error: any) {
      throw new UnauthorizedException(
        `Authentication failed: ${error.message}`
      );
    }
  }
}
