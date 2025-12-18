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
  SDK_PERMISSION_HANDLER: 'SdkPermissionHandler',
  SDK_MESSAGE_TRANSFORMER: 'SdkMessageTransformer',

  // Helper services
  SDK_AUTH_MANAGER: 'SdkAuthManager',
  SDK_SESSION_LIFECYCLE_MANAGER: 'SdkSessionLifecycleManager',
  SDK_CONFIG_WATCHER: 'SdkConfigWatcher',
  SDK_QUERY_BUILDER: 'SdkQueryBuilder',
  SDK_USER_MESSAGE_STREAM_FACTORY: 'SdkUserMessageStreamFactory',
  SDK_STREAM_TRANSFORMER: 'SdkStreamTransformer',
  SDK_CLI_DETECTOR: 'SdkCliDetector',
  SDK_ATTACHMENT_PROCESSOR: Symbol('SdkAttachmentProcessor'),
} as const;

/**
 * Type helper for SDK token keys
 */
export type SdkDIToken = keyof typeof SDK_TOKENS;
