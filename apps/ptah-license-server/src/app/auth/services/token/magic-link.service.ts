import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

/**
 * MagicLinkService - Passwordless authentication via email magic links
 *
 * Features:
 * - 2-minute TTL for magic link tokens (configurable)
 * - Single-use enforcement (token deleted after validation)
 * - In-memory token storage (single-instance deployment)
 * - Cryptographically secure token generation (256-bit entropy)
 *
 * Limitations:
 * - SINGLE-INSTANCE ONLY: In-memory storage is NOT suitable for multi-instance deployments
 * - For multi-instance, migrate to Redis with TTL-based expiration
 *
 * Configuration (environment variables):
 * - MAGIC_LINK_TTL_MS: Token time-to-live in milliseconds (default: 120000 = 2 minutes)
 * - FRONTEND_URL: Customer portal base URL for magic link generation
 */
interface MagicLinkToken {
  email: string;
  token: string;
  expiresAt: Date;
  used: boolean;
  /** Optional return URL for post-auth redirect */
  returnUrl?: string | null;
  /** Optional plan key for auto-checkout after auth */
  plan?: string | null;
}

/**
 * Options for creating a magic link
 */
export interface MagicLinkOptions {
  /** URL to redirect to after authentication */
  returnUrl?: string;
  /** Plan key for auto-checkout (e.g., 'pro-monthly', 'pro-yearly') */
  plan?: string;
}

@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);
  private readonly tokens = new Map<string, MagicLinkToken>();
  private readonly ttlMs: number;

  constructor(private readonly config: ConfigService) {
    // Default: 2 minutes (120000ms) - enough time to open email and click link
    this.ttlMs = this.config.get<number>('MAGIC_LINK_TTL_MS') || 120000;
    this.logger.log(`MagicLinkService initialized with TTL: ${this.ttlMs}ms`);

    // Run cleanup every 5 minutes to prevent memory leaks
    setInterval(() => this.cleanupExpiredTokens(), 5 * 60 * 1000);
  }

  /**
   * Create magic link for email authentication
   *
   * Generates a cryptographically secure token with 2-minute TTL
   * and returns a full magic link URL for the user to click.
   *
   * @param email - User's email address
   * @param options - Optional returnUrl and plan for post-auth redirect
   * @returns Full magic link URL (e.g., https://ptah.dev/api/auth/verify?token=abc123...)
   */
  async createMagicLink(
    email: string,
    options?: MagicLinkOptions
  ): Promise<string> {
    // Step 1: Generate 64-char hex token (256-bit entropy via crypto.randomBytes)
    const token = randomBytes(32).toString('hex');

    // Step 2: Calculate expiration timestamp (2 minutes from now)
    const expiresAt = new Date(Date.now() + this.ttlMs);

    // Step 3: Store token in memory with metadata (including optional returnUrl/plan)
    this.tokens.set(token, {
      email,
      token,
      expiresAt,
      used: false,
      returnUrl: options?.returnUrl || null,
      plan: options?.plan || null,
    });

    this.logger.log(
      `Magic link CREATED: token=${token.substring(0, 8)}...${token.substring(
        token.length - 8
      )} (length: ${token.length}), expires in ${
        this.ttlMs
      }ms, total tokens in storage: ${this.tokens.size}${
        options?.returnUrl ? `, returnUrl=${options.returnUrl}` : ''
      }${options?.plan ? `, plan=${options.plan}` : ''}`
    );

    // Step 4: Build full magic link URL
    // Note: Uses /api/auth/verify because backend has global '/api' prefix
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    return `${frontendUrl}/api/auth/verify?token=${token}`;
  }

  /**
   * Validate and consume magic link token
   *
   * Single-use enforcement: Token is deleted immediately after validation.
   * Expired tokens are also deleted to prevent memory leaks.
   *
   * @param token - Magic link token from URL query parameter
   * @returns Validation result with email and optional returnUrl/plan if valid, or error reason
   *
   * Error reasons:
   * - 'token_not_found': Token doesn't exist (never created or already consumed)
   * - 'token_already_used': Token was already used (should never happen due to deletion)
   * - 'token_expired': Token exceeded TTL (default: 2 minutes)
   */
  async validateAndConsume(token: string): Promise<{
    valid: boolean;
    email?: string;
    returnUrl?: string | null;
    plan?: string | null;
    error?: 'token_not_found' | 'token_already_used' | 'token_expired';
  }> {
    // Debug: Log lookup attempt
    this.logger.debug(
      `Magic link LOOKUP: searching for token=${
        token
          ? `${token.substring(0, 8)}...${token.substring(
              token.length - 8
            )} (length: ${token.length})`
          : 'EMPTY'
      }, tokens in storage: ${this.tokens.size}`
    );

    // Step 1: Retrieve token from storage
    const magicLink = this.tokens.get(token);

    if (!magicLink) {
      // Debug: List stored token prefixes for comparison
      const storedTokenPrefixes = Array.from(this.tokens.keys())
        .map((t) => `${t.substring(0, 8)}...`)
        .join(', ');
      this.logger.warn(
        `Token validation failed: token not found. Received: ${token?.substring(
          0,
          8
        )}..., Stored tokens: [${storedTokenPrefixes || 'none'}]`
      );
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

    // Step 3: Check expiration (default: 2-minute TTL)
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

    // Step 5: Return success with user email and optional returnUrl/plan
    return {
      valid: true,
      email: magicLink.email,
      returnUrl: magicLink.returnUrl,
      plan: magicLink.plan,
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
