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

import {
  ADVANCED_SETTINGS,
  SESSION_BUDGET_SETTINGS,
} from '@ptah-extension/shared';

/** Only values actually present in settings.json are eligible for migration. */
export const SKILL_SETTINGS_MIGRATIONS = [
  ['skillSynthesis.judgeProvider', 'skills.enhancement.provider'],
  ['skillSynthesis.judgeModel', 'skills.enhancement.model'],
  ['skillSynthesis.enhanceTimeoutMs', 'skills.enhancement.timeoutMs'],
  [
    'skillSynthesis.triggers.skillInvocationTelemetry.enabled',
    'skills.telemetry.enabled',
  ],
] as const;

/**
 * BUILT-IN provider auth keys that each get a `selectedModel` +
 * `reasoningEffort` slot.
 *
 * MUST stay in sync with `KNOWN_PROVIDER_AUTH_KEYS` in
 * `libs/backend/settings-core/src/schema/provider-schema.ts`.
 * We cannot import that constant here because settings-core depends on
 * platform-core (not the reverse) — a circular dependency would result.
 *
 * These keys must be in FILE_BASED_SETTINGS_KEYS so that
 * VscodeWorkspaceProvider routes them to ~/.ptah/settings.json instead of
 * vscode.workspace.getConfiguration (which has no schema for them).
 *
 * USER-DEFINED providers are deliberately NOT here — their ids only exist at
 * runtime. They are matched by `PROVIDER_AUTH_MODEL_PATTERN` below, the same
 * escape-hatch style this file already uses for per-provider base URLs and
 * scoped tier overrides.
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
 * `sessionBudget.*` → default (TASK_2026_597 N7), derived from the shared
 * bounds table so the key list, these defaults, the backend reader and the
 * settings card all read one source. `tightenWindowTokens` defaults to
 * `null` (advisory only): `PtahFileSettingsManager.get` returns a registered
 * `null` default as `null`, not as "unset".
 *
 * Deliberately NOT in `KNOWN_CONFIG_KEYS` (settings export, AS-N7a): that
 * would write the shipped defaults into every export file.
 */
const SESSION_BUDGET_SETTINGS_DEFAULTS: Record<string, unknown> =
  Object.fromEntries(
    Object.values(SESSION_BUDGET_SETTINGS).map((setting) => [
      setting.key,
      setting.default,
    ]),
  );

/**
 * The Settings "advanced" keys → default (TASK_2026_658), derived from the
 * shared `ADVANCED_SETTINGS` table so each default literal lives in one place;
 * the same table bounds the `settings:set` write and the settings groups.
 * `budgetDefault` in agent-sdk throws when a `compaction.*` default is missing
 * or not a positive integer, so those entries must stay positive integers.
 */
