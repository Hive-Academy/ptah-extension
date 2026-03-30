/**
 * Autopilot & Permission Type Definitions
 * TASK_2025_035: Model selector and autopilot integration
 * TASK_2025_237: Removed dead model constants (AVAILABLE_MODELS, MODEL_DISPLAY_NAMES,
 *   MODEL_DESCRIPTIONS, ModelInfo, isSelectableClaudeModel) — models are now fully
 *   dynamic from SDK via SdkModelInfo in rpc-config.types.ts.
 */

/**
 * Autopilot permission levels
 *
 * - `ask`: Manual approval for each action (default, safest)
 * - `auto-edit`: Auto-approve Edit and Write tools
 * - `yolo`: Skip ALL permission prompts (DANGEROUS)
 *
 * @example
 * const level: PermissionLevel = 'ask';
 * if (isPermissionLevel(userInput)) {
 *   // Safe to use userInput as PermissionLevel
 * }
 */
export type PermissionLevel = 'ask' | 'auto-edit' | 'yolo' | 'plan';

/**
 * Permission level display names for UI rendering
 *
 * Maps internal PermissionLevel values to user-friendly display strings.
 *
 * @example
 * const statusText = PERMISSION_LEVEL_NAMES['auto-edit']; // "Auto-edit"
 */
export const PERMISSION_LEVEL_NAMES: Record<PermissionLevel, string> = {
  ask: 'Manual',
  'auto-edit': 'Auto-edit',
  yolo: 'Full Auto (YOLO)',
  plan: 'Plan Mode',
} as const;

/**
 * Type guard: Check if value is a valid PermissionLevel
 *
 * @param value - Value to check
 * @returns True if value is 'ask', 'auto-edit', or 'yolo'
 *
 * @example
 * if (isPermissionLevel(userInput)) {
 *   // TypeScript now knows userInput is PermissionLevel
 *   const displayName = PERMISSION_LEVEL_NAMES[userInput];
 * }
 */
export function isPermissionLevel(value: unknown): value is PermissionLevel {
  return (
    typeof value === 'string' &&
    (value === 'ask' ||
      value === 'auto-edit' ||
      value === 'yolo' ||
      value === 'plan')
  );
}
