/**
 * Agent SDK Integration Library
 *
 * Official Claude Agent SDK wrapper providing IAIProvider implementation
 * with 10x performance improvements over CLI-based integration.
 *
 * Session Architecture:
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

// Internal Query Service
// One-shot SDK query execution, separate from interactive chat path
export { InternalQueryService } from './lib/internal-query';
export type {
  InternalQueryConfig,
  InternalQueryHandle,
} from './lib/internal-query';

// Message transformation exports
export { SdkMessageTransformer } from './lib/sdk-message-transformer';

// Session metadata exports (lightweight UI metadata only)
export { SessionMetadataStore } from './lib/session-metadata-store';
export type { SessionMetadata } from './lib/session-metadata-store';

// Session importer (imports existing Claude sessions)
export { SessionImporterService } from './lib/session-importer.service';

// Session history reader (reads JSONL files for session replay)
export {
  SessionHistoryReaderService,
  MESSAGE_ID_NOT_FOUND_PHRASE,
} from './lib/session-history-reader.service';

export { SdkTranscriptReaderAdapter } from './lib/sdk-transcript-reader.adapter';
// Re-exposed for skill-synthesis which injects JsonlReaderService
// directly to read raw JSONL turns for trajectory extraction.
export { JsonlReaderService } from './lib/helpers/history/jsonl-reader.service';

// SDK type exports (centralized SDK types)
export * from './lib/types/sdk-types/claude-sdk.types';

// Permission handler exports
export { SdkPermissionHandler } from './lib/sdk-permission-handler';

// Auth env port — agent-sdk reads AuthEnv on demand via this interface,
// implemented by AuthManager in @ptah-extension/auth-providers.
export type { IAuthEnvProvider } from './lib/auth-env.port';

// Errors
export {
  SdkError,
  SessionNotActiveError,
  ModelNotAvailableError,
} from './lib/errors';

// DI registration exports
export {
  registerSdkServices,
  wireAgentAdapterAliases,
} from './lib/di/register';
export { SDK_TOKENS } from './lib/di/tokens';
export type { SdkDIToken } from './lib/di/tokens';

// Subagent bidirectional messaging dispatcher
export {
  SubagentMessageDispatcher,
  SUBAGENT_DISPATCHER_TOKEN,
} from './lib/helpers';

// Compaction callback registry.
// Allows additional subscribers (e.g. memory curator) to receive PreCompact events.
export { CompactionCallbackRegistry } from './lib/helpers';
export {
  CompactionHookHandler,
  type CompactionStartCallback,
} from './lib/helpers';
export { CompactionConfigProvider } from './lib/helpers';

// SDK module + query option helpers re-exported for cli-agent-runtime consumers
export { SdkModuleLoader, SubagentHookHandler } from './lib/helpers';
export type { SdkQueryOptions } from './lib/helpers';

// Safe environment builder used when spawning Ptah CLI processes
export { buildSafeEnv } from './lib/helpers/build-safe-env';

// Model ID constants and tier resolution (single source of truth)
export {
  TIER_TO_MODEL_ID,
  TIER_ENV_VAR_MAP,
  DEFAULT_FALLBACK_MODEL_ID,
  buildTierEnvDefaults,
} from './lib/helpers';
export type { ModelTier, EnvMappedTier } from './lib/helpers';

// Anthropic-compatible provider registry
// Canonical source moved to @ptah-extension/shared in TASK_2026_123 Win 5
// Batch 16 to break the agent-sdk ↔ auth-providers cycle. Re-exported here
// for backward-compatibility with existing consumers.
export {
  ANTHROPIC_PROVIDERS,
  DEFAULT_PROVIDER_ID,
  ANTHROPIC_DIRECT_PROVIDER_ID,
  getAnthropicProvider,
  getProviderBaseUrl,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
} from '@ptah-extension/shared';
export type {
  AnthropicProvider,
  AnthropicProviderId,
  ProviderStaticModel,
} from '@ptah-extension/shared';

// CLI detector (Claude CLI availability check)
export { ClaudeCliDetector } from './lib/detector/claude-cli-detector';

// Shared prompt-building functions (used by SdkQueryOptionsBuilder and PtahCliAdapter)
export {
  assembleSystemPrompt,
  buildModelIdentityPrompt,
  getActiveProviderId,
} from './lib/helpers';
export type {
  AssembleSystemPromptInput,
  SystemPromptAssemblyResult,
} from './lib/helpers';

// ============================================================
// Ptah Core System Prompt
// PTAH_CORE_SYSTEM_PROMPT stays in agent-sdk (used by InternalQueryService).
// PromptDesigner / PromptCache / EnhancedPrompts live in
// `@ptah-extension/agent-generation`.
// ============================================================
export {
  PTAH_CORE_SYSTEM_PROMPT,
  PTAH_CORE_SYSTEM_PROMPT_TOKENS,
} from './lib/prompt-harness';

// ============================================================
// Plugin Loader Service
// ============================================================
export { PluginLoaderService } from './lib/helpers';
export {
  discoverPluginSkills,
  formatSkillsForPrompt,
  type PluginSkillInfo,
} from './lib/helpers';

// ============================================================
// Skill Junction Service
// Manages workspace .ptah/skills/ junctions for third-party providers
// ============================================================
export {
  SkillJunctionService,
  type SkillJunctionActivateOptions,
  type SkillJunctionResult,
} from './lib/helpers';

// ============================================================
// Slash Command Interceptor
// Detects and classifies follow-up slash commands
// ============================================================
export { SlashCommandInterceptor } from './lib/helpers';
export type { SlashCommandResult, SlashCommandConfig } from './lib/helpers';

// ============================================================
// Settings Export/Import
// Cross-platform settings portability
// ============================================================
export { SettingsExportService } from './lib/settings-export.service';
export { SettingsImportService } from './lib/settings-import.service';
export type { SettingsImportOptions } from './lib/settings-import.service';
export {
  SETTINGS_EXPORT_VERSION,
  KNOWN_PROVIDER_IDS,
  KNOWN_CONFIG_KEYS,
  SECRET_KEYS,
  providerSecretKey,
  countPopulatedSecrets,
} from './lib/types/settings-export.types';
export type {
  PtahSettingsExport,
  SettingsImportResult,
  KnownProviderId,
  KnownConfigKey,
} from './lib/types/settings-export.types';

// ============================================================
// Stream Processing (shared SDK stream processor)
// ============================================================
export { SdkStreamProcessor } from './lib/stream-processing';
export type {
  SdkStreamProcessorConfig,
  StreamEventEmitter,
  StreamEvent,
  PhaseTracker,
  StreamProcessorResult,
} from './lib/stream-processing';

// ============================================================
// MCP Port Management
// ============================================================
export { PTAH_MCP_PORT, setPtahMcpPort } from './lib/constants';

// ============================================================
// RPC Wiring helpers
// Session metadata event broadcasting (sdk-callbacks + agent-events
// moved to @ptah-extension/cli-agent-runtime).
// ============================================================
export {
  wireSessionMetadataEvents,
  type WireSessionMetadataEventsContext,
  type SessionMetadataEventPlatform,
} from './lib/wiring/session-metadata-events';

// Library version
export const AGENT_SDK_VERSION = '0.0.1';
