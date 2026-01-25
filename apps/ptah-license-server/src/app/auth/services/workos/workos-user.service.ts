import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@workos-inc/node';
import { WORKOS_CLIENT, WorkOSClient } from '../../providers/workos.provider';

/**
 * WorkOS Error Structure
 * Based on WorkOS SDK error responses
 */
interface WorkOSError {
  code?: string;
  message?: string;
  error?: string;
  error_description?: string;
  errors?: Array<{ code?: string; message?: string }>;
}

/**
 * Email Verification Required Result
 */
export interface EmailVerificationRequired {
  type: 'email_verification_required';
  userId: string;
  email: string;
}

/**
 * Authentication Success Result
 */
export interface AuthenticationSuccess {
  type: 'success';
  user: User;
  organizationId?: string;
}

/**
 * WorkOS User Service
 *
 * Single responsibility: All WorkOS User Management API operations.
 * Provides type-safe error handling and result types.
 */
@Injectable()
export class WorkosUserService {
  private readonly logger = new Logger(WorkosUserService.name);
  private readonly clientId: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(WORKOS_CLIENT)
    private readonly workos: WorkOSClient
  ) {
    this.clientId = this.configService.get<string>('WORKOS_CLIENT_ID') || '';
    if (!this.clientId) {
      this.logger.warn('WORKOS_CLIENT_ID not configured');
    }
  }

  /**
   * Authenticate user with email and password
   *
   * @returns Success result or throws appropriate exception
   */
  async authenticateWithPassword(
    email: string,
    password: string
  ): Promise<AuthenticationSuccess | EmailVerificationRequired> {
    this.ensureClientId();

    try {
      const { user, organizationId } =
        await this.workos.userManagement.authenticateWithPassword({
          clientId: this.clientId,
          email,
          password,
        });

      return { type: 'success', user, organizationId };
    } catch (error) {
      return this.handleAuthError(error, email);
    }
  }

  /**
   * Authenticate with authorization code (OAuth callback)
   */
  async authenticateWithCode(
    code: string,
    codeVerifier: string
  ): Promise<AuthenticationSuccess> {
    this.ensureClientId();

    try {
      const { user, organizationId } =
        await this.workos.userManagement.authenticateWithCode({
          clientId: this.clientId,
          code,
          codeVerifier,
        });

      return { type: 'success', user, organizationId };
    } catch (error) {
      this.logger.error(
        'Code authentication failed:',
        this.extractErrorMessage(error)
      );
      throw new UnauthorizedException(
        'Authentication failed. Please try again.'
      );
    }
  }

  /**
   * Create a new user with email and password
   */
  async createUser(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string
  ): Promise<User> {
    try {
      const user = await this.workos.userManagement.createUser({
        email,
        password,
        firstName,
        lastName,
        emailVerified: false,
      });

      this.logger.log(`Created user: ${email} (pending verification)`);
      return user;
    } catch (error) {
      this.handleCreateUserError(error);
    }
  }

  /**
   * Verify email with 6-digit code
   */
  async verifyEmail(userId: string, code: string): Promise<User> {
    try {
      const { user } = await this.workos.userManagement.verifyEmail({
        userId,
        code,
      });

      this.logger.log(`Email verified for user: ${user.email}`);
      return user;
    } catch (error) {
      this.handleVerifyEmailError(error);
    }
  }

  /**
   * Send verification email to user
   */
  async sendVerificationEmail(userId: string): Promise<void> {
    try {
      await this.workos.userManagement.sendVerificationEmail({ userId });
      this.logger.log(`Verification email sent to user: ${userId}`);
    } catch (error) {
      this.logger.warn(
        `Failed to send verification email: ${this.extractErrorMessage(error)}`
      );
      throw new BadRequestException(
        'Failed to send verification code. Please try again.'
      );
    }
  }

  /**
   * Find user by email
   */
  async findUserByEmail(email: string): Promise<User | null> {
    try {
      const response = await this.workos.userManagement.listUsers({ email });
      return response.data?.[0] || null;
    } catch (error) {
      this.logger.warn(
        `Failed to find user by email: ${this.extractErrorMessage(error)}`
      );
      return null;
    }
  }

  /**
   * Get authorization URL for AuthKit
   */
  getAuthorizationUrl(
    redirectUri: string,
    state: string,
    codeChallenge: string
  ): string {
    this.ensureClientId();

    return this.workos.userManagement.getAuthorizationUrl({
      provider: 'authkit',
      clientId: this.clientId,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod: 'S256',
    });
  }

  /**
   * Get OAuth authorization URL for specific provider
   */
  getOAuthAuthorizationUrl(
    provider: 'github' | 'google',
    redirectUri: string,
    state: string,
    codeChallenge: string
  ): string {
    this.ensureClientId();

    const providerMap = {
      github: 'GitHubOAuth',
      google: 'GoogleOAuth',
    } as const;

    return this.workos.userManagement.getAuthorizationUrl({
      provider: providerMap[provider] as any,
      clientId: this.clientId,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod: 'S256',
    });
  }

  // ============================================
  // PRIVATE ERROR HANDLING
  // ============================================

  private ensureClientId(): void {
    if (!this.clientId) {
      throw new BadRequestException('WorkOS client ID not configured');
    }
  }

  /**
   * Handle authentication errors
   * Detects email verification required and other error types
   */
  private async handleAuthError(
    error: unknown,
    email: string
  ): Promise<EmailVerificationRequired> {
    const workosError = this.parseWorkOSError(error);
    const errorMessage = this.extractErrorMessage(error);

    this.logger.warn(`Auth failed for ${email}: ${errorMessage}`);

    // Check for email verification required
    // WorkOS error codes: 'email_verification_required', 'unverified_email'
    // WorkOS messages: "Email ownership must be verified before authentication"
    if (this.isEmailVerificationRequired(workosError, errorMessage)) {
      // Look up user to get their ID
      const user = await this.findUserByEmail(email);

      if (user && !user.emailVerified) {
        // Send new verification email
        try {
          await this.sendVerificationEmail(user.id);
        } catch {
          // Log but don't fail - user might still have previous code
        }

        return {
          type: 'email_verification_required',
          userId: user.id,
          email,
        };
      }
    }

    throw new UnauthorizedException('Invalid email or password');
  }

  /**
   * Check if error indicates email verification is required
   */
  private isEmailVerificationRequired(
    error: WorkOSError | null,
    message: string
  ): boolean {
    // Check error code first (most reliable)
    if (error?.code) {
      const verificationCodes = [
        'email_verification_required',
        'unverified_email',
        'email_not_verified',
      ];
      if (verificationCodes.includes(error.code.toLowerCase())) {
        return true;
      }
    }

    // Check nested errors
    if (error?.errors) {
      for (const e of error.errors) {
        if (e.code && e.code.toLowerCase().includes('verif')) {
          return true;
        }
      }
    }

    // Fallback: check message (less reliable, but necessary)
    const verificationPhrases = [
      'email ownership must be verified',
      'email must be verified',
      'verify your email',
      'email verification required',
    ];

    const lowerMessage = message.toLowerCase();
    return verificationPhrases.some((phrase) => lowerMessage.includes(phrase));
  }

  /**
   * Handle user creation errors
   */
  private handleCreateUserError(error: unknown): never {
    const workosError = this.parseWorkOSError(error);
    const errorMessage = this.extractErrorMessage(error);

    this.logger.error(`User creation failed: ${errorMessage}`);

    // Check for duplicate email
    if (this.isDuplicateEmailError(workosError, errorMessage)) {
      throw new ConflictException(
        'A user with this email already exists. Please sign in instead.'
      );
    }

    // Check for password strength
    if (this.isPasswordStrengthError(workosError, errorMessage)) {
      throw new BadRequestException(
        'Password does not meet strength requirements.'
      );
    }

    throw new BadRequestException(`Failed to create account: ${errorMessage}`);
  }

  /**
   * Handle email verification errors
   */
  private handleVerifyEmailError(error: unknown): never {
    const workosError = this.parseWorkOSError(error);
    const errorCode = workosError?.code || workosError?.errors?.[0]?.code || '';

    this.logger.error(
      `Email verification failed: ${this.extractErrorMessage(error)}`
    );

    if (errorCode.includes('expired')) {
      throw new BadRequestException(
        'Verification code has expired. Please request a new one.'
      );
    }

    if (errorCode.includes('invalid')) {
      throw new BadRequestException(
        'Invalid verification code. Please check and try again.'
      );
    }

    throw new BadRequestException(
      'Email verification failed. Please try again.'
    );
  }

  /**
   * Check if error indicates duplicate email
   */
  private isDuplicateEmailError(
    error: WorkOSError | null,
    message: string
  ): boolean {
    const duplicateCodes = ['email_not_available', 'user_exists', 'duplicate'];
    const code = error?.code || error?.errors?.[0]?.code || '';

    if (duplicateCodes.some((dc) => code.toLowerCase().includes(dc))) {
      return true;
    }

    const duplicatePhrases = [
      'already exists',
      'already been taken',
      'not available',
      'duplicate',
    ];
    const lowerMessage = message.toLowerCase();
    return duplicatePhrases.some((phrase) => lowerMessage.includes(phrase));
  }

  /**
   * Check if error indicates password strength issue
   */
  private isPasswordStrengthError(
    error: WorkOSError | null,
    message: string
  ): boolean {
    const code = error?.code || error?.errors?.[0]?.code || '';
    if (code.toLowerCase().includes('password')) {
      return true;
    }

    const lowerMessage = message.toLowerCase();
    return (
      lowerMessage.includes('password') && lowerMessage.includes('strength')
    );
  }

  /**
   * Parse WorkOS error object
   */
  private parseWorkOSError(error: unknown): WorkOSError | null {
    if (!error || typeof error !== 'object') {
      return null;
    }

    return error as WorkOSError;
  }

  /**
   * Extract error message from any error type
   */
  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null) {
      const e = error as WorkOSError;
      return e.message || e.error_description || e.error || 'Unknown error';
    }
    return String(error);
  }
}
