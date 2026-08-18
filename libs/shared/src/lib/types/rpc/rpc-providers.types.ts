/**
 * Provider & LLM RPC Type Definitions
 *
 * Types for provider:listModels, provider:setModelTier, provider:getModelTiers,
 * provider:clearModelTier, deprecated OpenRouter aliases, and all llm:* methods
 */

import type { ModelCapability } from '../auth-env.types';
import type {
  CustomProviderEntry,
  CustomProviderEntryChanges,
  CustomProviderEntryInput,
} from '../../providers/provider-registry';

/** Model tier for provider model mapping */
export type ProviderModelTier = 'sonnet' | 'opus' | 'haiku';

/**
 * Scope for provider tier mappings.
 *
 * - `mainAgent`: The primary agent using Anthropic direct or a third-party
 *   proxy as configured in Settings. Tier writes propagate to global
 *   `process.env` and `AuthEnv` so the SDK picks them up at runtime.
 * - `cliAgent`: A Ptah CLI sub-agent with its own isolated `AuthEnv` built
 *   at spawn time. Tier writes are persisted to config only; they are read
 *   back by `resolveEffectiveTiers()` when the child process starts.
 * - `lane`: A background work lane (skill synthesis, archaeology, judging,
 *   replay). One shared scope serves every lane — per-lane model pinning is
 *   expressed by the lane's own `model` setting, not by a scope per lane.
 *
 * ## `lane` is inert with respect to globals BY CONSTRUCTION
 *
 * `ProviderModelsService.setModelTier` and `clearModelTier` guard their
 * `this.authEnv[...] = …` / `process.env[...] = …` writes with
 * `if (scope === 'mainAgent')`, so a `lane`-scoped tier can only ever reach
 * config. That is the point: a background lane must never repoint the user's
 * live chat session, and this scope makes that a property of the code rather
 * than a rule someone has to remember. Reads through
 * `getModelTiers(id, 'lane')` return all-nulls until something is persisted,
 * which is what lets the caller fall back to the provider entry's
 * `defaultTiers` with no hardcoded model id anywhere.
 *
 * Note that `applyPersistedTiers` has no scope parameter at all and writes
 * globals unconditionally — it reads the `mainAgent` scope by definition and
 * must never be handed lane work.
 */
export type ProviderTierScope = 'mainAgent' | 'cliAgent' | 'lane';

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
  /**
   * Capabilities this model supports, when the provider declares them.
   *
   * Published to the SDK as `ANTHROPIC_DEFAULT_<TIER>_MODEL_SUPPORTED_CAPABILITIES`
   * when the model is mapped to a tier. Leave undefined unless the provider
   * really reports this — the SDK treats the env var as an allowlist, so a
   * partial list turns off everything omitted from it.
   */
  capabilities?: ModelCapability[];
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
  /** Scope: whether this tier mapping belongs to the main agent or a CLI sub-agent */
  scope: ProviderTierScope;
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
  /** Scope: which agent's tier mapping to retrieve */
  scope: ProviderTierScope;
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
  /** Scope: which agent's tier mapping to clear */
  scope: ProviderTierScope;
}

/** Response from provider:clearModelTier RPC method */
export interface ProviderClearModelTierResult {
  success: boolean;
  error?: string;
}
// ---------------------------------------------------------------------------
// User-defined provider entries — TASK_2026_236
//
// CRUD over `provider.custom.entries` in ~/.ptah/settings.json plus a real
// connection probe. All five land under the EXISTING `provider:` prefix, which
// is already in ALLOWED_METHOD_PREFIXES — only this compile-time contract and
// the `RpcMethodName` union change (plan.md decision 5).
//
// The API key is NEVER part of an entry. It travels as a sibling `apiKey`
// param on add/update and is routed to SecretStorage by the handler, so the
// persisted JSON stays non-secret metadata.
// ---------------------------------------------------------------------------

/** Parameters for provider:listCustomEntries (none). */
export type ProviderListCustomEntriesParams = Record<string, never>;

/** Response from provider:listCustomEntries. */
export interface ProviderListCustomEntriesResult {
  entries: CustomProviderEntry[];
}

/** Parameters for provider:addCustomEntry. */
export interface ProviderAddCustomEntryParams {
  /** Non-secret metadata. `createdAt` is stamped server-side. */
  entry: CustomProviderEntryInput;
  /** Optional API key — written to SecretStorage, never to the entry. */
  apiKey?: string;
}

