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
import type * as vscode from 'vscode';
import EventEmitter from 'eventemitter3';
import axios from 'axios';
import { createPublicKey, verify, KeyObject } from 'crypto';
import {
  resolveEnvironment,
  LICENSE_PUBLIC_KEY_BASE64,
} from '@ptah-extension/shared';
import { Logger } from '../logging';
import { TOKENS } from '../di/tokens';
import type { ConfigManager } from '../config/config-manager';

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
 * Persisted user context for expired/trial-ended users
 *
 * When a license key is auto-cleared due to expiration or trial end,
 * we persist the user's context so that on next restart they see
 * an expiration notice instead of the new-user welcome screen.
 */
interface PreviousUserContext {
  /** Reason the key was cleared */
  reason: 'expired' | 'trial_ended';
  /** User profile from the expired license */
  user?: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  /** Timestamp when context was persisted (ms since epoch) - auto-expires after 90 days */
  persistedAt: number;
}

/**
 * License tier values for the freemium model
 *
 * TASK_2025_128: Freemium model conversion
 * - 'community': FREE forever, always valid, no license required
 * - 'pro': Active Pro subscription ($5/month)
 * - 'trial_pro': Pro plan during 100-day trial
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
 * - No license key: valid: false with reason 'not_found' (triggers registration prompt)
 * - Expired Pro (non-revoked): falls back to Community tier (valid: true)
 * - Revoked licenses: valid: false (blocks extension)
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
  /** Ed25519 signature of the response payload (TASK_2025_188: MITM prevention) */
  signature?: string;
}

/**
 * Determine if a license status represents a premium tier (Pro or Trial Pro).
 *
 * Single source of truth for premium gating logic. Use this function
 * instead of duplicating tier checks across the codebase.
 *
 * Premium = valid license AND (plan.isPremium OR tier is 'pro'/'trial_pro')
 *
 * @param licenseStatus - The license status from verification
 * @returns true if the user has premium features enabled
 */
