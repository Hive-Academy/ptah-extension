/**
 * Token Counter Service
 *
 * Provides accurate token counting using VS Code's native Language Model API (2025).
 * Falls back to estimation when offline or API unavailable.
 *
 * Research Finding 1: Native VS Code API eliminates custom token estimation
 * Evidence: VS Code 2025 LanguageModelChat.countTokens() provides actual tokenizer accuracy
 */

import { injectable } from 'tsyringe';
// APPROVED EXCEPTION: vscode.lm is a VS Code-specific Language Model API
// with no platform-agnostic equivalent. The service falls back gracefully
// to estimation when the API is unavailable.
import * as vscode from 'vscode';

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

  /**
   * Count tokens in text using native VS Code API with fallback
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

    let count: number;

    try {
      // Use native VS Code Language Model API (2025)
      count = await this.countTokensNative(text);
    } catch (error) {
      // Fallback to estimation if API unavailable
      console.warn('Token counting API unavailable, using estimation', error);
      count = this.estimateTokens(text);
    }

    // Cache result
    if (cacheKey) {
      this.setCached(cacheKey, count);
    }

    return count;
  }

  /**
   * Count tokens using native VS Code Language Model API
   *
   * @param text Text to count tokens
   * @returns Accurate token count from model tokenizer
   * @throws Error if API unavailable
   */
  private async countTokensNative(text: string): Promise<number> {
    // Select available chat models (prefer Copilot)
    const models = await vscode.lm.selectChatModels({
      vendor: 'copilot',
    });

    if (models.length === 0) {
      throw new Error('No language models available');
    }

    // Use first available model for token counting
    const model = models[0];
    return await model.countTokens(text);
  }

  /**
   * Estimate tokens using conservative character-based heuristic
   *
   * Fallback for offline scenarios or when native API unavailable.
   * Uses ~4 characters per token estimate (conservative for most languages).
   *
   * @param text Text to estimate tokens for
   * @returns Estimated token count
   */
  private estimateTokens(text: string): number {
    // Conservative estimate: ~4 characters per token
    // This matches GPT tokenizer averages for English text
    return Math.ceil(text.length / 4);
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
   * Get maximum input tokens for available model
   *
   * @returns Max input tokens or null if API unavailable
   */
  async getMaxInputTokens(): Promise<number | null> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (models.length === 0) {
        return null;
      }
      return models[0].maxInputTokens;
    } catch (error) {
      console.warn('Failed to get max input tokens', error);
      return null;
    }
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
