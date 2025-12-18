/**
 * Agent SDK Integration Library
 *
 * Official Claude Agent SDK wrapper providing IAIProvider implementation
 * with 10x performance improvements over CLI-based integration.
 *
 * Session Architecture (TASK_2025_088):
 * - SDK handles message persistence natively to ~/.claude/projects/{sessionId}.jsonl
 * - SessionMetadataStore only tracks UI metadata (names, timestamps, cost)
 * - Single sessionId used everywhere (SDK's UUID from system 'init' message)
 */

// Core adapter exports
export { SdkAgentAdapter } from './lib/sdk-agent-adapter';
export type {
  SessionIdResolvedCallback,
  ResultStatsCallback,
} from './lib/sdk-agent-adapter';

// Message transformation exports
export { SdkMessageTransformer } from './lib/sdk-message-transformer';

// Session metadata exports (lightweight UI metadata only)
export { SessionMetadataStore } from './lib/session-metadata-store';
export type { SessionMetadata } from './lib/session-metadata-store';

// Permission handler exports
export { SdkPermissionHandler } from './lib/sdk-permission-handler';

// DI registration exports
export { registerSdkServices } from './lib/di/register';
export { SDK_TOKENS } from './lib/di/tokens';
export type { SdkDIToken } from './lib/di/tokens';

// Library version
export const AGENT_SDK_VERSION = '0.0.1';
