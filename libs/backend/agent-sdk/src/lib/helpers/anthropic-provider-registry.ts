/**
 * Anthropic-Compatible Provider Registry (TASK_2025_129 Batch 3)
 *
 * Registry of providers that implement the Anthropic API protocol,
 * allowing Claude Agent SDK to route through them using:
 * - ANTHROPIC_BASE_URL: Provider's API endpoint
 * - ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY: Provider's API key
 *   (per-provider; see authEnvVar field)
 *
 * Known providers:
 * - OpenRouter: Multi-model access (200+ models) — Bearer auth
 * - Moonshot (Kimi): Anthropic-compatible endpoint — Bearer auth
 * - Z.AI (GLM): Anthropic-compatible endpoint — Bearer auth
 *
 * @see https://openrouter.ai/docs/guides/claude-code-integration
 * @see https://platform.moonshot.ai/docs/guide/agent-support.en-US
 * @see https://docs.z.ai/devpack/tool/claude
 */

import { updatePricingMap, type ModelPricing } from '@ptah-extension/shared';
import { COPILOT_PROVIDER_ENTRY } from '../copilot-provider';
import { CODEX_PROVIDER_ENTRY } from '../codex-provider';
import {
  OLLAMA_PROVIDER_ENTRY,
  OLLAMA_CLOUD_PROVIDER_ENTRY,
  LM_STUDIO_PROVIDER_ENTRY,
} from '../local-provider';

/**
 * Static model definition for providers without a dynamic models API
 */
export interface ProviderStaticModel {
  /** Model ID as used in API calls */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Short description */
  description: string;
  /** Maximum context length in tokens */
  contextLength: number;
  /** Whether this model supports tool use */
  supportsToolUse: boolean;
  /** Cost per input token in USD (optional - for pricing override) */
  inputCostPerToken?: number;
  /** Cost per output token in USD (optional - for pricing override) */
  outputCostPerToken?: number;
  /** Cost per cache read token in USD (optional) */
  cacheReadCostPerToken?: number;
  /** Cost per cache creation token in USD (optional) */
  cacheCreationCostPerToken?: number;
}

/**
 * Which environment variable carries the provider's API key.
 * - 'ANTHROPIC_AUTH_TOKEN' → sends Authorization: Bearer header (OpenRouter, Moonshot, Z.AI)
 * - 'ANTHROPIC_API_KEY'    → sends x-api-key header (future providers)
 */
export type ProviderAuthEnvVar = 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_API_KEY';

/**
 * Anthropic-compatible provider definition
 */
export interface AnthropicProvider {
  /** Unique provider identifier (stored in config) */
  id: string;
  /** Display name for UI */
  name: string;
  /** Provider's Anthropic-compatible API base URL */
  baseUrl: string;
  /** Which env var to set for this provider's API key */
  authEnvVar: ProviderAuthEnvVar;
  /** Expected API key prefix for validation hints (empty string if no standard prefix) */
  keyPrefix: string;
  /** URL where users can obtain API keys */
  helpUrl: string;
  /** Short description for UI tooltip/help text */
  description: string;
  /** Placeholder text for the API key input */
  keyPlaceholder: string;
  /** Masked key display (shown when key is configured) */
  maskedKeyDisplay: string;
  /** URL for /v1/models endpoint (if provider supports dynamic listing) */
  modelsEndpoint?: string;
  /** Hardcoded models for providers without a dynamic API */
  staticModels?: ProviderStaticModel[];
  /**
   * Authentication type (TASK_2025_186)
   * - 'apiKey': Traditional API key input (default if not set)
   * - 'oauth': OAuth-based authentication (e.g., GitHub Copilot)
   * - 'none': No authentication needed (e.g., local providers like Ollama, LM Studio)
   */
  authType?: 'apiKey' | 'oauth' | 'none';
  /**
   * Whether this provider requires a local translation proxy (TASK_2025_186)
   * When true, a local HTTP proxy translates between Anthropic and provider protocols.
   * Defaults to false if not set.
   */
  requiresProxy?: boolean;
  /**
   * Whether this is a local provider running on localhost (TASK_2025_265)
   * When true, the provider requires no API key and uses HTTP (not HTTPS).
   */
  isLocal?: boolean;
  /**
   * Default model tier mappings for this provider.
   * When present, auto-applied on first provider selection so
   * "Default (recommended)" resolves to the provider's best model.
   */
  defaultTiers?: {
    readonly sonnet: string;
    readonly opus: string;
    readonly haiku: string;
  };
  /**
   * Whether this provider supports an OPTIONAL API key (TASK_OLLAMA_CLOUD_KEY).
   *
   * Distinct from `authType: 'apiKey'` (which means the key is REQUIRED for
   * inference and changes strategy routing). When `supportsOptionalApiKey` is
   * true, the provider keeps `authType: 'none'` (so strategy resolution still
   * routes to local-native), but the UI can collect a key for metadata-only
   * features such as live model discovery and per-token pricing fetches.
   *
   * Currently used by `ollama-cloud`: inference still proxies through local
   * Ollama (no key needed), but a configured key unlocks live model tags from
   * ollama.com/api/tags and pricing from ollama.com/api/usage.
   */
  supportsOptionalApiKey?: boolean;
}

