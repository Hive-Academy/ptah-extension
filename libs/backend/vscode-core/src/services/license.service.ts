/**
 * License Service (coordinator)
 *
 * Manages license verification, caching, and status events for VS Code extension.
 * Uses VS Code's SecretStorage for encrypted license key storage.
 *
 * Provides license verification with a 1-hour cache plus a 7-day offline grace
 * period for network failures.
 *
 * This class is a thin coordinator; actual work is delegated to three
 * library-internal helpers:
 *   - {@link LicenseFetcher} — HTTP + Ed25519 signature verification
 *   - {@link LicenseCache} — in-memory + persisted cache + grace period
 *   - {@link LicenseStateBroadcaster} — dedupe logic for license events
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import type * as vscode from 'vscode';
import EventEmitter from 'eventemitter3';
import { Logger } from '../logging';
import { TOKENS } from '../di/tokens';
import type { ConfigManager } from '../config/config-manager';
import { LicenseFetcher } from './license/license-fetcher';
import { LicenseCache, SECRET_KEY } from './license/license-cache';
import { LicenseStateBroadcaster } from './license/license-state-broadcaster';
import type {
  LicenseStatus,
  LicenseEvents,
  PreviousUserContext,
} from './license/license-types';

// Re-export public types so the barrel (`src/index.ts`) and external consumers
// see the same names at the same import paths as before the split.
export type {
  LicenseStatus,
  LicenseEvents,
  LicenseTierValue,
} from './license/license-types';

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
 * License Service Implementation (coordinator)
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
 *
 * LICENSE_PUBLIC_KEY_BASE64 is imported from @ptah-extension/shared
 * (environment.constants.ts) — single source of truth for the Ed25519 public key
 * used to verify license server response signatures (MITM prevention).
 *
 * Generate a key pair with: npx ts-node scripts/generate-license-keys.ts
 */
