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
 */

/**
 * Provider auth keys that each get a `selectedModel` + `reasoningEffort` slot.
 *
 * MUST stay in sync with `KNOWN_PROVIDER_AUTH_KEYS` in
 * `libs/backend/settings-core/src/schema/provider-schema.ts`.
 * We cannot import that constant here because settings-core depends on
 * platform-core (not the reverse) — a circular dependency would result.
 *
 * These keys must be in FILE_BASED_SETTINGS_KEYS so that
 * VscodeWorkspaceProvider routes them to ~/.ptah/settings.json instead of
 * vscode.workspace.getConfiguration (which has no schema for them).
 */
const KNOWN_AUTH_KEYS_FOR_FILE_ROUTING = [
  'apiKey',
  'claudeCli',
  'thirdParty.openrouter',
  'thirdParty.moonshot',
  'thirdParty.z-ai',
  'thirdParty.ollama',
  'thirdParty.ollama-cloud',
  'thirdParty.lm-studio',
  'thirdParty.github-copilot',
  'thirdParty.openai-codex',
] as const;

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
  'reasoningEffort',
  'model.selected',

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
  'agentOrchestration.disabledMcpNamespaces',

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

  // Browser automation
  'browser.allowLocalhost',
  'browser.recordingDir',

  // Editor preferences
  'editor.vimMode',

  // Memory curator
  'memory.curatorEnabled',
  'memory.tierLimits.core',
  'memory.tierLimits.recall',
  'memory.tierLimits.archival',
  'memory.decayHalflifeDays',
  'memory.embeddingModel',
  'memory.curatorModel',
  'memory.searchTopK',
  'memory.searchAlpha',

  // Autonomous skill synthesis
  'skillSynthesis.enabled',
  'skillSynthesis.successesToPromote',
  'skillSynthesis.dedupCosineThreshold',
  'skillSynthesis.maxActiveSkills',
  'skillSynthesis.candidatesDir',
  'skillSynthesis.eligibilityMinTurns',
  'skillSynthesis.evictionDecayRate',
  'skillSynthesis.generalizationContextThreshold',
  'skillSynthesis.minTrajectoryFidelityRatio',
  'skillSynthesis.dedupClusterThreshold',
  'skillSynthesis.minAbstractionEditDistance',
  'skillSynthesis.judgeEnabled',
  'skillSynthesis.minJudgeScore',
  'skillSynthesis.judgeModel',
  'skillSynthesis.maxPinnedSkills',
  'skillSynthesis.curatorEnabled',
  'skillSynthesis.curatorIntervalHours',

  // Cron scheduler
  'cron.enabled',
  'cron.maxConcurrentJobs',
  'cron.catchupWindowMs',

  // Messaging gateway
  'gateway.enabled',
  'gateway.coalesceMs',
  'gateway.rateLimit.minTimeMs',
  'gateway.rateLimit.maxConcurrent',
  'gateway.voice.enabled',
  'gateway.voice.whisperModel',
  'gateway.telegram.enabled',
  'gateway.telegram.tokenCipher',
  'gateway.telegram.allowedUserIds',
  'gateway.discord.enabled',
  'gateway.discord.tokenCipher',
  'gateway.discord.allowedGuildIds',
  'gateway.slack.enabled',
  'gateway.slack.botTokenCipher',
  'gateway.slack.appTokenCipher',
  'gateway.slack.allowedTeamIds',

  // Provider-scoped per-auth model + effort keys.
  // Generated from KNOWN_AUTH_KEYS_FOR_FILE_ROUTING — one selectedModel and
  // one reasoningEffort key per provider auth identity.
  // Keeps VS Code's getConfiguration router from falling through to the
  // vscode.workspace.getConfiguration path (which has no schema for them).
  ...KNOWN_AUTH_KEYS_FOR_FILE_ROUTING.flatMap((k) => [
    `provider.${k}.selectedModel`,
    `provider.${k}.reasoningEffort`,
  ]),
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
  reasoningEffort: 'medium',
  'model.selected': '',

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
  'agentOrchestration.disabledMcpNamespaces': [],

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

  // Browser automation
  'browser.allowLocalhost': false,
  'browser.recordingDir': '',

  // Editor preferences
  'editor.vimMode': false,

  // Memory curator
  'memory.curatorEnabled': true,
  'memory.tierLimits.core': 256,
  'memory.tierLimits.recall': 4096,
  'memory.tierLimits.archival': 100000,
  'memory.decayHalflifeDays': 30,
  'memory.embeddingModel': 'Xenova/bge-small-en-v1.5',
  // Empty string delegates curator model selection to the SDK default —
  // the runtime resolves the actual model from agent-sdk's provider chain.
  'memory.curatorModel': '',
  'memory.searchTopK': 20,
  'memory.searchAlpha': 0.5,

  // Autonomous skill synthesis
  'skillSynthesis.enabled': true,
  'skillSynthesis.successesToPromote': 3,
  'skillSynthesis.dedupCosineThreshold': 0.85,
  'skillSynthesis.maxActiveSkills': 50,
  'skillSynthesis.candidatesDir': '',
  'skillSynthesis.eligibilityMinTurns': 5,
  'skillSynthesis.evictionDecayRate': 0.95,
  'skillSynthesis.generalizationContextThreshold': 3,
  'skillSynthesis.minTrajectoryFidelityRatio': 0.4,
  'skillSynthesis.dedupClusterThreshold': 0.78,
  'skillSynthesis.minAbstractionEditDistance': 0.3,
  'skillSynthesis.judgeEnabled': true,
  'skillSynthesis.minJudgeScore': 6.0,
  'skillSynthesis.judgeModel': 'inherit',
  'skillSynthesis.maxPinnedSkills': 10,
  'skillSynthesis.curatorEnabled': true,
  'skillSynthesis.curatorIntervalHours': 24,

  // Cron scheduler
  'cron.enabled': true,
  'cron.maxConcurrentJobs': 3,
  'cron.catchupWindowMs': 86400000,

  // Messaging gateway
  'gateway.enabled': false,
  'gateway.coalesceMs': 250,
  'gateway.rateLimit.minTimeMs': 500,
  'gateway.rateLimit.maxConcurrent': 2,
  'gateway.voice.enabled': true,
  'gateway.voice.whisperModel': 'base.en',
  'gateway.telegram.enabled': false,
  'gateway.telegram.tokenCipher': '',
  'gateway.telegram.allowedUserIds': [],
  'gateway.discord.enabled': false,
  'gateway.discord.tokenCipher': '',
  'gateway.discord.allowedGuildIds': [],
  'gateway.slack.enabled': false,
  'gateway.slack.botTokenCipher': '',
  'gateway.slack.appTokenCipher': '',
  'gateway.slack.allowedTeamIds': [],

  // Provider-scoped per-auth model + effort keys.
  // Empty string = "no selection yet / use provider default".
  ...Object.fromEntries(
    KNOWN_AUTH_KEYS_FOR_FILE_ROUTING.flatMap((k) => [
      [`provider.${k}.selectedModel`, ''],
      [`provider.${k}.reasoningEffort`, ''],
    ]),
  ),
};

