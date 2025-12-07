import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { WorkOS } from '@workos-inc/node';
import type {
  JWTPayload,
  RequestUser,
} from '../interfaces/request-user.interface';

@Injectable()
export class AuthService {
  private readonly workos: WorkOS;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {
    const apiKey = this.configService.get<string>('WORKOS_API_KEY');
    if (!apiKey) {
      throw new Error(
        'WORKOS_API_KEY is not configured. Please set it in your .env file.'
      );
    }
    this.workos = new WorkOS(apiKey);
  }

  /**
   * Generate WorkOS authorization URL for login redirect
   */
  async getAuthorizationUrl(): Promise<string> {
    const clientId = this.configService.get<string>('WORKOS_CLIENT_ID');
    const redirectUri = this.configService.get<string>('WORKOS_REDIRECT_URI');

    if (!clientId || !redirectUri) {
      throw new Error(
        'WORKOS_CLIENT_ID and WORKOS_REDIRECT_URI must be configured'
      );
    }

    return this.workos.userManagement.getAuthorizationUrl({
      provider: 'authkit',
      clientId,
      redirectUri,
    });
  }

  /**
   * Authenticate user with WorkOS authorization code
   * and generate JWT token
   */
  async authenticateWithCode(
    code: string
  ): Promise<{ token: string; user: RequestUser }> {
    const clientId = this.configService.get<string>('WORKOS_CLIENT_ID');

    if (!clientId) {
      throw new UnauthorizedException('WorkOS client ID not configured');
    }

    try {
      // Exchange code for user information
      const { user, organizationId } =
        await this.workos.userManagement.authenticateWithCode({
          clientId,
          code,
        });

      // Map WorkOS user to RequestUser
      const requestUser: RequestUser = this.mapWorkOSUserToRequestUser(
        user,
        organizationId
      );

      // Generate JWT token
      const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
        sub: requestUser.id,
        email: requestUser.email,
        tenantId: requestUser.tenantId,
        organizationId: requestUser.organizationId,
        roles: requestUser.roles,
        permissions: requestUser.permissions,
        tier: requestUser.tier,
      };

      const token = this.jwtService.sign(payload);

      return { token, user: requestUser };
    } catch (error: any) {
      throw new UnauthorizedException(
        `Authentication failed: ${error.message}`
      );
    }
  }

  /**
   * Validate JWT token and return user information
   */
  async validateToken(token: string): Promise<RequestUser> {
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
    } catch (error: any) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Map WorkOS user to application RequestUser
   * Extracts roles, permissions, and tier from WorkOS user data
   */
  private mapWorkOSUserToRequestUser(
    user: any,
    organizationId?: string
  ): RequestUser {
    // Extract roles from WorkOS user metadata or default to 'user'
    const roles = this.extractRoles(user);

    // Extract permissions from roles or user metadata
    const permissions = this.extractPermissions(user, roles);

    // Determine subscription tier
    const tier = this.determineTier(organizationId);

    // Use organizationId as tenantId, or create user-scoped tenant
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
   * Extract user roles from WorkOS user object
   * Override this method to implement custom role extraction logic
   */
  private extractRoles(user: any): string[] {
    // Check user metadata for roles
    if (user.metadata?.roles && Array.isArray(user.metadata.roles)) {
      return user.metadata.roles;
    }

    // Default role
    return ['user'];
  }

  /**
   * Extract permissions based on roles and user data
   * Override this method to implement custom permission logic
   */
  private extractPermissions(user: any, roles: string[]): string[] {
    const permissions: Set<string> = new Set();

    // Role-based permissions
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

    // Add custom permissions from user metadata
    if (
      user.metadata?.permissions &&
      Array.isArray(user.metadata.permissions)
    ) {
      user.metadata.permissions.forEach((p: string) => permissions.add(p));
    }

    return Array.from(permissions);
  }

  /**
   * Determine subscription tier based on organization
   * Override this method to implement custom tier logic (e.g., query from database)
   */
  private determineTier(
    organizationId?: string
  ): 'free' | 'pro' | 'enterprise' {
    // TODO: Implement tier lookup from database or WorkOS organization metadata
    // For now, default to 'pro' for organizations, 'free' for individual users
    return organizationId ? 'pro' : 'free';
  }
}
