/**
 * Provider & LLM RPC Type Definitions
 *
 * Types for provider:listModels, provider:setModelTier, provider:getModelTiers,
 * provider:clearModelTier, deprecated OpenRouter aliases, and all llm:* methods
 */

// ============================================================
// Provider Model RPC Types (TASK_2025_091 Phase 2, generalized TASK_2025_132)
// ============================================================

/** Model tier for provider model mapping */
export type ProviderModelTier = 'sonnet' | 'opus' | 'haiku';

/** Provider model information */
export interface ProviderModelInfo {
  /** Model ID (e.g., "anthropic/claude-3.5-sonnet", "kimi-k2") */
  id: string;
  /** Display name (e.g., "Claude 3.5 Sonnet") */
  name: string;
  /** Model description */
  description: string;
  /** Maximum context length in tokens */
  contextLength: number;
  /** Whether the model supports tool use (required for AI agents) */
  supportsToolUse: boolean;
  /** Cost per input token in USD (from provider API, e.g. OpenRouter) */
  inputCostPerToken?: number;
  /** Cost per output token in USD (from provider API) */
  outputCostPerToken?: number;
  /** Cost per cache read token in USD (from provider API) */
  cacheReadCostPerToken?: number;
  /** Cost per cache creation/write token in USD (from provider API) */
  cacheCreationCostPerToken?: number;
}

/** Parameters for provider:listModels RPC method */
export interface ProviderListModelsParams {
  /** Filter to only show models supporting tool use */
  toolUseOnly?: boolean;
  /** Provider ID to list models for (defaults to active provider) */
  providerId?: string;
}

/** Response from provider:listModels RPC method */
export interface ProviderListModelsResult {
  /** Available models */
  models: ProviderModelInfo[];
  /** Total count before filtering */
  totalCount: number;
  /** Whether the model list is static (no Refresh needed) */
  isStatic?: boolean;
  /** Error message when models couldn't be loaded (e.g., auth failure) */
  error?: string;
}

/** Parameters for provider:setModelTier RPC method */
export interface ProviderSetModelTierParams {
  /** Which tier to set (sonnet, opus, haiku) */
  tier: ProviderModelTier;
  /** Model ID to use for this tier (e.g., "openai/gpt-5.1-codex-max") */
  modelId: string;
  /** Provider ID (defaults to active provider) */
  providerId?: string;
}

/** Response from provider:setModelTier RPC method */
export interface ProviderSetModelTierResult {
  success: boolean;
  error?: string;
}

/** Parameters for provider:getModelTiers RPC method */
export interface ProviderGetModelTiersParams {
  /** Provider ID (defaults to active provider) */
  providerId?: string;
}

/** Response from provider:getModelTiers RPC method */
export interface ProviderGetModelTiersResult {
  /** Model ID mapped to Sonnet tier (null if using default) */
  sonnet: string | null;
  /** Model ID mapped to Opus tier (null if using default) */
  opus: string | null;
  /** Model ID mapped to Haiku tier (null if using default) */
  haiku: string | null;
}

/** Parameters for provider:clearModelTier RPC method */
export interface ProviderClearModelTierParams {
  /** Which tier to clear (reset to default) */
  tier: ProviderModelTier;
  /** Provider ID (defaults to active provider) */
  providerId?: string;
}

/** Response from provider:clearModelTier RPC method */
export interface ProviderClearModelTierResult {
  success: boolean;
  error?: string;
}