/**
 * Registry of known Anthropic-compatible providers
 *
 * To add a new provider:
 * 1. Add an entry to this array
 * 2. No other code changes required - the registry drives all behavior
 */
export const ANTHROPIC_PROVIDERS = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    keyPrefix: 'sk-or-',
    helpUrl: 'https://openrouter.ai/keys',
    description: 'Access 200+ models via unified API',
    keyPlaceholder: 'sk-or-v1-...',
    maskedKeyDisplay: 'sk-or-••••••••••••',
    modelsEndpoint: 'https://openrouter.ai/api/v1/models',
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.ai/anthropic/',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    keyPrefix: '',
    helpUrl: 'https://platform.moonshot.ai/console/api-keys',
    description: 'Kimi models via Anthropic-compatible API',
    keyPlaceholder: 'Enter Moonshot API key...',
    maskedKeyDisplay: '••••••••••••',
    modelsEndpoint: 'https://api.moonshot.ai/v1/models',
    // Moonshot's official Claude Code / Anthropic-compatible guide documents
    // mapping all three tiers to `kimi-k2.5` — it is the only model validated
    // against the /anthropic/ endpoint. Other IDs like `kimi-k2.6` and
    // `kimi-k2-0905-preview` exist on the native /v1/ API but are not
    // confirmed to route through the Anthropic-compatible layer, and using
    // them here caused the UI to hang when the endpoint dropped the request.
    // @see https://platform.kimi.ai/docs/guide/agent-support.en-US
    defaultTiers: {
      sonnet: 'kimi-k2.5',
      opus: 'kimi-k2.5',
      haiku: 'kimi-k2.5',
    },
    staticModels: [
      {
        id: 'kimi-k2',
        name: 'Kimi K2',
        description: 'Flagship model (128K context)',
        contextLength: 128000,
        supportsToolUse: true,
        inputCostPerToken: 0.23e-6, // $0.23 per 1M tokens
        outputCostPerToken: 3e-6, // $3.00 per 1M tokens
        cacheReadCostPerToken: 0.023e-6, // 10% of input
        cacheCreationCostPerToken: 0.2875e-6, // 125% of input
      },
      {
        id: 'kimi-k2-0905-preview',
        name: 'Kimi K2 (0905)',
        description: 'Preview release (256K context)',
        contextLength: 256000,
        supportsToolUse: true,
        inputCostPerToken: 0.23e-6, // $0.23 per 1M tokens
        outputCostPerToken: 3e-6, // $3.00 per 1M tokens
        cacheReadCostPerToken: 0.023e-6, // 10% of input
        cacheCreationCostPerToken: 0.2875e-6, // 125% of input
      },
      {
        id: 'kimi-k2-thinking',
        name: 'Kimi K2 Thinking',
        description: 'Extended thinking model (256K context)',
        contextLength: 256000,
        supportsToolUse: true,
        inputCostPerToken: 0.4e-6, // $0.40 per 1M tokens
        outputCostPerToken: 1.75e-6, // $1.75 per 1M tokens
        cacheReadCostPerToken: 0.04e-6, // 10% of input
        cacheCreationCostPerToken: 0.5e-6, // 125% of input
      },
      {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        description: 'Latest generation model (256K context)',
        contextLength: 256000,
        supportsToolUse: true,
        inputCostPerToken: 0.23e-6, // $0.23 per 1M tokens
        outputCostPerToken: 3e-6, // $3.00 per 1M tokens
        cacheReadCostPerToken: 0.023e-6, // 10% of input
        cacheCreationCostPerToken: 0.2875e-6, // 125% of input
      },
      {
        id: 'kimi-k2.6',
        name: 'Kimi K2.6',
        description: 'Next-generation flagship model (256K context)',
        contextLength: 256000,
        supportsToolUse: true,
        // Official pricing from https://platform.kimi.ai/docs/pricing/chat-k26
        inputCostPerToken: 0.95e-6, // $0.95 per 1M tokens (cache miss)
        outputCostPerToken: 4e-6, // $4.00 per 1M tokens
        cacheReadCostPerToken: 0.16e-6, // $0.16 per 1M tokens (cache hit)
        cacheCreationCostPerToken: 1.1875e-6, // 125% of input
      },
    ],
  },
  {
    id: 'z-ai',
    name: 'Z.AI (GLM)',
    baseUrl: 'https://api.z.ai/api/anthropic',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    keyPrefix: '',
    helpUrl: 'https://open.z.ai/open/api/openkey',
    description: 'GLM models via Anthropic-compatible API',
    keyPlaceholder: 'Enter Z.AI API key...',
    maskedKeyDisplay: '••••••••••••',
    // Z.AI has no /v1/models API — static models only
    // @see https://docs.z.ai/guides/overview/pricing
    defaultTiers: {
      sonnet: 'glm-5.1',
      opus: 'glm-5-code',
      haiku: 'glm-4.7-flashx',
    },
    staticModels: [
      {
        id: 'glm-5.1',
        name: 'GLM-5.1',
        description:
          'Latest flagship model, 94% of Opus 4.6 coding (200K context)',
        contextLength: 200000,
        supportsToolUse: true,
        inputCostPerToken: 1.0e-6, // $1.00 per 1M tokens (estimated, standalone API pricing TBD)
        outputCostPerToken: 3.2e-6, // $3.20 per 1M tokens (estimated, standalone API pricing TBD)
        cacheReadCostPerToken: 0.1e-6, // 10% of input
        cacheCreationCostPerToken: 1.25e-6, // 125% of input
      },
      {
        id: 'glm-5',
        name: 'GLM-5',
        description: 'Opus-class high-intelligence model (200K context)',
        contextLength: 200000,
        supportsToolUse: true,
        inputCostPerToken: 1.0e-6, // $1.00 per 1M tokens
        outputCostPerToken: 3.2e-6, // $3.20 per 1M tokens
        cacheReadCostPerToken: 0.1e-6, // 10% of input
        cacheCreationCostPerToken: 1.25e-6, // 125% of input
      },
      {
        id: 'glm-5-turbo',
        name: 'GLM-5 Turbo',
        description: 'Optimized performance variant (200K context)',
        contextLength: 200000,
        supportsToolUse: true,
        inputCostPerToken: 1.2e-6, // $1.20 per 1M tokens
        outputCostPerToken: 4.0e-6, // $4.00 per 1M tokens
        cacheReadCostPerToken: 0.12e-6, // 10% of input
        cacheCreationCostPerToken: 1.5e-6, // 125% of input
      },
      {
        id: 'glm-5-code',
        name: 'GLM-5 Code',
        description: 'Optimized for coding tasks (200K context)',
        contextLength: 200000,
        supportsToolUse: true,
        inputCostPerToken: 1.2e-6, // $1.20 per 1M tokens
        outputCostPerToken: 5.0e-6, // $5.00 per 1M tokens
        cacheReadCostPerToken: 0.12e-6, // 10% of input
        cacheCreationCostPerToken: 1.5e-6, // 125% of input
      },
      {
        id: 'glm-4.7',
        name: 'GLM-4.7',
        description: 'Sonnet-class flagship model (200K context)',
        contextLength: 200000,
        supportsToolUse: true,
        inputCostPerToken: 0.6e-6, // $0.60 per 1M tokens
        outputCostPerToken: 2.2e-6, // $2.20 per 1M tokens
        cacheReadCostPerToken: 0.06e-6, // 10% of input
        cacheCreationCostPerToken: 0.75e-6, // 125% of input
      },
      {
        id: 'glm-4.7-flashx',
        name: 'GLM-4.7 FlashX',
        description: 'Fast performance (200K context)',
        contextLength: 200000,
        supportsToolUse: true,
        inputCostPerToken: 0.07e-6, // $0.07 per 1M tokens
        outputCostPerToken: 0.4e-6, // $0.40 per 1M tokens
        cacheReadCostPerToken: 0.007e-6, // 10% of input
        cacheCreationCostPerToken: 0.0875e-6, // 125% of input
      },
      {
        id: 'glm-4.7-flash',
        name: 'GLM-4.7 Flash',
        description: 'Free lightweight model (200K context)',
        contextLength: 200000,
        supportsToolUse: true,
        inputCostPerToken: 0, // Free
        outputCostPerToken: 0, // Free
        cacheReadCostPerToken: 0, // Free
        cacheCreationCostPerToken: 0, // Free
      },
      {
        id: 'glm-4.6',
        name: 'GLM-4.6',
        description: 'Unified reasoning (200K context)',
        contextLength: 200000,
        supportsToolUse: true,
        inputCostPerToken: 0.6e-6, // $0.60 per 1M tokens
        outputCostPerToken: 2.2e-6, // $2.20 per 1M tokens
        cacheReadCostPerToken: 0.06e-6, // 10% of input
        cacheCreationCostPerToken: 0.75e-6, // 125% of input
      },
      {
        id: 'glm-4.5-x',
        name: 'GLM-4.5-X',
        description: 'Premium extended thinking (128K context)',
        contextLength: 128000,
        supportsToolUse: true,
        inputCostPerToken: 2.2e-6, // $2.20 per 1M tokens
        outputCostPerToken: 8.9e-6, // $8.90 per 1M tokens
        cacheReadCostPerToken: 0.22e-6, // 10% of input
        cacheCreationCostPerToken: 2.75e-6, // 125% of input
      },
      {
        id: 'glm-4.5',
        name: 'GLM-4.5',
        description: 'Hybrid thinking (128K context)',
        contextLength: 128000,
        supportsToolUse: true,
        inputCostPerToken: 0.6e-6, // $0.60 per 1M tokens
        outputCostPerToken: 2.2e-6, // $2.20 per 1M tokens
        cacheReadCostPerToken: 0.06e-6, // 10% of input
        cacheCreationCostPerToken: 0.75e-6, // 125% of input
      },
      {
        id: 'glm-4.5-airx',
        name: 'GLM-4.5 AirX',
        description: 'Accelerated MoE variant (128K context)',
        contextLength: 128000,
        supportsToolUse: true,
        inputCostPerToken: 1.1e-6, // $1.10 per 1M tokens
        outputCostPerToken: 4.5e-6, // $4.50 per 1M tokens
        cacheReadCostPerToken: 0.11e-6, // 10% of input
        cacheCreationCostPerToken: 1.375e-6, // 125% of input
      },
      {
        id: 'glm-4.5-air',
        name: 'GLM-4.5 Air',
        description: 'Lightweight MoE (128K context)',
        contextLength: 128000,
        supportsToolUse: true,
        inputCostPerToken: 0.2e-6, // $0.20 per 1M tokens
        outputCostPerToken: 1.1e-6, // $1.10 per 1M tokens
        cacheReadCostPerToken: 0.02e-6, // 10% of input
        cacheCreationCostPerToken: 0.25e-6, // 125% of input
      },
      {
        id: 'glm-4.5-flash',
        name: 'GLM-4.5 Flash',
        description: 'Free lightweight model (128K context)',
        contextLength: 128000,
        supportsToolUse: true,
        inputCostPerToken: 0, // Free
        outputCostPerToken: 0, // Free
        cacheReadCostPerToken: 0, // Free
        cacheCreationCostPerToken: 0, // Free
      },
    ],
  },
  COPILOT_PROVIDER_ENTRY,
  CODEX_PROVIDER_ENTRY,
  OLLAMA_PROVIDER_ENTRY,
  OLLAMA_CLOUD_PROVIDER_ENTRY,
  LM_STUDIO_PROVIDER_ENTRY,
] as const satisfies readonly AnthropicProvider[];

