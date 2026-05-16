/**
 * DI token registry for settings-core.
 *
 * All tokens use Symbol.for() so they resolve correctly across bundle boundaries
 * (e.g., when settings-core is loaded by both the extension host and a worker).
 */
export const SETTINGS_TOKENS = {
  /** Backend ISettingsStore (platform-specific adapter — registered by platform-{vscode,electron,cli}). */
  SETTINGS_STORE: Symbol.for('SettingsStore'),

  /** AuthSettings repository. */
  AUTH_SETTINGS: Symbol.for('AuthSettings'),

  /** ReasoningSettings repository. */
  REASONING_SETTINGS: Symbol.for('ReasoningSettings'),

  /** ModelSettings repository. */
  MODEL_SETTINGS: Symbol.for('ModelSettings'),

  /** CliSubagentSettings repository. */
  CLI_SUBAGENT_SETTINGS: Symbol.for('CliSubagentSettings'),

  /** ProviderSettings repository. */
  PROVIDER_SETTINGS: Symbol.for('ProviderSettings'),

  /** GatewaySettings repository. */
  GATEWAY_SETTINGS: Symbol.for('GatewaySettings'),

  /** MemorySettings repository. */
  MEMORY_SETTINGS: Symbol.for('MemorySettings'),

  /** SkillSynthesisSettings repository. */
  SKILL_SYNTHESIS_SETTINGS: Symbol.for('SkillSynthesisSettings'),

  /** CronSettings repository. */
  CRON_SETTINGS: Symbol.for('CronSettings'),

  /** MigrationRunner (ISettingsMigrator implementation). */
  MIGRATION_RUNNER: Symbol.for('MigrationRunner'),

  /** IMasterKeyProvider — platform-specific secure key retrieval. */
  MASTER_KEY_PROVIDER: Symbol.for('MasterKeyProvider'),
} as const;
