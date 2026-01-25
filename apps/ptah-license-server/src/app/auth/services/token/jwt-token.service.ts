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
   * Generate JWT token from WorkOS user
   */
  generateToken(user: User, organizationId?: string): string {
    const requestUser = this.mapWorkOSUserToRequestUser(user, organizationId);

    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
      sub: requestUser.id,
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
   */
  mapWorkOSUserToRequestUser(user: User, organizationId?: string): RequestUser {
    const roles = this.extractRoles(user);
    const permissions = this.extractPermissions(user, roles);
    const tier = this.determineTier(organizationId);
    const tenantId = organizationId || `user_${user.id}`;

    return {
      id: user.id,
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
