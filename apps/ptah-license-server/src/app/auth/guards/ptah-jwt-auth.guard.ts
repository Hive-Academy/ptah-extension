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
 * Protects portal routes by validating JWT tokens from HTTP-only cookies.
 * Accepts BOTH authentication methods for maximum flexibility.
 *
 * Supported Authentication Methods:
 * 1. Magic Link Flow → `ptah_auth` cookie
 * 2. WorkOS OAuth Flow → `access_token` cookie
 * 3. Email/Password Flow → `access_token` cookie
 * 4. Direct OAuth (Google/GitHub) → `access_token` cookie
 *
 * Why Two Cookies?
 * - `ptah_auth`: Set by magic link verification (simple portal auth)
 * - `access_token`: Set by WorkOS OAuth, email/password, or direct OAuth
 * - This guard checks BOTH to allow users to access the portal regardless
 *   of how they logged in
 *
 * Difference from JwtAuthGuard:
 * - Accepts both `ptah_auth` and `access_token` cookies (JwtAuthGuard only checks `access_token`)
 * - Simplified JWT payload (id, email only - no WorkOS fields)
 * - Used for customer portal endpoints (GET /api/v1/licenses/me)
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

    // Extract JWT token from HTTP-only cookies
    // Try ptah_auth first (magic link flow), then access_token (OAuth/email flow)
    // This allows the customer portal to work with ANY authentication method
    const token = request.cookies?.ptah_auth || request.cookies?.access_token;

    if (!token) {
      throw new UnauthorizedException(
        'No authentication token provided. Please login to access your account.'
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
