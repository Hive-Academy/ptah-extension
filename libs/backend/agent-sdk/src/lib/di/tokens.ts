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
 * Auth + provider tokens are owned by `@ptah-extension/auth-providers` as
 * AUTH_PROVIDERS_TOKENS. They are MIRRORED here (byte-identical Symbol.for
 * descriptions) so agent-sdk consumers can @inject() them without a runtime
 * dependency on auth-providers. tsyringe resolves them to the same
 * registration because Symbol.for() interns globally.
 *
 * Token files:
 * - vscode-core/src/di/tokens.ts    — core infrastructure tokens (TOKENS)
 * - agent-sdk/src/lib/di/tokens.ts  (this file) — SDK + mirrored auth tokens
 * - auth-providers/src/lib/di/tokens.ts — canonical AUTH_PROVIDERS_TOKENS
 * - agent-generation/src/lib/di/tokens.ts — agent generation tokens
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
  SDK_SESSION_LIFECYCLE_MANAGER: Symbol.for('SdkSessionLifecycleManager'),
  SDK_CONFIG_WATCHER: Symbol.for('SdkConfigWatcher'),
  SDK_STREAM_TRANSFORMER: Symbol.for('SdkStreamTransformer'),
  SDK_CLI_DETECTOR: Symbol.for('SdkCliDetector'),
  SDK_ATTACHMENT_PROCESSOR: Symbol.for('SdkAttachmentProcessor'),

  // Subagent hook handler
  SDK_SUBAGENT_HOOK_HANDLER: Symbol.for('SdkSubagentHookHandler'),

  // Compaction configuration provider
  SDK_COMPACTION_CONFIG_PROVIDER: Symbol.for('SdkCompactionConfigProvider'),

  // Compaction hook handler
  SDK_COMPACTION_HOOK_HANDLER: Symbol.for('SdkCompactionHookHandler'),

  SDK_COMPACTION_CALLBACK_REGISTRY: Symbol.for('SdkCompactionCallbackRegistry'),

  SDK_SESSION_END_CALLBACK_REGISTRY: Symbol.for(
    'SdkSessionEndCallbackRegistry',
  ),

  // Worktree hook handler
  SDK_WORKTREE_HOOK_HANDLER: Symbol.for('SdkWorktreeHookHandler'),

  // Extracted services
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

  SDK_SUBAGENT_MESSAGE_DISPATCHER: Symbol.for('SubagentMessageDispatcher'),

  SDK_WARM_QUERY_MANAGER: Symbol.for('SdkWarmQueryManager'),
  SDK_SESSION_FORK_SERVICE: Symbol.for('SdkSessionForkService'),
  SDK_RUNTIME_STATE: Symbol.for('SdkRuntimeState'),

  // Mirrored auth + provider tokens — byte-identical Symbol.for descriptions
  // with AUTH_PROVIDERS_TOKENS so agent-sdk consumers can @inject() them
  // without a runtime dependency on @ptah-extension/auth-providers.
  SDK_AUTH_MANAGER: Symbol.for('SdkAuthManager'),
  SDK_AUTH_ENV: Symbol.for('SdkAuthEnv'),
  SDK_PROVIDER_MODELS: Symbol.for('SdkProviderModels'),
  SDK_MODEL_RESOLVER: Symbol.for('SdkModelResolver'),
  SDK_API_KEY_STRATEGY: Symbol.for('SdkApiKeyStrategy'),
  SDK_OAUTH_PROXY_STRATEGY: Symbol.for('SdkOAuthProxyStrategy'),
  SDK_LOCAL_NATIVE_STRATEGY: Symbol.for('SdkLocalNativeStrategy'),
  SDK_LOCAL_PROXY_STRATEGY: Symbol.for('SdkLocalProxyStrategy'),
  SDK_CLI_STRATEGY: Symbol.for('SdkCliStrategy'),
  SDK_COPILOT_AUTH: Symbol.for('SdkCopilotAuth'),
  SDK_COPILOT_PROXY: Symbol.for('SdkCopilotProxy'),
  SDK_CODEX_AUTH: Symbol.for('SdkCodexAuth'),
  SDK_CODEX_PROXY: Symbol.for('SdkCodexProxy'),
  SDK_OPENROUTER_AUTH: Symbol.for('SdkOpenRouterAuth'),
  SDK_OPENROUTER_PROXY: Symbol.for('SdkOpenRouterProxy'),
  SDK_OLLAMA_DISCOVERY: Symbol.for('SdkOllamaDiscovery'),
  SDK_LM_STUDIO_PROXY: Symbol.for('SdkLmStudioProxy'),
  SDK_OLLAMA_CLOUD_METADATA: Symbol.for('SdkOllamaCloudMetadata'),
} as const;

/**
 * Type helper for SDK token keys
 */
export type SdkDIToken = keyof typeof SDK_TOKENS;
