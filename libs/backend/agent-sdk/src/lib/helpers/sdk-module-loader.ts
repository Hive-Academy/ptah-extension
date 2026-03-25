/**
 * SDK Module Loader - Handles dynamic import and caching of Claude Agent SDK
 *
 * TASK_2025_221: The Claude Agent SDK is NOT bundled with the extension.
 * Like the Copilot SDK and Codex SDK, it is resolved at runtime from the
 * user's system using the same resolveAndImportSdk pattern:
 *
 * 1. Try bare import('@anthropic-ai/claude-agent-sdk') - works if user has it
 *    installed globally or locally via npm
 * 2. Fall back to locating the package relative to the Claude CLI binary path
 *    (npm global installs place sibling packages in the same node_modules tree)
 * 3. Throw a descriptive error telling the user to install the Claude CLI
 *
 * Single Responsibility: Load and cache the SDK query function
 *
 * @see TASK_2025_102 - Extracted to reduce SdkAgentAdapter complexity
 * @see sdk-resolver.ts in llm-abstraction for the canonical pattern
 */

import { injectable, inject } from 'tsyringe';
import { realpathSync, existsSync } from 'fs';
import { dirname, join, sep } from 'path';
import { pathToFileURL } from 'url';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { QueryFunction } from '../types/sdk-types/claude-sdk.types';
import { ClaudeCliDetector } from '../detector/claude-cli-detector';
import { SDK_TOKENS } from '../di/tokens';

const SDK_PACKAGE_NAME = '@anthropic-ai/claude-agent-sdk';

/**
 * Dynamic import wrapper. With esbuild ESM output, native import() works directly
 * and is not transformed by the bundler. This thin wrapper keeps a single call site
 * for easier debugging.
 */
async function dynamicImport(specifier: string): Promise<unknown> {
  return import(specifier);
}

/**
 * Given a CLI binary path (possibly a symlink), resolve the real path
 * and walk up the directory tree to find the SDK package in a sibling
 * node_modules directory.
 *
 * On npm global installs, the binary is symlinked from the global bin/
 * directory to the package in lib/node_modules/. Walking up from the
 * real path finds the global node_modules where sibling SDK packages
 * are also installed.
 */
function findPackageFromBinary(
  binaryPath: string,
  packageName: string,
): string | null {
  try {
    const realPath = realpathSync(binaryPath);
    let dir = dirname(realPath);

    // Walk up looking for node_modules/<packageName>
    // Stop at filesystem root
    const root = dir.substring(0, dir.indexOf(sep) + 1) || sep;
    let iterations = 0;
    while (dir !== root && iterations++ < 50) {
      const candidate = join(dir, 'node_modules', ...packageName.split('/'));
      if (existsSync(join(candidate, 'package.json'))) {
        return candidate;
      }
      dir = dirname(dir);
    }
  } catch {
    // realpathSync failed -- binary path invalid
  }
  return null;
}

/**
 * Manages SDK module loading and caching
 *
 * Responsibilities:
 * - Runtime resolution of @anthropic-ai/claude-agent-sdk (NOT bundled)
 * - Caching the query function for reuse
 * - Pre-loading during extension activation
 * - Performance timing and logging
 * - Falling back to CLI binary path for SDK discovery
 */
