/**
 * Config RPC Type Definitions
 *
 * Types for config:model-switch, config:model-get, config:effort-set/get,
 * config:autopilot-toggle/get, config:models-list
 */

import type { SessionId } from '../branded.types';
import type { PermissionLevel } from '../model-autopilot.types';
import type { EffortLevel } from '../ai-provider.types';
import type { ModelPricing } from '../../utils/pricing.utils';

/** Parameters for config:model-switch RPC method */
export interface ConfigModelSwitchParams {
  /** Model API name to switch to (e.g., 'claude-sonnet-4-20250514') */
  model: string;
  /** Active session ID for live SDK sync (optional) */
  sessionId?: SessionId | null;
  applyTo?: 'global' | 'app' | 'workspace';
}

/** Response from config:model-switch RPC method */
export interface ConfigModelSwitchResult {
  model: string;
}

/** Response from config:model-get RPC method */
export interface ConfigModelGetResult {
  model: string;
}

/** Parameters for config:effort-set RPC method */
export interface ConfigEffortSetParams {
  /** Effort level to save, or undefined to clear (use SDK default) */
  effort: EffortLevel | undefined;
  /** Active session ID for live SDK sync (optional) */
  sessionId?: SessionId | null;
  applyTo?: 'global' | 'app' | 'workspace';
}

/** Response from config:effort-set RPC method */
export interface ConfigEffortSetResult {
  effort: EffortLevel | undefined;
}

/** Response from config:effort-get RPC method */
export interface ConfigEffortGetResult {
  effort: EffortLevel | undefined;
}

/** Parameters for config:autopilot-toggle RPC method */
export interface ConfigAutopilotToggleParams {
  /** Whether autopilot is enabled */
  enabled: boolean;
  /** Permission level for autopilot */
  permissionLevel: PermissionLevel;
  /**
   * The session whose live level the toggle also changes.
   * - A session id: that session.
   * - `null`: the caller's tab has no session; save the default only and
   *   change no live session (the webview popover sends this).
   * - Omitted: the most recently active session (CLI/TUI callers).
   */
  sessionId?: SessionId | null;
}

/** Response from config:autopilot-toggle RPC method */
export interface ConfigAutopilotToggleResult {
  enabled: boolean;
  permissionLevel: PermissionLevel;
}

/** Parameters for config:autopilot-get RPC method */
export interface ConfigAutopilotGetParams {
  /** Also report this session's live permission level (TASK_2026_660). */
  sessionId?: SessionId | null;
}

/** Response from config:autopilot-get RPC method */
export interface ConfigAutopilotGetResult {
  /** The saved default: what a new or resumed session starts at. */
  enabled: boolean;
  permissionLevel: PermissionLevel;
  /**
   * The live level of the requested `sessionId`; `null` when that session is
   * not live (it starts at the saved default when it resumes). Absent when no
   * session was requested.
   */
  sessionPermissionLevel?: PermissionLevel | null;
}

/** Model information for config:models-list response. IDs are always full model IDs (e.g., 'claude-opus-4-6'). */
export interface SdkModelInfo {
  id: string; // Full model ID (e.g., 'claude-opus-4-6', 'claude-sonnet-4-5-20250514')
  name: string; // Display name (e.g., 'Claude Sonnet 4')
  description: string; // Model description
  isSelected: boolean; // Whether this model is currently selected
  isRecommended?: boolean; // Whether this model is recommended
  providerModelId: string | null; // Actual provider model (e.g., 'openai/gpt-5.1-codex-max' when using OpenRouter tier overrides)
  tier?: 'opus' | 'sonnet' | 'haiku'; // Detected model tier for provider override mapping
}

/** Response from config:models-list RPC method */
export interface ConfigModelsListResult {
  models: SdkModelInfo[];
}

/**
 * Response from `config:pricing-get`.
 *
 * The extension host's runtime pricing map, verbatim. `pricing.utils` keeps
 * that map in a module-level `let`, and the webview bundle gets its OWN
 * instance of the module — so the OpenRouter catalog every backend lookup
 * enjoys was invisible to the renderer, whose map never held anything but the
 * handful of bundled entries. This is how the renderer catches up.
 */
export interface ConfigPricingGetResult {
  /** Model id (and lowercase / prefix-stripped aliases) → pricing entry. */
  pricing: Record<string, ModelPricing>;
  /**
   * True when the OpenRouter catalog has been fetched and merged. False means
   * this is the bundled table only — the renderer still hydrates (a partial
   * map beats none) but a caller may choose to retry later.
   */
  hydrated: boolean;
}
