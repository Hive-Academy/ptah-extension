import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
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
    private readonly configService: ConfigService,
    private readonly pkceService: PkceService,
    private readonly workosUserService: WorkosUserService,
    private readonly jwtTokenService: JwtTokenService,
    private readonly userSyncService: UserSyncService
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
      codeChallenge
    );

    return { url, state };
  }

  /**
   * Get OAuth authorization URL for specific provider
   */
  async getOAuthAuthorizationUrl(
    provider: OAuthProvider
  ): Promise<{ url: string; state: string }> {
    const { codeChallenge, state } = this.pkceService.generatePkceParams();

    const url = this.workosUserService.getOAuthAuthorizationUrl(
      provider,
      this.redirectUri,
      state,
      codeChallenge
    );

    return { url, state };
  }

  // ============================================
  // AUTHENTICATION
  // ============================================

  /**
   * Authenticate with OAuth callback code
   */
  async authenticateWithCode(
    code: string,
    state: string
  ): Promise<{ token: string; user: RequestUser }> {
    // Validate and consume PKCE state
    const codeVerifier = this.pkceService.consumeVerifier(state);
    if (!codeVerifier) {
      throw new UnauthorizedException(
        'Invalid or expired state. Please try again.'
      );
    }

    // Authenticate with WorkOS
    const result = await this.workosUserService.authenticateWithCode(
      code,
      codeVerifier
    );

    // Sync user to database
    await this.userSyncService.syncUser(result.user);

    // Generate JWT
    const token = this.jwtTokenService.generateToken(
      result.user,
      result.organizationId
    );
    const user = this.jwtTokenService.mapWorkOSUserToRequestUser(
      result.user,
      result.organizationId
    );

    return { token, user };
  }

  /**
   * Authenticate with email and password
   *
   * @returns Token and user, or throws with verification required info
   */
  async authenticateWithPassword(
    email: string,
    password: string
  ): Promise<{ token: string; user: RequestUser }> {
    const result = await this.workosUserService.authenticateWithPassword(
      email,
      password
    );

    // Check if email verification is required
    if (result.type === 'email_verification_required') {
      this.throwVerificationRequired(result);
    }

    // Authentication successful
    await this.userSyncService.syncUser(result.user);

    const token = this.jwtTokenService.generateToken(
      result.user,
      result.organizationId
    );
    const user = this.jwtTokenService.mapWorkOSUserToRequestUser(
      result.user,
      result.organizationId
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
   */
  async createUserWithPassword(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string
  ): Promise<{ userId: string; email: string; pendingVerification: boolean }> {
    const user = await this.workosUserService.createUser(
      email,
      password,
      firstName,
      lastName
    );

    await this.userSyncService.syncUser(user);

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
    code: string
  ): Promise<{ token: string; user: RequestUser }> {
    const workosUser = await this.workosUserService.verifyEmail(userId, code);

    await this.userSyncService.syncUser(workosUser);

    const token = this.jwtTokenService.generateToken(workosUser);
    const user = this.jwtTokenService.mapWorkOSUserToRequestUser(workosUser);

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
      })
    );
  }
}
