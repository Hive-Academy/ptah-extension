import type { SettingDefinition } from './definition';

/**
 * Memory curator setting definitions.
 *
 * TODO(Phase 3+): Populate from existing FILE_BASED_SETTINGS_KEYS entries
 * when the migration of the memory.* namespace to settings-core handles is scoped.
 * Reference keys are in libs/backend/platform-core/src/file-settings-keys.ts
 * under the "Memory curator" section (memory.curatorEnabled, memory.tierLimits.*,
 * memory.decayHalflifeDays, memory.embeddingModel, memory.curatorModel,
 * memory.searchTopK, memory.searchAlpha).
 */
export const MEMORY_SETTING_DEFS: readonly SettingDefinition<unknown>[] = [];
