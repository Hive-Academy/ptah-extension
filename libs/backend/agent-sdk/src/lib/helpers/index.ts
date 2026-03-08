/**
 * Helper Services - Extracted from SdkAgentAdapter for better maintainability
 *
 * These services encapsulate specific responsibilities:
 * - AuthManager: Authentication configuration and validation
 * - SessionLifecycleManager: Session creation, tracking, cleanup, and query orchestration
 * - ConfigWatcher: Config change detection and re-initialization
 * - StreamTransformer: SDK message to ExecutionNode transformation
 *
 * TASK_2025_102: SessionLifecycleManager now includes executeQuery() for query orchestration
 */

export { AuthManager, type AuthResult, type AuthConfig } from './auth-manager';
export {
  SessionLifecycleManager,
  type ActiveSession,
  type SDKUserMessage,
  type Query,
  type ContentBlock,
  type ExecuteQueryConfig,
  type ExecuteQueryResult,
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
  CompactionConfigProvider,
  type CompactionConfig,
} from './compaction-config-provider';
export {
  CompactionHookHandler,
  type CompactionStartCallback,
  isPreCompactHook,
} from './compaction-hook-handler';
export {
  SdkMessageFactory,
  type CreateMessageParams,
} from './sdk-message-factory';
export {
  SdkQueryOptionsBuilder,
  assembleSystemPromptAppend,
  buildModelIdentityPrompt,
  getActiveProviderId,
  type AssembleSystemPromptInput,
  type QueryOptionsInput,
  type SdkQueryOptions,
  type QueryConfig,
} from './sdk-query-options-builder';
export { SdkModuleLoader } from './sdk-module-loader';
export { SdkModelService } from './sdk-model-service';
// History module (TASK_2025_106)
export * from './history';

// Anthropic-compatible provider registry (TASK_2025_129 Batch 3)
export {
  ANTHROPIC_PROVIDERS,
  DEFAULT_PROVIDER_ID,
  getAnthropicProvider,
  getProviderBaseUrl,
  type AnthropicProvider,
  type AnthropicProviderId,
  type ProviderStaticModel,
} from './anthropic-provider-registry';

// Prompt constants (TASK_2025_135)
export { PTAH_BEHAVIORAL_PROMPT } from './prompt-constants';

// Plugin loader (TASK_2025_153)
export { PluginLoaderService } from './plugin-loader.service';

// Plugin skill discovery
export {
  discoverPluginSkills,
  formatSkillsForPrompt,
  type PluginSkillInfo,
} from './plugin-skill-discovery';
