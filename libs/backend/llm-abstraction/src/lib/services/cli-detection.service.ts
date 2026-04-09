/**
 * CLI Detection Service
 * TASK_2025_157: Auto-detect installed CLI agents (Gemini, Codex)
 * TASK_2025_158: Added VS Code Language Model adapter
 * TASK_2025_162: Added Copilot SDK adapter with permission bridge
 * TASK_2025_169: Removed Copilot CLI fallback, SDK is the only adapter
 *
 * Detects on first call and caches results.
 * Registered adapters: Gemini CLI, Codex CLI, Copilot SDK.
 * Exposes detection results for MCP tools and namespace.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { CliType, CliDetectionResult } from '@ptah-extension/shared';
import type {
  CliAdapter,
  CliModelInfo,
} from './cli-adapters/cli-adapter.interface';
import { GeminiCliAdapter } from './cli-adapters/gemini-cli.adapter';
import { CodexCliAdapter } from './cli-adapters/codex-cli.adapter';
import { CopilotSdkAdapter } from './cli-adapters/copilot-sdk.adapter';
import { CopilotPermissionBridge } from './cli-adapters/copilot-permission-bridge';
import { CursorCliAdapter } from './cli-adapters/cursor-cli.adapter';

@injectable()
export class CliDetectionService {
  private readonly adapters: Map<CliType, CliAdapter> = new Map();
  private detectionCache: Map<CliType, CliDetectionResult> | null = null;
  /** In-flight detection promise to prevent concurrent detection races */
  private detectionInFlight: Promise<CliDetectionResult[]> | null = null;
  /** Cached model lists per CLI type */
  private modelCache: Map<CliType, CliModelInfo[]> | null = null;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.adapters.set('gemini', new GeminiCliAdapter());
    this.adapters.set('codex', new CodexCliAdapter());

    // Copilot SDK adapter with permission bridge (TASK_2025_162)
    const permissionBridge = new CopilotPermissionBridge();
    this.adapters.set('copilot', new CopilotSdkAdapter(permissionBridge));

    this.adapters.set('cursor', new CursorCliAdapter());

    this.logger.info(
      '[CliDetection] Service initialized with adapters: gemini, codex, copilot, cursor',
    );
  }

  /**
   * Detect all registered CLI agents.
   * Results are cached after first call. Call invalidateCache() to re-detect.
   * Uses promise deduplication to prevent race conditions when called concurrently.
   */
  async detectAll(): Promise<CliDetectionResult[]> {
    if (this.detectionCache) {
      return Array.from(this.detectionCache.values());
    }

    // Deduplicate concurrent calls: reuse in-flight detection promise
    if (this.detectionInFlight) {
      this.logger.debug(
        '[CliDetection] Detection already in progress, reusing in-flight promise',
      );
      return this.detectionInFlight;
    }

    this.detectionInFlight = this.doDetectAll();

    try {
      return await this.detectionInFlight;
    } finally {
      this.detectionInFlight = null;
    }
  }

  /**
   * Internal detection implementation.
   */
  private async doDetectAll(): Promise<CliDetectionResult[]> {
    this.logger.info('[CliDetection] Detecting installed CLI agents...');
    const results = new Map<CliType, CliDetectionResult>();

    for (const [name, adapter] of this.adapters) {
      try {
        const result = await adapter.detect();
        results.set(name, result);
        if (result.installed) {
          this.logger.info(`[CliDetection] ${adapter.displayName} detected`, {
            path: result.path,
            version: result.version,
          });
        } else {
          this.logger.debug(
            `[CliDetection] ${adapter.displayName} not installed`,
          );
        }
      } catch (error) {
        this.logger.error(
          `[CliDetection] Error detecting ${adapter.displayName}`,
          error instanceof Error ? error : new Error(String(error)),
        );
        results.set(name, {
          cli: name,
          installed: false,
          supportsSteer: false,
        });
      }
    }

    this.detectionCache = results;
    return Array.from(results.values());
  }

  /**
   * Get detection result for a specific CLI
   */
  async getDetection(cli: CliType): Promise<CliDetectionResult | undefined> {
    const all = await this.detectAll();
    return all.find((r) => r.cli === cli);
  }

  /**
   * Get list of installed CLIs only
   */
  async getInstalledClis(): Promise<CliDetectionResult[]> {
    const all = await this.detectAll();
    return all.filter((r) => r.installed);
  }

  /**
   * Get the adapter for a specific CLI
   */
  getAdapter(cli: CliType): CliAdapter | undefined {
    return this.adapters.get(cli);
  }

  /**
   * List available models for all installed CLIs that support listModels().
   * Results are cached until invalidateCache() is called.
   */
  async listModelsForAll(): Promise<Record<string, CliModelInfo[]>> {
    if (this.modelCache) {
      const result: Record<string, CliModelInfo[]> = {};
      for (const [cli, models] of this.modelCache) {
        result[cli] = models;
      }
      return result;
    }

    const detections = await this.detectAll();
    const cache = new Map<CliType, CliModelInfo[]>();

    for (const detection of detections) {
      if (!detection.installed) continue;

      const adapter = this.adapters.get(detection.cli);
      if (!adapter?.listModels) continue;

      try {
        const models = await adapter.listModels();
        cache.set(detection.cli, models);
      } catch (error) {
        this.logger.warn(
          `[CliDetection] Failed to list models for ${detection.cli}`,
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }

    this.modelCache = cache;

    const result: Record<string, CliModelInfo[]> = {};
    for (const [cli, models] of cache) {
      result[cli] = models;
    }
    return result;
  }

  /**
   * Invalidate the detection cache (forces re-detection on next call)
   */
  invalidateCache(): void {
    this.detectionCache = null;
    this.detectionInFlight = null;
    this.modelCache = null;
  }

  /**
   * Ensure CLI OAuth tokens are fresh (non-blocking background task).
   * Currently only Codex requires OAuth token refresh.
   * Call during extension startup to avoid stale-token fallbacks on first use.
   */
  async refreshCliTokens(): Promise<void> {
    const codexAdapter = this.adapters.get('codex');
    if (codexAdapter?.ensureTokensFresh) {
      const fresh = await codexAdapter.ensureTokensFresh();
      this.logger.info(
        `[CliDetection] Codex token refresh: ${
          fresh ? 'fresh' : 'stale/unavailable'
        }`,
      );
      // Invalidate model cache so next listModels() fetches with fresh token
      if (fresh) {
        this.modelCache = null;
      }
    }
  }
}
