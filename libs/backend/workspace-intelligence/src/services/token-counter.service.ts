/**
 * Token Counter Service
 *
 * Provides token counting using platform-agnostic ITokenCounter abstraction.
 * VS Code: Uses native LM API with gpt-tokenizer fallback.
 * Electron: Uses gpt-tokenizer BPE tokenization.
 * Includes LRU caching for repeated counts.
 */

import { injectable, inject } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ITokenCounter } from '@ptah-extension/platform-core';

/**
 * LRU Cache entry for token counts
 */
interface CacheEntry {
  /** Cached token count */
  count: number;
  /** Timestamp of cache entry */
  timestamp: number;
}

/**
 * Token counter with native API support and fallback estimation
 */
@injectable()
export class TokenCounterService {
  private cache = new Map<string, CacheEntry>();
  private readonly cacheMaxSize = 1000;
  private readonly cacheTTL = 300000; // 5 minutes

  constructor(
    @inject(PLATFORM_TOKENS.TOKEN_COUNTER)
    private readonly tokenCounter: ITokenCounter,
  ) {}

  /**
   * Count tokens in text using platform-specific ITokenCounter backend.
   * Results are cached when a cacheKey is provided.
   *
   * @param text Text to count tokens for
   * @param cacheKey Optional cache key for repeated counts
   * @returns Token count
   */
  async countTokens(text: string, cacheKey?: string): Promise<number> {
    // Check cache first
    if (cacheKey) {
      const cached = this.getCached(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }

    const count = await this.tokenCounter.countTokens(text);

    // Cache result
    if (cacheKey) {
      this.setCached(cacheKey, count);
    }

    return count;
  }

  /**
   * Get cached token count if valid
   *
   * @param key Cache key
   * @returns Cached count or null if not found/expired
   */
  private getCached(key: string): number | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    const now = Date.now();
    if (now - entry.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    return entry.count;
  }

  /**
   * Set cached token count with LRU eviction
   *
   * @param key Cache key
   * @param count Token count to cache
   */
  private setCached(key: string, count: number): void {
    // Evict oldest entries if cache full
    if (this.cache.size >= this.cacheMaxSize) {
      // Simple LRU: delete first (oldest) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      count,
      timestamp: Date.now(),
    });
  }

  /**
   * Get maximum input tokens for available model.
   * Delegates to the platform-specific ITokenCounter implementation.
   *
   * @returns Max input tokens or null if unavailable
   */
  async getMaxInputTokens(): Promise<number | null> {
    return this.tokenCounter.getMaxInputTokens();
  }

  /**
   * Clear token count cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Dispose service and cleanup resources
   */
  dispose(): void {
    this.clearCache();
  }
}
