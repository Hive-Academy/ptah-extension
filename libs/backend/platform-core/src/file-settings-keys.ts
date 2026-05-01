/**
 * File-Based Settings Keys Registry
 *
 * Defines which settings keys are stored in ~/.ptah/settings.json instead of
 * VS Code's package.json contributes.configuration. The VS Code Marketplace
 * content scanner flags extensions with trademarked terms ("copilot", "codex",
 * "claude", "gpt") in package.json as "suspicious content".
 *
 * These keys use flat dot-notation matching the existing
 * getConfiguration('ptah', 'provider.github-copilot.clientId') call pattern.
 * The Set provides O(1) lookup for routing checks in workspace providers.
 *
 * TASK_2025_247 Batch 2, Task 2.2
 */

/**
 * Settings keys that route to file-based storage (~/.ptah/settings.json).
 *
 * Used by VscodeWorkspaceProvider and ElectronWorkspaceProvider for routing:
 *   if (section === 'ptah' && FILE_BASED_SETTINGS_KEYS.has(key)) {
 *     return fileSettings.get(key, defaultValue);
 *   }
 */
export const FILE_BASED_SETTINGS_KEYS = new Set<string>([
  // Authentication method (shared across VS Code + Electron)
  'authMethod',

  // Provider selection
  'anthropicProviderId',

  // LLM configuration
  'llm.defaultProvider',
  'llm.vscode.model',

  // Agent orchestration — Codex
  'agentOrchestration.codexModel',
  'agentOrchestration.codexReasoningEffort',
  'agentOrchestration.codexAutoApprove',

  // Agent orchestration — Copilot
  'agentOrchestration.copilotModel',
  'agentOrchestration.copilotReasoningEffort',
  'agentOrchestration.copilotAutoApprove',

  // Agent orchestration — CLI management
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

  // Provider: Ollama (local)
  'provider.ollama.modelTier.opus',
  'provider.ollama.modelTier.sonnet',
  'provider.ollama.modelTier.haiku',

  // Provider: Ollama Cloud
  'provider.ollama-cloud.modelTier.opus',
  'provider.ollama-cloud.modelTier.sonnet',
  'provider.ollama-cloud.modelTier.haiku',

  // Provider: LM Studio (local)
  'provider.lm-studio.modelTier.opus',
  'provider.lm-studio.modelTier.sonnet',
  'provider.lm-studio.modelTier.haiku',

  // CLI agent configurations
  'ptahCliAgents',

  // Browser automation (TASK_2025_244)
  'browser.allowLocalhost',
  'browser.recordingDir',

  // Editor preferences (TASK_2025_283)
  'editor.vimMode',
]);

/**
 * Default values for file-based settings.
 *
 * These replace the default values that were previously defined in
 * package.json contributes.configuration. The PtahFileSettingsManager
 * uses these as the fallback when no user-set value exists.
 *
 * Convention:
 * - String settings default to '' (empty string) when no meaningful default exists
 * - Model tier settings default to null (signals "use provider default model")
 * - Boolean settings have explicit true/false defaults
 * - Array settings default to [] (empty array)
 */
export const FILE_BASED_SETTINGS_DEFAULTS: Record<string, unknown> = {
  // Authentication method
  authMethod: 'apiKey',

  // Provider selection
  anthropicProviderId: 'openrouter',

  // LLM configuration
  'llm.defaultProvider': 'vscode-lm',
  'llm.vscode.model': 'copilot/gpt-4o',

  // Agent orchestration — Codex
  'agentOrchestration.codexModel': '',
  'agentOrchestration.codexReasoningEffort': '',
  'agentOrchestration.codexAutoApprove': true,

  // Agent orchestration — Copilot
  'agentOrchestration.copilotModel': '',
  'agentOrchestration.copilotReasoningEffort': '',
  'agentOrchestration.copilotAutoApprove': true,

  // Agent orchestration — CLI management
  'agentOrchestration.disabledClis': [],

  // Provider: GitHub Copilot
  'provider.github-copilot.tokenExchangeUrl': '',
  'provider.github-copilot.apiEndpoint': '',
  'provider.github-copilot.clientId': '',
  'provider.github-copilot.modelTier.opus': null,
  'provider.github-copilot.modelTier.sonnet': null,
  'provider.github-copilot.modelTier.haiku': null,

  // Provider: OpenAI Codex
  'provider.openai-codex.oauthApiEndpoint': '',
  'provider.openai-codex.modelTier.opus': null,
  'provider.openai-codex.modelTier.sonnet': null,
  'provider.openai-codex.modelTier.haiku': null,

  // Provider: OpenRouter
  'provider.openrouter.modelTier.opus': null,
  'provider.openrouter.modelTier.sonnet': null,
  'provider.openrouter.modelTier.haiku': null,

  // Provider: Moonshot
  'provider.moonshot.modelTier.opus': null,
  'provider.moonshot.modelTier.sonnet': null,
  'provider.moonshot.modelTier.haiku': null,

  // Provider: Z-AI
  'provider.z-ai.modelTier.opus': null,
  'provider.z-ai.modelTier.sonnet': null,
  'provider.z-ai.modelTier.haiku': null,

  // Provider: Ollama (local) — defaults null so the runtime falls back to
  // OLLAMA_PROVIDER_ENTRY.defaultTiers (qwen3:8b / devstral / qwen3:32b)
  'provider.ollama.modelTier.opus': null,
  'provider.ollama.modelTier.sonnet': null,
  'provider.ollama.modelTier.haiku': null,

  // Provider: Ollama Cloud — defaults null so the runtime falls back to
  // OLLAMA_CLOUD_PROVIDER_ENTRY.defaultTiers
  'provider.ollama-cloud.modelTier.opus': null,
  'provider.ollama-cloud.modelTier.sonnet': null,
  'provider.ollama-cloud.modelTier.haiku': null,

  // Provider: LM Studio (local) — no defaultTiers in the registry; user must
  // pick from dynamically-discovered models
  'provider.lm-studio.modelTier.opus': null,
  'provider.lm-studio.modelTier.sonnet': null,
  'provider.lm-studio.modelTier.haiku': null,

  // CLI agent configurations
  ptahCliAgents: [],

  // Browser automation (TASK_2025_244)
  'browser.allowLocalhost': false,
  'browser.recordingDir': '',

  // Editor preferences (TASK_2025_283)
  'editor.vimMode': false,
};
