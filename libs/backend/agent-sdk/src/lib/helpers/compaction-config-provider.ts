/**
 * Compaction Configuration Provider - Provides SDK compaction configuration from VS Code settings
 *
 * Responsibilities:
 * - Read compaction settings from VS Code configuration
 * - Provide sensible defaults when settings not configured
 * - Log configuration retrieval for debugging
 *
 * The SDK handles automatic compaction - we only configure thresholds and enable/disable.
 *
 * @see TASK_2025_098 - SDK Session Compaction
 */

import { injectable, inject } from 'tsyringe';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';

/**
 * Compaction configuration settings
 */
export interface CompactionConfig {
  /** Enable automatic compaction (default: true) */
  readonly enabled: boolean;
  /** Token threshold to trigger compaction (default: 100000) */
  readonly contextTokenThreshold: number;
}

/**
 * Default compaction configuration values
 * These are used when VS Code settings are not configured
 */
const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  contextTokenThreshold: 100000,
};

/**
 * Provides compaction configuration from VS Code settings
 *
 * Pattern: Configuration provider (similar to AuthManager)
 * Single Responsibility: Read and provide compaction settings
 *
 * @example
 * ```typescript
 * const config = compactionConfigProvider.getConfig();
 * if (config.enabled) {
 *   // Pass compactionControl to SDK query
 * }
 * ```
 */
@injectable()
export class CompactionConfigProvider {
  constructor(
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(TOKENS.LOGGER) private readonly logger: Logger
  ) {}

  /**
   * Get compaction configuration from VS Code settings
   *
   * Settings keys:
   * - ptah.compaction.enabled: boolean (default: true)
   * - ptah.compaction.threshold: number (default: 100000)
   *
   * @returns CompactionConfig with current settings or defaults
   */
  getConfig(): CompactionConfig {
    // Read settings with defaults
    const enabled =
      this.config.get<boolean>('compaction.enabled') ??
      DEFAULT_COMPACTION_CONFIG.enabled;

    // TASK_2025_098: Validate threshold with type check and minimum value
    // Minimum threshold of 1000 tokens matches package.json schema constraint
    const rawThreshold = this.config.get<number>('compaction.threshold');
    const contextTokenThreshold =
      typeof rawThreshold === 'number' && rawThreshold >= 1000
        ? rawThreshold
        : DEFAULT_COMPACTION_CONFIG.contextTokenThreshold;

    // Log warning if invalid threshold was provided
    if (
      rawThreshold !== undefined &&
      (typeof rawThreshold !== 'number' || rawThreshold < 1000)
    ) {
      this.logger.warn(
        '[CompactionConfigProvider] Invalid threshold value, using default',
        {
          providedValue: rawThreshold,
          providedType: typeof rawThreshold,
          defaultValue: DEFAULT_COMPACTION_CONFIG.contextTokenThreshold,
        }
      );
    }

    const compactionConfig: CompactionConfig = {
      enabled,
      contextTokenThreshold,
    };

    this.logger.debug(
      '[CompactionConfigProvider] Retrieved compaction configuration',
      {
        enabled: compactionConfig.enabled,
        contextTokenThreshold: compactionConfig.contextTokenThreshold,
        usingDefaults:
          enabled === DEFAULT_COMPACTION_CONFIG.enabled &&
          contextTokenThreshold ===
            DEFAULT_COMPACTION_CONFIG.contextTokenThreshold,
      }
    );

    return compactionConfig;
  }
}
