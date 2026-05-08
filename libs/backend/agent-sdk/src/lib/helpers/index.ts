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
  CompactionConfigProvider,
  type CompactionConfig,
} from './compaction-config-provider';
export {
  CompactionHookHandler,
  type CompactionStartCallback,
  isPreCompactHook,
} from './compaction-hook-handler';
// Compaction callback registry (TASK_2026_HERMES Track 1)
export { CompactionCallbackRegistry } from './compaction-callback-registry';
// Session end callback registry (TASK_2026_THOTH_SKILL_LIFECYCLE)
export {
  SessionEndCallbackRegistry,
  type SessionEndCallback,
  type SessionEndPayload,
} from './session-end-callback-registry';
// Live usage tracker (TASK_2026_109 cycle-break)
export { LiveUsageTracker } from './live-usage-tracker';
// Worktree hook handler (TASK_2025_236)
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
// Memory prompt injector (TASK_2026_THOTH_MEMORY_READ)
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
// Slash command interceptor (TASK_2025_184)
export {
  SlashCommandInterceptor,
  type SlashCommandResult,
} from './slash-command-interceptor';
// History module (TASK_2025_106)
export * from './history';

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

// Skill junction management (TASK_2025_201)
export {
  SkillJunctionService,
  type SkillJunctionActivateOptions,
  type SkillJunctionResult,
} from './skill-junction.service';

// MCP Server Directory (discovery + installation)
export * from './mcp-directory';
