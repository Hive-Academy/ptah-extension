/**
 * Helper Services - Extracted from SdkAgentAdapter for better maintainability
 *
 * These services encapsulate specific responsibilities:
 * - AuthManager: Authentication configuration and validation
 * - SessionLifecycleManager: Session creation, tracking, and cleanup
 * - ConfigWatcher: Config change detection and re-initialization
 * - SdkQueryBuilder: SDK query options construction
 * - UserMessageStreamFactory: Async message stream creation
 * - StreamTransformer: SDK message to ExecutionNode transformation
 */

export { AuthManager, type AuthResult, type AuthConfig } from './auth-manager';
export {
  SessionLifecycleManager,
  type ActiveSession,
  type SDKUserMessage,
  type Query,
  type ContentBlock,
} from './session-lifecycle-manager';
export { ConfigWatcher, type ReinitCallback } from './config-watcher';
export {
  SdkQueryBuilder,
  type SdkQueryOptions,
  type QueryBuildConfig,
} from './sdk-query-builder';
export { UserMessageStreamFactory } from './user-message-stream-factory';
export {
  StreamTransformer,
  type SessionIdResolvedCallback,
  type ResultStatsCallback,
  type StreamTransformConfig,
} from './stream-transformer';
export * from './attachment-processor.service';