const ADVANCED_SETTINGS_DEFAULTS: Record<string, unknown> = Object.fromEntries(
  ADVANCED_SETTINGS.map((setting) => [setting.key, setting.default]),
);

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
  'reasoningEffort',
  'model.selected',
  'autopilot.enabled',
  'autopilot.permissionLevel',
  'agentOrchestration.codexModel',
  'agentOrchestration.codexReasoningEffort',
  'agentOrchestration.codexAutoApprove',
  'agentOrchestration.codexAutoCompactTokens',
  'agentOrchestration.codexToolOutputTokenLimit',
  'agentOrchestration.codexWebSearch',
  'agentOrchestration.copilotModel',
  'agentOrchestration.copilotReasoningEffort',
  'agentOrchestration.copilotAutoApprove',
  'agentOrchestration.piReasoningEffort',
  'agentOrchestration.cursorModel',
  'agentOrchestration.antigravityModel',
  'agentOrchestration.grokModel',
  'agentOrchestration.opencodeModel',
  'agentOrchestration.piModel',
  'agentOrchestration.subagentPromptCacheTtl',
  // Lane tool-call guards (TASK_2026_597 Wave D).
  'agentOrchestration.laneToolCallSteerAt',
  'agentOrchestration.laneToolCallStopAt',
  'agentOrchestration.laneRepeatCallStopAt',
  // Lane-routing decision model (TASK_2026_646_136a): a `DecisionModelSelection`
  // object written by `DecisionModelConfig.setSelection`. VS Code has no schema
  // for it, so without this entry every save is rejected there.
  'agentOrchestration.decisionModel',
  // Compaction budgets (TASK_2026_597 Wave D). `compaction.threshold` is NOT
  // here: it is still VS Code-contributed and moves with its migration.
  'compaction.toolOutputBudgetTokens',
  'compaction.subagentHandoffTokens',
  'compaction.rotationSuggestTokens',
  'compaction.subagentStopWeightedTokens',
  // Idle compaction settings (TASK_2026_692).
  'compaction.idleCompactionEnabled',
  'compaction.idleCompactionMinTokens',
  // Machine scope: { "<agent-slug>" | "*": { claude?, codex?, copilot?, cursor?, opencode?: string } }.
  // Workspace override: workspace.<hash>.agentGeneration.models,
  // already routed by SCOPED_SETTING_PREFIX_PATTERN.
  'agentGeneration.models',
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
  'workflows.disabled',
  'diff.renderSideBySide',
  'editorLauncher.lastTarget',
  'memory.embeddingModel',
  'memory.curatorModel',
  'memory.curatorProvider',
  'memory.searchTopK',
  'memory.searchAlpha',
  'memory.symbolInjectionEnabled',
  'skillSynthesis.enabled',
  // Root for shipped skills.
  'skillSynthesis.skillsRoot',
  'skills.enhancement.provider',
  'skills.enhancement.model',
  'skills.enhancement.timeoutMs',
  'skills.telemetry.enabled',
  'memory.enabled',
  // MemoryRetentionService (memory-curator). Defaults below must equal the
  // `memory-retention-config.ts` fallbacks; pinned by memory-retention.service.spec.ts.
  'memory.retention.enabled',
  'memory.retention.processedDays',
  'memory.retention.stuckDays',
  'memory.retention.batchSize',
  'memory.lifecycle.enabled',
  'memory.lifecycle.archiveAfterDays',
  'memory.lifecycle.deleteAfterDays',
  'memory.lifecycle.maxPerWorkspace',
  'memory.triggers.idleMs',
  'memory.triggers.turnThreshold',
  'memory.triggers.bootScan',
  'memory.triggers.userPromptSubmit.enabled',
  'memory.triggers.userPromptSubmit.cueList',
  'memory.triggers.userPromptSubmit.minPromptLength',
  'memory.triggers.postToolUse.enabled',
  'memory.triggers.maxCuratesPerHour',
  // The one-shot concurrency gate that every internal caller shares —
  // memory-curator, skill-synthesis, cron, the harness LLM runner and the setup
  // wizard all queue on the same process-wide singleton (TASK_2026_323 B6).
  // The global and timeout keys were read through `getConfiguration` from the day the gate
  // shipped and registered NOWHERE — not here, not in the VS Code
  // `contributes.configuration` — so they hit this file's documented silent-drop
  // failure mode in the write direction on every host, and the gate stayed
  // pinned at its defaults with no way for a user to move it (TASK_2026_328).
  // The per-lane key was also unregistered until TASK_2026_463.
  'internalQuery.maxConcurrent',
  'internalQuery.maxConcurrentPerLane',
  'internalQuery.queueTimeoutMs',
  'cron.enabled',
  'cron.maxConcurrentJobs',
  'cron.catchupWindowMs',
  'gateway.enabled',
  'gateway.coalesceMs',
  'gateway.rateLimit.minTimeMs',
  'gateway.rateLimit.maxConcurrent',
  'gateway.voice.enabled',
  'gateway.voice.whisperModel',
  'voice.whisperModel',
  'voice.ttsVoice',
  'gateway.telegram.enabled',
  'gateway.telegram.tokenCipher',
  'gateway.telegram.allowedUserIds',
  'gateway.discord.enabled',
  'gateway.discord.tokenCipher',
  'gateway.discord.allowedGuildIds',
  'gateway.discord.applicationId',
  'gateway.slack.enabled',
  'gateway.slack.botTokenCipher',
  'gateway.slack.appTokenCipher',
  'gateway.slack.allowedTeamIds',
  // Saved Tasks-board views (TASK_2026_181, FR-C2). These two are per-user
  // state with no `package.json contributes.configuration` declaration behind
  // them, so routing them here is what makes them PERSIST AT ALL: without the
  // entry, VscodeWorkspaceProvider hands the key to
  // vscode.workspace.getConfiguration, which has no schema for it, and the
  // write is discarded with no error and no warning.
  'tasks.savedViews',
  'tasks.activeViewId',
  // Harness reconciler (TASK_2026_278). Both are read with section 'ptah' —
  // the earlier readers used section 'harness', which reached
  // vscode.workspace.getConfiguration('harness'), a section no
  // `contributes.configuration` declares. Reads returned undefined and writes
  // were dropped silently, so the keys were unsettable on VS Code.
  //
  // Their defaults come from ADVANCED_SETTINGS_DEFAULTS (TASK_2026_658) so the
  // Settings page reads a value instead of undefined. They must equal
  // `harness-sync` DEFAULT_PREFLIGHT_TIMEOUT_MS (1500) and
  // DEFAULT_MANAGE_GITIGNORE (true), which every reader still falls back to.
  'harness.preflightTimeoutMs',
  'harness.manageGitignore',
  // Host notification preferences use the shared advanced-settings defaults.
  'notifications.hostEnabled',
  'notifications.failureHostEnabled',
  // User-defined provider entries (TASK_2026_236) — one JSON array of
  // NON-SECRET metadata. API keys never live here; they stay in SecretStorage
  // via AuthSecretsService.setProviderKey().
  'provider.custom.entries',
  ...KNOWN_AUTH_KEYS_FOR_FILE_ROUTING.flatMap((k) => [
    `provider.${k}.selectedModel`,
    `provider.${k}.reasoningEffort`,
  ]),
  // Session budget (TASK_2026_597 N7): ten keys spread from the shared table.
  ...Object.keys(SESSION_BUDGET_SETTINGS_DEFAULTS),
]);

