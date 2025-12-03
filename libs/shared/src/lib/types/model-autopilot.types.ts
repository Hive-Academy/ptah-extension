/**
 * Autopilot Type Definitions
 * TASK_2025_035: Model selector and autopilot integration
 *
 * These types define the autopilot permission levels and display name mappings
 * used throughout the frontend and backend for Claude CLI configuration.
 *
 * NOTE: ClaudeModel type already exists in claude-domain.types.ts and is re-used.
 */

import { ClaudeModel } from './claude-domain.types';

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
export type PermissionLevel = 'ask' | 'auto-edit' | 'yolo';

/**
 * Model display names for UI rendering
 *
 * Maps ClaudeModel values (from claude-domain.types.ts) to user-friendly display strings.
 * Note: Only includes the three selectable models (opus, sonnet, haiku), not 'default'.
 *
 * @example
 * const displayName = MODEL_DISPLAY_NAMES['sonnet']; // "Claude Sonnet 4.0"
 */
export const MODEL_DISPLAY_NAMES: Record<
  Exclude<ClaudeModel, 'default'>,
  string
> = {
  opus: 'Claude Opus 4.0',
  sonnet: 'Claude Sonnet 4.0',
  haiku: 'Claude Haiku 3.5',
} as const;

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
} as const;

/**
 * Type guard: Check if value is a valid selectable ClaudeModel (opus, sonnet, haiku)
 *
 * @param value - Value to check
 * @returns True if value is 'opus', 'sonnet', or 'haiku' (not 'default')
 *
 * @example
 * if (isSelectableClaudeModel(userInput)) {
 *   // TypeScript now knows userInput is a selectable model
 *   const displayName = MODEL_DISPLAY_NAMES[userInput];
 * }
 */
export function isSelectableClaudeModel(
  value: unknown
): value is Exclude<ClaudeModel, 'default'> {
  return (
    typeof value === 'string' &&
    (value === 'opus' || value === 'sonnet' || value === 'haiku')
  );
}

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
    (value === 'ask' || value === 'auto-edit' || value === 'yolo')
  );
}
