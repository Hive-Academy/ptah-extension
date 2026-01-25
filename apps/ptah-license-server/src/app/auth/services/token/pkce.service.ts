import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

/**
 * PKCE State Entry
 * Stores code verifier with expiration for OAuth 2.1 PKCE flow
 */
interface PKCEState {
  verifier: string;
  expiresAt: number;
  /** Optional return URL for post-auth redirect */
  returnUrl?: string | null;
  /** Optional plan key for auto-checkout after auth */
  plan?: string | null;
}

/**
 * Options for generating PKCE parameters
 */
export interface PkceOptions {
  /** URL to redirect to after authentication */
  returnUrl?: string;
  /** Plan key for auto-checkout (e.g., 'pro-monthly', 'pro-yearly') */
  plan?: string;
}

/**
 * Result from consuming a PKCE state
 */
export interface PkceConsumeResult {
  /** The code verifier for token exchange */
  verifier: string;
  /** Optional return URL stored with the state */
  returnUrl?: string | null;
  /** Optional plan key stored with the state */
  plan?: string | null;
}

/**
 * PKCE Service
 *
 * Handles Proof Key for Code Exchange (OAuth 2.1) state management.
 * Single responsibility: Generate and validate PKCE parameters.
 *
 * NOTE: Uses in-memory Map for development. For production with
 * multiple instances, migrate to Redis.
 */
@Injectable()
export class PkceService implements OnModuleDestroy {
  private readonly logger = new Logger(PkceService.name);
  private readonly states = new Map<string, PKCEState>();
  private readonly STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly cleanupIntervalId: NodeJS.Timeout;

  constructor() {
    // Periodic cleanup of expired states
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpiredStates();
    }, 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }
  }

  /**
   * Generate PKCE parameters for authorization request
   *
   * @param options - Optional settings for return URL and plan
   * @returns code_verifier, code_challenge, and state
   */
  generatePkceParams(options?: PkceOptions): {
    codeVerifier: string;
    codeChallenge: string;
    state: string;
  } {
    // Generate code verifier (43-128 chars per RFC 7636)
    const codeVerifier = randomBytes(32).toString('base64url');

    // Generate code challenge (SHA256 hash)
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // Generate state for CSRF protection
    const state = randomBytes(16).toString('hex');

    // Store verifier mapped to state (with optional returnUrl and plan)
    this.states.set(state, {
      verifier: codeVerifier,
      expiresAt: Date.now() + this.STATE_TTL_MS,
      returnUrl: options?.returnUrl || null,
      plan: options?.plan || null,
    });

    this.logger.debug(
      `Generated PKCE state: ${state.substring(0, 8)}... (expires in 5 min)${
        options?.returnUrl ? ` returnUrl=${options.returnUrl}` : ''
      }${options?.plan ? ` plan=${options.plan}` : ''}`
    );

    return { codeVerifier, codeChallenge, state };
  }

  /**
   * Retrieve and consume code verifier for token exchange
   *
   * @param state - State parameter from callback
   * @returns PkceConsumeResult with verifier and optional returnUrl/plan, or null if invalid/expired
   */
  consumeVerifier(state: string): PkceConsumeResult | null {
    const entry = this.states.get(state);

    if (!entry) {
      this.logger.warn(`Invalid PKCE state: ${state.substring(0, 8)}...`);
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.states.delete(state);
      this.logger.warn(`Expired PKCE state: ${state.substring(0, 8)}...`);
      return null;
    }

    // Single-use: delete after consumption
    this.states.delete(state);
    this.logger.debug(
      `Consumed PKCE state: ${state.substring(0, 8)}... (remaining: ${
        this.states.size
      })`
    );

    return {
      verifier: entry.verifier,
      returnUrl: entry.returnUrl,
      plan: entry.plan,
    };
  }

  /**
   * Clean up expired states to prevent memory leaks
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    let count = 0;

    for (const [state, data] of this.states.entries()) {
      if (now > data.expiresAt) {
        this.states.delete(state);
        count++;
      }
    }

    if (count > 0) {
      this.logger.debug(`Cleaned up ${count} expired PKCE states`);
    }
  }
}