/**
 * Pattern for per-provider base URL override keys.
 *
 * Matches `provider.<providerId>.baseUrl` for any provider id. This lets the
 * CLI parity work (`provider base-url set <provider> <url>`) accept arbitrary
 * provider names without enumerating every entry from ANTHROPIC_PROVIDERS.
 */
const PROVIDER_BASE_URL_PATTERN = /^provider\.[a-z0-9-]+\.baseUrl$/;

/**
 * Per-scope tier override keys written by ProviderModelsService:
 *   provider.<providerId>.<mainAgent|cliAgent>.modelTier.<sonnet|opus|haiku>
 *
 * Must be file-routed for every provider id (including trademarked ones not
 * declarable in package.json contributes.configuration) so that the scoped
 * writes from the Model Mapping dialog actually persist to ~/.ptah/settings.json.
 */
const PROVIDER_SCOPED_TIER_PATTERN =
  /^provider\.[a-z0-9-]+\.(mainAgent|cliAgent)\.modelTier\.(sonnet|opus|haiku)$/;

/**
 * Returns true when the given settings key should be routed to file-based
 * storage (~/.ptah/settings.json). Prefer this over `FILE_BASED_SETTINGS_KEYS.has()`
 * directly so dynamic key families (e.g. provider base URL overrides) are
 * resolved consistently across all platform workspace providers.
 */
export function isFileBasedSettingKey(key: string): boolean {
  if (FILE_BASED_SETTINGS_KEYS.has(key)) return true;
  if (PROVIDER_BASE_URL_PATTERN.test(key)) return true;
  if (PROVIDER_SCOPED_TIER_PATTERN.test(key)) return true;
  return false;
}