/**
 * Provider IDs as a union type.
 * Manually defined to include both static and dynamic providers.
 */
export type AnthropicProviderId =
  | 'openrouter'
  | 'moonshot'
  | 'z-ai'
  | 'github-copilot'
  | 'openai-codex'
  | 'ollama'
  | 'ollama-cloud'
  | 'lm-studio';

/** Default provider when none is configured */
export const DEFAULT_PROVIDER_ID: AnthropicProviderId = 'openrouter';

/** Virtual provider ID for direct Claude auth (OAuth/API key) — not in ANTHROPIC_PROVIDERS registry */
export const ANTHROPIC_DIRECT_PROVIDER_ID = 'anthropic';

/**
 * Get a provider by ID
 *
 * @param id - Provider ID to look up
 * @returns Provider definition, or undefined if not found
 */
export function getAnthropicProvider(
  id: string,
): AnthropicProvider | undefined {
  return ANTHROPIC_PROVIDERS.find((p) => p.id === id);
}

/**
 * Get provider base URL by ID, with fallback to default provider
 *
 * @param id - Provider ID
 * @returns Base URL for the provider
 */
export function getProviderBaseUrl(id: string): string {
  const provider = getAnthropicProvider(id);
  if (provider) {
    return provider.baseUrl;
  }
  // Fallback to default provider (OpenRouter)
  const defaultProvider = getAnthropicProvider(DEFAULT_PROVIDER_ID);
  if (!defaultProvider) {
    throw new Error(
      `Default provider '${DEFAULT_PROVIDER_ID}' not found in registry`,
    );
  }
  return defaultProvider.baseUrl;
}

