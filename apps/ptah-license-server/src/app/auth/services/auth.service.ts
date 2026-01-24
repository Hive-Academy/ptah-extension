import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { WorkOS } from '@workos-inc/node';
import { randomBytes, createHash } from 'crypto';
import type {
  JWTPayload,
  RequestUser,
} from '../interfaces/request-user.interface';

/**
 * PKCE (Proof Key for Code Exchange) state storage entry
 *
 * Stores the code verifier associated with a state parameter for OAuth 2.1 PKCE flow.
 * Each entry is single-use and has a 5-minute expiration for security.
 *
 * NOTE: In-memory Map is acceptable for development/single-instance deployments.
 * For production with multiple server instances, migrate to Redis:
 * - Use IoRedis with SET/GET and EX option for TTL
 * - Key format: `pkce:state:{state}` => JSON({ verifier, expiresAt })
 */
interface PKCEState {
  /** Base64URL-encoded code verifier (32 random bytes) */
  verifier: string;
  /** Unix timestamp (ms) when this state expires */
  expiresAt: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly workos: WorkOS;

  /**
   * PKCE state storage - maps state parameter to code verifier
   *
   * Security properties:
   * - 5-minute TTL prevents accumulation
   * - Single-use enforcement (deleted after use)
   * - State acts as CSRF token
   *
   * PRODUCTION NOTE: Replace with Redis for stateless horizontal scaling
   */
  private readonly pkceStates: Map<string, PKCEState> = new Map();

  /** PKCE state TTL in milliseconds (5 minutes) */
  private readonly PKCE_STATE_TTL_MS = 5 * 60 * 1000;

  /** Interval for cleaning up expired states (1 minute) */
  private readonly cleanupIntervalId: NodeJS.Timeout;

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

