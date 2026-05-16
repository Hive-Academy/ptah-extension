/**
 * Settings Export/Import Types
 *
 * The export schema is versioned for forward compatibility.
 * Secret keys and provider IDs are enumerated as constants to avoid
 * magic strings scattered across export/import services.
 */

// ============================================================
// Schema Version
// ============================================================

/** Current schema version. Bump when the PtahSettingsExport shape changes. */
export const SETTINGS_EXPORT_VERSION = 1 as const;

// ============================================================
// Known Provider IDs
// ============================================================

/**
 * Provider IDs that store per-provider API keys under
 * `ptah.auth.provider.{id}` in SecretStorage.
 */
export const KNOWN_PROVIDER_IDS = ['openrouter', 'moonshot', 'z-ai'] as const;

export type KnownProviderId = (typeof KNOWN_PROVIDER_IDS)[number];

// ============================================================
// Secret Key Constants
// ============================================================

/**
 * All known secret storage keys collected by the export service.
 * These correspond to keys stored via ISecretStorage (VS Code SecretStorage
 * or Electron safeStorage depending on platform).
 */
export const SECRET_KEYS = {
  /** License key — stored by LicenseService */
  LICENSE_KEY: 'ptah.licenseKey',

  /** Anthropic API key — stored by AuthSecretsService (KEY_MAP.apiKey) */
  API_KEY: 'ptah.auth.anthropicApiKey',
} as const;

/**
 * Build the secret storage key for a per-provider API key.
 * Pattern: `ptah.auth.provider.{providerId}`
 */
export function providerSecretKey(providerId: string): string {
  return `ptah.auth.provider.${providerId}`;
}

// ============================================================
// Known Configuration Keys
// ============================================================

/**
 * Configuration keys read from IWorkspaceProvider.getConfiguration('ptah', key).
 * These are the non-sensitive settings exported alongside credentials.
 *
 * Enumerated explicitly because IWorkspaceProvider.getConfiguration takes
 * (section, key) — wildcard reads are not supported.
 *
 * - VS Code config (package.json contributes.configuration) — safe keys
 * - File-based (~/.ptah/settings.json) — keys containing trademarked terms
 * The IWorkspaceProvider.getConfiguration() call transparently routes to the
 * correct backend, so consumers do not need to know which storage is used.
 */
export const KNOWN_CONFIG_KEYS = [
  // --- VS Code config settings (stored in package.json contributes.configuration) ---
  'authMethod',
  'model.selected',
  'autopilot.enabled',
  'autopilot.permissionLevel',
  'enhancedPrompts.enabled',
  'compaction.enabled',
  'compaction.threshold',
  'reasoningEffort',
  'mcpPort',
  'apiUrl',
  'agentOrchestration.preferredAgentOrder',
  'agentOrchestration.maxConcurrentAgents',
  'agentOrchestration.geminiModel',

  // --- File-based settings (stored in ~/.ptah/settings.json, not VS Code config) ---
  // Provider selection
  'anthropicProviderId',

  // LLM configuration
  'llm.defaultProvider',
  'llm.vscode.model',

  // Agent orchestration
  'agentOrchestration.copilotModel',
  'agentOrchestration.codexModel',
  'agentOrchestration.codexReasoningEffort',
  'agentOrchestration.copilotReasoningEffort',
  'agentOrchestration.codexAutoApprove',
  'agentOrchestration.copilotAutoApprove',
  'agentOrchestration.disabledClis',

  // Provider: GitHub Copilot
  'provider.github-copilot.tokenExchangeUrl',
  'provider.github-copilot.apiEndpoint',
  'provider.github-copilot.clientId',
  'provider.github-copilot.modelTier.opus',
  'provider.github-copilot.modelTier.sonnet',
  'provider.github-copilot.modelTier.haiku',

  // Provider: OpenAI Codex
  'provider.openai-codex.oauthApiEndpoint',
  'provider.openai-codex.modelTier.opus',
  'provider.openai-codex.modelTier.sonnet',
  'provider.openai-codex.modelTier.haiku',

  // Provider: OpenRouter
  'provider.openrouter.modelTier.opus',
  'provider.openrouter.modelTier.sonnet',
  'provider.openrouter.modelTier.haiku',

  // Provider: Moonshot
  'provider.moonshot.modelTier.opus',
  'provider.moonshot.modelTier.sonnet',
  'provider.moonshot.modelTier.haiku',

  // Provider: Z-AI
  'provider.z-ai.modelTier.opus',
  'provider.z-ai.modelTier.sonnet',
  'provider.z-ai.modelTier.haiku',

  // CLI agent configurations
  'ptahCliAgents',
] as const;

export type KnownConfigKey = (typeof KNOWN_CONFIG_KEYS)[number];

// ============================================================
// Export Schema
// ============================================================

/**
 * Versioned JSON schema for a full Ptah settings export.
 * Written to disk as pretty-printed JSON; the caller (VS Code command
 * or Electron RPC handler) is responsible for file I/O.
 */
export interface PtahSettingsExport {
  /** Schema version for forward compatibility */
  version: typeof SETTINGS_EXPORT_VERSION;

  /** ISO 8601 timestamp of when the export was created */
  exportedAt: string;

  /** Which platform produced this export */
  source: 'vscode' | 'electron' | 'cli';

  /** License key (ptah.licenseKey) — may be absent if not configured */
  licenseKey?: string;

  /** Authentication credentials from SecretStorage */
  auth: {
    /** ptah.auth.anthropicApiKey */
    apiKey?: string;
    /** Per-provider API keys keyed by provider ID */
    providerKeys?: Record<string, string>;
  };

  /** Non-sensitive ptah.* configuration values */
  config: Record<string, unknown>;
}

// ============================================================
// Import Result
// ============================================================

/**
 * Detailed summary returned after importing settings.
 * Each array contains human-readable key descriptions.
 */
export interface SettingsImportResult {
  /** Keys that were successfully imported */
  imported: string[];

  /** Keys that already existed and were not overwritten */
  skipped: string[];

  /** Keys that failed to import (with error descriptions) */
  errors: string[];
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Count the number of populated secret fields in the export data.
 * Useful for summary display in both VS Code and Electron UIs.
 *
 * SECURITY: Counts only — never accesses actual secret values.
 */
export function countPopulatedSecrets(data: PtahSettingsExport): number {
  let count = 0;
  if (data.licenseKey) count++;
  if (data.auth.apiKey) count++;
  if (data.auth.providerKeys) {
    count += Object.keys(data.auth.providerKeys).length;
  }
  return count;
}
