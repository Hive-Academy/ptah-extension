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

/**
 * Workspace-scoping param shared by the `@` file picker (`context:*`) and the
 * `/` command picker (`autocomplete:*`). Same convention as
 * {@link GitWorkspaceScopedParams} / {@link TasksWorkspaceScopedParams} — one
 * optional `workspaceRoot` field, absolute path, host-native form.
 *
 * **Omitting it means "the process-global active workspace folder"** — i.e.
 * whatever `IWorkspaceProvider.getWorkspaceRoot()` reports at the instant the
 * request is served. That fallback is a deliberate part of the contract, not an
 * accident: an older webview build and any MCP-side caller that has no root to
 * offer must keep working unchanged.
 *
 * The process-global root is subject to switch timing (Electron flips the
 * active folder at runtime) and, in VS Code, it is the *window's* folder even
 * when the calling chat tab is bound to a different session root. A caller that
 * knows which workspace it means should therefore ALWAYS pass it — that is the
 * only thing on this wire that can disambiguate, since the RPC envelope carries
 * no session id (TASK_2026_200).
 *
 * Send the field or omit it — never send `''`. The empty string is not "no
 * opinion", and the backend rejects it at the Zod boundary.
 */
export interface PickerWorkspaceScopedParams {
  /**
   * Absolute path of the workspace to answer for. Omit for the process-global
   * active workspace folder.
   */
  workspaceRoot?: string;
}

/** Parameters for context:getAllFiles RPC method */
export interface ContextGetAllFilesParams extends PickerWorkspaceScopedParams {
  /** Whether to include image files */
  includeImages?: boolean;
  /** Maximum number of files to return */
  limit?: number;
}

