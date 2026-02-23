/**
 * CLI Detection Service
 * TASK_2025_157: Auto-detect installed CLI agents (Gemini, Codex)
 * TASK_2025_158: Added VS Code Language Model adapter
 *
 * Detects on first call and caches results.
 * Registered adapters: Gemini CLI, Codex CLI, VS Code LM.
 * Exposes detection results for MCP tools and namespace.
 */
import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { CliType, CliDetectionResult } from '@ptah-extension/shared';
import type { CliAdapter } from './cli-adapters/cli-adapter.interface';
import { GeminiCliAdapter } from './cli-adapters/gemini-cli.adapter';
import { CodexCliAdapter } from './cli-adapters/codex-cli.adapter';
import { CopilotCliAdapter } from './cli-adapters/copilot-cli.adapter';

@injectable()
export class CliDetectionService {
  private readonly adapters: Map<CliType, CliAdapter> = new Map();
  private detectionCache: Map<CliType, CliDetectionResult> | null = null;
  /** In-flight detection promise to prevent concurrent detection races */
  private detectionInFlight: Promise<CliDetectionResult[]> | null = null;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    // Register headless CLI adapters only (no vscode-lm — that's for Ptah AI chat)
    this.adapters.set('gemini', new GeminiCliAdapter());
    this.adapters.set('codex', new CodexCliAdapter());
    this.adapters.set('copilot', new CopilotCliAdapter());

    this.logger.info(
      '[CliDetection] Service initialized with adapters: gemini, codex, copilot'
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
        '[CliDetection] Detection already in progress, reusing in-flight promise'
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
            `[CliDetection] ${adapter.displayName} not installed`
          );
        }
      } catch (error) {
        this.logger.error(
          `[CliDetection] Error detecting ${adapter.displayName}`,
          error instanceof Error ? error : new Error(String(error))
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
   * Invalidate the detection cache (forces re-detection on next call)
   */
  invalidateCache(): void {
    this.detectionCache = null;
    this.detectionInFlight = null;
  }
}
