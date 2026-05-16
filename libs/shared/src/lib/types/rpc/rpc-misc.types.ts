/**
 * Miscellaneous RPC Type Definitions
 *
 * Types for context:*, autocomplete:*, file:*, license:*, command:*,
 * quality:*, plugins:* methods
 */

import type {
  ProjectIntelligence,
  QualityHistoryEntry,
} from '../quality-assessment.types';

// ============================================================
// Context RPC Types
// ============================================================

/** Parameters for context:getAllFiles RPC method */
export interface ContextGetAllFilesParams {
  /** Whether to include image files */
  includeImages?: boolean;
  /** Maximum number of files to return */
  limit?: number;
}

/** Parameters for context:getFileSuggestions RPC method */
export interface ContextGetFileSuggestionsParams {
  /** Search query for file suggestions */
  query?: string;
  /** Maximum number of suggestions to return */
  limit?: number;
}

/** File info returned by context:getAllFiles */
export interface ContextFileInfo {
  uri: string;
  /** Actual file system path for attachment processing (e.g., D:\path\file.ts or /path/file.ts) */
  fsPath: string;
  relativePath: string;
  fileName: string;
  fileType: string;
  size: number;
  lastModified: number;
  isDirectory: boolean;
}

/** Response from context:getAllFiles RPC method */
export interface ContextGetAllFilesResult {
  files?: ContextFileInfo[];
}

/** Response from context:getFileSuggestions RPC method */
export interface ContextGetFileSuggestionsResult {
  files?: ContextFileInfo[];
}

// ============================================================
// Autocomplete RPC Types
// ============================================================

/** Parameters for autocomplete:agents RPC method */
export interface AutocompleteAgentsParams {
  /** Search query for agents */
  query?: string;
  /** Maximum number of results */
  maxResults?: number;
}

/** Parameters for autocomplete:commands RPC method */
export interface AutocompleteCommandsParams {
  /** Search query for commands */
  query?: string;
  /** Maximum number of results */
  maxResults?: number;
}

/** Agent info returned by autocomplete:agents */
export interface AutocompleteAgentInfo {
  name: string;
  description: string;
  scope: 'project' | 'user' | 'builtin';
}

/** Response from autocomplete:agents RPC method */
export interface AutocompleteAgentsResult {
  agents?: AutocompleteAgentInfo[];
}

/** Command info returned by autocomplete:commands */
export interface AutocompleteCommandInfo {
  name: string;
  description: string;
  scope: 'builtin' | 'project' | 'user' | 'mcp' | 'plugin';
  argumentHint?: string;
}

/** Response from autocomplete:commands RPC method */
export interface AutocompleteCommandsResult {
  commands?: AutocompleteCommandInfo[];
}

// ============================================================
// File RPC Types
// ============================================================

/** Parameters for file:open RPC method */
export interface FileOpenParams {
  /** File path to open */
  path: string;
  /** Optional line number to navigate to */
  line?: number;
}

/** Response from file:open RPC method */
export interface FileOpenResult {
  success: boolean;
  error?: string;
  isDirectory?: boolean;
}

// ============================================================
// License RPC Types
// ============================================================

/** Parameters for license:getStatus RPC method */
export type LicenseGetStatusParams = Record<string, never>;

/**
 * License tier values for RPC communication.
 *
 * Freemium model:
 * - 'community': FREE forever - always valid, no license required
 * - 'pro': Active Pro subscription ($5/month)
 * - 'trial_pro': Pro plan during 100-day trial
 * - 'expired': Revoked or payment failed only (NOT for unlicensed users)
 */
export type LicenseTier = 'community' | 'pro' | 'trial_pro' | 'expired';

/**
 * Response from license:getStatus RPC method.
 *
 * Supports a two-tier paid model with trial support, plus a `reason` field
 * for context-aware welcome messaging. Freemium model uses `isCommunity`
 * (previously `isBasic`).
 */
export interface LicenseGetStatusResponse {
  /** Whether the license is valid (Community = always true) */
  valid: boolean;
  /** License tier (community, pro, trial_pro, or expired) */
  tier: LicenseTier;
  /** Whether the user has premium features enabled (Pro tier) */
  isPremium: boolean;
  /** Whether the user has Community tier (convenience flag) */
  isCommunity: boolean;
  /** Days remaining before subscription expires (null if not applicable) */
  daysRemaining: number | null;
  /** Whether user is currently in trial period */
  trialActive: boolean;
  /** Days remaining in trial period (null if not in trial) */
  trialDaysRemaining: number | null;
  /** Plan details (if has valid license) */
  plan?: {
    name: string;
    description: string;
    features: string[];
  };
  /** Reason for invalid license (for context-aware welcome messaging) */
  reason?: 'expired' | 'trial_ended' | 'no_license';
  /** User profile data - only present for licensed users */
  user?: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  /**
   * Defensive expiry warning surfaced when daysRemaining indicates an upcoming
   * lapse. 'critical' = < 7 days, 'near_expiry' = < 14 days, null/undefined =
   * no warning. Computed client-side in mapLicenseStatusToResponse so CLI/UI
   * can render warnings even when the server omits expiry context.
   */
  expiryWarning?: 'near_expiry' | 'critical' | null;
}

