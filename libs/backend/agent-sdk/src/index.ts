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

// Internal Query Service (TASK_2025_145)
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
export { SessionHistoryReaderService } from './lib/session-history-reader.service';

// SDK type exports (centralized SDK types)
export * from './lib/types/sdk-types/claude-sdk.types';

// Permission handler exports
export { SdkPermissionHandler } from './lib/sdk-permission-handler';

// Provider models service (TASK_2025_091 Phase 2, generalized TASK_2025_132)
export {
  ProviderModelsService,
  type DynamicModelFetcher,
} from './lib/provider-models.service';

// @deprecated Use ProviderModelsService instead
export { ProviderModelsService as OpenRouterModelsService } from './lib/provider-models.service';

// DI registration exports
export { registerSdkServices } from './lib/di/register';
export { SDK_TOKENS } from './lib/di/tokens';
export type { SdkDIToken } from './lib/di/tokens';

// Model ID constants (single source of truth for tier → model ID mapping)
export { TIER_TO_MODEL_ID, DEFAULT_FALLBACK_MODEL_ID } from './lib/helpers';

// Anthropic-compatible provider registry (TASK_2025_129 Batch 3)
// Re-exported via helpers barrel (canonical source: helpers/anthropic-provider-registry.ts)
export {
  ANTHROPIC_PROVIDERS,
  DEFAULT_PROVIDER_ID,
  ANTHROPIC_DIRECT_PROVIDER_ID,
  getAnthropicProvider,
  getProviderBaseUrl,
} from './lib/helpers';
export type {
  AnthropicProvider,
  AnthropicProviderId,
  ProviderStaticModel,
} from './lib/helpers';

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
// Enhanced Prompts System (TASK_2025_137)
// AI-powered, project-specific prompt generation
// ============================================================

// Core prompt (Batch 1)
export {
  PTAH_CORE_SYSTEM_PROMPT,
  PTAH_CORE_SYSTEM_PROMPT_TOKENS,
} from './lib/prompt-harness';

// Prompt Designer Agent (Batch 2)
// Intelligent prompt generation based on workspace analysis
export {
  PromptDesignerAgent,
  PROMPT_DESIGNER_SYSTEM_PROMPT,
  buildGenerationUserPrompt,
  buildFallbackGuidance,
  parseStructuredResponse,
  parseTextResponse,
  validateOutput,
  formatAsPromptSection,
  truncateToTokenBudget,
  PromptDesignerResponseSchema,
  DEFAULT_PROMPT_DESIGNER_CONFIG,
} from './lib/prompt-harness';
export type {
  PromptDesignerInput,
  PromptDesignerOutput,
  PromptDesignerConfig,
  PromptDesignerResponse,
  PromptGenerationProgress,
  PromptGenerationStatus,
  CachedPromptDesign,
} from './lib/prompt-harness';

// Prompt Cache Service (Batch 3)
// Smart caching with file-based invalidation
export {
  PromptCacheService,
  DEFAULT_CACHE_CONFIG,
  // Invalidation utilities
  INVALIDATION_TRIGGER_FILES,
  INVALIDATION_IGNORE_PATTERNS,
  CACHE_CONFIG_VERSION,
  DEFAULT_CACHE_TTL_MS,
  computeHash,
  generateCacheKey,
  extractDependencyInfo,
  isInvalidationTrigger,
  getInvalidationReason,
  isCacheExpired,
  createInvalidationEvent,
} from './lib/prompt-harness';
export type {
  PromptCacheConfig,
  InvalidationReason,
  InvalidationEvent,
  CacheKeyComponents,
} from './lib/prompt-harness';

// Enhanced Prompts Service (Batch 4)
// Orchestrates the Enhanced Prompts feature
export {
  EnhancedPromptsService,
  DEFAULT_ENHANCED_PROMPTS_CONFIG,
  createInitialEnhancedPromptsState,
} from './lib/prompt-harness';
export type {
  EnhancedPromptsState,
  EnhancedPromptsStatus,
  EnhancedPromptsConfig,
  EnhancedPromptsWizardResult,
  EnhancedPromptsSummary,
  EnhancedPromptsSdkConfig,
  DetectedStack,
  RegeneratePromptsRequest,
  RegeneratePromptsResponse,
  IMultiPhaseAnalysisReader,
} from './lib/prompt-harness';

// ============================================================
// Plugin Loader Service (TASK_2025_153)
// ============================================================
export { PluginLoaderService } from './lib/helpers';
export {
  discoverPluginSkills,
  formatSkillsForPrompt,
  type PluginSkillInfo,
} from './lib/helpers';

// ============================================================
// Skill Junction Service (TASK_2025_201)
// Manages workspace .ptah/skills/ junctions for third-party providers
// ============================================================
export { SkillJunctionService, type SkillJunctionResult } from './lib/helpers';

// ============================================================
// Ptah CLI (TASK_2025_167)
// User-configured adapters for Anthropic-compatible providers
// ============================================================
export { PtahCliAdapter, PtahCliRegistry } from './lib/ptah-cli';
export type { PtahCliPremiumConfig } from './lib/ptah-cli';

// ============================================================
// Copilot Provider (TASK_2025_186)
// GitHub Copilot integration via OAuth + translation proxy
// ============================================================
export {
  CopilotAuthService,
  VscodeCopilotAuthService,
  CopilotTranslationProxy,
  COPILOT_PROVIDER_ENTRY,
  COPILOT_DEFAULT_TIERS,
  readCopilotToken,
  getCopilotHostsPath,
  getCopilotAppsPath,
  writeCopilotToken,
} from './lib/copilot-provider';
export type {
  ICopilotAuthService,
  ICopilotTranslationProxy,
  CopilotAuthState,
  CopilotHostsFile,
} from './lib/copilot-provider';

// ============================================================
// Codex Provider (TASK_2025_193)
// OpenAI Codex integration via file-based OAuth + translation proxy
// ============================================================
export {
  CodexAuthService,
  CodexTranslationProxy,
  CODEX_PROVIDER_ENTRY,
  CODEX_DEFAULT_TIERS,
} from './lib/codex-provider';
export type { ICodexAuthService, CodexAuthFile } from './lib/codex-provider';

// ============================================================
// Local Model Providers (TASK_2025_265)
// Ollama and LM Studio integration via translation proxy
// ============================================================
export {
  OllamaTranslationProxy,
  LmStudioTranslationProxy,
  OLLAMA_PROVIDER_ENTRY,
  LM_STUDIO_PROVIDER_ENTRY,
  LOCAL_PROXY_TOKEN_PLACEHOLDER,
  isLocalProviderId,
} from './lib/local-provider';

// ============================================================
// OpenAI Translation Module (TASK_2025_193)
// Shared Anthropic <-> OpenAI translation infrastructure
// ============================================================
export {
  OpenAIResponseTranslator,
  TranslationProxyBase,
  translateAnthropicToOpenAI,
} from './lib/openai-translation';
export type {
  ITranslationProxy,
  TranslationProxyConfig,
} from './lib/openai-translation';

// ============================================================
// Slash Command Interceptor (TASK_2025_184)
// Detects and classifies follow-up slash commands
// ============================================================
export { SlashCommandInterceptor } from './lib/helpers';
export type { SlashCommandResult, SlashCommandConfig } from './lib/helpers';

// ============================================================
// Settings Export/Import (TASK_2025_210)
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
export { setPtahMcpPort } from './lib/constants';

// Library version
export const AGENT_SDK_VERSION = '0.0.1';
