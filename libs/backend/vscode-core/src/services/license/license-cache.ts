/**
 * License Cache (Wave C7a — TASK_2025_291)
 *
 * Extracted from {@link LicenseService}.
 *
 * Responsibilities:
 * - In-memory 1-hour TTL cache
 * - Persisted cache in VS Code globalState (offline grace period)
 * - 7-day grace period logic for network failures (TASK_2025_121)
 * - Persistence of previousUserContext (expired/trial-ended user memory)
 *
 * This helper is **library-internal** — it is not `@injectable()` and is not
 * exported from the public barrel. {@link LicenseService} owns a single
 * instance that is constructed in its constructor.
 *
 * @packageDocumentation
 */

import type * as vscode from 'vscode';
import type { Logger } from '../../logging';
import type {
  LicenseStatus,
  PersistedLicenseCache,
  PreviousUserContext,
} from './license-types';

/** Storage key for the encrypted license key (SecretStorage). */
export const SECRET_KEY = 'ptah.licenseKey';
/** Storage key for the persisted offline-grace-period cache. */
export const PERSISTED_CACHE_KEY = 'ptah.licenseCache';
/** Storage key for the persisted previous-user context. */
export const PREVIOUS_USER_CONTEXT_KEY = 'ptah.previousUserContext';

/** 1-hour in-memory cache TTL. */
export const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Offline grace period: 7 days.
 *
 * TASK_2025_121 Batch 3: Grace period for network failures
 * - When network verification fails, use persisted cache if within grace period
 * - Grace period is ONLY for network failures (not expired licenses)
 * - After grace period, license is treated as expired
 */
export const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Maximum age for previousUserContext before auto-clearing (90 days).
 * Prevents the expiration modal from persisting indefinitely.
 */
export const PREVIOUS_CONTEXT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * In-memory + persisted license cache.
 *
 * Preserves the exact read/write ordering of the original
 * {@link LicenseService}. Log messages and storage keys are byte-identical.
 */
