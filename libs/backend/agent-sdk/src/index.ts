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

// Session importer (imports existing Claude Code sessions)
export { SessionImporterService } from './lib/session-importer.service';

// Session history reader (reads JSONL files for session replay)
export { SessionHistoryReaderService } from './lib/session-history-reader.service';

// SDK type exports (centralized SDK types)
export * from './lib/types/sdk-types/claude-sdk.types';

// Permission handler exports
export { SdkPermissionHandler } from './lib/sdk-permission-handler';

// Provider models service (TASK_2025_091 Phase 2, generalized TASK_2025_132)
export { ProviderModelsService } from './lib/provider-models.service';

// @deprecated Use ProviderModelsService instead
export { ProviderModelsService as OpenRouterModelsService } from './lib/provider-models.service';

// DI registration exports
export { registerSdkServices } from './lib/di/register';
export { SDK_TOKENS } from './lib/di/tokens';
export type { SdkDIToken } from './lib/di/tokens';

// Anthropic-compatible provider registry (TASK_2025_129 Batch 3)
// Re-exported via helpers barrel (canonical source: helpers/anthropic-provider-registry.ts)
export {
  ANTHROPIC_PROVIDERS,
  DEFAULT_PROVIDER_ID,
  getAnthropicProvider,
  getProviderBaseUrl,
} from './lib/helpers';
export type {
  AnthropicProvider,
  AnthropicProviderId,
  ProviderStaticModel,
} from './lib/helpers';

// Prompt Harness System (TASK_2025_135)
// Layered prompt assembly with user-configurable power-ups
export {
  POWER_UP_DEFINITIONS,
  getPowerUp,
  getPowerUpsByCategory,
  getFreePowerUps,
  getPremiumPowerUps,
  getPowerUpCategories,
  calculateTotalTokens,
  UserPromptStore,
  PromptHarnessService,
} from './lib/prompt-harness';
export type {
  PowerUpCategory,
  PromptLayerType,
  PromptWarningType,
  PromptWarningSeverity,
  PowerUpDefinition,
  PowerUpState,
  UserPromptSection,
  PromptHarnessConfig,
  PromptLayer,
  PromptWarning,
  AssembledPrompt,
} from './lib/prompt-harness';

// Library version
export const AGENT_SDK_VERSION = '0.0.1';
