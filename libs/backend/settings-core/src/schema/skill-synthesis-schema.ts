import type { SettingDefinition } from './definition';

/**
 * Skill synthesis setting definitions.
 *
 * TODO(Phase 3+): Populate from existing FILE_BASED_SETTINGS_KEYS entries
 * when the migration of the skillSynthesis.* namespace to settings-core handles is scoped.
 * Reference keys are in libs/backend/platform-core/src/file-settings-keys.ts
 * under the "Autonomous skill synthesis" section (skillSynthesis.enabled,
 * skillSynthesis.successesToPromote, skillSynthesis.dedupCosineThreshold, etc.).
 */
export const SKILL_SYNTHESIS_SETTING_DEFS: readonly SettingDefinition<unknown>[] =
  [];
