/**
 * License Service
 *
 * Manages license verification, caching, and status events for VS Code extension.
 * Uses VS Code's SecretStorage for encrypted license key storage.
 *
 * TASK_2025_075 Batch 5: License verification with 1-hour cache
 * TASK_2025_121 Batch 3: Added offline grace period (7 days) for network failures
 *
 * Offline Grace Period:
 * - When network verification fails, the service checks for a persisted cache
 * - If cache exists and is within 7-day grace period, use cached license status
 * - Grace period is for NETWORK FAILURES only (not expired licenses)
 * - Clear warning logged when using offline cache
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import EventEmitter from 'eventemitter3';
import { Logger } from '../logging';
import { TOKENS } from '../di/tokens';

/**
 * Persisted cache structure for offline grace period
 *
 * Stored in VS Code globalState to survive restarts.
 * Used when network verification fails.
 */
interface PersistedLicenseCache {
  /** Cached license status */
  status: LicenseStatus;
  /** Timestamp when cache was persisted (ms since epoch) */
  persistedAt: number;
  /** Timestamp when cache was last validated (ms since epoch) */
  lastValidatedAt: number;
}

/**
 * License tier values for the freemium model
 *
 * TASK_2025_128: Freemium model conversion
 * - 'community': FREE forever, always valid, no license required
 * - 'pro': Active Pro subscription ($5/month)
 * - 'trial_pro': Pro plan during 14-day trial
 * - 'expired': Revoked or payment failed only (NOT for unlicensed users)
 */
export type LicenseTierValue =
  | 'community' // FREE tier, always valid
  | 'pro'
  | 'trial_pro'
  | 'expired'; // Only for revoked/explicitly expired

/**
 * License verification status returned by the server
 *
 * TASK_2025_128: Updated for freemium model
 * - Community tier (no license key) has valid: true
 * - Only expired/revoked licenses have valid: false
 */
export interface LicenseStatus {
  /** Whether the license is valid (Community = always true) */
  valid: boolean;
  /** Current license tier (community, pro, trial_pro, or expired) */
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
  /** User profile data from license server (TASK_2025_129) */
  user?: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
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
  private static readonly PERSISTED_CACHE_KEY = 'ptah.licenseCache';
  private static readonly LICENSE_SERVER_URL = 'http://localhost:3000'; // || 'https://api.ptah.dev';
  private static readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  private static readonly NETWORK_TIMEOUT_MS = 5000; // 5 seconds

