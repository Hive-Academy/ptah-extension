import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

/**
 * MagicLinkService - Passwordless authentication via email magic links
 *
 * Features:
 * - 30-second TTL for magic link tokens
 * - Single-use enforcement (token deleted after validation)
 * - In-memory token storage (single-instance deployment)
 * - Cryptographically secure token generation (256-bit entropy)
 *
 * Limitations:
 * - SINGLE-INSTANCE ONLY: In-memory storage is NOT suitable for multi-instance deployments
 * - For multi-instance, migrate to Redis with TTL-based expiration
 *
 * Configuration (environment variables):
 * - MAGIC_LINK_TTL_MS: Token time-to-live in milliseconds (default: 30000)
 * - FRONTEND_URL: Customer portal base URL for magic link generation
 */
interface MagicLinkToken {
  email: string;
  token: string;
  expiresAt: Date;
  used: boolean;
}

@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);
  private readonly tokens = new Map<string, MagicLinkToken>();
  private readonly ttlMs: number;

  constructor(private readonly config: ConfigService) {
    this.ttlMs = this.config.get<number>('MAGIC_LINK_TTL_MS') || 30000;
    this.logger.log(`MagicLinkService initialized with TTL: ${this.ttlMs}ms`);

    // Run cleanup every 5 minutes to prevent memory leaks
    setInterval(() => this.cleanupExpiredTokens(), 5 * 60 * 1000);
  }

  /**
   * Create magic link for email authentication
   *
   * Generates a cryptographically secure token with 30-second TTL
   * and returns a full magic link URL for the user to click.
   *
   * @param email - User's email address
   * @returns Full magic link URL (e.g., https://ptah.dev/auth/verify?token=abc123...)
   */
  async createMagicLink(email: string): Promise<string> {
    // Step 1: Generate 64-char hex token (256-bit entropy via crypto.randomBytes)
    const token = randomBytes(32).toString('hex');

    // Step 2: Calculate expiration timestamp (30 seconds from now)
    const expiresAt = new Date(Date.now() + this.ttlMs);

    // Step 3: Store token in memory with metadata
    this.tokens.set(token, {
      email,
      token,
      expiresAt,
      used: false,
    });

    this.logger.log(
      `Magic link created for email (token will expire in ${this.ttlMs}ms)`
    );

    // Step 4: Build full magic link URL
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    return `${frontendUrl}/auth/verify?token=${token}`;
  }

  /**
   * Validate and consume magic link token
   *
   * Single-use enforcement: Token is deleted immediately after validation.
   * Expired tokens are also deleted to prevent memory leaks.
   *
   * @param token - Magic link token from URL query parameter
   * @returns Validation result with email if valid, or error reason
   *
   * Error reasons:
   * - 'token_not_found': Token doesn't exist (never created or already consumed)
   * - 'token_already_used': Token was already used (should never happen due to deletion)
   * - 'token_expired': Token exceeded 30-second TTL
   */
  async validateAndConsume(token: string): Promise<{
    valid: boolean;
    email?: string;
    error?: 'token_not_found' | 'token_already_used' | 'token_expired';
  }> {
    // Step 1: Retrieve token from storage
    const magicLink = this.tokens.get(token);

    if (!magicLink) {
      this.logger.warn('Token validation failed: token not found');
      return {
        valid: false,
        error: 'token_not_found',
      };
    }

    // Step 2: Check if token was already used (double-click protection)
    if (magicLink.used) {
      this.logger.warn('Token validation failed: token already used');
      return {
        valid: false,
        error: 'token_already_used',
      };
    }

    // Step 3: Check expiration (30-second TTL)
    if (new Date() > magicLink.expiresAt) {
      this.tokens.delete(token); // Clean up expired token
      this.logger.warn('Token validation failed: token expired');
      return {
        valid: false,
        error: 'token_expired',
      };
    }

    // Step 4: Single-use enforcement - delete token immediately
    this.tokens.delete(token);
    this.logger.log(`Magic link token validated and consumed for email`);

    // Step 5: Return success with user email
    return {
      valid: true,
      email: magicLink.email,
    };
  }

  /**
   * Cleanup expired tokens to prevent memory leaks
   *
   * Runs every 5 minutes in background.
   * Removes tokens that have exceeded their TTL.
   *
   * @private
   */
  private cleanupExpiredTokens(): void {
    const now = new Date();
    let cleanedCount = 0;

    for (const [token, data] of this.tokens.entries()) {
      if (now > data.expiresAt) {
        this.tokens.delete(token);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.log(`Cleaned up ${cleanedCount} expired magic link tokens`);
    }
  }

  /**
   * Get current token storage size (for monitoring)
   *
   * Useful for detecting memory leaks or abuse.
   *
   * @returns Number of tokens currently stored in memory
   */
  getTokenCount(): number {
    return this.tokens.size;
  }
}
