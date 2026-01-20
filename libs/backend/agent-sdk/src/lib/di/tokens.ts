/**
 * DI tokens for agent-sdk services
 * TASK_2025_044 Batch 3: Dependency injection symbols
 */

/**
 * Agent SDK DI Tokens
 * Use string tokens to avoid Symbol conflicts with main DI container
 */
export const SDK_TOKENS = {
  // Core services
  SDK_AGENT_ADAPTER: 'SdkAgentAdapter',
  SDK_SESSION_METADATA_STORE: 'SessionMetadataStore',
  SDK_SESSION_IMPORTER: 'SdkSessionImporter',
  SDK_SESSION_HISTORY_READER: 'SdkSessionHistoryReader',
  SDK_PERMISSION_HANDLER: 'SdkPermissionHandler',
  SDK_MESSAGE_TRANSFORMER: 'SdkMessageTransformer',

  // Helper services
  SDK_AUTH_MANAGER: 'SdkAuthManager',
  SDK_SESSION_LIFECYCLE_MANAGER: 'SdkSessionLifecycleManager',
  SDK_CONFIG_WATCHER: 'SdkConfigWatcher',
  SDK_STREAM_TRANSFORMER: 'SdkStreamTransformer',
  SDK_CLI_DETECTOR: 'SdkCliDetector',
  SDK_ATTACHMENT_PROCESSOR: Symbol('SdkAttachmentProcessor'),

  // Subagent hook handler (TASK_2025_099)
  SDK_SUBAGENT_HOOK_HANDLER: 'SdkSubagentHookHandler',

  // Compaction configuration provider (TASK_2025_098)
  SDK_COMPACTION_CONFIG_PROVIDER: 'SdkCompactionConfigProvider',

  // Compaction hook handler (TASK_2025_098)
  SDK_COMPACTION_HOOK_HANDLER: 'SdkCompactionHookHandler',

  // OpenRouter services (TASK_2025_091 Phase 2)
  SDK_OPENROUTER_MODELS: 'SdkOpenRouterModels',

  // Extracted services (TASK_2025_102)
  SDK_MESSAGE_FACTORY: 'SdkMessageFactory',
  SDK_QUERY_OPTIONS_BUILDER: 'SdkQueryOptionsBuilder',
  SDK_MODULE_LOADER: 'SdkModuleLoader',
  SDK_MODEL_SERVICE: 'SdkModelService',
  SDK_USER_MESSAGE_STREAM_FACTORY: 'UserMessageStreamFactory',

  // History reader child services (TASK_2025_106)
  SDK_HISTORY_EVENT_FACTORY: 'SdkHistoryEventFactory',
  SDK_JSONL_READER: 'SdkJsonlReader',
  SDK_AGENT_CORRELATION: 'SdkAgentCorrelation',
  SDK_SESSION_REPLAY: 'SdkSessionReplay',
} as const;

/**
 * Type helper for SDK token keys
 */
export type SdkDIToken = keyof typeof SDK_TOKENS;
