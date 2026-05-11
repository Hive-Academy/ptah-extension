import type { SettingDefinition } from './definition';

/**
 * Cron scheduler setting definitions.
 *
 * TODO(Phase 3+): Populate from existing FILE_BASED_SETTINGS_KEYS entries
 * when the migration of the cron.* namespace to settings-core handles is scoped.
 * Reference keys are in libs/backend/platform-core/src/file-settings-keys.ts
 * under the "Cron scheduler" section (cron.enabled, cron.maxConcurrentJobs,
 * cron.catchupWindowMs).
 */
export const CRON_SETTING_DEFS: readonly SettingDefinition<unknown>[] = [];
