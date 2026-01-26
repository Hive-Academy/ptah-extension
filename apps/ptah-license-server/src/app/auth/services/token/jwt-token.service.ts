import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@workos-inc/node';
import type {
  JWTPayload,
  RequestUser,
} from '../../interfaces/request-user.interface';

/**
 * JWT Token Service
 *
 * Single responsibility: JWT token generation and validation.
 * Maps WorkOS users to application RequestUser format.
 */
@Injectable()
export class JwtTokenService {
  constructor(private readonly jwtService: JwtService) {}

  /**
   * Generate JWT token using database user ID
   *
   * The JWT sub claim contains the database UUID (not the WorkOS user ID).
   * This allows downstream services to query the database directly.
   *
   * @param databaseUserId - The database UUID for the user
   * @param workosUser - WorkOS user for extracting roles/permissions
   * @param organizationId - Optional organization ID
   */
  generateToken(
    databaseUserId: string,
    workosUser: User,
    organizationId?: string
  ): string {
    const requestUser = this.mapWorkOSUserToRequestUser(
      workosUser,
      organizationId,
      databaseUserId
    );

    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
      sub: databaseUserId, // Database UUID, NOT WorkOS ID
      email: requestUser.email,
      tenantId: requestUser.tenantId,
      organizationId: requestUser.organizationId,
      roles: requestUser.roles,
      permissions: requestUser.permissions,
      tier: requestUser.tier,
    };

    return this.jwtService.sign(payload);
  }

  /**
   * Generate JWT token from custom payload
   */
  generateTokenFromPayload(payload: Record<string, unknown>): string {
    return this.jwtService.sign(payload);
  }

  /**
   * Validate JWT token and return RequestUser
   */
  validateToken(token: string): RequestUser {
    try {
      const payload = this.jwtService.verify<JWTPayload>(token);

      return {
        id: payload.sub,
        email: payload.email,
        tenantId: payload.tenantId,
        organizationId: payload.organizationId,
        roles: payload.roles,
        permissions: payload.permissions,
        tier: payload.tier,
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Get RequestUser from WorkOS user without generating token
   *
   * @param user - WorkOS user
   * @param organizationId - Optional organization ID
   * @param databaseUserId - Optional database UUID to use instead of WorkOS user ID
   */
  mapWorkOSUserToRequestUser(
    user: User,
    organizationId?: string,
    databaseUserId?: string
  ): RequestUser {
    const roles = this.extractRoles(user);
    const permissions = this.extractPermissions(user, roles);
    const tier = this.determineTier(organizationId);
    // Use database UUID if provided, otherwise fall back to WorkOS ID
    const userId = databaseUserId || user.id;
    const tenantId = organizationId || `user_${userId}`;

    return {
      id: userId,
      email: user.email,
      tenantId,
      organizationId,
      roles,
      permissions,
      tier,
    };
  }

  /**
   * Extract user roles from WorkOS user metadata
   */
  private extractRoles(user: User): string[] {
    const metadata = user.metadata as Record<string, unknown> | undefined;
    if (metadata?.roles && Array.isArray(metadata.roles)) {
      return metadata.roles as string[];
    }
    return ['user'];
  }

  /**
   * Extract permissions based on roles
   */
  private extractPermissions(user: User, roles: string[]): string[] {
    const permissions = new Set<string>();

    if (roles.includes('owner')) {
      permissions.add('admin:tenant');
      permissions.add('write:docs');
      permissions.add('read:docs');
      permissions.add('manage:users');
    } else if (roles.includes('admin')) {
      permissions.add('write:docs');
      permissions.add('read:docs');
      permissions.add('manage:users');
    } else if (roles.includes('user')) {
      permissions.add('read:docs');
      permissions.add('write:docs');
    }

    // Add custom permissions from metadata
    const metadata = user.metadata as Record<string, unknown> | undefined;
    if (metadata?.permissions && Array.isArray(metadata.permissions)) {
      (metadata.permissions as string[]).forEach((p) => permissions.add(p));
    }

    return Array.from(permissions);
  }

  /**
   * Determine subscription tier
   */
  private determineTier(
    organizationId?: string
  ): 'free' | 'pro' | 'enterprise' {
    // TODO: Implement tier lookup from database
    return organizationId ? 'pro' : 'free';
  }
}
