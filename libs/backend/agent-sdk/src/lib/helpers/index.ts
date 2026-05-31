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
  isPostCompactHook,
} from './compaction-hook-handler';
export { CompactionCallbackRegistry } from './compaction-callback-registry';
export { redactMcpUrl, redactMcpOverrideMap } from './redact-mcp-url';
export {
  SessionEndCallbackRegistry,
  type SessionEndCallback,
  type SessionEndPayload,
} from './session-end-callback-registry';
export {
  SessionActivityRegistry,
  type SessionActivityCallback,
  type SessionActivityPayload,
} from './session-activity-registry';
export {
  SubagentStopCallbackRegistry,
  type SubagentStopCallback,
  type SubagentStopPayload,
} from './subagent-stop-callback-registry';
export {
  PostToolUseCallbackRegistry,
  type PostToolUseCallback,
  type PostToolUsePayload,
} from './post-tool-use-callback-registry';
export { PostToolUseHookHandler } from './post-tool-use-hook-handler';
export {
  PreToolUseCallbackRegistry,
  type PreToolUseCallback,
  type PreToolUsePayload,
} from './pre-tool-use-callback-registry';
export { PreToolUseHookHandler } from './pre-tool-use-hook-handler';
export {
  SessionStartCallbackRegistry,
  type SessionStartCallback,
  type SessionStartPayload,
  type SessionStartSource,
} from './session-start-callback-registry';
export { SessionStartHookHandler } from './session-start-hook-handler';
export {
  UserPromptSubmitCallbackRegistry,
  type UserPromptSubmitCallback,
  type UserPromptSubmitPayload,
} from './user-prompt-submit-callback-registry';
export { UserPromptSubmitHookHandler } from './user-prompt-submit-hook-handler';
export {
  StopCallbackRegistry,
  type StopCallback,
  type StopPayload,
} from './stop-callback-registry';
export { StopHookHandler } from './stop-hook-handler';
export { StopFailureHookHandler } from './stop-failure-hook-handler';
export { SubagentStopHookHandler } from './subagent-stop-hook-handler';
export {
  isStopFailureHook,
  isSubagentStopHook,
  narrowTerminalReason,
} from '../types/sdk-types/claude-sdk.types';
export {
  SessionEndHookCallbackRegistry,
  type SessionEndHookCallback,
  type SessionEndHookPayload,
} from './session-end-hook-callback-registry';
export { SessionEndHookHandler } from './session-end-hook-handler';
export {
  ToolFailureCallbackRegistry,
  type ToolFailureCallback,
  type ToolFailurePayload,
} from './tool-failure-callback-registry';
export { ToolFailureHookHandler } from './tool-failure-hook-handler';
export {
  CuratorRateLimitService,
  type RateLimitDecision,
  type RateLimitSnapshot,
} from './curator-rate-limit.service';
export { LiveUsageTracker } from './live-usage-tracker';
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
export {
  SdkQueryRunner,
  type OneShotRunInput,
  type OneShotRunResult,
  type InteractiveRunInput,
  type InteractiveRunResult,
} from './sdk-query-runner.service';
export { MemoryPromptInjector } from './memory-prompt-injector';
export { SdkInternalQueryCuratorLlm } from '../curator-llm-adapter';
export {
  SdkModelService,
  TIER_ENV_VAR_MAP,
  buildTierEnvDefaults,
  type ModelTier,
  type EnvMappedTier,
} from './sdk-model-service';
export {
  SlashCommandInterceptor,
  type SlashCommandResult,
} from './slash-command-interceptor';
export * from './history';
export { PluginLoaderService } from './plugin-loader.service';
export {
  discoverPluginSkills,
  formatSkillsForPrompt,
  type PluginSkillInfo,
} from './plugin-skill-discovery';
export {
  SkillJunctionService,
  type SkillJunctionActivateOptions,
  type SkillJunctionResult,
} from './skill-junction.service';
export {
  SdkWarmQueryManager,
  type WarmQueryHandle,
  type WarmPrewarmFingerprint,
} from './sdk-warm-query-manager';
export {
  SessionForkService,
  type ForkSessionParams,
  type RewindFilesParams,
} from './session-fork.service';
export { SdkAdapterCallbackRegistry } from './sdk-adapter-callback-registry';
export {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

export type { IPricingProvider } from '../pricing.port';
export { SdkRuntimeStateService } from './sdk-runtime-state.service';
export {
  SdkAdapterEvents,
  type SdkAdapterEventName,
  type SdkAdapterInitializedEvent,
  type SdkAdapterDisposedEvent,
  type SdkAdapterConfigChangedEvent,
  type SdkAdapterAuthFileChangedEvent,
  type SdkAdapterCompactionCompleteEvent,
  type SdkAdapterTurnEndedEvent,
  type SdkAdapterTurnFailedEvent,
  type SdkAdapterSubagentEndedEvent,
} from './sdk-adapter-events.service';
