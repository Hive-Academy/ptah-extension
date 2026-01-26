/**
 * License Service
 *
 * Manages license verification, caching, and status events for VS Code extension.
 * Uses VS Code's SecretStorage for encrypted license key storage.
 *
 * TASK_2025_075 Batch 5: License verification with 1-hour cache
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import EventEmitter from 'eventemitter3';
import { Logger } from '../logging';
import { TOKENS } from '../di/tokens';

/**
 * License tier values for the two-tier paid model
 *
 * TASK_2025_121: New tier system
 * - 'basic': Active Basic subscription ($3/month)
 * - 'pro': Active Pro subscription ($5/month)
 * - 'trial_basic': Basic plan during 14-day trial
 * - 'trial_pro': Pro plan during 14-day trial
 * - 'expired': No valid subscription (extension blocked)
 *
 * NOTE: Legacy values 'free' and 'early_adopter' are mapped in server code:
 * - 'early_adopter' -> 'pro' (grandfathered users)
 * - 'free' -> 'trial_basic' or 'expired' depending on trial status
 */
export type LicenseTierValue =
  | 'basic'
  | 'pro'
  | 'trial_basic'
  | 'trial_pro'
  | 'expired';

/**
 * License verification status returned by the server
 *
 * TASK_2025_121: Updated for two-tier paid model with trial support
 */
export interface LicenseStatus {
  /** Whether the license is currently valid */
  valid: boolean;
  /** Current license tier (basic, pro, trial_basic, trial_pro, or expired) */
  tier: LicenseTierValue;
  /** Plan details (if applicable) */
  plan?: {
    name: string;
    features: string[];
    expiresAfterDays: number | null;
    isPremium: boolean;
    description: string;
  };
  /** Subscription/trial expiration timestamp (ISO 8601) */
  expiresAt?: string;
  /** Days remaining before subscription expires */
  daysRemaining?: number;
  /** Whether user is currently in trial period */
  trialActive?: boolean;
  /** Days remaining in trial period (only set during trial) */
  trialDaysRemaining?: number;
  /** Reason for invalid status */
  reason?: 'expired' | 'revoked' | 'not_found' | 'trial_ended';
}

/**
 * Events emitted by LicenseService for license status changes
 */
export interface LicenseEvents {
  'license:verified': (status: LicenseStatus) => void;
  'license:expired': (status: LicenseStatus) => void;
  'license:updated': (status: LicenseStatus) => void;
}

/**
 * License Service Implementation
 *
 * Responsibilities:
 * - Verify license keys with the license server
 * - Cache verification results for 1 hour (reduce API calls)
 * - Store license keys in encrypted SecretStorage
 * - Emit events on license status changes
 * - Graceful degradation: use cached status if server unreachable
 *
 * Security:
 * - License keys stored in encrypted SecretStorage (VS Code API)
 * - License keys NEVER logged (only prefix shown)
 * - Network timeout: 5 seconds
 *
 * Pattern Reference: AuthSecretsService (vscode-core)
 */
@injectable()
export class LicenseService extends EventEmitter<LicenseEvents> {
  private static readonly SECRET_KEY = 'ptah.licenseKey';
  private static readonly LICENSE_SERVER_URL =
    process.env['PTAH_LICENSE_SERVER_URL'] || 'https://api.ptah.dev';
  private static readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  private static readonly NETWORK_TIMEOUT_MS = 5000; // 5 seconds