    // Start periodic cleanup of expired PKCE states to prevent memory leaks
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpiredStates();
    }, 60 * 1000); // Every 1 minute
  }

  /**
   * Cleanup method for graceful shutdown
   * Called when NestJS application is destroyed
   */
  onModuleDestroy(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }
  }

  /**
   * Remove expired PKCE states from memory
   * Prevents memory accumulation from abandoned auth flows
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [state, data] of this.pkceStates.entries()) {
      if (now > data.expiresAt) {
        this.pkceStates.delete(state);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      this.logger.debug(`Cleaned up ${expiredCount} expired PKCE states`);
    }
  }

  /**
   * Generate WorkOS authorization URL with PKCE (OAuth 2.1 compliant)
   *
   * PKCE Flow:
   * 1. Generate code_verifier: 32 random bytes, base64url encoded (43-128 chars)
   * 2. Generate code_challenge: SHA256(code_verifier), base64url encoded
   * 3. Generate state: 16 random bytes, hex encoded (CSRF protection)
   * 4. Store verifier mapped to state (5-minute TTL, single-use)
   * 5. Return authorization URL with code_challenge and state
   *
   * Security Properties:
   * - code_verifier is NEVER sent to authorization server (only stored locally)
   * - code_challenge is one-way hash (cannot derive verifier)
   * - state prevents CSRF attacks
   * - 5-minute expiration limits attack window
   *
   * @returns Authorization URL and state parameter
   */
  async getAuthorizationUrl(): Promise<{ url: string; state: string }> {
    const clientId = this.configService.get<string>('WORKOS_CLIENT_ID');
    const redirectUri = this.configService.get<string>('WORKOS_REDIRECT_URI');

    if (!clientId || !redirectUri) {
      throw new Error(
        'WORKOS_CLIENT_ID and WORKOS_REDIRECT_URI must be configured'
      );
    }

    // Step 1: Generate cryptographically secure code verifier
    // RFC 7636 requires 43-128 characters; 32 bytes = 43 chars in base64url
    const codeVerifier = randomBytes(32).toString('base64url');

    // Step 2: Generate code challenge (SHA256 hash of verifier)
    // This is sent to auth server; verifier stays secret until token exchange
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // Step 3: Generate state for CSRF protection
    // 16 bytes = 32 hex characters, sufficient entropy for CSRF token
    const state = randomBytes(16).toString('hex');

    // Step 4: Store verifier with expiration (5 minutes)
    // Verifier will be retrieved during callback to complete token exchange
    this.pkceStates.set(state, {
      verifier: codeVerifier,
      expiresAt: Date.now() + this.PKCE_STATE_TTL_MS,
    });

    this.logger.debug(
      `Generated PKCE state: ${state.substring(0, 8)}... (expires in 5 min)`
    );

    // Step 5: Generate authorization URL with PKCE parameters
    const url = this.workos.userManagement.getAuthorizationUrl({
      provider: 'authkit',
      clientId,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod: 'S256',
    });

    return { url, state };
  }

  /**
   * Authenticate user with WorkOS authorization code using PKCE
   *
   * PKCE Token Exchange:
   * 1. Validate state parameter exists and not expired
   * 2. Retrieve code_verifier associated with state
   * 3. Delete state (single-use enforcement)
   * 4. Exchange code + code_verifier for tokens
   * 5. Generate JWT for session
   *
   * Security Properties:
   * - State validation prevents CSRF attacks
   * - code_verifier proves original requester (not an attacker with intercepted code)
   * - Single-use state prevents replay attacks
   *
   * @param code Authorization code from OAuth callback
   * @param state State parameter for CSRF validation and verifier lookup
   * @returns JWT token and user information
   * @throws UnauthorizedException if state is invalid, expired, or missing
   */
  async authenticateWithCode(
    code: string,
    state: string
  ): Promise<{ token: string; user: RequestUser }> {
    const clientId = this.configService.get<string>('WORKOS_CLIENT_ID');

    if (!clientId) {
      throw new UnauthorizedException('WorkOS client ID not configured');
    }

    // Step 1: Retrieve and validate PKCE state
    const pkceState = this.pkceStates.get(state);

    if (!pkceState) {
      this.logger.warn(
        `Invalid PKCE state attempted: ${state.substring(0, 8)}...`
      );
      throw new UnauthorizedException(
        'Invalid or expired state parameter. Please try logging in again.'
      );
    }

    // Step 2: Check state expiration
    if (Date.now() > pkceState.expiresAt) {
      this.pkceStates.delete(state);
      this.logger.warn(`Expired PKCE state used: ${state.substring(0, 8)}...`);
      throw new UnauthorizedException(
        'Authentication session expired. Please try logging in again.'
      );
    }

    // Step 3: Extract verifier and delete state (single-use)
    const codeVerifier = pkceState.verifier;
    this.pkceStates.delete(state);

    this.logger.debug(
      `PKCE state consumed: ${state.substring(0, 8)}... (remaining states: ${
        this.pkceStates.size
      })`
    );

    try {
      // Step 4: Exchange code for user information with PKCE verifier
      const { user, organizationId } =
        await this.workos.userManagement.authenticateWithCode({
          clientId,
          code,
          codeVerifier, // PKCE: proves we are the original requester
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
    } catch (error: unknown) {
      // Log original error for debugging but return generic message to client
      // This prevents exposing internal WorkOS error details
      this.logger.error(
        'WorkOS authentication failed',
        error instanceof Error ? error.stack : String(error)
      );
      throw new UnauthorizedException(
        'Authentication failed. Please try again.'
      );
    }
  }

  /**
   * Generate a signed JWT token
   *
   * Public method to create JWT tokens without exposing jwtService directly.
   * Used by controllers that need to sign tokens for specific use cases
   * (e.g., magic link verification, ticket generation).
   *
   * @param payload - JWT payload (sub, email, and optional claims)
   * @returns Signed JWT token string
   */
  public generateJwtToken(payload: Record<string, unknown>): string {
    return this.jwtService.sign(payload);
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
