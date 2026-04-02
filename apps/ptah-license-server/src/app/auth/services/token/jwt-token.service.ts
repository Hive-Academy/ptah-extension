import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@workos-inc/node';
import type {
  JWTPayload,
  RequestUser,
} from '../../interfaces/request-user.interface';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Valid roles that can be assigned via WorkOS metadata.
 * 'owner' is intentionally excluded — owner status must be determined server-side,
 * not via user-writable metadata, to prevent privilege escalation.
 */
const VALID_ROLES = ['user', 'admin'] as const;
type ValidRole = (typeof VALID_ROLES)[number];

/**
 * Server-side permission mapping per role.
 * Permissions are NEVER read from user metadata to prevent injection attacks.
 */
const ROLE_PERMISSIONS: Record<ValidRole, string[]> = {
  user: ['read:docs', 'write:docs'],
  admin: ['read:docs', 'write:docs', 'manage:users'],
};

/**
 * JWT Token Service
 *
 * Single responsibility: JWT token generation and validation.
 * Maps WorkOS users to application RequestUser format.
 */
@Injectable()
export class JwtTokenService {
  private readonly logger = new Logger(JwtTokenService.name);

  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

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
  async generateToken(
    databaseUserId: string,
    workosUser: User,
    organizationId?: string,
  ): Promise<string> {
    const requestUser = await this.mapWorkOSUserToRequestUser(
      workosUser,
      organizationId,
      databaseUserId,
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
  async mapWorkOSUserToRequestUser(
    user: User,
    organizationId?: string,
    databaseUserId?: string,
  ): Promise<RequestUser> {
    const roles = this.extractValidatedRoles(user);
    const permissions = this.derivePermissionsFromRoles(roles);
    // Use database UUID if provided, otherwise fall back to WorkOS ID
    const userId = databaseUserId || user.id;
    const tier = await this.determineTier(userId);
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
   * Extract and validate user roles from WorkOS user metadata.
   *
   * SECURITY FIX (TASK_2025_188): WorkOS user metadata is writable by org admins,
   * so we filter roles against a server-side allowlist. The 'owner' role is
   * intentionally excluded from VALID_ROLES to prevent privilege escalation
   * via metadata manipulation.
   */
  private extractValidatedRoles(user: User): string[] {
    const metadata = user.metadata as Record<string, unknown> | undefined;
    const rawRoles =
      metadata?.['roles'] && Array.isArray(metadata['roles'])
        ? (metadata['roles'] as string[])
        : ['user'];

    // Filter against allowlist — reject any role not in VALID_ROLES
    const validatedRoles = rawRoles.filter((role): role is ValidRole =>
      (VALID_ROLES as readonly string[]).includes(role),
    );

    // Ensure at least the default 'user' role
    if (validatedRoles.length === 0) {
      validatedRoles.push('user');
    }

    return validatedRoles;
  }

  /**
   * Derive permissions purely from validated roles using a server-side mapping.
   *
   * SECURITY FIX (TASK_2025_188): Permissions are NEVER read from user metadata.
   * This prevents attackers from injecting arbitrary permissions via WorkOS
   * metadata fields.
   */
  private derivePermissionsFromRoles(roles: string[]): string[] {
    const permissions = new Set<string>();

    for (const role of roles) {
      const rolePerms = ROLE_PERMISSIONS[role as ValidRole];
      if (rolePerms) {
        for (const perm of rolePerms) {
          permissions.add(perm);
        }
      }
    }

    return Array.from(permissions);
  }

  /**
   * Determine subscription tier from the database.
   *
   * SECURITY FIX (TASK_2025_188): Looks up the user's actual license and
   * subscription records instead of hardcoding tier based on organizationId.
   *
   * TASK_2025_128: Freemium model (Community + Pro)
   * - 'community': Free tier (always valid, no active license)
   * - 'pro': Active Pro subscription
   * - 'trial_pro': Pro plan during 30-day trial
   * - 'expired': License revoked or subscription past_due/canceled
   */
  private async determineTier(
    databaseUserId: string,
  ): Promise<'community' | 'pro' | 'trial_pro' | 'expired'> {
    // Check for an active subscription first (most authoritative source)
    // NOTE: DB errors are intentionally NOT caught here — a Pro user should
    // never silently degrade to 'community' on a transient DB failure.
    // Let the error propagate so the auth flow returns 500 and the user retries.
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId: databaseUserId,
        status: { in: ['active', 'trialing', 'past_due'] },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (subscription) {
      if (subscription.status === 'trialing') {
        return 'trial_pro';
      }
      if (subscription.status === 'past_due') {
        return 'expired';
      }
      // status === 'active'
      return 'pro';
    }

    // Fall back to license record if no subscription found
    const license = await this.prisma.license.findFirst({
      where: {
        userId: databaseUserId,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (license) {
      if (license.status === 'active' && license.plan === 'pro') {
        // Check if license has expired by date
        if (license.expiresAt && license.expiresAt < new Date()) {
          return 'expired';
        }
        return 'pro';
      }
      if (
        license.status === 'revoked' ||
        license.status === 'expired' ||
        license.status === 'paused'
      ) {
        return 'expired';
      }
      // Active community license
      if (license.status === 'active' && license.plan === 'community') {
        return 'community';
      }
    }

    // No subscription or license found — default to community (free tier)
    return 'community';
  }
}
