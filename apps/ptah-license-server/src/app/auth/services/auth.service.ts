import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RequestUser } from '../interfaces/request-user.interface';
import { JwtTokenService, PkceService } from './token';
import { UserSyncService } from './sync';
import { WorkosUserService, EmailVerificationRequired } from './workos';

/** Supported OAuth providers */
export type OAuthProvider = 'github' | 'google';

/**
 * Auth Service
 *
 * Orchestrates authentication operations using specialized services:
 * - PkceService: PKCE state management
 * - WorkosUserService: WorkOS API operations
 * - JwtTokenService: JWT token generation/validation
 * - UserSyncService: Database synchronization
 *
 * This service is a thin coordinator that delegates to focused services.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly redirectUri: string;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PkceService) private readonly pkceService: PkceService,
    @Inject(WorkosUserService)
    private readonly workosUserService: WorkosUserService,
    @Inject(JwtTokenService) private readonly jwtTokenService: JwtTokenService,
    @Inject(UserSyncService) private readonly userSyncService: UserSyncService,
  ) {
    this.redirectUri =
      this.configService.get<string>('WORKOS_REDIRECT_URI') || '';
    this.logger.log('Auth service initialized');
  }

  // ============================================
  // AUTHORIZATION URLs
  // ============================================

  /**
   * Get WorkOS AuthKit authorization URL with PKCE
   */
  async getAuthorizationUrl(): Promise<{ url: string; state: string }> {
    const { codeChallenge, state } = this.pkceService.generatePkceParams();

    const url = this.workosUserService.getAuthorizationUrl(
      this.redirectUri,
      state,
      codeChallenge,
    );

    return { url, state };
  }

  /**
   * Get OAuth authorization URL for specific provider
   *
   * @param provider - OAuth provider (github, google)
   * @param returnUrl - Optional URL to redirect to after auth
   * @param plan - Optional plan key for auto-checkout after auth
   */
  async getOAuthAuthorizationUrl(
    provider: OAuthProvider,
    returnUrl?: string,
    plan?: string,
  ): Promise<{ url: string; state: string }> {
    const { codeChallenge, state } = this.pkceService.generatePkceParams({
      returnUrl,
      plan,
    });

    const url = this.workosUserService.getOAuthAuthorizationUrl(
      provider,
      this.redirectUri,
      state,
      codeChallenge,
    );

    return { url, state };
  }

  // ============================================
  // AUTHENTICATION
  // ============================================

  /**
   * Authenticate with OAuth callback code
   *
   * @returns Token, user, and optional returnUrl/plan from PKCE state
   */
  async authenticateWithCode(
    code: string,
    state: string,
  ): Promise<{
    token: string;
    user: RequestUser;
    returnUrl?: string | null;
    plan?: string | null;
  }> {
    // Validate and consume PKCE state (now returns full state with returnUrl/plan)
    const pkceResult = this.pkceService.consumeVerifier(state);
    if (!pkceResult) {
      throw new UnauthorizedException(
        'Invalid or expired state. Please try again.',
      );
    }

    // Authenticate with WorkOS
    const result = await this.workosUserService.authenticateWithCode(
      code,
      pkceResult.verifier,
    );

    // Sync user to database and get database user ID (NOT WorkOS ID)
    const dbUser = await this.userSyncService.syncUser(result.user);

    // Generate JWT using DATABASE user ID (not WorkOS user ID)
    // This ensures the JWT sub claim matches the database UUID
    const token = await this.jwtTokenService.generateToken(
      dbUser.id,
      result.user,
      result.organizationId,
    );
    const user = await this.jwtTokenService.mapWorkOSUserToRequestUser(
      result.user,
      result.organizationId,
      dbUser.id,
    );

    return {
      token,
      user,
      returnUrl: pkceResult.returnUrl,
      plan: pkceResult.plan,
    };
  }

  /**
   * Authenticate with email and password
   *
   * @returns Token and user, or throws with verification required info
   */
  async authenticateWithPassword(
    email: string,
    password: string,
  ): Promise<{ token: string; user: RequestUser }> {
    const result = await this.workosUserService.authenticateWithPassword(
      email,
      password,
    );

    // Check if email verification is required
    if (result.type === 'email_verification_required') {
      this.throwVerificationRequired(result);
    }

    // Authentication successful - sync and get database user ID
    const dbUser = await this.userSyncService.syncUser(result.user);

    // Generate JWT using DATABASE user ID (not WorkOS user ID)
    const token = await this.jwtTokenService.generateToken(
      dbUser.id,
      result.user,
      result.organizationId,
    );
    const user = await this.jwtTokenService.mapWorkOSUserToRequestUser(
      result.user,
      result.organizationId,
      dbUser.id,
    );

    this.logger.log(`User authenticated: ${email}`);
    return { token, user };
  }

  // ============================================
  // USER CREATION & VERIFICATION
  // ============================================

  /**
   * Create new user with email and password
   * Returns pending verification status (no token until verified)
   *
   * Note: WorkOS does NOT automatically send verification emails.
   * We must explicitly call sendVerificationEmail after user creation.
   */
  async createUserWithPassword(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string,
  ): Promise<{ userId: string; email: string; pendingVerification: boolean }> {
    const user = await this.workosUserService.createUser(
      email,
      password,
      firstName,
      lastName,
    );

    await this.userSyncService.syncUser(user);

    // Send verification email (WorkOS does NOT auto-send on user creation)
    await this.workosUserService.sendVerificationEmail(user.id);

    return {
      userId: user.id,
      email: user.email,
      pendingVerification: true,
    };
  }

  /**
   * Verify email with code
   */
  async verifyEmailCode(
    userId: string,
    code: string,
  ): Promise<{ token: string; user: RequestUser }> {
    const workosUser = await this.workosUserService.verifyEmail(userId, code);

    // Sync and get database user ID
    const dbUser = await this.userSyncService.syncUser(workosUser);

    // Generate JWT using DATABASE user ID (not WorkOS user ID)
    const token = await this.jwtTokenService.generateToken(
      dbUser.id,
      workosUser,
    );
    const user = await this.jwtTokenService.mapWorkOSUserToRequestUser(
      workosUser,
      undefined,
      dbUser.id,
    );

    return { token, user };
  }

  /**
   * Resend verification code
   */
  async resendVerificationCode(userId: string): Promise<{ success: boolean }> {
    await this.workosUserService.sendVerificationEmail(userId);
    return { success: true };
  }

  // ============================================
  // TOKEN OPERATIONS
  // ============================================

  /**
   * Validate JWT token
   */
  async validateToken(token: string): Promise<RequestUser> {
    return this.jwtTokenService.validateToken(token);
  }

  /**
   * Generate JWT token from payload
   */
  generateJwtToken(payload: Record<string, unknown>): string {
    return this.jwtTokenService.generateTokenFromPayload(payload);
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  /**
   * Throw UnauthorizedException with verification required info
   */
  private throwVerificationRequired(result: EmailVerificationRequired): never {
    throw new UnauthorizedException(
      JSON.stringify({
        code: 'email_verification_required',
        userId: result.userId,
        email: result.email,
        message:
          'Please verify your email before signing in. A verification code has been sent.',
      }),
    );
  }
}
