/**
 * DI tokens for agent-sdk services
 * TASK_2025_044 Batch 3: Dependency injection symbols
 */

/**
 * Agent SDK DI Tokens
 * Use string tokens to avoid Symbol conflicts with main DI container
 */
export const SDK_TOKENS = {
  SDK_AGENT_ADAPTER: 'SdkAgentAdapter',
  SDK_SESSION_STORAGE: 'SdkSessionStorage',
  SDK_PERMISSION_HANDLER: 'SdkPermissionHandler',
} as const;

/**
 * Type helper for SDK token keys
 */
export type SdkDIToken = keyof typeof SDK_TOKENS;
