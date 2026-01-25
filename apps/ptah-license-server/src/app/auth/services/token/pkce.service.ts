import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

/**
 * PKCE State Entry
 * Stores code verifier with expiration for OAuth 2.1 PKCE flow
 */
interface PKCEState {
  verifier: string;
  expiresAt: number;
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
   * @returns code_verifier, code_challenge, and state
   */
  generatePkceParams(): {
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

    // Store verifier mapped to state
    this.states.set(state, {
      verifier: codeVerifier,
      expiresAt: Date.now() + this.STATE_TTL_MS,
    });

    this.logger.debug(
      `Generated PKCE state: ${state.substring(0, 8)}... (expires in 5 min)`
    );

    return { codeVerifier, codeChallenge, state };
  }

  /**
   * Retrieve and consume code verifier for token exchange
   *
   * @param state - State parameter from callback
   * @returns code_verifier or null if invalid/expired
   */
  consumeVerifier(state: string): string | null {
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

    return entry.verifier;
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
