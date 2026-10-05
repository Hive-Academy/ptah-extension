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
import { FILE_BASED_SETTINGS_DEFAULTS } from '@ptah-extension/platform-core';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import {
  isValidAutoCompactWindow,
  parseAutoCompactWindowEnv,
  SDK_AUTO_COMPACT_WINDOW_MAX,
  SDK_AUTO_COMPACT_WINDOW_MIN,
} from './auto-compact-control';

/**
 * The runtime's own window override. Ptah never sets it; it is read here only
 * so the session-start log can say the runtime will use it instead of the
 * setting.
 */
const AUTO_COMPACT_WINDOW_ENV = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0
  );
}

/**
 * The platform-core default of a budget key. A missing or non-positive default
 * is a programming error (it would otherwise reach callers as `undefined`),
 * so it throws rather than being cast.
 */
function budgetDefault(key: string): number {
  const value: unknown = FILE_BASED_SETTINGS_DEFAULTS[key];
  if (!isPositiveSafeInteger(value)) {
    throw new Error(
      `FILE_BASED_SETTINGS_DEFAULTS has no positive integer default for ${key}`,
    );
  }
  return value;
}

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
  /**
   * The window the runtime takes from `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (it
   * wins over every setting), or `null` when the variable is unset or the
   * runtime would ignore it. Read for the log only; Ptah never forwards it.
   */
  readonly envWindow: number | null;
  /** Per-tool-output cap in tokens (`compaction.toolOutputBudgetTokens`). */
  readonly toolOutputBudgetTokens: number;
  /** Subagent handoff size in tokens (`compaction.subagentHandoffTokens`). */
  readonly subagentHandoffTokens: number;
  /** Session size at which rotation is suggested (`compaction.rotationSuggestTokens`). */
  readonly rotationSuggestTokens: number;
  /** Weighted-token total at which a subagent is stopped (`compaction.subagentStopWeightedTokens`). */
  readonly subagentStopWeightedTokens: number;
}

/**
 * Provides compaction configuration from settings
 *
 * Pattern: Configuration provider (similar to AuthManager)
 * Single Responsibility: Read and validate compaction settings
 */
@injectable()
export class CompactionConfigProvider {
  /** Invalid budget values already warned about (`key:type:value`). */
  private readonly warnedBudgets = new Set<string>();

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
   *
   * `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is read from the process env (the SDK
   * child inherits it). A value the runtime ignores or clamps is warned about
   * so the rejection is visible; the variable itself is left untouched.
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
            validRange: [
              SDK_AUTO_COMPACT_WINDOW_MIN,
              SDK_AUTO_COMPACT_WINDOW_MAX,
            ],
          },
        );
      }
    }

    const envWindow = this.readEnvWindow();

    const compactionConfig: CompactionConfig = {
      enabled,
      contextTokenThreshold,
      envWindow,
      toolOutputBudgetTokens: this.readBudget(
        'compaction.toolOutputBudgetTokens',
      ),
      subagentHandoffTokens: this.readBudget(
        'compaction.subagentHandoffTokens',
      ),
      rotationSuggestTokens: this.readBudget(
        'compaction.rotationSuggestTokens',
      ),
      subagentStopWeightedTokens: this.readBudget(
        'compaction.subagentStopWeightedTokens',
      ),
    };

    this.logger.debug(
      '[CompactionConfigProvider] Retrieved compaction configuration',
      {
        enabled: compactionConfig.enabled,
        contextTokenThreshold: compactionConfig.contextTokenThreshold,
        envWindow: compactionConfig.envWindow,
      },
    );

    return compactionConfig;
  }

  /**
   * Reads one positive-integer budget. Unset is the default; a hand-edited
   * value that is not a positive integer (non-number, non-integer, zero or
   * negative) is warned about and treated as unset.
   */
  private readBudget(key: string): number {
    // One edit site: the default comes from platform-core, which also supplies
    // it when the key is absent; an invalid hand-edited value falls back to it.
    const defaultValue = budgetDefault(key);
    const raw = this.config.get<unknown>(key);
    if (raw === undefined || raw === null) return defaultValue;
    if (isPositiveSafeInteger(raw)) {
      return raw;
    }
    // Called per tool call and per subagent message: warn once per key+value.
    const warnKey = `${key}:${typeof raw}:${String(raw)}`;
    if (!this.warnedBudgets.has(warnKey)) {
      this.warnedBudgets.add(warnKey);
      this.logger.warn(
        `[CompactionConfigProvider] Invalid ${key}, using the default`,
        { providedType: typeof raw, defaultValue },
      );
    }
    return defaultValue;
  }

  /**
   * The runtime's view of `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. Ignored values
   * (not a positive integer) and clamped values (outside
   * `[SDK_AUTO_COMPACT_WINDOW_MIN, SDK_AUTO_COMPACT_WINDOW_MAX]`) are warned
   * about; the raw text is logged only as its length, never echoed.
   */
  private readEnvWindow(): number | null {
    const raw = process.env[AUTO_COMPACT_WINDOW_ENV];
    if (raw === undefined || raw.trim() === '') return null;
    const envWindow = parseAutoCompactWindowEnv(raw);
    if (envWindow === null) {
      this.logger.warn(
        `[CompactionConfigProvider] ${AUTO_COMPACT_WINDOW_ENV} is not a positive integer; the runtime ignores it`,
        { rawLength: raw.length },
      );
      return null;
    }
    if (envWindow !== Number.parseInt(raw.trim(), 10)) {
      this.logger.warn(
        `[CompactionConfigProvider] ${AUTO_COMPACT_WINDOW_ENV} is outside the accepted range; the runtime clamps it`,
        {
          effectiveWindow: envWindow,
          validRange: [
            SDK_AUTO_COMPACT_WINDOW_MIN,
            SDK_AUTO_COMPACT_WINDOW_MAX,
          ],
        },
      );
    }
    return envWindow;
  }
}
