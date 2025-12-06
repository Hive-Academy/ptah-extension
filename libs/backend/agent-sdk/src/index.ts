/**
 * Agent SDK Integration Library
 *
 * Official Claude Agent SDK wrapper providing IAIProvider implementation
 * with 10x performance improvements over CLI-based integration.
 */

// Core adapter exports
export { SdkAgentAdapter } from './lib/sdk-agent-adapter';

// Message transformation exports
export { SdkMessageTransformer } from './lib/sdk-message-transformer';

// Session storage exports
export { SdkSessionStorage } from './lib/sdk-session-storage';
export type {
  StoredSession,
  StoredSessionMessage,
} from './lib/types/sdk-session.types';

// Permission handler exports
export { SdkPermissionHandler } from './lib/sdk-permission-handler';

// Custom tools exports (TASK_2025_044 Batch 3)
export { createPtahTools } from './lib/ptah-tools-server';
export { executePtahHelpTool, ptahHelpToolDefinition } from './lib/tools/ptah-help-tool';
export {
  executePtahExecuteCodeTool,
  ptahExecuteCodeToolDefinition,
} from './lib/tools/ptah-execute-code-tool';

// DI registration exports (TASK_2025_044 Batch 3)
export { registerSdkServices } from './lib/di/register';
export { SDK_TOKENS } from './lib/di/tokens';
export type { SdkDIToken } from './lib/di/tokens';

// Library version
export const AGENT_SDK_VERSION = '0.0.1';
