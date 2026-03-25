/**
 * SDK Module Loader - Handles dynamic import and caching of Claude Agent SDK
 *
 * Extracted from SdkAgentAdapter to separate SDK loading concerns.
 * The SDK is dynamically imported as an ESM module (externalized, resolved
 * from node_modules) and cached to avoid repeated import overhead (~100-200ms per import).
 *
 * Single Responsibility: Load and cache the SDK query function
 *
 * @see TASK_2025_102 - Extracted to reduce SdkAgentAdapter complexity
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { QueryFunction } from '../types/sdk-types/claude-sdk.types';

/**
 * Manages SDK module loading and caching
 *
 * Responsibilities:
 * - Dynamic import of @anthropic-ai/claude-agent-sdk
 * - Caching the query function for reuse
 * - Pre-loading during extension activation
 * - Performance timing and logging
 */
@injectable()
export class SdkModuleLoader {
  /**
   * Cached SDK query function - imported once and reused for all sessions
   * This avoids the overhead of dynamic import() on every chat session start
   */
  private cachedSdkQuery: QueryFunction | null = null;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Get or import the SDK query function (cached after first use)
   * This avoids repeated dynamic imports which add latency on each session start.
   *
   * Performance: SDK import takes ~100-200ms on first call, subsequent calls are instant.
   *
   * @returns The SDK query function
   */
  async getQueryFunction(): Promise<QueryFunction> {
    if (this.cachedSdkQuery) {
      return this.cachedSdkQuery;
    }

    const startTime = performance.now();
    this.logger.info(
      '[SdkModuleLoader] Importing Claude Agent SDK (first use)...'
    );

    // Dynamic import the ESM SDK module (externalized, resolved from node_modules)
    const sdkModule = await import('@anthropic-ai/claude-agent-sdk');
    const query = sdkModule.query as QueryFunction;

    const elapsed = (performance.now() - startTime).toFixed(2);
    this.cachedSdkQuery = query;
    this.logger.info(
      `[SdkModuleLoader] SDK imported and cached successfully (${elapsed}ms)`
    );

    return query;
  }

  /**
   * Pre-load the SDK during extension activation (non-blocking).
   * This shifts the ~100-200ms import cost from first chat to activation time,
   * making the first user interaction feel instant.
   *
   * Call this during extension activation after initialize():
   * ```typescript
   * sdkModuleLoader.preload().catch(err => logger.warn('SDK preload failed', err));
   * ```
   */
  async preload(): Promise<void> {
    const startTime = performance.now();
    this.logger.info('[SdkModuleLoader] Pre-loading SDK during activation...');

    try {
      await this.getQueryFunction();
      const elapsed = (performance.now() - startTime).toFixed(2);
      this.logger.info(
        `[SdkModuleLoader] SDK pre-loaded successfully (${elapsed}ms)`
      );
    } catch (error) {
      const elapsed = (performance.now() - startTime).toFixed(2);
      this.logger.warn(
        `[SdkModuleLoader] SDK pre-load failed after ${elapsed}ms (will retry on first use)`,
        { error: error instanceof Error ? error.message : String(error) }
      );
      throw error;
    }
  }

  /**
   * Check if SDK is already loaded/cached
   */
  isLoaded(): boolean {
    return this.cachedSdkQuery !== null;
  }

  /**
   * Clear the cached SDK (useful for testing or re-initialization)
   */
  clearCache(): void {
    this.cachedSdkQuery = null;
    this.logger.debug('[SdkModuleLoader] SDK cache cleared');
  }
}
