/**
 * DI Token Registry - Agent SDK Tokens
 *
 * CONVENTION: All DI tokens MUST use Symbol.for('DescriptiveName')
 *
 * Why Symbol.for():
 * - Symbol.for() creates globally shared symbols (same description = same symbol)
 * - String tokens ('Name') and Symbol.for('Name') are different — causes silent DI failures
 * - Plain Symbol('Name') !== Symbol('Name') — creates unique symbols per call
 * - Symbol.for('Name') === Symbol.for('Name') — always matches, even across modules
 *
 * Rules:
 * 1. Always use Symbol.for() for token values
 * 2. Never use string literals as DI tokens
 * 3. Never use plain Symbol() (without .for)
 * 4. Always inject via token constants (TOKENS.X, SDK_TOKENS.X), never hardcode strings
 *    in @inject() decorators
 * 5. Each Symbol.for() description must be globally unique across all token files
 *    (unless intentionally shared for cross-library resolution, e.g.,
 *    TOKENS.SDK_AGENT_ADAPTER and SDK_TOKENS.SDK_AGENT_ADAPTER both resolve to
 *    Symbol.for('SdkAgentAdapter') so they reference the same registration)
 *
 * Token files:
 * - vscode-core/src/di/tokens.ts    — core infrastructure tokens (TOKENS)
 * - agent-sdk/src/lib/di/tokens.ts  (this file) — SDK-specific tokens
 * - agent-generation/src/lib/di/tokens.ts — agent generation tokens (AGENT_GENERATION_TOKENS)
 *
 * @see libs/backend/vscode-core/src/di/tokens.ts for canonical convention reference
 */
