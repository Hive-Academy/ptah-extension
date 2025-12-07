/**
 * Model & Autopilot Type Definitions
 * TASK_2025_035: Model selector and autopilot integration
 *
 * These types define:
 * - ModelInfo: Rich model metadata for UI display
 * - PermissionLevel: Autopilot permission levels
 * - Display name mappings for frontend rendering
 *
 * NOTE: ClaudeModel type already exists in claude-domain.types.ts and is re-used.
 */

import { ClaudeModel } from './claude-domain.types';

/**
 * Rich model information for UI display
 *
 * Contains all metadata needed to render a model option in the selector,
 * including display name, description, and visual indicators.
 *
 * @example
 * const sonnetModel: ModelInfo = {
 *   id: 'sonnet',
 *   name: 'Sonnet 4.5',
 *   description: 'Best for everyday tasks',
 *   isRecommended: true,
 * };
 */
export interface ModelInfo {
  /** Model identifier used for API calls (e.g., 'sonnet', 'opus', 'haiku') */
  id: Exclude<ClaudeModel, 'default'>;
  /** Display name shown in UI (e.g., 'Sonnet 4.5') */
  name: string;
  /** Short description of model capabilities */
  description: string;
  /** Whether this is the recommended/default model */
  isRecommended?: boolean;
  /** SDK API model name (e.g., 'claude-sonnet-4-20250514') */
  apiName: string;
}

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
 * Names match Claude CLI `/model` command output for consistency.
 *
 * @example
 * const displayName = MODEL_DISPLAY_NAMES['sonnet']; // "Sonnet 4.5"
 */
export const MODEL_DISPLAY_NAMES: Record<
  Exclude<ClaudeModel, 'default'>,
  string
> = {
  opus: 'Opus 4.5',
  sonnet: 'Sonnet 4.5',
  haiku: 'Haiku 4.5',
} as const;

/**
 * Model descriptions for UI tooltips/subtitles
 *
 * Short descriptions matching Claude CLI `/model` command output.
 *
 * @example
 * const desc = MODEL_DESCRIPTIONS['opus']; // "Most capable for complex work"
 */
export const MODEL_DESCRIPTIONS: Record<
  Exclude<ClaudeModel, 'default'>,
  string
> = {
  opus: 'Most capable for complex work',
  sonnet: 'Best for everyday tasks',
  haiku: 'Fastest for quick answers',
} as const;

/**
 * Available models list with full metadata
 *
 * This is the single source of truth for available Claude models.
 * When Anthropic releases new models, update this list.
 * Order determines display order in UI (recommended first).
 *
 * @example
 * // Get all available models
 * const models = AVAILABLE_MODELS;
 *
 * // Find recommended model
 * const recommended = AVAILABLE_MODELS.find(m => m.isRecommended);
 */
export const AVAILABLE_MODELS: readonly ModelInfo[] = [
  {
    id: 'sonnet',
    name: 'Sonnet 4.5',
    description: 'Best for everyday tasks',
    isRecommended: true,
    apiName: 'claude-sonnet-4-20250514',
  },
  {
    id: 'opus',
    name: 'Opus 4.5',
    description: 'Most capable for complex work',
    apiName: 'claude-opus-4-20250514',
  },
  {
    id: 'haiku',
    name: 'Haiku 4.5',
    description: 'Fastest for quick answers',
    apiName: 'claude-haiku-3-20240307',
  },
] as const;

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