  /**
   * Offline grace period: 7 days
   *
   * TASK_2025_121 Batch 3: Grace period for network failures
   * - When network verification fails, use persisted cache if within grace period
   * - Grace period is ONLY for network failures (not expired licenses)
   * - After grace period, license is treated as expired
   */
  private static readonly GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  /**
   * In-memory cache for quick access (1-hour TTL)
   */
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
      gracePeriodMs: LicenseService.GRACE_PERIOD_MS,
    });

    // Load persisted cache on initialization (for offline grace period)
    this.loadPersistedCache().then((persistedCache) => {
      if (persistedCache) {
        this.logger.debug(
          '[LicenseService.constructor] Loaded persisted cache',
          {
            tier: persistedCache.status.tier,
            persistedAt: new Date(persistedCache.persistedAt).toISOString(),
            isWithinGracePeriod: this.isWithinGracePeriod(persistedCache),
          }
        );
      }
    });
  }

  /**
   * Verify license key with server (or return cached result).
   *
   * TASK_2025_128: Freemium model with Community fallback
   *
   * Flow:
   * 1. Check cache validity (1-hour TTL)
   * 2. Get license key from SecretStorage
   * 3. If no key: return Community tier (FREE, valid)
   * 4. POST to server /api/v1/licenses/verify
   * 5. If server says invalid (expired/trial_ended/not_found):
   *    auto-clear key and fall back to Community tier
   * 6. ONLY admin revocation returns valid: false (blocks extension)
   * 7. Cache result and emit events
   * 8. On error: return cached status or Community tier
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
        // TASK_2025_128: No license key = Community tier (FREE, valid)
        const communityStatus: LicenseStatus = {
          valid: true, // CHANGED from false - Community is valid
          tier: 'community', // CHANGED from 'expired' - Community tier
          // No reason field - Community is a valid state, not an error
        };
        this.updateCache(communityStatus);
        this.logger.info(
          '[LicenseService.verifyLicense] No license key found, returning Community tier'
        );
        return communityStatus;
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

        // TASK_2025_128: Community fallback for expired Pro users
        // When server says license is invalid (expired/trial_ended/not_found),
        // automatically fall back to Community tier instead of blocking.
        // ONLY explicit revocation by admin should block the user.
        if (!status.valid && status.reason !== 'revoked') {
          this.logger.info(
            '[LicenseService.verifyLicense] License invalid (non-revoked), falling back to Community tier',
            {
              originalTier: status.tier,
              reason: status.reason,
            }
          );

          // Clear the expired/invalid license key so user gets Community tier
          await this.context.secrets.delete(LicenseService.SECRET_KEY);
          await this.clearPersistedCache();

          const communityFallback: LicenseStatus = {
            valid: true,
            tier: 'community',
          };
          this.updateCache(communityFallback);
          this.emit('license:updated', communityFallback);
          return communityFallback;
        }

        // Step 4: Update cache and emit events
        this.updateCache(status);
        this.emitLicenseEvent(status);

        // Step 5: Persist cache to globalState (TASK_2025_121 - offline grace period)
        // Only persist valid licenses (we don't want to cache expired status)
        if (status.valid) {
          await this.persistCacheToStorage(status);
        }

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

      // TASK_2025_121: Check offline grace period cache
      // Grace period is for NETWORK FAILURES only (not expired licenses)
      const persistedCache = await this.loadPersistedCache();

      if (persistedCache && this.isWithinGracePeriod(persistedCache)) {
        // Within grace period - use persisted cache
        this.logger.warn(
          '[LicenseService.verifyLicense] Network error - using offline cached license (grace period)',
          {
            tier: persistedCache.status.tier,
            persistedAt: new Date(persistedCache.persistedAt).toISOString(),
            gracePeriodRemaining: this.getGracePeriodRemaining(persistedCache),
          }
        );

        // Update in-memory cache from persisted cache
        this.cache = {
          status: persistedCache.status,
          timestamp: persistedCache.lastValidatedAt,
        };

        return persistedCache.status;
      }

      // Outside grace period or no cache - check in-memory cache
      if (this.cache.status) {
        this.logger.warn(
          '[LicenseService.verifyLicense] Returning stale in-memory cached status',
          {
            tier: this.cache.status.tier,
            cacheAge: Date.now() - this.cache.timestamp!,
          }
        );
        return this.cache.status;
      }

      // TASK_2025_128: No cache and outside grace period = Community tier (FREE, valid)
      // Users without a license key still get the free Community tier
      const communityStatus: LicenseStatus = {
        valid: true,
        tier: 'community',
      };
      return communityStatus;
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
   * TASK_2025_128: Updated for freemium model
   *
   * Flow:
   * 1. Delete key from SecretStorage
   * 2. Update cache to Community tier (FREE, valid)
   * 3. Emit license:updated event
   *
   * @example
   * ```typescript
   * await licenseService.clearLicenseKey();
   * // License key removed, downgraded to Community tier
   * ```
   */
  async clearLicenseKey(): Promise<void> {
    await this.context.secrets.delete(LicenseService.SECRET_KEY);
    this.logger.info('[LicenseService.clearLicenseKey] License key removed');

    // TASK_2025_121: Clear persisted cache as well (no grace period for manual removal)
    await this.clearPersistedCache();

    // TASK_2025_128: Downgrade to Community tier (not expired)
    const communityStatus: LicenseStatus = {
      valid: true, // CHANGED from false - Community is valid
      tier: 'community', // CHANGED from 'expired' - Community tier
    };
    this.updateCache(communityStatus);
    this.emit('license:updated', communityStatus);
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

  // ============================================================
  // TASK_2025_121 Batch 3: Offline Grace Period Methods
  // ============================================================

  /**
   * Persist license cache to VS Code globalState
   *
   * Persisted cache survives VS Code restarts and is used for offline grace period.
   * Only called when license verification succeeds (valid license).
   *
   * @param status - Valid license status to persist
   */
  private async persistCacheToStorage(status: LicenseStatus): Promise<void> {
    const persistedCache: PersistedLicenseCache = {
      status,
      persistedAt: Date.now(),
      lastValidatedAt: Date.now(),
    };

    await this.context.globalState.update(
      LicenseService.PERSISTED_CACHE_KEY,
      persistedCache
    );

    this.logger.debug(
      '[LicenseService.persistCacheToStorage] Cache persisted to globalState',
      {
        tier: status.tier,
        persistedAt: new Date(persistedCache.persistedAt).toISOString(),
      }
    );
  }

  /**
   * Load persisted cache from VS Code globalState
   *
   * Used for offline grace period when network verification fails.
   *
   * @returns Persisted cache or null if not found
   */
  private async loadPersistedCache(): Promise<PersistedLicenseCache | null> {
    const persistedCache = this.context.globalState.get<PersistedLicenseCache>(
      LicenseService.PERSISTED_CACHE_KEY
    );

    if (!persistedCache) {
      return null;
    }

    // Validate cache structure
    if (
      !persistedCache.status ||
      typeof persistedCache.persistedAt !== 'number'
    ) {
      this.logger.warn(
        '[LicenseService.loadPersistedCache] Invalid persisted cache structure, clearing'
      );
      await this.clearPersistedCache();
      return null;
    }

    return persistedCache;
  }

  /**
   * Clear persisted cache from VS Code globalState
   *
   * Called when license key is removed or cache is invalid.
   */
  private async clearPersistedCache(): Promise<void> {
    await this.context.globalState.update(
      LicenseService.PERSISTED_CACHE_KEY,
      undefined
    );

    this.logger.debug(
      '[LicenseService.clearPersistedCache] Persisted cache cleared'
    );
  }

  /**
   * Check if persisted cache is within grace period (7 days)
   *
   * Grace period is for NETWORK FAILURES only:
   * - Cache must exist
   * - Cache must be within 7-day grace period
   * - Original cached license must have been valid
   * - License must not have expired since caching (expiresAt check)
   *
   * @param cache - Persisted cache to check
   * @returns true if within grace period and license not expired
   */
  private isWithinGracePeriod(cache: PersistedLicenseCache): boolean {
    // Grace period only applies to valid licenses
    if (!cache.status.valid) {
      return false;
    }

    // TASK_2025_121: Check if license has expired since caching
    // Even during grace period, if expiresAt has passed, license is invalid
    if (cache.status.expiresAt) {
      const expiresAt = new Date(cache.status.expiresAt).getTime();
      if (Date.now() > expiresAt) {
        this.logger.info(
          '[LicenseService.isWithinGracePeriod] Cached license has expired',
          {
            expiresAt: cache.status.expiresAt,
            now: new Date().toISOString(),
          }
        );
        return false;
      }
    }

    const gracePeriodEnd = cache.persistedAt + LicenseService.GRACE_PERIOD_MS;
    return Date.now() < gracePeriodEnd;
  }

  /**
   * Get remaining time in grace period (in human-readable format)
   *
   * @param cache - Persisted cache
   * @returns Remaining time string (e.g., "3 days 5 hours")
   */
  private getGracePeriodRemaining(cache: PersistedLicenseCache): string {
    const gracePeriodEnd = cache.persistedAt + LicenseService.GRACE_PERIOD_MS;
    const remainingMs = gracePeriodEnd - Date.now();

    if (remainingMs <= 0) {
      return '0 days';
    }

    const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
    const hours = Math.floor(
      (remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000)
    );

    if (days > 0) {
      return `${days} day${days === 1 ? '' : 's'} ${hours} hour${
        hours === 1 ? '' : 's'
      }`;
    }
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
}
