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
 * SDK_TOKENS holds only SDK-internal services (SdkAgentAdapter, SdkQueryRunner,
 * SessionLifecycleManager, etc.). Auth + provider tokens live in
 * `@ptah-extension/auth-providers-tokens` as AUTH_PROVIDERS_TOKENS — consumers
 * inject from that leaf lib directly.
 *
 * Token files:
 * - vscode-core/src/di/tokens.ts             — core infrastructure tokens (TOKENS)
 * - agent-sdk/src/lib/di/tokens.ts (this)    — SDK-internal services
 * - auth-providers-tokens/src/lib/tokens.ts  — AUTH_PROVIDERS_TOKENS (canonical)
 * - agent-generation/src/lib/di/tokens.ts    — agent generation tokens
 *
 * @see libs/backend/vscode-core/src/di/tokens.ts for canonical convention reference
 */
export const SDK_TOKENS = {
  SDK_AGENT_ADAPTER: Symbol.for('SdkAgentAdapter'),
  SDK_SESSION_METADATA_STORE: Symbol.for('SdkSessionMetadataStore'),
  SDK_SESSION_IMPORTER: Symbol.for('SdkSessionImporter'),
  SDK_SESSION_HISTORY_READER: Symbol.for('SdkSessionHistoryReader'),
  SDK_PERMISSION_HANDLER: Symbol.for('SdkPermissionHandler'),
  SDK_MESSAGE_TRANSFORMER: Symbol.for('SdkMessageTransformer'),
  SDK_SESSION_LIFECYCLE_MANAGER: Symbol.for('SdkSessionLifecycleManager'),
  SDK_CONFIG_WATCHER: Symbol.for('SdkConfigWatcher'),
  SDK_STREAM_TRANSFORMER: Symbol.for('SdkStreamTransformer'),
  SDK_CLI_DETECTOR: Symbol.for('SdkCliDetector'),
  SDK_ATTACHMENT_PROCESSOR: Symbol.for('SdkAttachmentProcessor'),
  SDK_SUBAGENT_HOOK_HANDLER: Symbol.for('SdkSubagentHookHandler'),
  SDK_COMPACTION_CONFIG_PROVIDER: Symbol.for('SdkCompactionConfigProvider'),
  SDK_COMPACTION_HOOK_HANDLER: Symbol.for('SdkCompactionHookHandler'),

  SDK_COMPACTION_CALLBACK_REGISTRY: Symbol.for('SdkCompactionCallbackRegistry'),

  SDK_SESSION_END_CALLBACK_REGISTRY: Symbol.for(
    'SdkSessionEndCallbackRegistry',
  ),
  SDK_SESSION_ACTIVITY_REGISTRY: Symbol.for('SdkSessionActivityRegistry'),
  SDK_WORKTREE_HOOK_HANDLER: Symbol.for('SdkWorktreeHookHandler'),
  SDK_MESSAGE_FACTORY: Symbol.for('SdkMessageFactory'),
  SDK_QUERY_OPTIONS_BUILDER: Symbol.for('SdkQueryOptionsBuilder'),
  SDK_QUERY_RUNNER: Symbol.for('SdkQueryRunner'),
  SDK_MODULE_LOADER: Symbol.for('SdkModuleLoader'),
  SDK_MODEL_SERVICE: Symbol.for('SdkModelService'),
  SDK_HISTORY_EVENT_FACTORY: Symbol.for('SdkHistoryEventFactory'),
  SDK_JSONL_READER: Symbol.for('SdkJsonlReader'),
  SDK_AGENT_CORRELATION: Symbol.for('SdkAgentCorrelation'),
  SDK_SESSION_REPLAY: Symbol.for('SdkSessionReplay'),

  SDK_INTERNAL_QUERY_SERVICE: Symbol.for('SdkInternalQueryService'),

  SDK_PLUGIN_LOADER: Symbol.for('SdkPluginLoader'),

  SDK_SLASH_COMMAND_INTERCEPTOR: Symbol.for('SdkSlashCommandInterceptor'),

  SDK_SKILL_JUNCTION: Symbol.for('SdkSkillJunction'),

  SDK_SETTINGS_EXPORT: Symbol.for('SdkSettingsExport'),
  SDK_SETTINGS_IMPORT: Symbol.for('SdkSettingsImport'),

  SDK_LIVE_USAGE_TRACKER: Symbol.for('SdkLiveUsageTracker'),

  SDK_MEMORY_PROMPT_INJECTOR: Symbol.for('SdkMemoryPromptInjector'),

  SDK_CURATOR_LLM_ADAPTER: Symbol.for('PtahCuratorLlm'),

  SDK_CURATOR_AUTH_RESOLVER: Symbol.for('SdkCuratorAuthResolver'),

  SDK_SUBAGENT_MESSAGE_DISPATCHER: Symbol.for('SubagentMessageDispatcher'),

  SDK_WARM_QUERY_MANAGER: Symbol.for('SdkWarmQueryManager'),
  SDK_SESSION_FORK_SERVICE: Symbol.for('SdkSessionForkService'),
  SDK_RUNTIME_STATE: Symbol.for('SdkRuntimeState'),
  SDK_ADAPTER_EVENTS: Symbol.for('SdkAdapterEvents'),

  SDK_SUBAGENT_STOP_CALLBACK_REGISTRY: Symbol.for(
    'SdkSubagentStopCallbackRegistry',
  ),
  SDK_POST_TOOL_USE_CALLBACK_REGISTRY: Symbol.for(
    'SdkPostToolUseCallbackRegistry',
  ),
  SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY: Symbol.for(
    'SdkUserPromptSubmitCallbackRegistry',
  ),
  SDK_POST_TOOL_USE_HOOK_HANDLER: Symbol.for('SdkPostToolUseHookHandler'),
  SDK_USER_PROMPT_SUBMIT_HOOK_HANDLER: Symbol.for(
    'SdkUserPromptSubmitHookHandler',
  ),
  SDK_STOP_CALLBACK_REGISTRY: Symbol.for('SdkStopCallbackRegistry'),
  SDK_STOP_HOOK_HANDLER: Symbol.for('SdkStopHookHandler'),
  SDK_STOP_FAILURE_HOOK_HANDLER: Symbol.for('SdkStopFailureHookHandler'),
  SDK_SUBAGENT_STOP_HOOK_HANDLER: Symbol.for('SdkSubagentStopHookHandler'),
  SDK_SESSION_END_HOOK_CALLBACK_REGISTRY: Symbol.for(
    'SdkSessionEndHookCallbackRegistry',
  ),
  SDK_SESSION_END_HOOK_HANDLER: Symbol.for('SdkSessionEndHookHandler'),
  SDK_TOOL_FAILURE_CALLBACK_REGISTRY: Symbol.for(
    'SdkToolFailureCallbackRegistry',
  ),
  SDK_TOOL_FAILURE_HOOK_HANDLER: Symbol.for('SdkToolFailureHookHandler'),
  SDK_CURATOR_RATE_LIMIT: Symbol.for('SdkCuratorRateLimit'),
  PRICING_PROVIDER: Symbol.for('SDK_PRICING_PROVIDER'),
  SDK_PRE_TOOL_USE_CALLBACK_REGISTRY: Symbol.for(
    'SdkPreToolUseCallbackRegistry',
  ),
  SDK_PRE_TOOL_USE_HOOK_HANDLER: Symbol.for('SdkPreToolUseHookHandler'),
  SDK_SESSION_START_CALLBACK_REGISTRY: Symbol.for(
    'SdkSessionStartCallbackRegistry',
  ),
  SDK_SESSION_START_HOOK_HANDLER: Symbol.for('SdkSessionStartHookHandler'),
} as const;

/**
 * Type helper for SDK token keys
 */
export type SdkDIToken = keyof typeof SDK_TOKENS;
