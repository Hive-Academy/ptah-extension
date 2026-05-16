/**
 * Helper Services - Extracted from SdkAgentAdapter for better maintainability
 *
 * These services encapsulate specific responsibilities:
 * - AuthManager: Authentication configuration and validation
 * - SessionLifecycleManager: Session creation, tracking, cleanup, and query orchestration
 * - ConfigWatcher: Config change detection and re-initialization
 * - StreamTransformer: SDK message to ExecutionNode transformation
 *
 */

export { AuthManager, type AuthResult, type AuthConfig } from './auth-manager';
export {
  SessionLifecycleManager,
  type SDKUserMessage,
  type Query,
  type ContentBlock,
  type ExecuteQueryConfig,
  type ExecuteQueryResult,
  type SlashCommandConfig,
} from './session-lifecycle-manager';
export { ConfigWatcher, type ReinitCallback } from './config-watcher';
export {
  StreamTransformer,
  type SessionIdResolvedCallback,
  type ResultStatsCallback,
  type ResultModelUsage,
  type StreamTransformConfig,
} from './stream-transformer';
export * from './attachment-processor.service';
export { SubagentHookHandler } from './subagent-hook-handler';
export {
  SubagentMessageDispatcher,
  SUBAGENT_DISPATCHER_TOKEN,
} from './subagent-message-dispatcher';
export {
  CompactionConfigProvider,
  type CompactionConfig,
} from './compaction-config-provider';
export {
  CompactionHookHandler,
  type CompactionStartCallback,
  isPreCompactHook,
} from './compaction-hook-handler';
// Compaction callback registry
export { CompactionCallbackRegistry } from './compaction-callback-registry';
// Session end callback registry
export {
  SessionEndCallbackRegistry,
  type SessionEndCallback,
  type SessionEndPayload,
} from './session-end-callback-registry';
// Live usage tracker
export { LiveUsageTracker } from './live-usage-tracker';
// Worktree hook handler
export {
  WorktreeHookHandler,
  type WorktreeCreatedCallback,
  type WorktreeRemovedCallback,
} from './worktree-hook-handler';
export {
  SdkMessageFactory,
  type CreateMessageParams,
} from './sdk-message-factory';
export {
  SdkQueryOptionsBuilder,
  assembleSystemPrompt,
  buildModelIdentityPrompt,
  getActiveProviderId,
  type AssembleSystemPromptInput,
  type SystemPromptAssemblyResult,
  type QueryOptionsInput,
  type SdkQueryOptions,
  type QueryConfig,
} from './sdk-query-options-builder';
export { SdkModuleLoader } from './sdk-module-loader';
// Memory prompt injector
export { MemoryPromptInjector } from './memory-prompt-injector';
// Curator LLM adapter (moved from memory-curator to break circular dependency)
export { SdkInternalQueryCuratorLlm } from '../curator-llm-adapter';
export {
  SdkModelService,
  TIER_TO_MODEL_ID,
  TIER_ENV_VAR_MAP,
  DEFAULT_FALLBACK_MODEL_ID,
  buildTierEnvDefaults,
  type ModelTier,
  type EnvMappedTier,
} from './sdk-model-service';
// Slash command interceptor
export {
  SlashCommandInterceptor,
  type SlashCommandResult,
} from './slash-command-interceptor';
// History module
export * from './history';

// Plugin loader
export { PluginLoaderService } from './plugin-loader.service';

// Plugin skill discovery
export {
  discoverPluginSkills,
  formatSkillsForPrompt,
  type PluginSkillInfo,
} from './plugin-skill-discovery';

// Skill junction management
export {
  SkillJunctionService,
  type SkillJunctionActivateOptions,
  type SkillJunctionResult,
} from './skill-junction.service';

// MCP Server Directory (discovery + installation)
export * from './mcp-directory';