/** Parameters for context:getFileSuggestions RPC method */
export interface ContextGetFileSuggestionsParams extends PickerWorkspaceScopedParams {
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

/** Parameters for autocomplete:agents RPC method */
export interface AutocompleteAgentsParams extends PickerWorkspaceScopedParams {
  /** Search query for agents */
  query?: string;
  /** Maximum number of results */
  maxResults?: number;
}

/** Parameters for autocomplete:commands RPC method */
export interface AutocompleteCommandsParams extends PickerWorkspaceScopedParams {
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

/** Parameters for license:getStatus RPC method */
export type LicenseGetStatusParams = Record<string, never>;

/**
 * License tier values for RPC communication.
 *
 * Open-source + Builders model (exactly three values):
 * - 'community': FREE and open source - always valid, no license required
 * - 'builders': Active Ptah Builders membership (the only premium tier)
 * - 'expired': Revoked or payment failed only (NOT for unlicensed users)
 */
export type LicenseTier = 'community' | 'builders' | 'expired';

/**
 * Response from license:getStatus RPC method.
 *
 * Open-source + Builders model, plus a `reason` field for context-aware
 * welcome messaging. Freemium model uses `isCommunity` (previously `isBasic`).
 */
export interface LicenseGetStatusResponse {
  /** Whether the license is valid (Community = always true) */
  valid: boolean;
  /** License tier (community, builders, or expired) */
  tier: LicenseTier;
  /** Whether the user has premium features enabled (Builders tier) */
  isPremium: boolean;
  /** Whether the user has Community tier (convenience flag) */
  isCommunity: boolean;
  /** Days remaining before subscription expires (null if not applicable) */
  daysRemaining: number | null;
  /** Plan details (if has valid license) */
  plan?: {
    name: string;
    description: string;
    features: string[];
  };
  /** Reason for invalid license (for context-aware welcome messaging) */
  reason?: 'expired' | 'no_license';
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

/**
 * Where a plugin came from — this drives its activation semantics.
 *
 * - `bundled`: shipped with Ptah and downloaded into `~/.ptah/plugins/`.
 *   OPT-IN — active only while its id is listed in `enabledPluginIds`.
 * - `harness`: authored by the user through the harness wizard
 *   (`ptah_harness_create_skill` / `harness:create-skill`), written to
 *   `~/.ptah/plugins/ptah-harness-{slug}/`. OPT-OUT — the user created it by
 *   clicking Apply, so it is active on discovery and stays active until its id
 *   is listed in `disabledPluginIds`.
 * - `external`: installed from a third-party marketplace into
 *   `~/.ptah/plugins/external/<owner>/<repo>/<plugin>/`. OPT-IN like bundled,
 *   so it must appear in `enabledPluginIds` to take effect — but the consent
 *   dialog already showed the user its skills, scripts and declared MCP
 *   servers, so a successful install enables it in the current workspace
 *   rather than making the user hunt for a second switch. Turning it off
 *   afterwards is the ordinary bundled-plugin toggle.
 * - `skillssh`: installed from the skills.sh directory into
 *   `~/.ptah/plugins/ptah-skillssh-{owner}-{repo}/`. OPT-OUT like `harness` —
 *   the user picked this exact skill by name, which is the same deliberate act
 *   as authoring one. Before TASK_2026_288 these did not appear here at all:
 *   the install wrote straight into `.claude/skills`, so the skill reached
 *   Claude alone, no toggle could reach it, and `ptah harness doctor` reported
 *   it `foreign` forever.
 *
 * Optional on {@link PluginInfo} for back-compat: payloads produced before this
 * field existed carry only bundled plugins, so `undefined` means `'bundled'`.
 */
export type PluginSource = 'bundled' | 'harness' | 'external' | 'skillssh';

/**
 * Whether a plugin source is OPT-OUT (active on discovery) rather than OPT-IN
 * (active only while listed in `enabledPluginIds`).
 *
 * One rule, three consumers — `PluginLoaderService.resolveCurrentPluginPaths`,
 * the plugin browser modal's toggle, and the status widget's enabled count. It
 * lives here because those three disagreeing is invisible until a user toggles
 * a plugin and the count does not move.
 */
export function isOptOutPluginSource(
  source: PluginSource | undefined,
): boolean {
  return source === 'harness' || source === 'skillssh';
}

/** Plugin metadata for UI display */
export interface PluginInfo {
  /** Unique plugin identifier (directory name, e.g., 'ptah-core') */
  id: string;
  /** Human-readable plugin name */
  name: string;
  /** Plugin description */
  description: string;
  /** Plugin category for grouping in UI */
  category:
    | 'core-tools'
    | 'backend-tools'
    | 'frontend-tools'
    | 'creative-tools'
    | 'harness-tools'
    | 'external-tools';
  /** Number of skills in this plugin */
  skillCount: number;
  /** Number of commands in this plugin */
  commandCount: number;
  /** Whether this plugin is recommended as default */
  isDefault: boolean;
  /** Search keywords for filtering */
  keywords: string[];
  /** Origin + activation semantics. Absent on legacy payloads → `'bundled'`. */
  source?: PluginSource;
}

/** Per-workspace plugin configuration state */
export interface PluginConfigState {
  /**
   * Plugin IDs the user explicitly turned ON.
   *
   * This is the allowlist for OPT-IN (bundled) plugins only. Harness-authored
   * plugins are default-enabled and are NOT required to appear here.
   */
  enabledPluginIds: string[];
  /** Skill directory names that are explicitly disabled (e.g., "orchestration") */
  disabledSkillIds: string[];
  /**
   * Plugin IDs the user explicitly turned OFF.
   *
   * Only meaningful for OPT-OUT (harness-authored) plugins: those are active on
   * discovery, so the only way to record "the user unchecked this" is a
   * dedicated denylist. Optional — configs persisted before this field existed
   * load unchanged and are read as an empty denylist (no migration).
   */
  disabledPluginIds?: string[];
  /**
   * Agent slugs the user explicitly turned OFF — `backend-developer` for
   * `~/.ptah/user/agents/backend-developer.md`.
   *
   * The per-agent half of agent consent; the workspace-level half lives in
   * `{ws}/.ptah/harness/state.json`. Optional for the same reason
   * {@link disabledPluginIds} is: configs persisted before this field existed
   * load unchanged and read as an empty denylist (no migration).
   */
  disabledAgentIds?: string[];
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