  private cache: {
    status: LicenseStatus | null;
    timestamp: number | null;
  } = { status: null, timestamp: null };

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    super();
    this.logger.info('[LicenseService.constructor] Service initialized', {
      serverUrl: LicenseService.LICENSE_SERVER_URL,
      cacheTtlMs: LicenseService.CACHE_TTL_MS,
    });
  }

  /**
   * Verify license key with server (or return cached result).
   *
   * TASK_2025_121: Updated for two-tier paid model
   *
   * Flow:
   * 1. Check cache validity (1-hour TTL)
   * 2. Get license key from SecretStorage
   * 3. If no key: return expired tier status (extension blocked)
   * 4. POST to server /api/v1/licenses/verify
   * 5. Cache result and emit events
   * 6. On error: return cached status or expired tier
   *
   * @returns License status with tier, plan details, expiration
   *
   * @example
   * ```typescript
   * const status = await licenseService.verifyLicense();
   * if (status.valid && (status.tier === 'pro' || status.tier === 'trial_pro')) {
   *   console.log('Premium license active');
   * }
   * ```
   */
  async verifyLicense(): Promise<LicenseStatus> {
    try {
      // Step 1: Check cache (1-hour TTL)
      if (this.isCacheValid()) {
        this.logger.debug(
          '[LicenseService.verifyLicense] Returning cached status',
          {
            tier: this.cache.status!.tier,
            valid: this.cache.status!.valid,
            cacheAge: Date.now() - this.cache.timestamp!,
          }
        );
        return this.cache.status!;
      }

      // Step 2: Get license key from SecretStorage
      const licenseKey = await this.context.secrets.get(
        LicenseService.SECRET_KEY
      );

      if (!licenseKey) {
        // TASK_2025_121: No license key = expired (extension blocked)
        const expiredStatus: LicenseStatus = {
          valid: false,
          tier: 'expired',
          reason: 'not_found',
        };
        this.updateCache(expiredStatus);
        this.logger.info(
          '[LicenseService.verifyLicense] No license key found, returning expired tier'
        );
        return expiredStatus;
      }

      // Step 3: Verify with server
      this.logger.debug(
        '[LicenseService.verifyLicense] Verifying with server',
        {
          keyPrefix: licenseKey.substring(0, 10) + '...',
          serverUrl: LicenseService.LICENSE_SERVER_URL,
        }
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, LicenseService.NETWORK_TIMEOUT_MS);

      try {
        const response = await fetch(
          `${LicenseService.LICENSE_SERVER_URL}/api/v1/licenses/verify`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(
            `License verification failed: ${response.status} ${response.statusText}`
          );
        }

        const status: LicenseStatus = await response.json();

        // Step 4: Update cache and emit events
        this.updateCache(status);
        this.emitLicenseEvent(status);

        this.logger.info(
          '[LicenseService.verifyLicense] License verified successfully',
          {
            tier: status.tier,
            valid: status.valid,
            expiresAt: status.expiresAt,
          }
        );

        return status;
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    } catch (error) {
      this.logger.error('[LicenseService.verifyLicense] Verification failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Graceful degradation: Return cached status if available
      if (this.cache.status) {
        this.logger.warn(
          '[LicenseService.verifyLicense] Returning stale cached status',
          {
            tier: this.cache.status.tier,
            cacheAge: Date.now() - this.cache.timestamp!,
          }
        );
        return this.cache.status;
      }

      // TASK_2025_121: No cache = expired (extension blocked)
      const expiredStatus: LicenseStatus = {
        valid: false,
        tier: 'expired',
        reason: 'not_found',
      };
      return expiredStatus;
    }
  }

  /**
   * Store license key in SecretStorage and re-verify.
   *
   * Flow:
   * 1. Store key in encrypted SecretStorage
   * 2. Invalidate cache
   * 3. Re-verify license with server
   * 4. Emit license:updated event
   *
   * @param licenseKey - License key to store (format: ptah_lic_{64-hex})
   *
   * @example
   * ```typescript
   * await licenseService.setLicenseKey('ptah_lic_a1b2c3...');
   * // Key stored, verified, and license:updated event emitted
   * ```
   */
  async setLicenseKey(licenseKey: string): Promise<void> {
    await this.context.secrets.store(LicenseService.SECRET_KEY, licenseKey);
    this.logger.info('[LicenseService.setLicenseKey] License key stored', {
      keyPrefix: licenseKey.substring(0, 10) + '...',
    });

    // Invalidate cache and re-verify
    this.cache = { status: null, timestamp: null };
    const status = await this.verifyLicense();
    this.emit('license:updated', status);
  }

  /**
   * Remove license key from SecretStorage.
   *
   * TASK_2025_121: Updated for two-tier paid model
   *
   * Flow:
   * 1. Delete key from SecretStorage
   * 2. Update cache to expired tier (extension blocked)
   * 3. Emit license:updated event
   *
   * @example
   * ```typescript
   * await licenseService.clearLicenseKey();
   * // License key removed, tier set to expired
   * ```
   */
  async clearLicenseKey(): Promise<void> {
    await this.context.secrets.delete(LicenseService.SECRET_KEY);
    this.logger.info('[LicenseService.clearLicenseKey] License key removed');

    // TASK_2025_121: Update to expired tier (extension blocked)
    const expiredStatus: LicenseStatus = {
      valid: false,
      tier: 'expired',
      reason: 'not_found',
    };
    this.updateCache(expiredStatus);
    this.emit('license:updated', expiredStatus);
  }

  /**
   * Get cached license status (no network call).
   *
   * IMPORTANT: Does NOT validate cache TTL. Use verifyLicense() for automatic cache validation.
   *
   * @returns Cached status or null if cache is empty
   *
   * @example
   * ```typescript
   * const cached = licenseService.getCachedStatus();
   * if (cached) {
   *   console.log('Cached tier:', cached.tier);
   * }
   * ```
   */
  getCachedStatus(): LicenseStatus | null {
    return this.cache.status;
  }

  /**
   * Force cache invalidation and re-verify.
   *
   * Background revalidation: Call this periodically (e.g., every 24 hours)
   * to check for license expiration.
   *
   * @example
   * ```typescript
   * // Background revalidation (every 24 hours)
   * setInterval(() => licenseService.revalidate(), 24 * 60 * 60 * 1000);
   * ```
   */
  async revalidate(): Promise<void> {
    this.logger.debug('[LicenseService.revalidate] Force revalidation');
    this.cache = { status: null, timestamp: null }; // Invalidate cache
    await this.verifyLicense();
  }

  /**
   * Check if cache is valid (1-hour TTL).
   *
   * @returns true if cache exists and is within TTL window
   */
  private isCacheValid(): boolean {
    if (!this.cache.status || !this.cache.timestamp) return false;
    return Date.now() - this.cache.timestamp < LicenseService.CACHE_TTL_MS;
  }

  /**
   * Update cache with new license status and timestamp.
   *
   * @param status - License status to cache
   */
  private updateCache(status: LicenseStatus): void {
    this.cache = { status, timestamp: Date.now() };
  }

  /**
   * Emit appropriate license event based on validity.
   *
   * Events:
   * - license:verified (if valid)
   * - license:expired (if invalid)
   *
   * @param status - License status to evaluate
   */
  private emitLicenseEvent(status: LicenseStatus): void {
    if (status.valid) {
      this.emit('license:verified', status);
    } else {
      this.emit('license:expired', status);
    }
  }
}
