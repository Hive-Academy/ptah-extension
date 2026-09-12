/**
 * Compaction Configuration Provider - reads Ptah's compaction settings at the
 * ConfigManager boundary and validates them.
 *
 * The agent runtime owns automatic compaction. Ptah contributes at most two
 * opinions, applied through the flag-tier settings (see
 * `resolveAutoCompactControl`): auto compaction off, or an explicit window.
 * An UNSET threshold is not a default of any size — it means the runtime
 * decides.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import {
  isValidAutoCompactWindow,
  SDK_AUTO_COMPACT_WINDOW_MAX,
  SDK_AUTO_COMPACT_WINDOW_MIN,
} from './auto-compact-control';

/**
 * Compaction configuration settings
 */
export interface CompactionConfig {
  /** Enable automatic compaction (default: true). Manual /compact is unaffected. */
  readonly enabled: boolean;
  /**
   * User-set auto-compact window in tokens, passed to the runtime as
   * `autoCompactWindow`. `null` when unset or invalid: the runtime decides.
   */
  readonly contextTokenThreshold: number | null;
}

/**
 * Provides compaction configuration from settings
 *
 * Pattern: Configuration provider (similar to AuthManager)
 * Single Responsibility: Read and validate compaction settings
 */
@injectable()
export class CompactionConfigProvider {
  constructor(
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Get compaction configuration from settings
   *
   * Settings keys:
   * - ptah.compaction.enabled: boolean (default: true)
   * - ptah.compaction.threshold: integer in [100000, 1000000], or unset
   *
   * A persisted threshold outside that range, or not an integer, is warned
   * about and treated as UNSET. It is never clamped: the runtime would then
   * compact at a size the user did not choose.
   */
  getConfig(): CompactionConfig {
    const enabled = this.config.get<boolean>('compaction.enabled') ?? true;
    const rawThreshold = this.config.get<unknown>('compaction.threshold');

    let contextTokenThreshold: number | null = null;
    if (rawThreshold !== undefined && rawThreshold !== null) {
      if (isValidAutoCompactWindow(rawThreshold)) {
        contextTokenThreshold = rawThreshold;
      } else {
        this.logger.warn(
          '[CompactionConfigProvider] Invalid compaction threshold, treating it as unset so the runtime decides',
          {
            providedValue:
              typeof rawThreshold === 'number' ? rawThreshold : undefined,
            providedType: typeof rawThreshold,
            validRange: [SDK_AUTO_COMPACT_WINDOW_MIN, SDK_AUTO_COMPACT_WINDOW_MAX],
          },
        );
      }
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
      },
    );

    return compactionConfig;
  }
}