export const SDK_TOKENS = {
  // Core services
  SDK_AGENT_ADAPTER: Symbol.for('SdkAgentAdapter'),
  SDK_SESSION_METADATA_STORE: Symbol.for('SdkSessionMetadataStore'),
  SDK_SESSION_IMPORTER: Symbol.for('SdkSessionImporter'),
  SDK_SESSION_HISTORY_READER: Symbol.for('SdkSessionHistoryReader'),
  SDK_PERMISSION_HANDLER: Symbol.for('SdkPermissionHandler'),
  SDK_MESSAGE_TRANSFORMER: Symbol.for('SdkMessageTransformer'),

  // Helper services
  SDK_AUTH_MANAGER: Symbol.for('SdkAuthManager'),
  SDK_SESSION_LIFECYCLE_MANAGER: Symbol.for('SdkSessionLifecycleManager'),
  SDK_CONFIG_WATCHER: Symbol.for('SdkConfigWatcher'),
  SDK_STREAM_TRANSFORMER: Symbol.for('SdkStreamTransformer'),
  SDK_CLI_DETECTOR: Symbol.for('SdkCliDetector'),
  SDK_ATTACHMENT_PROCESSOR: Symbol.for('SdkAttachmentProcessor'),

  // Subagent hook handler (TASK_2025_099)
  SDK_SUBAGENT_HOOK_HANDLER: Symbol.for('SdkSubagentHookHandler'),

  // Compaction configuration provider (TASK_2025_098)
  SDK_COMPACTION_CONFIG_PROVIDER: Symbol.for('SdkCompactionConfigProvider'),

  // Compaction hook handler (TASK_2025_098)
  SDK_COMPACTION_HOOK_HANDLER: Symbol.for('SdkCompactionHookHandler'),

  /**
   * Compaction callback registry (TASK_2026_HERMES Track 1).
   * Fan-out registry of additional `CompactionStartCallback` subscribers
   * (e.g. memory curator) invoked by `CompactionHookHandler` in addition
   * to the chat-path's captured closure.
   */
  SDK_COMPACTION_CALLBACK_REGISTRY: Symbol.for('SdkCompactionCallbackRegistry'),

  /**
   * Session end callback registry.
   * Fan-out registry for session-end subscribers (e.g. skill synthesis).
   * Fired by SessionControl.endSession() after session is fully removed.
   */
  SDK_SESSION_END_CALLBACK_REGISTRY: Symbol.for(
    'SdkSessionEndCallbackRegistry',
  ),

  // Worktree hook handler
  SDK_WORKTREE_HOOK_HANDLER: Symbol.for('SdkWorktreeHookHandler'),

  // Provider models service (TASK_2025_091 Phase 2, generalized TASK_2025_132)
  SDK_PROVIDER_MODELS: Symbol.for('SdkProviderModels'),

  // Extracted services (TASK_2025_102)
  SDK_MESSAGE_FACTORY: Symbol.for('SdkMessageFactory'),
  SDK_QUERY_OPTIONS_BUILDER: Symbol.for('SdkQueryOptionsBuilder'),
  SDK_MODULE_LOADER: Symbol.for('SdkModuleLoader'),
  SDK_MODEL_SERVICE: Symbol.for('SdkModelService'),
  // History reader child services (TASK_2025_106)
  SDK_HISTORY_EVENT_FACTORY: Symbol.for('SdkHistoryEventFactory'),
  SDK_JSONL_READER: Symbol.for('SdkJsonlReader'),
  SDK_AGENT_CORRELATION: Symbol.for('SdkAgentCorrelation'),
  SDK_SESSION_REPLAY: Symbol.for('SdkSessionReplay'),

  // Prompt Designer Agent (TASK_2025_137 Batch 2)
  SDK_PROMPT_DESIGNER_AGENT: Symbol.for('SdkPromptDesignerAgent'),

  // Prompt Cache Service (TASK_2025_137 Batch 3)
  SDK_PROMPT_CACHE_SERVICE: Symbol.for('SdkPromptCacheService'),

  // Enhanced Prompts Service (TASK_2025_137 Batch 4)
  SDK_ENHANCED_PROMPTS_SERVICE: Symbol.for('SdkEnhancedPromptsService'),

  // Internal Query Service (TASK_2025_145)
  // One-shot SDK query execution, separate from interactive chat path
  SDK_INTERNAL_QUERY_SERVICE: Symbol.for('SdkInternalQueryService'),

  // Plugin Loader Service (TASK_2025_153)
  // Manages plugin metadata and per-workspace plugin configuration
  SDK_PLUGIN_LOADER: Symbol.for('SdkPluginLoader'),

  /** Shared mutable AuthEnv singleton (TASK_2025_164) */
  SDK_AUTH_ENV: Symbol.for('SdkAuthEnv'),

  /** Ptah CLI Config Persistence (TASK_2025_176) */
  SDK_PTAH_CLI_CONFIG_PERSISTENCE: Symbol.for('SdkPtahCliConfigPersistence'),

  /** Ptah CLI Spawn Options (TASK_2025_176) */
  SDK_PTAH_CLI_SPAWN_OPTIONS: Symbol.for('SdkPtahCliSpawnOptions'),

  /** Ptah CLI Registry (TASK_2025_167) */
  SDK_PTAH_CLI_REGISTRY: Symbol.for('SdkPtahCliRegistry'),

  /** Slash Command Interceptor (TASK_2025_184) */
  SDK_SLASH_COMMAND_INTERCEPTOR: Symbol.for('SdkSlashCommandInterceptor'),

  /** Copilot Provider Services (TASK_2025_186) */
  SDK_COPILOT_AUTH: Symbol.for('SdkCopilotAuth'),
  SDK_COPILOT_PROXY: Symbol.for('SdkCopilotProxy'),

  /** Codex Provider Services (TASK_2025_193) */
  SDK_CODEX_AUTH: Symbol.for('SdkCodexAuth'),
  SDK_CODEX_PROXY: Symbol.for('SdkCodexProxy'),

  /** OpenRouter Provider Services */
  SDK_OPENROUTER_AUTH: Symbol.for('SdkOpenRouterAuth'),
  SDK_OPENROUTER_PROXY: Symbol.for('SdkOpenRouterProxy'),

  /** Local Model Provider Services (TASK_2025_265, updated TASK_2025_281) */
  SDK_OLLAMA_DISCOVERY: Symbol.for('SdkOllamaDiscovery'),
  SDK_LM_STUDIO_PROXY: Symbol.for('SdkLmStudioProxy'),

  /** Ollama Cloud metadata service — live tags + pricing (TASK_OLLAMA_CLOUD_KEY) */
  SDK_OLLAMA_CLOUD_METADATA: Symbol.for('SdkOllamaCloudMetadata'),

  /** Skill Junction Service (TASK_2025_201) */
  SDK_SKILL_JUNCTION: Symbol.for('SdkSkillJunction'),

  /** Settings Export/Import Services (TASK_2025_210) */
  SDK_SETTINGS_EXPORT: Symbol.for('SdkSettingsExport'),
  SDK_SETTINGS_IMPORT: Symbol.for('SdkSettingsImport'),

  /** Auth Strategy Services (TASK_AUTH_REFACTOR) */
  SDK_API_KEY_STRATEGY: Symbol.for('SdkApiKeyStrategy'),
  SDK_OAUTH_PROXY_STRATEGY: Symbol.for('SdkOAuthProxyStrategy'),
  SDK_LOCAL_NATIVE_STRATEGY: Symbol.for('SdkLocalNativeStrategy'),
  SDK_LOCAL_PROXY_STRATEGY: Symbol.for('SdkLocalProxyStrategy'),
  SDK_CLI_STRATEGY: Symbol.for('SdkCliStrategy'),
  SDK_MODEL_RESOLVER: Symbol.for('SdkModelResolver'),

  /**
   * Live usage tracker (TASK_2026_109 cycle-break).
   * Holds the per-session cumulative pre-compaction token snapshot. Written
   * by `SdkMessageTransformer` from streaming usage events and read by
   * `CompactionHookHandler` at PreCompact firing time.
   */
  SDK_LIVE_USAGE_TRACKER: Symbol.for('SdkLiveUsageTracker'),

  /**
   * MemoryPromptInjector — recalls top-K memories and formats them for system prompt
   * injection at session start. Registered as a singleton; depends on TOKENS.MEMORY_READER
   * (cross-layer alias resolved by memory-curator DI registration, with a no-op fallback
   * registered here for hosts where memory-curator is not loaded).
   * TASK_2026_THOTH_MEMORY_READ
   */
  SDK_MEMORY_PROMPT_INJECTOR: Symbol.for('SdkMemoryPromptInjector'),

  /**
   * SdkInternalQueryCuratorLlm — implements ICuratorLLM by routing curator prompts
   * through InternalQueryService. Symbol.for('PtahCuratorLlm') matches
   * MEMORY_CONTRACT_TOKENS.CURATOR_LLM so memory-curator resolves the same registration.
   */
  SDK_CURATOR_LLM_ADAPTER: Symbol.for('PtahCuratorLlm'),

  /**
   * SubagentMessageDispatcher — bidirectional messaging + stop/interrupt for
   * running subagents. Phase 2 addition.
   */
  SDK_SUBAGENT_MESSAGE_DISPATCHER: Symbol.for('SubagentMessageDispatcher'),
} as const;

/**
 * Type helper for SDK token keys
 */
export type SdkDIToken = keyof typeof SDK_TOKENS;
