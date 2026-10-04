/**
 * Session budget configuration provider (TASK_2026_597 N7) — reads the
 * `sessionBudget.*` settings at the ConfigManager boundary and validates them
 * against the shared bounds table.
 *
 * The keys are file-based (`~/.ptah/settings.json`) and `settings:set` writes
 * them without validating values, so every read is checked here: a value
 * outside its bounds, of the wrong type, or a tighten/handoff pair out of
 * order is WARNed (once per key and value) and read as the default. The
 * settings are read on every call with no cache, so a change is seen on the
 * next evaluation.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import {
  SESSION_BUDGET_SETTINGS,
  isSessionBudgetPercentOrderValid,
  type SessionBudgetBooleanSetting,
  type SessionBudgetConfig,
  type SessionBudgetEnumSetting,
  type SessionBudgetNumberSetting,
  type SessionBudgetUnit,
} from '@ptah-extension/shared';

type SettingReader = (key: string) => unknown;

/** Dedupe key for the tighten/handoff cross-field warning. */
const PERCENT_ORDER_WARN_KEY = 'sessionBudget.tightenPercent<handoffPercent';
/** Dedupe key for the unreadable-store warning. */
const STORE_WARN_KEY = 'sessionBudget.*';

/** The configuration every invalid or unreadable value falls back to. */
export const SESSION_BUDGET_DEFAULT_CONFIG: SessionBudgetConfig = {
  enabled: SESSION_BUDGET_SETTINGS.enabled.default,
  unit: SESSION_BUDGET_SETTINGS.unit.default,
  tokens: SESSION_BUDGET_SETTINGS.tokens.default,
  usd: SESSION_BUDGET_SETTINGS.usd.default,
  fallbackWeightedTokens:
    SESSION_BUDGET_SETTINGS.fallbackWeightedTokens.default,
  tightenPercent: SESSION_BUDGET_SETTINGS.tightenPercent.default,
  handoffPercent: SESSION_BUDGET_SETTINGS.handoffPercent.default,
  handoffAfterCompactions:
    SESSION_BUDGET_SETTINGS.handoffAfterCompactions.default,
  tightenWindowTokens: SESSION_BUDGET_SETTINGS.tightenWindowTokens.default,
  blockAtLimit: SESSION_BUDGET_SETTINGS.blockAtLimit.default,
};

function isNumberInBounds(
  setting: SessionBudgetNumberSetting,
  value: unknown,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!setting.integer || Number.isInteger(value)) &&
    value >= setting.min &&
    value <= setting.max
  );
}

/**
 * A log-safe description of a rejected value: numbers and booleans as-is,
 * anything else only as its type (a string is never echoed).
 */
function describeValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${typeof value}:${String(value)}`;
  }
  if (value === null) return 'null';
  return typeof value;
}

@injectable()
export class SessionBudgetConfigProvider {
  /**
   * Last rejected value per key, so each bad value warns once. Bounded by the
   * ten keys plus the two composite keys above.
   */
  private readonly lastWarned = new Map<string, string>();

  constructor(
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  /** The validated settings, read now. An unreadable store gives all defaults. */
  getConfig(): SessionBudgetConfig {
    try {
      return this.readConfig((key) => this.config.get<unknown>(key));
    } catch (error: unknown) {
      this.warnOnce(
        STORE_WARN_KEY,
        'unreadable',
        '[SessionBudgetConfigProvider] Settings store unreadable; using the default session budget',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return SESSION_BUDGET_DEFAULT_CONFIG;
    }
  }

  private readConfig(read: SettingReader): SessionBudgetConfig {
    let tightenPercent = this.readNumber(
      read,
      SESSION_BUDGET_SETTINGS.tightenPercent,
    );
    let handoffPercent = this.readNumber(
      read,
      SESSION_BUDGET_SETTINGS.handoffPercent,
    );
    if (!isSessionBudgetPercentOrderValid(tightenPercent, handoffPercent)) {
      this.warnOnce(
        PERCENT_ORDER_WARN_KEY,
        `${tightenPercent}/${handoffPercent}`,
        '[SessionBudgetConfigProvider] tightenPercent must be below handoffPercent; using both defaults',
        { tightenPercent, handoffPercent },
      );
      tightenPercent = SESSION_BUDGET_SETTINGS.tightenPercent.default;
      handoffPercent = SESSION_BUDGET_SETTINGS.handoffPercent.default;
    }

    return {
      enabled: this.readBoolean(read, SESSION_BUDGET_SETTINGS.enabled),
      unit: this.readEnum(read, SESSION_BUDGET_SETTINGS.unit),
      tokens: this.readNumber(read, SESSION_BUDGET_SETTINGS.tokens),
      usd: this.readNumber(read, SESSION_BUDGET_SETTINGS.usd),
      fallbackWeightedTokens: this.readNumber(
        read,
        SESSION_BUDGET_SETTINGS.fallbackWeightedTokens,
      ),
      tightenPercent,
      handoffPercent,
      handoffAfterCompactions: this.readNumber(
        read,
        SESSION_BUDGET_SETTINGS.handoffAfterCompactions,
      ),
      tightenWindowTokens: this.readNumber(
        read,
        SESSION_BUDGET_SETTINGS.tightenWindowTokens,
      ),
      blockAtLimit: this.readBoolean(
        read,
        SESSION_BUDGET_SETTINGS.blockAtLimit,
      ),
    };
  }

  private readBoolean(
    read: SettingReader,
    setting: SessionBudgetBooleanSetting,
  ): boolean {
    const raw = read(setting.key);
    if (raw === undefined) return setting.default;
    if (typeof raw === 'boolean') return raw;
    this.warnInvalid(setting.key, raw, 'a boolean');
    return setting.default;
  }

  private readEnum(
    read: SettingReader,
    setting: SessionBudgetEnumSetting,
  ): SessionBudgetUnit {
    const raw = read(setting.key);
    if (raw === undefined) return setting.default;
    const match = setting.values.find((value) => value === raw);
    if (match !== undefined) return match;
    this.warnInvalid(setting.key, raw, `one of ${setting.values.join(', ')}`);
    return setting.default;
  }

  private readNumber(
    read: SettingReader,
    setting: SessionBudgetNumberSetting & {
      readonly nullable: false;
      readonly default: number;
    },
  ): number;
  private readNumber(
    read: SettingReader,
    setting: SessionBudgetNumberSetting,
  ): number | null;
  private readNumber(
    read: SettingReader,
    setting: SessionBudgetNumberSetting,
  ): number | null {
    const raw = read(setting.key);
    if (raw === undefined) return setting.default;
    if (raw === null && setting.nullable) return null;
    if (isNumberInBounds(setting, raw)) return raw;
    this.warnInvalid(
      setting.key,
      raw,
      `${setting.integer ? 'an integer' : 'a number'} in [${setting.min}, ${setting.max}]${setting.nullable ? ' or null' : ''}`,
    );
    return setting.default;
  }

  private warnInvalid(key: string, raw: unknown, expected: string): void {
    const described = describeValue(raw);
    this.warnOnce(
      key,
      described,
      `[SessionBudgetConfigProvider] Invalid ${key}; using the default`,
      { key, provided: described, expected },
    );
  }

  private warnOnce(
    key: string,
    signature: string,
    message: string,
    context: Record<string, unknown>,
  ): void {
    if (this.lastWarned.get(key) === signature) return;
    this.lastWarned.set(key, signature);
    this.logger.warn(message, context);
  }
}
