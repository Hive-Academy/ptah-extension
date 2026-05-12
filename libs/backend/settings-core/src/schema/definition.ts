import { z } from 'zod';

/**
 * Where a setting lives:
 * - 'global'  — persisted in ~/.ptah/settings.json (platform-agnostic file store)
 * - 'secret'  — persisted in secure storage (VS Code SecretStorage / Electron keychain)
 * - 'session' — ephemeral, never written to disk
 */
export type SettingScope = 'global' | 'secret' | 'session';

/**
 * How sensitive a setting value is:
 * - 'plain'     — safe to log and display
 * - 'encrypted' — stored in settings.json but as cipher text; do not log raw value
 * - 'secret'    — stored in secure OS storage; never log or display
 */
export type SettingSensitivity = 'plain' | 'encrypted' | 'secret';

/**
 * Typed descriptor for a single application setting.
 *
 * T is the runtime type of the setting value. Use `defineSetting()` to
 * construct instances — it returns a frozen, immutable descriptor.
 */
export interface SettingDefinition<T> {
  /** Dot-notation key used in storage (e.g., 'provider.openrouter.selectedModel'). */
  readonly key: string;

  /** Storage tier for this setting. */
  readonly scope: SettingScope;

  /** Sensitivity classification — drives logging and display decisions. */
  readonly sensitivity: SettingSensitivity;

  /** Zod schema used to parse raw storage values and validate writes. */
  readonly schema: z.ZodType<T>;

  /** Value returned when nothing is persisted for this key. */
  readonly default: T;

  /**
   * Schema version in which this setting was introduced.
   * Used by the migration runner to apply appropriate transforms.
   */
  readonly sinceVersion: number;

  /**
   * Optional alternative key safe for the VS Code Marketplace scanner.
   * When set, any code generating package.json contributions should use
   * this key instead of `key` (which may contain trademarked terms).
   */
  readonly marketplaceSafeKey?: string;
}

/**
 * Construct an immutable SettingDefinition.
 *
 * Usage:
 * ```ts
 * export const AUTH_METHOD_DEF = defineSetting({
 *   key: 'authMethod',
 *   scope: 'global',
 *   sensitivity: 'plain',
 *   schema: z.enum(['apiKey', 'claudeCli', 'thirdParty']),
 *   default: 'apiKey',
 *   sinceVersion: 1,
 * });
 * ```
 */
export function defineSetting<T>(
  def: SettingDefinition<T>,
): SettingDefinition<T> {
  return Object.freeze(def);
}