/**
 * Get provider auth env var by ID, with fallback to default
 *
 * @param id - Provider ID
 * @returns The env var name to use for this provider's API key
 */
export function getProviderAuthEnvVar(id: string): ProviderAuthEnvVar {
  const provider = getAnthropicProvider(id);
  return provider?.authEnvVar ?? 'ANTHROPIC_AUTH_TOKEN';
}

/**
 * Seed the pricing map with static model pricing from a provider.
 *
 * Called during provider activation as a fallback for models not on OpenRouter.
 * Creates pricing map entries with both exact and normalized keys.
 *
 * @param providerId - Provider ID to seed pricing for
 */
export function seedStaticModelPricing(providerId: string): void {
  const provider = getAnthropicProvider(providerId);
  if (!provider?.staticModels) return;

  const entries: Record<string, ModelPricing> = {};

  for (const model of provider.staticModels) {
    if (model.inputCostPerToken == null || model.outputCostPerToken == null) {
      continue;
    }

    const pricing: ModelPricing = {
      inputCostPerToken: model.inputCostPerToken,
      outputCostPerToken: model.outputCostPerToken,
      cacheReadCostPerToken: model.cacheReadCostPerToken,
      cacheCreationCostPerToken: model.cacheCreationCostPerToken,
      provider: providerId,
      maxTokens: model.contextLength,
    };

    // Exact key
    entries[model.id] = pricing;
    // Normalized lowercase key
    const lower = model.id.toLowerCase();
    if (lower !== model.id) {
      entries[lower] = pricing;
    }
  }

  if (Object.keys(entries).length > 0) {
    updatePricingMap(entries);
  }
}
