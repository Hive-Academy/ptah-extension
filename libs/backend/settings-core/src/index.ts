// ---- DI Tokens ----
export { SETTINGS_TOKENS } from './di/tokens';

// ---- Encryption ----
export type { SecretEnvelope } from './encryption/secret-envelope';
export { encryptValue, decryptValue } from './encryption/secret-envelope';
export { SecretsFileStore } from './encryption/secrets-file-store';
export type { IMasterKeyProvider } from './encryption/master-key-provider';

// ---- Ports ----
export type { ISettingsStore } from './ports/settings-store.interface';
export type { ISettingsMigrator } from './ports/settings-migrator.interface';

// ---- Schema — core types ----
export { defineSetting } from './schema/definition';
export type {
  SettingDefinition,
  SettingScope,
  SettingSensitivity,
} from './schema/definition';

// ---- Schema — auth ----
export {
  AUTH_METHOD_DEF,
  ANTHROPIC_PROVIDER_ID_DEF,
  AUTH_METHOD_SCHEMA,
} from './schema/auth-schema';

// ---- Schema — reasoning ----
export { EFFORT_LEVEL_SCHEMA } from './schema/reasoning-schema';
export type { EffortLevel } from './schema/reasoning-schema';

// ---- Schema — model ----
export { MODEL_SELECTED_SCHEMA } from './schema/model-schema';

// ---- Schema — provider ----
export {
  KNOWN_PROVIDER_AUTH_KEYS,
  providerSelectedModelDef,
  providerReasoningEffortDef,
} from './schema/provider-schema';
export type { KnownProviderAuthKey } from './schema/provider-schema';

// ---- Schema — CLI subagents ----
export { PTAH_CLI_AGENTS_DEF } from './schema/cli-subagent-schema';
export type { PtahCliAgentEntry } from './schema/cli-subagent-schema';

// ---- Schema — gateway ----
export {
  GATEWAY_TELEGRAM_TOKEN_DEF,
  GATEWAY_DISCORD_TOKEN_DEF,
  GATEWAY_SLACK_TOKEN_DEF,
} from './schema/gateway-schema';

// ---- Schema — placeholder namespaces ----
export { MEMORY_SETTING_DEFS } from './schema/memory-schema';
export { SKILL_SYNTHESIS_SETTING_DEFS } from './schema/skill-synthesis-schema';
export { CRON_SETTING_DEFS } from './schema/cron-schema';

// ---- Schema — master registry ----
export { SETTINGS_SCHEMA } from './schema/index';

// ---- Reactive store ----
export { ReactiveSettingsStore } from './reactive/reactive-settings-store';

// ---- Repository handles ----
export type { SettingHandle } from './repositories/setting-handle';
export type { SecretHandle } from './repositories/secret-handle';
export { ComputedSettingHandle } from './repositories/computed-setting-handle';
export { BaseSettingsRepository } from './repositories/base-repository';

// ---- Per-namespace repositories ----
export { AuthSettings } from './repositories/auth-settings';
export { ReasoningSettings } from './repositories/reasoning-settings';
export { ModelSettings } from './repositories/model-settings';
export { CliSubagentSettings } from './repositories/cli-subagent-settings';
export { ProviderSettings } from './repositories/provider-settings';
export { GatewaySettings } from './repositories/gateway-settings';
export { MemorySettings } from './repositories/memory-settings';
export { SkillSynthesisSettings } from './repositories/skill-synthesis-settings';
export { CronSettings } from './repositories/cron-settings';

// ---- Migrations ----
export { MigrationRunner } from './migrations/runner';
export type { MigrationFn } from './migrations/runner';
export { runV1Migration } from './migrations/v1-migration';
export { runV2Migration } from './migrations/v2-migration';
export { runV3Migration } from './migrations/v3-migration';
