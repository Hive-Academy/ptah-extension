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
export { SdkAgentAdapter } from './lib/sdk-agent-adapter';
export type {
  SessionIdResolvedCallback,
  ResultStatsCallback,
} from './lib/sdk-agent-adapter';
export { InternalQueryService } from './lib/internal-query';
export type {
  InternalQueryConfig,
  InternalQueryHandle,
} from './lib/internal-query';
export { SdkMessageTransformer } from './lib/sdk-message-transformer';
export {
  SessionMetadataStore,
  flushSessionMetadataStores,
} from './lib/session-metadata-store';
export type {
  SessionMetadata,
  PersistedAgentOutput,
} from './lib/session-metadata-store';
export { SessionImporterService } from './lib/session-importer.service';
export {
  SessionHistoryReaderService,
  MESSAGE_ID_NOT_FOUND_PHRASE,
} from './lib/session-history-reader.service';

export { SdkTranscriptReaderAdapter } from './lib/sdk-transcript-reader.adapter';
export { JsonlReaderService } from './lib/helpers/history/jsonl-reader.service';
export type {
  JsonlReadOptions,
  JsonlTailOptions,
} from './lib/helpers/history/jsonl-reader.service';
export * from './lib/types/sdk-types/claude-sdk.types';
export { SdkPermissionHandler } from './lib/sdk-permission-handler';
export type {
  PermissionPromptLifecycleEvent,
  PermissionPromptLifecycleListener,
} from './lib/sdk-permission-handler';
export type { IAuthEnvProvider } from './lib/auth-env.port';
export type { IProviderAuthResolver } from './lib/auth/provider-auth-resolver.port';
export type { OneShotAuthOverride } from './lib/helpers';
export type { IPricingProvider } from './lib/pricing.port';
export {
  SdkError,
  SessionNotActiveError,
  ModelNotAvailableError,
  AuthRequiredError,
  InternalQueryQueueTimeoutError,
} from './lib/errors';
export {
  registerSdkServices,
  wireAgentAdapterAliases,
} from './lib/di/register';
export { SDK_TOKENS } from './lib/di/tokens';
export type { SdkDIToken } from './lib/di/tokens';
export {
  SubagentMessageDispatcher,
  SUBAGENT_DISPATCHER_TOKEN,
} from './lib/helpers';
export { CompactionCallbackRegistry } from './lib/helpers';
export { SessionLifecycleManager } from './lib/helpers';
export {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './lib/helpers';
export {
  SessionEndCallbackRegistry,
  type SessionEndCallback,
  type SessionEndPayload,
  SessionActivityRegistry,
  type SessionActivityCallback,
  type SessionActivityPayload,
  SubagentStopCallbackRegistry,
  type SubagentStopCallback,
  type SubagentStopPayload,
  PostToolUseCallbackRegistry,
  type PostToolUseCallback,
  type PostToolUsePayload,
  PostToolUseHookHandler,
  SessionIdResolvedCallbackRegistry,
  type SessionIdResolvedPayload,
  type SessionIdResolvedRegistryCallback,
  SessionStartCallbackRegistry,
  type SessionStartCallback,
  type SessionStartPayload,
  type SessionStartSource,
  SessionStartHookHandler,
  UserPromptSubmitCallbackRegistry,
  type UserPromptSubmitCallback,
  type UserPromptSubmitPayload,
  UserPromptSubmitHookHandler,
  UserPromptExpansionCallbackRegistry,
  type UserPromptExpansionCallback,
  type UserPromptExpansionPayload,
  UserPromptExpansionHookHandler,
  StopCallbackRegistry,
  type StopCallback,
  type StopPayload,
  StopHookHandler,
  StopFailureHookHandler,
  SubagentStopHookHandler,
  isStopFailureHook,
  isSubagentStopHook,
  narrowTerminalReason,
  SessionEndHookCallbackRegistry,
  type SessionEndHookCallback,
  type SessionEndHookPayload,
  SessionEndHookHandler,
  ToolFailureCallbackRegistry,
  type ToolFailureCallback,
  type ToolFailurePayload,
  ToolFailureHookHandler,
  CuratorRateLimitService,
  type RateLimitDecision,
  type RateLimitSnapshot,
} from './lib/helpers';
export {
  CompactionHookHandler,
  type CompactionStartCallback,
  isPostCompactHook,
} from './lib/helpers';
export { CompactionConfigProvider } from './lib/helpers';
export { SdkModuleLoader, SubagentHookHandler } from './lib/helpers';
export {
  SdkAdapterEvents,
  type SdkAdapterInitializedEvent,
  type SdkAdapterDisposedEvent,
  type SdkAdapterConfigChangedEvent,
  type SdkAdapterAuthFileChangedEvent,
  type SdkAdapterCompactionCompleteEvent,
  type SdkAdapterTurnEndedEvent,
  type SdkAdapterTurnFailedEvent,
  type SdkAdapterSubagentEndedEvent,
} from './lib/helpers';
export type { SdkQueryOptions } from './lib/helpers';
export { buildSafeEnv } from './lib/helpers/build-safe-env';
export { redactMcpUrl, redactMcpOverrideMap } from './lib/helpers';
export {
  TIER_ENV_VAR_MAP,
  TIER_METADATA_ENV_VAR_MAP,
  ALL_TIER_ENV_KEYS,
  buildTierEnvDefaults,
  SdkModelService,
  MemoryPromptInjector,
  CodeSymbolPromptInjector,
} from './lib/helpers';
export type { ModelTier, EnvMappedTier } from './lib/helpers';
export {
  ANTHROPIC_PROVIDERS,
  DEFAULT_PROVIDER_ID,
  ANTHROPIC_DIRECT_PROVIDER_ID,
  getAnthropicProvider,
  getAllAnthropicProviders,
  getProviderBaseUrl,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
  setCustomProviderEntries,
  clearCustomProviderEntries,
  getCustomProviderEntries,
  getCustomProviderEntry,
  isCustomProviderId,
  customEntryToAnthropicProvider,
  CustomProviderEntrySchema,
  CustomProviderEntriesSchema,
  CUSTOM_PROVIDER_LANES,
} from '@ptah-extension/shared';
export type {
  AnthropicProvider,
  AnthropicProviderId,
  ProviderStaticModel,
  CustomProviderEntry,
  CustomProviderLane,
  CustomProviderPricing,
  SetCustomProviderEntriesResult,
} from '@ptah-extension/shared';
export { ClaudeCliDetector } from './lib/detector/claude-cli-detector';
export {
  assembleSystemPrompt,
  buildModelIdentityPrompt,
  // The one builder of the output-style FLAG tier. Exported so the CLI-agent
  // spawn path in `cli-agent-runtime` reuses it instead of growing a second
  // definition of `Options.settings`.
  buildFlagSettings,
  getActiveProviderId,
} from './lib/helpers';
export type {
  AssembleSystemPromptInput,
  SystemPromptAssemblyResult,
} from './lib/helpers';
export {
  PTAH_CORE_SYSTEM_PROMPT,
  PTAH_CORE_SYSTEM_PROMPT_TOKENS,
} from './lib/prompt-harness';
export { PluginLoaderService } from './lib/helpers';
export {
  discoverPluginSkills,
  formatSkillsForPrompt,
  type PluginSkillInfo,
} from './lib/helpers';
export { SlashCommandInterceptor } from './lib/helpers';
export type { SlashCommandResult, SlashCommandConfig } from './lib/helpers';
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
export { SdkStreamProcessor } from './lib/stream-processing';
export type {
  SdkStreamProcessorConfig,
  StreamEventEmitter,
  StreamEvent,
  PhaseTracker,
  StreamProcessorResult,
} from './lib/stream-processing';
export { PTAH_MCP_PORT, setPtahMcpPort } from './lib/constants';
export {
  HARNESS_PREFLIGHT_TOKEN,
  type HarnessPreflightRequest,
  type IHarnessPreflight,
} from './lib/harness/harness-preflight.port';
export {
  wireSessionMetadataEvents,
  type WireSessionMetadataEventsContext,
  type SessionMetadataEventPlatform,
} from './lib/wiring/session-metadata-events';
export const AGENT_SDK_VERSION = '0.0.1';
