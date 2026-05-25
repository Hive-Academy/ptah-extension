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
  'authMethod',
  'anthropicProviderId',
  'llm.defaultProvider',
  'llm.vscode.model',
  'reasoningEffort',
  'model.selected',
  'agentOrchestration.codexModel',
  'agentOrchestration.codexReasoningEffort',
  'agentOrchestration.codexAutoApprove',
  'agentOrchestration.copilotModel',
  'agentOrchestration.copilotReasoningEffort',
  'agentOrchestration.copilotAutoApprove',
  'agentOrchestration.cursorModel',
  'agentOrchestration.disabledClis',
  'agentOrchestration.disabledMcpNamespaces',
  'provider.cursor.apiKey',
  'provider.github-copilot.tokenExchangeUrl',
  'provider.github-copilot.apiEndpoint',
  'provider.github-copilot.clientId',
  'provider.github-copilot.modelTier.opus',
  'provider.github-copilot.modelTier.sonnet',
  'provider.github-copilot.modelTier.haiku',
  'provider.openai-codex.oauthApiEndpoint',
  'provider.openai-codex.modelTier.opus',
  'provider.openai-codex.modelTier.sonnet',
  'provider.openai-codex.modelTier.haiku',
  'provider.openrouter.modelTier.opus',
  'provider.openrouter.modelTier.sonnet',
  'provider.openrouter.modelTier.haiku',
  'provider.moonshot.modelTier.opus',
  'provider.moonshot.modelTier.sonnet',
  'provider.moonshot.modelTier.haiku',
  'provider.z-ai.modelTier.opus',
  'provider.z-ai.modelTier.sonnet',
  'provider.z-ai.modelTier.haiku',
  'provider.ollama.modelTier.opus',
  'provider.ollama.modelTier.sonnet',
  'provider.ollama.modelTier.haiku',
  'provider.ollama-cloud.modelTier.opus',
  'provider.ollama-cloud.modelTier.sonnet',
  'provider.ollama-cloud.modelTier.haiku',
  'provider.lm-studio.modelTier.opus',
  'provider.lm-studio.modelTier.sonnet',
  'provider.lm-studio.modelTier.haiku',
  'ptahCliAgents',
  'browser.allowLocalhost',
  'browser.recordingDir',
  'editor.vimMode',
  'memory.curatorEnabled',
  'memory.tierLimits.core',
  'memory.tierLimits.recall',
  'memory.tierLimits.archival',
  'memory.decayHalflifeDays',
  'memory.embeddingModel',
  'memory.curatorModel',
  'memory.searchTopK',
  'memory.searchAlpha',
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
  'memory.triggers.preCompact',
  'memory.triggers.idleMs',
  'memory.triggers.turnThreshold',
  'memory.triggers.bootScan',
  'memory.triggers.userPromptSubmit.enabled',
  'memory.triggers.userPromptSubmit.cueList',
  'memory.triggers.userPromptSubmit.minPromptLength',
  'memory.triggers.postToolUse.enabled',
  'memory.triggers.maxCuratesPerHour',
  'skillSynthesis.triggers.sessionEnd',
  'skillSynthesis.triggers.idleMs',
  'skillSynthesis.triggers.bootScan',
  'skillSynthesis.triggers.subagentStop.enabled',
  'skillSynthesis.triggers.postToolUse.enabled',
  'skillSynthesis.triggers.postToolUse.minEditCount',
  'skillSynthesis.triggers.maxAnalyzesPerHour',
  'cron.enabled',
  'cron.maxConcurrentJobs',
  'cron.catchupWindowMs',
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
  authMethod: 'apiKey',
  anthropicProviderId: 'openrouter',
  'llm.defaultProvider': 'vscode-lm',
  'llm.vscode.model': 'copilot/gpt-4o',
  reasoningEffort: 'medium',
  'model.selected': '',
  'agentOrchestration.codexModel': '',
  'agentOrchestration.codexReasoningEffort': '',
  'agentOrchestration.codexAutoApprove': true,
  'agentOrchestration.copilotModel': '',
  'agentOrchestration.copilotReasoningEffort': '',
  'agentOrchestration.copilotAutoApprove': true,
  'agentOrchestration.cursorModel': '',
  'agentOrchestration.disabledClis': [],
  'agentOrchestration.disabledMcpNamespaces': [],
  'provider.cursor.apiKey': '',
  'provider.github-copilot.tokenExchangeUrl': '',
  'provider.github-copilot.apiEndpoint': '',
  'provider.github-copilot.clientId': '',
  'provider.github-copilot.modelTier.opus': null,
  'provider.github-copilot.modelTier.sonnet': null,
  'provider.github-copilot.modelTier.haiku': null,
  'provider.openai-codex.oauthApiEndpoint': '',
  'provider.openai-codex.modelTier.opus': null,
  'provider.openai-codex.modelTier.sonnet': null,
  'provider.openai-codex.modelTier.haiku': null,
  'provider.openrouter.modelTier.opus': null,
  'provider.openrouter.modelTier.sonnet': null,
  'provider.openrouter.modelTier.haiku': null,
  'provider.moonshot.modelTier.opus': null,
  'provider.moonshot.modelTier.sonnet': null,
  'provider.moonshot.modelTier.haiku': null,
  'provider.z-ai.modelTier.opus': null,
  'provider.z-ai.modelTier.sonnet': null,
  'provider.z-ai.modelTier.haiku': null,
  'provider.ollama.modelTier.opus': null,
  'provider.ollama.modelTier.sonnet': null,
  'provider.ollama.modelTier.haiku': null,
  'provider.ollama-cloud.modelTier.opus': null,
  'provider.ollama-cloud.modelTier.sonnet': null,
  'provider.ollama-cloud.modelTier.haiku': null,
  'provider.lm-studio.modelTier.opus': null,
  'provider.lm-studio.modelTier.sonnet': null,
  'provider.lm-studio.modelTier.haiku': null,
  ptahCliAgents: [],
  'browser.allowLocalhost': false,
  'browser.recordingDir': '',
  'editor.vimMode': false,
  'memory.curatorEnabled': true,
  'memory.tierLimits.core': 256,
  'memory.tierLimits.recall': 4096,
  'memory.tierLimits.archival': 100000,
  'memory.decayHalflifeDays': 30,
  'memory.embeddingModel': 'Xenova/bge-small-en-v1.5',
  'memory.curatorModel': '',
  'memory.searchTopK': 20,
  'memory.searchAlpha': 0.5,
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
  'memory.triggers.preCompact': true,
  'memory.triggers.idleMs': 600000,
  'memory.triggers.turnThreshold': 20,
  'memory.triggers.bootScan': true,
  'memory.triggers.userPromptSubmit.enabled': true,
  'memory.triggers.userPromptSubmit.cueList': [
    'remember (this|that)',
    '(important|critical)\\s+(point|note|fact|detail)',
    'from now on',
    'going forward',
    'keep in mind',
    'note that',
    'save to memory',
  ],
  'memory.triggers.userPromptSubmit.minPromptLength': 20,
  'memory.triggers.postToolUse.enabled': true,
  'memory.triggers.maxCuratesPerHour': 12,
  'skillSynthesis.triggers.sessionEnd': true,
  'skillSynthesis.triggers.idleMs': 600000,
  'skillSynthesis.triggers.bootScan': true,
  'skillSynthesis.triggers.subagentStop.enabled': true,
  'skillSynthesis.triggers.postToolUse.enabled': true,
  'skillSynthesis.triggers.postToolUse.minEditCount': 3,
  'skillSynthesis.triggers.maxAnalyzesPerHour': 6,
  'cron.enabled': true,
  'cron.maxConcurrentJobs': 3,
  'cron.catchupWindowMs': 86400000,
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
