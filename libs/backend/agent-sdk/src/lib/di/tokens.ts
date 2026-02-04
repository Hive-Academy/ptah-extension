/**
 * DI tokens for agent-sdk services
 * TASK_2025_044 Batch 3: Dependency injection symbols
 * TASK_2025_140 Batch 1: Migrated from string tokens to Symbol.for()
 *
 * All tokens use Symbol.for() for cross-module DI support.
 * Symbol.for('X') === Symbol.for('X') across all modules, enabling
 * cross-library token resolution (e.g., TOKENS.SDK_AGENT_ADAPTER in
 * vscode-core resolves to the same symbol as SDK_TOKENS.SDK_AGENT_ADAPTER here).
 */
export const SDK_TOKENS = {
  // Core services
  SDK_AGENT_ADAPTER: Symbol.for('SdkAgentAdapter'),
  SDK_SESSION_METADATA_STORE: Symbol.for('SessionMetadataStore'),
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

  // Provider models service (TASK_2025_091 Phase 2, generalized TASK_2025_132)
  SDK_PROVIDER_MODELS: Symbol.for('SdkProviderModels'),

  // @deprecated Use SDK_PROVIDER_MODELS instead
  SDK_OPENROUTER_MODELS: Symbol.for('SdkProviderModels'),

  // Extracted services (TASK_2025_102)
  SDK_MESSAGE_FACTORY: Symbol.for('SdkMessageFactory'),
  SDK_QUERY_OPTIONS_BUILDER: Symbol.for('SdkQueryOptionsBuilder'),
  SDK_MODULE_LOADER: Symbol.for('SdkModuleLoader'),
  SDK_MODEL_SERVICE: Symbol.for('SdkModelService'),
  SDK_USER_MESSAGE_STREAM_FACTORY: Symbol.for('UserMessageStreamFactory'),

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
} as const;

/**
 * Type helper for SDK token keys
 */
export type SdkDIToken = keyof typeof SDK_TOKENS;