@injectable()
export class SdkModuleLoader {
  /**
   * Cached SDK query function - imported once and reused for all sessions
   * This avoids the overhead of dynamic import() on every chat session start
   */
  private cachedSdkQuery: QueryFunction | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_CLI_DETECTOR)
    private readonly cliDetector: ClaudeCliDetector,
  ) {}

  /**
   * Get or import the SDK query function (cached after first use)
   * This avoids repeated dynamic imports which add latency on each session start.
   *
   * Resolution order:
   * 1. Standard Node.js module resolution (bare import)
   * 2. Locate package relative to Claude CLI binary path
   * 3. Fail with descriptive error + install instructions
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
      '[SdkModuleLoader] Resolving Claude Agent SDK at runtime (first use)...',
    );

    const sdkModule = await this.resolveAndImportSdk();
    const query = sdkModule['query'] as QueryFunction;

    const elapsed = (performance.now() - startTime).toFixed(2);
    this.cachedSdkQuery = query;
    this.logger.info(
      `[SdkModuleLoader] SDK resolved and cached successfully (${elapsed}ms)`,
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

  /**
   * Resolve and dynamically import the Claude Agent SDK.
   *
   * This follows the same pattern as resolveAndImportSdk() in
   * libs/backend/llm-abstraction/src/lib/services/cli-adapters/sdk-resolver.ts
   * used by Copilot SDK and Codex SDK adapters.
   *
   * The SDK is NOT bundled with the extension. It is discovered at runtime:
   * 1. Try standard Node.js module resolution (bare import)
   * 2. Fall back to locating the package relative to the Claude CLI binary
   * 3. Throw descriptive error with install instructions
   */
  private async resolveAndImportSdk(): Promise<Record<string, unknown>> {
    let lastError: unknown;

    // Attempt 1: Standard Node.js module resolution
    // Works if user has @anthropic-ai/claude-agent-sdk installed globally or locally
    try {
      this.logger.debug(
        '[SdkModuleLoader] Attempt 1: Standard module resolution...',
      );
      const mod = (await dynamicImport(SDK_PACKAGE_NAME)) as Record<
        string,
        unknown
      >;
      this.logger.debug(
        '[SdkModuleLoader] SDK resolved via standard module resolution',
      );
      return mod;
    } catch (e) {
      lastError = e;
      this.logger.debug(
        '[SdkModuleLoader] Standard resolution failed, trying CLI binary fallback...',
        { error: e instanceof Error ? e.message : String(e) },
      );
    }

    // Attempt 2: Resolve from Claude CLI binary's install tree
    // npm global installs place the CLI binary as a symlink from global bin/
    // to lib/node_modules/@anthropic-ai/claude-code/. Walking up from the
    // real path finds the global node_modules where the SDK is also installed.
    try {
      const installation = await this.cliDetector.findExecutable();
      if (installation?.path) {
        this.logger.debug(
          `[SdkModuleLoader] Attempt 2: Resolving from CLI binary at ${installation.path}...`,
        );
        const sdkPath = findPackageFromBinary(
          installation.path,
          SDK_PACKAGE_NAME,
        );
        if (sdkPath) {
          // Use file:// URL for cross-platform ESM import from absolute paths
          const fileUrl = pathToFileURL(sdkPath).href;
          try {
            const mod = (await dynamicImport(fileUrl)) as Record<
              string,
              unknown
            >;
            this.logger.debug(
              `[SdkModuleLoader] SDK resolved from CLI binary tree: ${sdkPath}`,
            );
            return mod;
          } catch (e) {
            lastError = e;
            this.logger.debug(
              `[SdkModuleLoader] Found SDK at ${sdkPath} but import failed`,
              { error: e instanceof Error ? e.message : String(e) },
            );
          }
        } else {
          this.logger.debug(
            '[SdkModuleLoader] SDK package not found relative to CLI binary',
          );
        }
      } else {
        this.logger.debug(
          '[SdkModuleLoader] Claude CLI not found on system, skipping binary fallback',
        );
      }
    } catch (e) {
      this.logger.debug(
        '[SdkModuleLoader] CLI detector failed during SDK resolution',
        { error: e instanceof Error ? e.message : String(e) },
      );
    }

    // All attempts failed -- throw descriptive error
    const detail = lastError instanceof Error ? lastError.message : '';
    throw new Error(
      `Claude Agent SDK (${SDK_PACKAGE_NAME}) is not installed or could not be loaded. ` +
        `${detail ? `(${detail}) ` : ''}` +
        `Please install the Claude CLI: npm install -g @anthropic-ai/claude-code`,
    );
  }
}
