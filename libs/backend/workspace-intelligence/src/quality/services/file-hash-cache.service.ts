/**
 * File Hash Cache Service
 *
 * Maintains an in-memory cache of file content hashes for incremental analysis.
 * Uses SHA-256 hashing to detect file changes and stores per-file anti-pattern
 * detection results to avoid re-analyzing unchanged files.
 *
 * Features:
 * - SHA-256 content hashing (16-char hex prefix for space efficiency)
 * - LRU eviction at 10,000 entries
 * - 30-minute TTL for cache entries
 * - Per-file anti-pattern result caching
 * - Cache hit/miss statistics tracking
 *
 * TASK_2025_144: Phase F - Performance Optimizations
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import { createHash } from 'crypto';
import type { AntiPattern } from '@ptah-extension/shared';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { IFileHashCacheService, FileHashCacheEntry } from '../interfaces';

// ============================================
// Constants
// ============================================

/** Maximum number of entries before LRU eviction triggers */
const MAX_CACHE_SIZE = 10_000;

/** Cache entry TTL in milliseconds (30 minutes) */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Length of hex hash prefix to store (64 bits = negligible collision for <10k files) */
const HASH_PREFIX_LENGTH = 16;

// ============================================
// Service Implementation
// ============================================

/**
 * FileHashCacheService
 *
 * Implements SHA-256 content hashing with LRU eviction and TTL-based expiry
 * for incremental quality analysis. Stores detected anti-patterns per file
 * to enable cache-aware analysis that skips unchanged files.
 *
 * Design: In-memory Map with LRU eviction when exceeding 10,000 entries.
 * Entries older than 30 minutes are treated as stale and excluded from cache hits.
 *
 * @example
 * ```typescript
 * const cache = container.resolve<FileHashCacheService>(
 *   TOKENS.FILE_HASH_CACHE_SERVICE
 * );
 *
 * if (cache.hasChanged(filePath, content)) {
 *   const patterns = await detector.detectPatternsAsync(content, filePath);
 *   cache.setCachedPatterns(filePath, patterns);
 *   cache.updateHash(filePath, content);
 * } else {
 *   const cached = cache.getCachedPatterns(filePath);
 * }
 * ```
 */
@injectable()
export class FileHashCacheService implements IFileHashCacheService {
  /** In-memory cache: filePath -> { hash, analysisTimestamp, patterns } */
  private readonly cache: Map<string, FileHashCacheEntry> = new Map();

  /** Total cache lookup attempts for hit rate calculation */
  private lookupCount = 0;