export class LicenseCache {
  /**
   * In-memory cache for quick access (1-hour TTL)
   */
  private cache: {
    status: LicenseStatus | null;
    timestamp: number | null;
  } = { status: null, timestamp: null };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
  ) {}

  // ==========================================================================
  // In-memory cache
  // ==========================================================================

  /**
   * Get the currently cached status without any TTL validation.
   *
   * Mirrors the public `LicenseService.getCachedStatus()` semantics.
   */
  getCached(): LicenseStatus | null {
    return this.cache.status;
  }

  /**
   * Get the timestamp (ms since epoch) of the current in-memory cache entry,
   * or `null` if empty.
   */
  getCachedTimestamp(): number | null {
    return this.cache.timestamp;
  }

  /**
   * Check if cache is valid (1-hour TTL).
   *
   * @returns true if cache exists and is within TTL window
   */
  isCacheValid(): boolean {
    if (!this.cache.status || !this.cache.timestamp) return false;
    return Date.now() - this.cache.timestamp < CACHE_TTL_MS;
  }

  /**
   * Update cache with new license status and a fresh `Date.now()` timestamp.
   *
   * @param status - License status to cache
   */
  updateCache(status: LicenseStatus): void {
    this.cache = { status, timestamp: Date.now() };
  }

  /**
   * Overwrite the in-memory cache with an explicit (status, timestamp) pair.
   *
   * Used by the grace-period fallback path to set the cache to the persisted
   * status with `Date.now()` as the timestamp — preventing repeated failing
   * network calls on every `verifyLicense()` invocation.
   */
  setCache(status: LicenseStatus, timestamp: number): void {
    this.cache = { status, timestamp };
  }

  /**
   * Clear the in-memory cache only.
   */
  invalidate(): void {
    this.cache = { status: null, timestamp: null };
  }

  // ==========================================================================
  // Persisted cache (globalState)
  // ==========================================================================

  /**
   * Persist license cache to VS Code globalState.
   *
   * Persisted cache survives VS Code restarts and is used for offline grace period.
   * Only called when license verification succeeds (valid license).
   *
   * @param status - Valid license status to persist
   */
  async persistCacheToStorage(status: LicenseStatus): Promise<void> {
    const persistedCache: PersistedLicenseCache = {
      status,
      persistedAt: Date.now(),
      lastValidatedAt: Date.now(),
    };

    await this.context.globalState.update(PERSISTED_CACHE_KEY, persistedCache);

    this.logger.debug(
      '[LicenseService.persistCacheToStorage] Cache persisted to globalState',
      {
        tier: status.tier,
        persistedAt: new Date(persistedCache.persistedAt).toISOString(),
      },
    );
  }

  /**
   * Load persisted cache from VS Code globalState.
   *
   * Used for offline grace period when network verification fails.
   *
   * @returns Persisted cache or null if not found
   */
  async loadPersistedCache(): Promise<PersistedLicenseCache | null> {
    const persistedCache =
      this.context.globalState.get<PersistedLicenseCache>(PERSISTED_CACHE_KEY);

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
   * Clear persisted cache from VS Code globalState.
   *
   * Called when license key is removed or cache is invalid.
   */
  async clearPersistedCache(): Promise<void> {
    await this.context.globalState.update(PERSISTED_CACHE_KEY, undefined);

    this.logger.debug(
      '[LicenseService.clearPersistedCache] Persisted cache cleared',
    );
  }

  // ==========================================================================
  // Grace period
  // ==========================================================================

  /**
   * Check if persisted cache is within grace period (7 days).
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
  isWithinGracePeriod(cache: PersistedLicenseCache): boolean {
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

    const gracePeriodEnd = cache.persistedAt + GRACE_PERIOD_MS;
    return Date.now() < gracePeriodEnd;
  }

  /**
   * Get remaining time in grace period (in human-readable format).
   *
   * @param cache - Persisted cache
   * @returns Remaining time string (e.g., "3 days 5 hours")
   */
  getGracePeriodRemaining(cache: PersistedLicenseCache): string {
    const gracePeriodEnd = cache.persistedAt + GRACE_PERIOD_MS;
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

  // ==========================================================================
  // Previous user context
  // ==========================================================================

  /**
   * Load the persisted previousUserContext, validating its structure and age.
   *
   * Returns a discriminated result:
   * - `{ kind: 'valid', context }` — structurally valid and within 90-day max age
   * - `{ kind: 'invalid', raw }` — a raw value exists but is not a valid context;
   *   caller should clear it
   * - `{ kind: 'none' }` — no context stored
   */
  loadPreviousUserContext():
    | { kind: 'valid'; context: PreviousUserContext }
    | { kind: 'invalid'; raw: PreviousUserContext | undefined }
    | { kind: 'none' } {
    const previousContext = this.context.globalState.get<PreviousUserContext>(
      PREVIOUS_USER_CONTEXT_KEY,
    );

    if (!previousContext) {
      return { kind: 'none' };
    }

    const isValidContext =
      (previousContext.reason === 'expired' ||
        previousContext.reason === 'trial_ended') &&
      typeof previousContext.persistedAt === 'number' &&
      Date.now() - previousContext.persistedAt < PREVIOUS_CONTEXT_MAX_AGE_MS;

    if (isValidContext) {
      return { kind: 'valid', context: previousContext };
    }

    return { kind: 'invalid', raw: previousContext };
  }

  /**
   * Persist a previousUserContext entry to globalState.
   */
  async savePreviousUserContext(ctx: PreviousUserContext): Promise<void> {
    await this.context.globalState.update(PREVIOUS_USER_CONTEXT_KEY, ctx);
  }

  /**
   * Clear the previousUserContext entry from globalState.
   */
  async clearPreviousUserContext(): Promise<void> {
    await this.context.globalState.update(PREVIOUS_USER_CONTEXT_KEY, undefined);
  }
}