export function isPremiumTier(licenseStatus: LicenseStatus): boolean {
  return (
    licenseStatus.valid &&
    (licenseStatus.plan?.isPremium === true ||
      licenseStatus.tier === 'pro' ||
      licenseStatus.tier === 'trial_pro')
  );
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
/**
 * LICENSE_PUBLIC_KEY_BASE64 is imported from @ptah-extension/shared
 * (environment.constants.ts) - single source of truth for the Ed25519 public key
 * used to verify license server response signatures (MITM prevention).
 *
 * Generate a key pair with: npx ts-node scripts/generate-license-keys.ts
 */

@injectable()
export class LicenseService extends EventEmitter<LicenseEvents> {
  private static readonly SECRET_KEY = 'ptah.licenseKey';
  private static readonly PERSISTED_CACHE_KEY = 'ptah.licenseCache';
  private static readonly PREVIOUS_USER_CONTEXT_KEY =
    'ptah.previousUserContext';
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
   * Maximum age for previousUserContext before auto-clearing (90 days)
   * Prevents the expiration modal from persisting indefinitely
   */
  private static readonly PREVIOUS_CONTEXT_MAX_AGE_MS =
    90 * 24 * 60 * 60 * 1000; // 90 days

  /**
   * Cached Ed25519 public key for verifying license server response signatures.
   * TASK_2025_188: null means signing verification is disabled (placeholder key).
   */
  private publicKey: KeyObject | null = null;

  /**
   * In-memory cache for quick access (1-hour TTL)
   */
  private cache: {
    status: LicenseStatus | null;
    timestamp: number | null;
  } = { status: null, timestamp: null };

  /** Tracks the last emitted status to suppress duplicate events. */
  private lastEmittedStatus: { valid: boolean; tier: LicenseTierValue } | null =
    null;

  /**
   * Resolve the license server URL.
   *
   * Priority:
   * 1. Setting `ptah.apiUrl` (manual override via ConfigManager)
   * 2. Environment-based: localhost:3000 in dev, api.ptah.live in production
   */
  private get licenseServerUrl(): string {
    const settingOverride = this.configManager.get<string>('apiUrl');
    if (settingOverride) {
      return settingOverride;
    }

    // extensionMode: 2 = Development (matches vscode.ExtensionMode.Development)
    const isDev = this.context.extensionMode === 2;
    return resolveEnvironment(isDev).urls.API_URL;
  }

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
  ) {
    super();
    this.logger.info('[LicenseService.constructor] Service initialized', {
      serverUrl: this.licenseServerUrl,
      cacheTtlMs: LicenseService.CACHE_TTL_MS,
      gracePeriodMs: LicenseService.GRACE_PERIOD_MS,
    });

    // Load and cache the Ed25519 public key for signature verification (TASK_2025_188)
    this.publicKey = this.loadPublicKey();

    // Load persisted cache on initialization (for offline grace period)
    this.loadPersistedCache().then((persistedCache) => {
      if (persistedCache) {
        this.logger.debug(
          '[LicenseService.constructor] Loaded persisted cache',
          {
            tier: persistedCache.status.tier,
            persistedAt: new Date(persistedCache.persistedAt).toISOString(),
            isWithinGracePeriod: this.isWithinGracePeriod(persistedCache),
          },
        );
      }
    });
  }

  /**
   * Load the Ed25519 public key from the embedded constant.
   *
   * TASK_2025_188: Loads the Ed25519 public key for signature verification.
   *
   * @returns KeyObject for Ed25519 verification, or null if key is invalid
   */
  private loadPublicKey(): KeyObject | null {
    try {
      return createPublicKey({
        key: Buffer.from(LICENSE_PUBLIC_KEY_BASE64, 'base64'),
        format: 'der',
        type: 'spki',
      });
    } catch (error) {
      this.logger.error(
        '[LicenseService] Failed to load Ed25519 public key for signature verification',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }
  }

  /**
   * Verify the Ed25519 signature of a license server response.
   *
   * TASK_2025_188: Prevents MITM attacks by verifying that the response
   * was signed by the license server's private key.
   *
   * Verification is graceful:
   * - If no public key is configured (placeholder), returns true (skip verification)
   * - If no signature is present in the response, returns true (server not updated yet)
   * - Only rejects if a signature IS present but IS INVALID
   *
   * @param payload - The response data (without the signature field)
   * @param signature - The base64-encoded Ed25519 signature
   * @returns true if signature is valid or verification is skipped
   */
  private verifySignature(payload: object, signature: string): boolean {
    if (!this.publicKey) {
      // Public key not configured (placeholder) - skip verification
      return true;
    }
    try {
      const data = JSON.stringify(payload, Object.keys(payload).sort());
      return verify(
        null,
        Buffer.from(data),
        this.publicKey,
        Buffer.from(signature, 'base64'),
      );
    } catch (error) {
      this.logger.error('[LicenseService] Signature verification error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Verify license key with server (or return cached result).
   *
   * Flow:
   * 1. Check cache validity (1-hour TTL)
   * 2. Get license key from SecretStorage
   * 3. If no key: return { valid: false, reason: 'not_found' } to trigger registration prompt
   * 4. POST to server /api/v1/licenses/verify
   * 5. If server says invalid (expired/trial_ended/not_found):
   *    auto-clear key and fall back to Community tier
   * 6. ONLY admin revocation returns valid: false (blocks extension)
   * 7. Cache result and emit events
   * 8. On error: return cached status or trigger registration prompt
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
      if (this.isCacheValid() && this.cache.status && this.cache.timestamp) {
        this.logger.debug(
          '[LicenseService.verifyLicense] Returning cached status',
          {
            tier: this.cache.status.tier,
            valid: this.cache.status.valid,
            cacheAge: Date.now() - this.cache.timestamp,
          },
        );
        return this.cache.status;
      }

      // Step 2: Get license key from SecretStorage
      const licenseKey = await this.context.secrets.get(
        LicenseService.SECRET_KEY,
      );

      if (!licenseKey) {
        // Check for previousUserContext (returning user with expired/trial-ended license)
        const previousContext =
          this.context.globalState.get<PreviousUserContext>(
            LicenseService.PREVIOUS_USER_CONTEXT_KEY,
          );

        const isValidContext =
          previousContext &&
          (previousContext.reason === 'expired' ||
            previousContext.reason === 'trial_ended') &&
          typeof previousContext.persistedAt === 'number' &&
          Date.now() - previousContext.persistedAt <
            LicenseService.PREVIOUS_CONTEXT_MAX_AGE_MS;

        if (isValidContext) {
          // Returning user: activate as community with expiration reason
          // This prevents the welcome screen and shows trial-ended modal instead
          const communityWithContext: LicenseStatus = {
            valid: true,
            tier: 'community',
            reason: previousContext.reason,
            user: previousContext.user,
          };
          this.updateCache(communityWithContext);
          this.logger.info(
            '[LicenseService.verifyLicense] Returning user with expired context, activating as community',
            { reason: previousContext.reason },
          );
          return communityWithContext;
        } else if (previousContext) {
          // Invalid structure - clear it
          this.logger.warn(
            '[LicenseService.verifyLicense] Invalid previousUserContext structure, clearing',
          );
          await this.context.globalState.update(
            LicenseService.PREVIOUS_USER_CONTEXT_KEY,
            undefined,
          );
        }

        // No license key and no previous context = prompt user to register
        const noAccountStatus: LicenseStatus = {
          valid: false,
          tier: 'community',
          reason: 'not_found',
        };
        this.updateCache(noAccountStatus);
        this.logger.info(
          '[LicenseService.verifyLicense] No license key found, prompting registration',
        );
        return noAccountStatus;
      }

      // Step 3: Verify with server
      this.logger.debug(
        '[LicenseService.verifyLicense] Verifying with server',
        {
          keyPrefix: licenseKey.substring(0, 10) + '...',
          serverUrl: this.licenseServerUrl,
        },
      );

      try {
        const { data: responseJson } = await axios.post<
          LicenseStatus & { signature?: string }
        >(
          `${this.licenseServerUrl}/api/v1/licenses/verify`,
          { licenseKey },
          { timeout: LicenseService.NETWORK_TIMEOUT_MS },
        );

        // TASK_2025_188: Verify response signature to prevent MITM attacks
        // Extract signature before creating the LicenseStatus object
        const { signature: responseSignature, ...licenseData } = responseJson;
        if (this.publicKey) {
          // When a real public key is configured, signature is mandatory
          if (!responseSignature) {
            throw new Error(
              'License response missing required signature — possible tampering',
            );
          }
          if (!this.verifySignature(licenseData, responseSignature)) {
            this.logger.error(
              '[LicenseService.verifyLicense] License response signature verification failed - possible MITM attack',
            );
            throw new Error(
              'License response signature verification failed — possible tampering',
            );
          }
          this.logger.debug(
            '[LicenseService.verifyLicense] Response signature verified successfully',
          );
        }

        const status: LicenseStatus = licenseData;

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
            },
          );

          // Persist user context before clearing key so returning users
          // see expiration notice instead of new-user welcome screen
          if (status.reason === 'expired' || status.reason === 'trial_ended') {
            const previousContext: PreviousUserContext = {
              reason: status.reason,
              user: status.user,
              persistedAt: Date.now(),
            };
            await this.context.globalState.update(
              LicenseService.PREVIOUS_USER_CONTEXT_KEY,
              previousContext,
            );
            this.logger.debug(
              '[LicenseService.verifyLicense] Persisted previousUserContext',
              { reason: status.reason },
            );
          }

          // Clear the expired/invalid license key so user gets Community tier
          await this.context.secrets.delete(LicenseService.SECRET_KEY);
          await this.clearPersistedCache();

          const communityFallback: LicenseStatus = {
            valid: true,
            tier: 'community',
            reason: status.reason, // Preserve reason so frontend can prompt re-entry
            user: status.user, // Preserve user for this session
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
          },
        );

        return status;
      } catch (fetchError) {
        if (axios.isAxiosError(fetchError) && fetchError.response) {
          const bodySnippet =
            typeof fetchError.response.data === 'string'
              ? fetchError.response.data.substring(0, 200)
              : JSON.stringify(fetchError.response.data).substring(0, 200);
          throw new Error(
            `License verification failed: ${fetchError.response.status} ${fetchError.response.statusText} — ${bodySnippet}`,
          );
        }
        throw fetchError;
      }
    } catch (error) {
      this.logger.error('[LicenseService.verifyLicense] Verification failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        url: this.licenseServerUrl,
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
          },
        );

        // Update in-memory cache from persisted cache
        // Use Date.now() so this grace-period result is cached for the normal TTL,
        // preventing repeated failing network calls on every verifyLicense() invocation
        this.cache = {
          status: persistedCache.status,
          timestamp: Date.now(),
        };

        return persistedCache.status;
      }

      // Outside grace period or no cache - check in-memory cache
      if (this.cache.status) {
        this.logger.warn(
          '[LicenseService.verifyLicense] Returning stale in-memory cached status',
          {
            tier: this.cache.status.tier,
            cacheAge: Date.now() - (this.cache.timestamp ?? 0),
          },
        );
        return this.cache.status;
      }

      // No cache and outside grace period - check if user had a license key
      const licenseKey = await this.context.secrets.get(
        LicenseService.SECRET_KEY,
      );

      if (licenseKey) {
        // User has a key but server is unreachable and grace period expired
        this.logger.warn(
          '[LicenseService.verifyLicense] License key exists but cannot verify (grace period expired)',
        );
        const expiredStatus: LicenseStatus = {
          valid: false,
          tier: 'expired',
          reason: 'expired',
        };
        return expiredStatus;
      }

      // No key at all = prompt registration
      const noAccountStatus: LicenseStatus = {
        valid: false,
        tier: 'community',
        reason: 'not_found',
      };
      return noAccountStatus;
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

    // Clear any stale previousUserContext (user is entering a fresh key)
    await this.context.globalState.update(
      LicenseService.PREVIOUS_USER_CONTEXT_KEY,
      undefined,
    );

    // Invalidate cache and dedup tracker so re-verify emits events
    this.cache = { status: null, timestamp: null };
    this.lastEmittedStatus = null;
    const status = await this.verifyLicense();
    this.emit('license:updated', status);
  }

  /**
   * Remove license key from SecretStorage.
   *
   * Flow:
   * 1. Delete key from SecretStorage
   * 2. Clear persisted cache
   * 3. Update cache to invalid (triggers registration prompt on reload)
   * 4. Emit license:updated event
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
    this.lastEmittedStatus = null;

    // Clear previousUserContext (manual removal = voluntary, not expiration)
    await this.context.globalState.update(
      LicenseService.PREVIOUS_USER_CONTEXT_KEY,
      undefined,
    );

    // No license key = prompt registration on next activation
    const noAccountStatus: LicenseStatus = {
      valid: false,
      tier: 'community',
      reason: 'not_found',
    };
    this.updateCache(noAccountStatus);
    this.emit('license:updated', noAccountStatus);
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
   * Seed a valid community license status into the cache.
   *
   * Used by CLI/TUI platforms that have no registration gate on first boot.
   * Only seeds if the cache is currently empty (does NOT overwrite existing
   * verified statuses from verifyLicense()).
   *
   * @returns true if seeded, false if cache already populated
   */
  seedCommunityStatus(): boolean {
    if (this.cache.status) {
      return false; // Already has a cached status, don't overwrite
    }
    this.updateCache({
      valid: true,
      tier: 'community',
    });
    this.logger.info(
      '[LicenseService.seedCommunityStatus] Seeded valid community status for CLI platform',
    );
    return true;
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
   * Emit appropriate license event only when status actually changes.
   *
   * Events:
   * - license:verified (if valid AND status changed from previous)
   * - license:expired (if invalid AND status changed from previous)
   *
   * Prevents spurious notifications on routine re-verifications where
   * the tier and validity haven't changed.
   *
   * @param status - License status to evaluate
   */
  private emitLicenseEvent(status: LicenseStatus): void {
    const previous = this.lastEmittedStatus;
    if (
      previous &&
      previous.valid === status.valid &&
      previous.tier === status.tier
    ) {
      this.logger.debug(
        '[LicenseService.emitLicenseEvent] Suppressed duplicate event',
        { tier: status.tier, valid: status.valid },
      );
      return;
    }

    this.lastEmittedStatus = { valid: status.valid, tier: status.tier };

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
      persistedCache,
    );

    this.logger.debug(
      '[LicenseService.persistCacheToStorage] Cache persisted to globalState',
      {
        tier: status.tier,
        persistedAt: new Date(persistedCache.persistedAt).toISOString(),
      },
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
      LicenseService.PERSISTED_CACHE_KEY,
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
        '[LicenseService.loadPersistedCache] Invalid persisted cache structure, clearing',
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
      undefined,
    );

    this.logger.debug(
      '[LicenseService.clearPersistedCache] Persisted cache cleared',
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
          },
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
      (remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000),
    );

    if (days > 0) {
      return `${days} day${days === 1 ? '' : 's'} ${hours} hour${
        hours === 1 ? '' : 's'
      }`;
    }
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
}