  /** Total cache hits for hit rate calculation */
  private hitCount = 0;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.debug('FileHashCacheService initialized', {
      maxSize: MAX_CACHE_SIZE,
      ttlMs: CACHE_TTL_MS,
    });
  }

  /**
   * Compute a SHA-256 hash of the given content.
   * Returns a 16-character hex prefix for space-efficient storage.
   *
   * @param content - File content to hash
   * @returns 16-char hex hash prefix
   */
  computeHash(content: string): string {
    return createHash('sha256')
      .update(content)
      .digest('hex')
      .substring(0, HASH_PREFIX_LENGTH);
  }

  /**
   * Get the cached hash for a file path.
   * Returns undefined if not cached or entry has expired.
   * Updates the access timestamp for LRU tracking.
   */
  getHash(filePath: string): string | undefined {
    const entry = this.cache.get(filePath);

    if (!entry) {
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(filePath);
      return undefined;
    }

    // Update access timestamp for LRU tracking
    entry.lastAccessTimestamp = Date.now();

    return entry.hash;
  }

  /**
   * Set the hash for a file path with current timestamp.
   * Initializes an empty patterns array.
   */
  setHash(filePath: string, hash: string): void {
    this.evictIfNeeded();

    const now = Date.now();
    this.cache.set(filePath, {
      hash,
      analysisTimestamp: now,
      lastAccessTimestamp: now,
      patterns: [],
    });
  }

  /**
   * Check if a file's content has changed since last cached hash.
   * Computes a fresh hash and compares to the cached value.
   * Returns true (changed) if:
   * - No cached entry exists
   * - Cached entry has expired (TTL exceeded)
   * - Computed hash differs from cached hash
   */
  hasChanged(filePath: string, content: string): boolean {
    this.lookupCount++;

    const entry = this.cache.get(filePath);

    if (!entry) {
      return true;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(filePath);
      return true;
    }

    const currentHash = this.computeHash(content);
    const changed = currentHash !== entry.hash;

    if (!changed) {
      this.hitCount++;
      // Update access timestamp for LRU tracking
      entry.lastAccessTimestamp = Date.now();
    }

    return changed;
  }

  /**
   * Update the cached hash for a file after fresh analysis.
   * Preserves existing patterns if any (caller should use setCachedPatterns separately).
   */
  updateHash(filePath: string, content: string): void {
    this.evictIfNeeded();

    const hash = this.computeHash(content);
    const existing = this.cache.get(filePath);
    const now = Date.now();

    this.cache.set(filePath, {
      hash,
      analysisTimestamp: now,
      lastAccessTimestamp: now,
      patterns: existing?.patterns ?? [],
    });
  }

  /**
   * Get cached anti-pattern results for a file.
   * Returns undefined if not cached or cache entry has expired.
   * Updates the access timestamp for LRU tracking.
   */
  getCachedPatterns(filePath: string): AntiPattern[] | undefined {
    const entry = this.cache.get(filePath);

    if (!entry) {
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(filePath);
      return undefined;
    }

    // Update access timestamp for LRU tracking
    entry.lastAccessTimestamp = Date.now();

    return entry.patterns;
  }

  /**
   * Store anti-pattern results for a file in the cache.
   * Updates the analysis timestamp and preserves the existing hash.
   */
  setCachedPatterns(filePath: string, patterns: AntiPattern[]): void {
    const entry = this.cache.get(filePath);

    if (entry) {
      entry.patterns = patterns;
      entry.analysisTimestamp = Date.now();
    } else {
      this.logger.warn(
        'setCachedPatterns called for file without cached hash, creating entry',
        { filePath }
      );
      this.evictIfNeeded();
      const now = Date.now();
      this.cache.set(filePath, {
        hash: '',
        analysisTimestamp: now,
        lastAccessTimestamp: now,
        patterns,
      });
    }
  }

  /**
   * Get all file paths that have valid (non-expired) cache entries.
   */
  getCachedFiles(): string[] {
    const now = Date.now();
    const validFiles: string[] = [];

    for (const [filePath, entry] of this.cache) {
      if (now - entry.analysisTimestamp <= CACHE_TTL_MS) {
        validFiles.push(filePath);
      }
    }

    return validFiles;
  }

  /**
   * Clear all cached entries and reset statistics.
   */
  clearCache(): void {
    const previousSize = this.cache.size;
    this.cache.clear();
    this.lookupCount = 0;
    this.hitCount = 0;

    this.logger.debug('File hash cache cleared', {
      entriesRemoved: previousSize,
    });
  }

  /**
   * Get cache statistics for monitoring and diagnostics.
   */
  getStats(): { totalCached: number; cacheHitRate: number } {
    return {
      totalCached: this.cache.size,
      cacheHitRate: this.lookupCount > 0 ? this.hitCount / this.lookupCount : 0,
    };
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Check if a cache entry has expired based on TTL.
   */
  private isExpired(entry: FileHashCacheEntry): boolean {
    return Date.now() - entry.analysisTimestamp > CACHE_TTL_MS;
  }

  /**
   * Evict oldest entries when cache exceeds maximum size.
   * Uses LRU strategy: removes entries with the oldest analysisTimestamp.
   */
  private evictIfNeeded(): void {
    if (this.cache.size < MAX_CACHE_SIZE) {
      return;
    }

    // Find and remove the oldest entries (evict 10% to avoid frequent eviction)
    const evictionCount = Math.ceil(MAX_CACHE_SIZE * 0.1);
    const entries = Array.from(this.cache.entries()).sort(
      ([, a], [, b]) => a.lastAccessTimestamp - b.lastAccessTimestamp
    );

    for (let i = 0; i < evictionCount && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
    }

    this.logger.debug('LRU cache eviction performed', {
      evicted: evictionCount,
      remaining: this.cache.size,
    });
  }
}