@injectable()
export class LicenseService extends EventEmitter<LicenseEvents> {
  private readonly fetcher: LicenseFetcher;
  private readonly cache: LicenseCache;
  private readonly broadcaster: LicenseStateBroadcaster;
  private readonly ready: Promise<void>;

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER)
    configManager: ConfigManager,
  ) {
    super();

    this.fetcher = new LicenseFetcher(context, logger, configManager);
    this.cache = new LicenseCache(context, logger);
    this.broadcaster = new LicenseStateBroadcaster(logger);

    this.logger.info('[LicenseService.constructor] Service initialized', {
      serverUrl: this.fetcher.licenseServerUrl,
      cacheTtlMs: 60 * 60 * 1000,
      gracePeriodMs: 7 * 24 * 60 * 60 * 1000,
    });

    // Load persisted cache on initialization (for offline grace period)
    this.ready = this.cache
      .loadPersistedCache()
      .then((persisted) => {
        if (persisted) {
          this.logger.debug(
            '[LicenseService] Hydrated cache from persisted snapshot',
            {
              tier: persisted.status?.tier,
              persistedAt: persisted.persistedAt,
            },
          );
        }
      })
      .catch((err) => {
        this.logger.warn('[LicenseService] Failed to hydrate persisted cache', {
          error: err,
        });
      });
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
   */
  async verifyLicense(): Promise<LicenseStatus> {
    try {
      await this.ready;

      // Step 1: Check cache (1-hour TTL)
      if (this.cache.isCacheValid()) {
        const cachedStatus = this.cache.getCached();
        const cachedTimestamp = this.cache.getCachedTimestamp();
        if (cachedStatus && cachedTimestamp) {
          this.logger.debug(
            '[LicenseService.verifyLicense] Returning cached status',
            {
              tier: cachedStatus.tier,
              valid: cachedStatus.valid,
              cacheAge: Date.now() - cachedTimestamp,
            },
          );
          // Seed the broadcaster so a future network re-verify of the same
          // status is suppressed rather than firing a spurious license:verified.
          this.broadcaster.seed(cachedStatus);
          return cachedStatus;
        }
      }

      // Step 2: Get license key from SecretStorage
      const licenseKey = await this.context.secrets.get(SECRET_KEY);

      if (!licenseKey) {
        // Check for previousUserContext (returning user with expired/trial-ended license)
        const previous = this.cache.loadPreviousUserContext();

        if (previous.kind === 'valid') {
          // Returning user: activate as community with expiration reason
          // This prevents the welcome screen and shows trial-ended modal instead
          const communityWithContext: LicenseStatus = {
            valid: true,
            tier: 'community',
            reason: previous.context.reason,
            user: previous.context.user,
          };
          this.cache.updateCache(communityWithContext);
          this.logger.info(
            '[LicenseService.verifyLicense] Returning user with expired context, activating as community',
            { reason: previous.context.reason },
          );
          return communityWithContext;
        } else if (previous.kind === 'invalid') {
          // Invalid structure - clear it
          this.logger.warn(
            '[LicenseService.verifyLicense] Invalid previousUserContext structure, clearing',
          );
          await this.cache.clearPreviousUserContext();
        }

        // No license key and no previous context = prompt user to register
        const noAccountStatus: LicenseStatus = {
          valid: false,
          tier: 'community',
          reason: 'not_found',
        };
        this.cache.updateCache(noAccountStatus);
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
          serverUrl: this.fetcher.licenseServerUrl,
        },
      );

      const status = await this.fetcher.fetchLicenseStatus(licenseKey);

      // Community fallback for expired Pro users.
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
          await this.cache.savePreviousUserContext(previousContext);
          this.logger.debug(
            '[LicenseService.verifyLicense] Persisted previousUserContext',
            { reason: status.reason },
          );
        }

        // Clear the expired/invalid license key so user gets Community tier
        await this.context.secrets.delete(SECRET_KEY);
        await this.cache.clearPersistedCache();

        const communityFallback: LicenseStatus = {
          valid: true,
          tier: 'community',
          reason: status.reason, // Preserve reason so frontend can prompt re-entry
          user: status.user, // Preserve user for this session
        };
        this.cache.updateCache(communityFallback);
        this.emit('license:updated', communityFallback);
        return communityFallback;
      }

      // Step 4: Update cache and emit events
      this.cache.updateCache(status);
      this.emitLicenseEvent(status);

      // Step 5: Persist cache to globalState (for offline grace period).
      // Only persist valid licenses (we don't want to cache expired status)
      if (status.valid) {
        await this.cache.persistCacheToStorage(status);
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
    } catch (error) {
      this.logger.error('[LicenseService.verifyLicense] Verification failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        url: this.fetcher.licenseServerUrl,
      });

      // Check offline grace period cache.
      // Grace period is for NETWORK FAILURES only (not expired licenses).
      const persistedCache = await this.cache.loadPersistedCache();

      if (persistedCache && this.cache.isWithinGracePeriod(persistedCache)) {
        // Within grace period - use persisted cache
        this.logger.warn(
          '[LicenseService.verifyLicense] Network error - using offline cached license (grace period)',
          {
            tier: persistedCache.status.tier,
            persistedAt: new Date(persistedCache.persistedAt).toISOString(),
            gracePeriodRemaining:
              this.cache.getGracePeriodRemaining(persistedCache),
          },
        );

        // Update in-memory cache from persisted cache
        // Use Date.now() so this grace-period result is cached for the normal TTL,
        // preventing repeated failing network calls on every verifyLicense() invocation
        this.cache.setCache(persistedCache.status, Date.now());

        return persistedCache.status;
      }

      // Outside grace period or no cache - check in-memory cache
      const inMemoryStatus = this.cache.getCached();
      if (inMemoryStatus) {
        this.logger.warn(
          '[LicenseService.verifyLicense] Returning stale in-memory cached status',
          {
            tier: inMemoryStatus.tier,
            cacheAge: Date.now() - (this.cache.getCachedTimestamp() ?? 0),
          },
        );
        return inMemoryStatus;
      }

      // No cache and outside grace period - check if user had a license key
      const licenseKey = await this.context.secrets.get(SECRET_KEY);

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
   */
  async setLicenseKey(licenseKey: string): Promise<void> {
    await this.context.secrets.store(SECRET_KEY, licenseKey);
    this.logger.info('[LicenseService.setLicenseKey] License key stored', {
      keyPrefix: licenseKey.substring(0, 10) + '...',
    });

    // Clear any stale previousUserContext (user is entering a fresh key)
    await this.cache.clearPreviousUserContext();

    // Invalidate cache and dedup tracker so re-verify emits events
    this.cache.invalidate();
    this.broadcaster.reset();
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
   */
  async clearLicenseKey(): Promise<void> {
    await this.context.secrets.delete(SECRET_KEY);
    this.logger.info('[LicenseService.clearLicenseKey] License key removed');

    // Clear persisted cache as well (no grace period for manual removal).
    await this.cache.clearPersistedCache();
    this.broadcaster.reset();

    // Clear previousUserContext (manual removal = voluntary, not expiration)
    await this.cache.clearPreviousUserContext();

    // No license key = prompt registration on next activation
    const noAccountStatus: LicenseStatus = {
      valid: false,
      tier: 'community',
      reason: 'not_found',
    };
    this.cache.updateCache(noAccountStatus);
    this.emit('license:updated', noAccountStatus);
  }

  /**
   * Get cached license status (no network call).
   *
   * IMPORTANT: Does NOT validate cache TTL. Use verifyLicense() for automatic cache validation.
   *
   * @returns Cached status or null if cache is empty
   */
  getCachedStatus(): LicenseStatus | null {
    return this.cache.getCached();
  }

  /**
   * Force cache invalidation and re-verify.
   *
   * Background revalidation: Call this periodically (e.g., every 24 hours)
   * to check for license expiration.
   */
  async revalidate(): Promise<void> {
    this.logger.debug('[LicenseService.revalidate] Force revalidation');
    this.cache.invalidate();
    await this.verifyLicense();
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
    if (this.cache.getCached()) {
      return false; // Already has a cached status, don't overwrite
    }
    this.cache.updateCache({
      valid: true,
      tier: 'community',
    });
    this.logger.info(
      '[LicenseService.seedCommunityStatus] Seeded valid community status for CLI platform',
    );
    return true;
  }

  /**
   * Emit appropriate license event only when status actually changes.
   *
   * Delegates dedup decisions to {@link LicenseStateBroadcaster}.
   *
   * @param status - License status to evaluate
   */
  private emitLicenseEvent(status: LicenseStatus): void {
    const decision = this.broadcaster.decide(status);
    if (decision === 'verified') {
      this.emit('license:verified', status);
    } else if (decision === 'expired') {
      this.emit('license:expired', status);
    }
    // 'suppressed' → no emit
  }
}