/** Response from provider:addCustomEntry. */
export interface ProviderAddCustomEntryResult {
  entry: CustomProviderEntry;
}

/** Parameters for provider:updateCustomEntry. */
export interface ProviderUpdateCustomEntryParams {
  /** Id of the entry to edit. Immutable — `changes.id` may not differ from it. */
  id: string;
  changes: CustomProviderEntryChanges;
  /** When present, replaces the stored key for this id. */
  apiKey?: string;
}

/** Response from provider:updateCustomEntry. */
export interface ProviderUpdateCustomEntryResult {
  entry: CustomProviderEntry;
}

/** Parameters for provider:removeCustomEntry. */
export interface ProviderRemoveCustomEntryParams {
  id: string;
}

/** Response from provider:removeCustomEntry. */
export interface ProviderRemoveCustomEntryResult {
  /** False when the id was already absent. The stored key is deleted either way. */
  removed: boolean;
}

/** Parameters for provider:testCustomEntry. */
export interface ProviderTestCustomEntryParams {
  id: string;
}

/**
 * Response from provider:testCustomEntry.
 *
 * `message` is written for the user, not for a log — it names the specific
 * thing to fix (bad key, wrong base URL, TLS, no tool support, …).
 */
export interface ProviderTestCustomEntryResult {
  ok: boolean;
  message: string;
  /** Round-trip time of the probe request; absent when no request was made. */
  latencyMs?: number;
}

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

/** LLM Provider names for API key management (platform-agnostic) */
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

/**
 * Auth modality for a provider entry returned by llm:getProviderStatus.
 *
 * - 'apiKey': Traditional API-key entry stored in secret storage
 * - 'oauth':  OAuth-based device-code or authorization-code flow
 * - 'cli':    Authentication delegated to a local CLI binary
 *             (e.g. claude-code) — no key in secret storage
 * - 'none':   No authentication required (e.g. local Ollama, LM Studio)
 */
export type LlmProviderAuthMode = 'apiKey' | 'oauth' | 'cli' | 'none';

/**
 * Per-provider entry returned by `llm:getProviderStatus`. Surfaces the
 * registry's full provider catalogue (not just `anthropic` + `openrouter`)
 * and includes the auth mode + per-provider base-URL override status so
 * the CLI `provider status --human` table can render columns for every
 * provider.
 */
export interface LlmGetProviderStatusEntry {
  /** Provider id (e.g. 'anthropic', 'openrouter', 'ollama'). */
  name: LlmProviderName;
  /** Human-readable display name. */
  displayName: string;
  /** Whether an API key is present in secret storage (only meaningful when authType='apiKey'). */
  hasApiKey: boolean;
  /** Whether this provider is the active default. */
  isDefault: boolean;
  /** Auth modality — derived from the provider registry. */
  authType: LlmProviderAuthMode;
  /** Whether this provider needs a local translation proxy (defaults false). */
  requiresProxy: boolean;
  /** Whether this is a local provider (no remote inference). Defaults false. */
  isLocal: boolean;
  /** Effective base URL — override if set, otherwise registry default. */
  baseUrl: string | null;
  /** True when the user has set a `provider.<id>.baseUrl` override. */
  baseUrlOverridden: boolean;
}

/** Full payload returned by llm:getProviderStatus (CLI bug fix batch). */
export interface LlmGetProviderStatusResponse {
  providers: LlmGetProviderStatusEntry[];
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

/** Parameters for llm:setProviderBaseUrl RPC method */
export interface LlmSetProviderBaseUrlParams {
  provider: LlmProviderName;
  baseUrl: string;
}

/** Response from llm:setProviderBaseUrl RPC method */
export interface LlmSetProviderBaseUrlResponse {
  success: boolean;
  error?: string;
}

/** Parameters for llm:getProviderBaseUrl RPC method */
export interface LlmGetProviderBaseUrlParams {
  provider: LlmProviderName;
}

/** Response from llm:getProviderBaseUrl RPC method */
export interface LlmGetProviderBaseUrlResponse {
  /** Override URL set by user, or null if no override (registry default in effect) */
  baseUrl: string | null;
  /** Registry default URL for this provider (informational) */
  defaultBaseUrl: string | null;
}

/** Parameters for llm:clearProviderBaseUrl RPC method */
export interface LlmClearProviderBaseUrlParams {
  provider: LlmProviderName;
}

/** Response from llm:clearProviderBaseUrl RPC method */
export interface LlmClearProviderBaseUrlResponse {
  success: boolean;
  error?: string;
}
