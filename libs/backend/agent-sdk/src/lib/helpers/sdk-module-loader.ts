/**
 * SDK Module Loader - Loads and caches the bundled Claude Agent SDK query function
 *
 * The Claude Agent SDK is bundled into the extension via esbuild. The SDK's
 * query function is imported dynamically (required for ESM/CJS interop) and
 * cached for reuse across sessions.
 *
 * Single Responsibility: Load and cache the SDK query function
 *
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { QueryFunction } from '../types/sdk-types/claude-sdk.types';
import { ClaudeCliDetector } from '../detector/claude-cli-detector';
import { SDK_TOKENS } from '../di/tokens';
import { SdkError } from '../errors';

/**
 * Manages SDK module loading and caching
 *
 * Responsibilities:
 * - Providing the bundled @anthropic-ai/claude-agent-sdk query function
 * - Caching the query function for reuse
 * - Pre-loading during extension activation
 * - Performance timing and logging
 * - Resolving the Claude CLI js path for pathToClaudeCodeExecutable
 */
@injectable()
export class SdkModuleLoader {
  /**
   * Cached SDK query function - set once and reused for all sessions.
   * This avoids repeated dynamic imports on every chat session start.
   */
  private cachedSdkQuery: QueryFunction | null = null;

  /** Cached CLI js path resolved from detector (undefined = not yet resolved) */
  private cachedCliJsPath: string | null | undefined = undefined;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_CLI_DETECTOR)
    private readonly cliDetector: ClaudeCliDetector,
  ) {}

  /**
   * Get the SDK query function (cached after first use).
   *
   * The SDK is bundled with the extension via esbuild. The dynamic import()
   * is resolved at bundle time -- no runtime package resolution is needed.
   * Uses dynamic import() for ESM/CJS interop compatibility.
   *
   * @returns The SDK query function
   */
  async getQueryFunction(): Promise<QueryFunction> {
    if (this.cachedSdkQuery) {
      return this.cachedSdkQuery;
    }

    const startTime = performance.now();
    this.logger.info('[SdkModuleLoader] Loading bundled Claude Agent SDK...');

    try {
      const sdkModule =
        (await import('@anthropic-ai/claude-agent-sdk')) as Record<
          string,
          unknown
        >;
      const query = sdkModule['query'];

      if (typeof query !== 'function') {
        throw new SdkError(
          `SDK module loaded but 'query' export is ${typeof query}, expected function`,
        );
      }

      const elapsed = (performance.now() - startTime).toFixed(2);
      this.cachedSdkQuery = query as QueryFunction;
      this.logger.info(
        `[SdkModuleLoader] SDK query function cached (bundled, ${elapsed}ms)`,
      );

      return this.cachedSdkQuery;
    } catch (error) {
      const elapsed = (performance.now() - startTime).toFixed(2);
      this.logger.error(
        `[SdkModuleLoader] Failed to load Claude Agent SDK query function after ${elapsed}ms`,
        { error: error instanceof Error ? error.message : String(error) },
      );
      throw error;
    }
  }

  /**
   * Pre-load the SDK during extension activation (non-blocking).
   * This shifts the import cost from first chat to activation time,
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
        `[SdkModuleLoader] SDK pre-loaded successfully (${elapsed}ms)`,
      );
    } catch (error) {
      const elapsed = (performance.now() - startTime).toFixed(2);
      this.logger.warn(
        `[SdkModuleLoader] SDK pre-load failed after ${elapsed}ms (will retry on first use)`,
        { error: error instanceof Error ? error.message : String(error) },
      );
      throw error;
    }
  }

  /**
   * Get the resolved path to the Claude Code CLI executable (cli.js).
   *
   * Uses the CLI detector to find the installation, then returns the cliJsPath.
   * This path is needed by SDK query options as `pathToClaudeCodeExecutable`
   * to override the baked-in import.meta.url resolution that fails in production
   *.
   *
   * Caches the result after first resolution. Returns null if CLI not found.
   */
  async getCliJsPath(): Promise<string | null> {
    if (this.cachedCliJsPath !== undefined) {
      return this.cachedCliJsPath;
    }

    try {
      const installation = await this.cliDetector.findExecutable();
      this.cachedCliJsPath = installation?.cliJsPath ?? null;
      if (this.cachedCliJsPath) {
        this.logger.info(
          `[SdkModuleLoader] CLI js path resolved: ${this.cachedCliJsPath}`,
        );
      } else {
        this.logger.debug(
          '[SdkModuleLoader] CLI js path not found via detector',
        );
      }
    } catch {
      this.cachedCliJsPath = null;
    }

    return this.cachedCliJsPath;
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
    this.cachedCliJsPath = undefined;
    this.logger.debug('[SdkModuleLoader] SDK cache cleared');
  }
}