/**
 * Skill enhancement timeout configuration boundaries and default in milliseconds.
 * Governs both the legacy timeout and `skills.enhancement.timeoutMs`.
 */
export const ENHANCE_TIMEOUT_MIN_MS = 15_000;
export const ENHANCE_TIMEOUT_MAX_MS = 600_000;
export const ENHANCE_TIMEOUT_DEFAULT_MS = 120_000;

/**
 * File-based keys whose value is a plain object stored whole.
 *
 * `PtahFileSettingsManager` flattens every nested object on load, so without
 * this list an object written to one of these keys would come back as
 * `<key>.<field>` leaves after a reload, and the key itself would read as
 * unset. Each key here must also be in `FILE_BASED_SETTINGS_KEYS`.
 */
export const FILE_BASED_OBJECT_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  // `DecisionModelSelection` (TASK_2026_646_136a), e.g. `{ kind, model }`.
  'agentOrchestration.decisionModel',
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
  'llm.defaultProvider': '',
  reasoningEffort: 'medium',
  'model.selected': '',
  'autopilot.enabled': false,
  'autopilot.permissionLevel': 'ask',
  'agentOrchestration.codexModel': '',
  'agentOrchestration.codexReasoningEffort': '',
  'agentOrchestration.codexAutoApprove': true,
  // Codex lane budgets and codexWebSearch: see ADVANCED_SETTINGS_DEFAULTS.
  'agentOrchestration.copilotModel': '',
  'agentOrchestration.copilotReasoningEffort': '',
  'agentOrchestration.copilotAutoApprove': true,
  'agentOrchestration.piReasoningEffort': '',
  'agentOrchestration.cursorModel': '',
  'agentOrchestration.antigravityModel': '',
  'agentOrchestration.grokModel': '',
  'agentOrchestration.opencodeModel': '',
  'agentOrchestration.piModel': '',
  // Subagent prompt-cache TTL: 'auto' | '5m' | '1h'. 'auto' asks for 1h only when the session can spawn subagents.
  'agentOrchestration.subagentPromptCacheTtl': 'auto',
  // Lane tool-call guards: steer at N calls, stop at N calls, stop at N identical calls.
  'agentOrchestration.laneToolCallSteerAt': 40,
  'agentOrchestration.laneToolCallStopAt': 60,
  'agentOrchestration.laneRepeatCallStopAt': 20,
  // `null` reads as `{ kind: 'unset' }` in DecisionModelConfig.getSelection,
  // with no invalid-value warning.
  'agentOrchestration.decisionModel': null,
  // Compaction budgets: see ADVANCED_SETTINGS_DEFAULTS.
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
  'workflows.disabled': false,
  'diff.renderSideBySide': true,
  'memory.embeddingModel': 'Xenova/bge-small-en-v1.5',
  'memory.curatorModel': '',
  'memory.curatorProvider': '',
  'memory.searchTopK': 20,
  'memory.searchAlpha': 0.5,
  'skillSynthesis.enabled': true,
  'skillSynthesis.skillsRoot': '',
  'skills.enhancement.provider': '',
  'skills.enhancement.model': 'inherit',
  'skills.enhancement.timeoutMs': ENHANCE_TIMEOUT_DEFAULT_MS,
  'skills.telemetry.enabled': true,
  'memory.enabled': true,
  // Must equal the `memory-retention-config.ts` fallbacks (MemoryRetentionService);
  // pinned by memory-retention.service.spec.ts. The numeric retention and
  // lifecycle keys come from ADVANCED_SETTINGS_DEFAULTS.
  'memory.retention.enabled': true,
  'memory.lifecycle.enabled': true,
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
  'memory.triggers.maxCuratesPerHour': 20,
  // internalQuery.* must match `DEFAULT_MAX_CONCURRENT`,
  // `DEFAULT_MAX_CONCURRENT_PER_LANE` and `DEFAULT_QUEUE_TIMEOUT_MS` in
  // `agent-sdk/src/lib/internal-query/internal-query-concurrency-gate.ts`. A
  // drift is invisible: the service falls back to its own constant, so the two
  // would disagree only for a user who never wrote the setting. They, and
  // cron.maxConcurrentJobs / cron.catchupWindowMs, come from
  // ADVANCED_SETTINGS_DEFAULTS.
  'cron.enabled': true,
  'gateway.enabled': false,
  'gateway.coalesceMs': 250,
  'gateway.rateLimit.minTimeMs': 500,
  'gateway.rateLimit.maxConcurrent': 2,
  'gateway.voice.enabled': true,
  'gateway.voice.whisperModel': 'base.en',
  'voice.whisperModel': 'base.en',
  'voice.ttsVoice': 'af_heart',
  'gateway.telegram.enabled': false,
  'gateway.telegram.tokenCipher': '',
  'gateway.telegram.allowedUserIds': [],
  'gateway.discord.enabled': false,
  'gateway.discord.tokenCipher': '',
  'gateway.discord.allowedGuildIds': [],
  'gateway.discord.applicationId': '',
  'gateway.slack.enabled': false,
  'gateway.slack.botTokenCipher': '',
  'gateway.slack.appTokenCipher': '',
  'gateway.slack.allowedTeamIds': [],
  // Must stay in lockstep with the two `tasks.*` entries above.
  'tasks.savedViews': [],
  'tasks.activeViewId': '',
  // No custom providers until the user adds one.
  'provider.custom.entries': [],
  ...Object.fromEntries(
    KNOWN_AUTH_KEYS_FOR_FILE_ROUTING.flatMap((k) => [
      [`provider.${k}.selectedModel`, ''],
      [`provider.${k}.reasoningEffort`, ''],
    ]),
  ),
  // Session budget (TASK_2026_597 N7). Same table as the key list above.
  ...SESSION_BUDGET_SETTINGS_DEFAULTS,
  // Settings "advanced" keys (TASK_2026_658). Same table as the Settings groups.
  ...ADVANCED_SETTINGS_DEFAULTS,
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
 *   provider.<providerId>.<mainAgent|cliAgent|lane>.modelTier.<sonnet|opus|haiku>
 *
 * Must be file-routed for every provider id (including trademarked ones not
 * declarable in package.json contributes.configuration) so that the scoped
 * writes from the Model Mapping dialog actually persist to ~/.ptah/settings.json.
 *
 * The alternation must list EVERY member of `ProviderTierScope`
 * (`libs/shared/src/lib/types/rpc/rpc-providers.types.ts`). A scope missing
 * here fails silently in one direction only, which is why it is easy to miss:
 * reads fall through to the provider entry's `defaultTiers` and look correct,
 * and only a WRITE is lost — `set()` is routed to a store that does not own
 * the key, no error is raised, and the next read serves the default as if the
 * user had never remapped the tier. `'lane'` (TASK_2026_180, background skill
 * lanes) was absent for exactly one batch for this reason.
 */
