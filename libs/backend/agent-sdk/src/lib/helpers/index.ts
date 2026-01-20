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
  type StreamTransformConfig,
} from './stream-transformer';
export * from './attachment-processor.service';
export { SubagentHookHandler } from './subagent-hook-handler';
export {
  CompactionConfigProvider,
  type CompactionConfig,
} from './compaction-config-provider';
export {
  SdkMessageFactory,
  type CreateMessageParams,
} from './sdk-message-factory';
export {
  SdkQueryOptionsBuilder,
  type QueryOptionsInput,
  type SdkQueryOptions,
  type QueryConfig,
} from './sdk-query-options-builder';
export { SdkModuleLoader } from './sdk-module-loader';
export { SdkModelService } from './sdk-model-service';
export { UserMessageStreamFactory } from './user-message-stream-factory';

// History module (TASK_2025_106)
export * from './history';