// Backward-compatible type aliases (deprecated - use Provider* variants)
/** @deprecated Use ProviderModelTier instead */
export type OpenRouterModelTier = ProviderModelTier;
/** @deprecated Use ProviderModelInfo instead */
export type OpenRouterModelInfo = ProviderModelInfo;
/** @deprecated Use ProviderListModelsParams instead */
export type OpenRouterListModelsParams = ProviderListModelsParams;
/** @deprecated Use ProviderListModelsResult instead */
export type OpenRouterListModelsResult = ProviderListModelsResult;
/** @deprecated Use ProviderSetModelTierParams instead */
export type OpenRouterSetModelTierParams = ProviderSetModelTierParams;
/** @deprecated Use ProviderSetModelTierResult instead */
export type OpenRouterSetModelTierResult = ProviderSetModelTierResult;
/** @deprecated Use ProviderGetModelTiersParams instead */
export type OpenRouterGetModelTiersParams = ProviderGetModelTiersParams;
/** @deprecated Use ProviderGetModelTiersResult instead */
export type OpenRouterGetModelTiersResult = ProviderGetModelTiersResult;
/** @deprecated Use ProviderClearModelTierParams instead */
export type OpenRouterClearModelTierParams = ProviderClearModelTierParams;
/** @deprecated Use ProviderClearModelTierResult instead */
export type OpenRouterClearModelTierResult = ProviderClearModelTierResult;

// ============================================================
// LLM Provider RPC Types (SDK-only migration: vscode-lm only)
// ============================================================

/** LLM Provider names for API key management (TASK_2025_209: platform-agnostic) */
export type LlmProviderName =
  | 'anthropic'
  | 'openrouter'
  | 'moonshot'
  | 'z-ai'
  | 'github-copilot'
  | 'openai-codex'
  | string; // Allow future providers without type updates

/** LLM Provider capability flags */
export type LlmProviderCapability = 'text-chat' | 'structured-output';

/** Response from llm:getProviderStatus RPC method */
export interface LlmProviderStatusResponse {
  providers: Array<{
    provider: LlmProviderName;
    displayName: string;
    isConfigured: boolean;
    defaultModel: string;
    capabilities: LlmProviderCapability[];
  }>;
  defaultProvider: LlmProviderName;
}

/** Parameters for llm:setDefaultProvider RPC method */
export interface SetDefaultProviderRequest {
  provider: LlmProviderName;
}

/** Response from llm:setDefaultProvider RPC method */
export interface SetDefaultProviderResponse {
  success: boolean;
  error?: string;
}

/** Parameters for llm:setApiKey RPC method */
export interface LlmSetApiKeyParams {
  provider: LlmProviderName;
  apiKey: string;
}

/** Response from llm:setApiKey RPC method */
export interface LlmSetApiKeyResponse {
  success: boolean;
  error?: string;
}

/** Parameters for llm:removeApiKey RPC method */
export type LlmRemoveApiKeyParams = LlmProviderName;

/** Response from llm:removeApiKey RPC method */
export type LlmRemoveApiKeyResponse = LlmSetApiKeyResponse;

/** Parameters for llm:getDefaultProvider RPC method */
export type LlmGetDefaultProviderParams = Record<string, never>;

/** Response from llm:getDefaultProvider RPC method */
export type LlmGetDefaultProviderResponse = LlmProviderName;

/** Parameters for llm:validateApiKeyFormat RPC method */
export interface LlmValidateApiKeyFormatParams {
  provider: LlmProviderName;
  apiKey: string;
}

/** Response from llm:validateApiKeyFormat RPC method */
export interface LlmValidateApiKeyFormatResponse {
  isValid: boolean;
  errorMessage?: string;
}

/** Parameters for llm:setDefaultModel RPC method */
export interface LlmSetDefaultModelParams {
  provider: LlmProviderName;
  model: string;
}

/** Response from llm:setDefaultModel RPC method */
export interface LlmSetDefaultModelResponse {
  success: boolean;
  error?: string;
}

/** Parameters for llm:getProviderStatus RPC method */
export type LlmGetProviderStatusParams = Record<string, never>;

/** Parameters for llm:listVsCodeModels RPC method */
export type LlmListVsCodeModelsParams = Record<string, never>;

/** Parameters for llm:listProviderModels RPC method */
export interface LlmListProviderModelsParams {
  provider: LlmProviderName;
}

/** Response from llm:listProviderModels RPC method */
export interface LlmListProviderModelsResponse {
  models: Array<{ id: string; displayName: string }>;
  error?: string;
}