/** Parameters for license:setKey RPC method */
export interface LicenseSetKeyParams {
  licenseKey: string;
}

/** Response from license:setKey RPC method */
export interface LicenseSetKeyResponse {
  success: boolean;
  tier?: string;
  plan?: { name: string };
  error?: string;
}

/** Parameters for license:clearKey RPC method (empty - no params needed) */
export type LicenseClearKeyParams = Record<string, never>;

/** Response from license:clearKey RPC method */
export interface LicenseClearKeyResponse {
  success: boolean;
  error?: string;
}

// ============================================================
// Command RPC Types
// ============================================================

/**
 * Parameters for command:execute RPC method.
 *
 * Allows webview to execute VS Code commands. Extended to allow specific
 * whitelisted commands.
 * SECURITY: Only ptah.* prefix commands and specific whitelisted commands
 * are allowed (enforced by handler).
 */
export interface CommandExecuteParams {
  /** VS Code command ID to execute (must match whitelist: ptah.* prefix or exact match) */
  command: string;
  /** Optional arguments for the command */
  args?: unknown[];
}

/**
 * Response from command:execute RPC method
 */
export interface CommandExecuteResponse {
  /** Whether command executed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ============================================================
// Quality Dashboard RPC Types
// ============================================================

/** Parameters for quality:getAssessment RPC method */
export interface QualityGetAssessmentParams {
  /** Force fresh analysis (bypass cache) */
  forceRefresh?: boolean;
}

/** Response from quality:getAssessment RPC method */
export interface QualityGetAssessmentResult {
  /** Full project intelligence data */
  intelligence: ProjectIntelligence;
  /** Whether result came from cache */
  fromCache: boolean;
}

/** Parameters for quality:getHistory RPC method */
export interface QualityGetHistoryParams {
  /** Maximum number of history entries to return (default: 30) */
  limit?: number;
}

/** Response from quality:getHistory RPC method */
export interface QualityGetHistoryResult {
  /** Historical assessment entries (newest first) */
  entries: QualityHistoryEntry[];
}

/** Parameters for quality:export RPC method */
export interface QualityExportParams {
  /** Export format */
  format: 'markdown' | 'json' | 'csv';
}

/** Response from quality:export RPC method */
export interface QualityExportResult {
  /** Exported content as string */
  content: string;
  /** Suggested filename */
  filename: string;
  /** MIME type */
  mimeType: string;
  /** Whether the file was saved to disk via VS Code save dialog */
  saved?: boolean;
  /** File path where the report was saved (if saved) */
  filePath?: string;
}

// ============================================================
// Plugin Configuration RPC Types
// ============================================================

/** Plugin metadata for UI display */
export interface PluginInfo {
  /** Unique plugin identifier (directory name, e.g., 'ptah-core') */
  id: string;
  /** Human-readable plugin name */
  name: string;
  /** Plugin description */
  description: string;
  /** Plugin category for grouping in UI */
  category: 'core-tools' | 'backend-tools' | 'frontend-tools';
  /** Number of skills in this plugin */
  skillCount: number;
  /** Number of commands in this plugin */
  commandCount: number;
  /** Whether this plugin is recommended as default */
  isDefault: boolean;
  /** Search keywords for filtering */
  keywords: string[];
}

/** Per-workspace plugin configuration state */
export interface PluginConfigState {
  /** Array of enabled plugin IDs */
  enabledPluginIds: string[];
  /** Skill directory names that are explicitly disabled (e.g., "orchestration") */
  disabledSkillIds: string[];
  /** ISO timestamp of last configuration change */
  lastUpdated?: string;
}

/** Skill metadata for per-skill toggling UI */
export interface PluginSkillEntry {
  /** Skill directory name (globally unique, used as ID) */
  skillId: string;
  /** Human-readable skill name from SKILL.md frontmatter */
  displayName: string;
  /** Skill description from SKILL.md frontmatter */
  description: string;
  /** Parent plugin ID (e.g., "ptah-core") */
  pluginId: string;
}