const PROVIDER_SCOPED_TIER_PATTERN =
  /^provider\.[a-z0-9-]+\.(mainAgent|cliAgent|lane)\.modelTier\.(sonnet|opus|haiku)$/;

/**
 * Per-provider model / reasoning-effort keys for THIRD-PARTY providers:
 *   provider.thirdParty.<providerId>.(selectedModel|reasoningEffort)
 *
 * `KNOWN_AUTH_KEYS_FOR_FILE_ROUTING` above enumerates these for the built-in
 * providers. It cannot enumerate USER-DEFINED providers — their ids are typed
 * by the user at runtime — so before this pattern existed a custom entry's
 * model and reasoning-effort choices hit the documented silent-drop failure
 * mode of this file: no schema in vscode.workspace.getConfiguration, write
 * discarded, no error (TASK_2026_236).
 *
 * The id character class matches CUSTOM_PROVIDER_ID_PATTERN in
 * `libs/shared/src/lib/providers/provider-registry.ts` — a custom id outside
 * it is rejected at entry-creation time, so it can never reach here.
 */
const PROVIDER_AUTH_MODEL_PATTERN =
  /^provider\.thirdParty\.[a-z0-9-]+\.(selectedModel|reasoningEffort)$/;

const SCOPED_SETTING_PREFIX_PATTERN = /^(app|workspace)\./;

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
  if (PROVIDER_AUTH_MODEL_PATTERN.test(key)) return true;
  if (SCOPED_SETTING_PREFIX_PATTERN.test(key)) return true;
  return false;
}
