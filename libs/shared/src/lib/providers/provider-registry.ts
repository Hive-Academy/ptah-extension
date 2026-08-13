/**
 * Anthropic-Compatible Provider Registry
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

import { z } from 'zod';

import { updatePricingMap, type ModelPricing } from '../utils/pricing.utils';
import { isValidProviderBaseUrl } from './provider-base-url';
import { COPILOT_PROVIDER_ENTRY } from './entries/copilot-provider-entry';
import { CODEX_PROVIDER_ENTRY } from './entries/codex-provider-entry';
import {
  OLLAMA_PROVIDER_ENTRY,
  OLLAMA_CLOUD_PROVIDER_ENTRY,
  LM_STUDIO_PROVIDER_ENTRY,
} from './entries/local-provider-entry';
import { CLAUDE_CLI_PROVIDER_ENTRY } from './entries/claude-cli-provider-entry';
import { SAKANA_PROVIDER_ENTRY } from './entries/sakana-provider-entry';
import { REQUESTY_PROVIDER_ENTRY } from './entries/requesty-provider-entry';

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
   * Authentication type
   * - 'apiKey': Traditional API key input (default if not set)
   * - 'oauth': OAuth-based authentication (e.g., GitHub Copilot)
   * - 'none': No authentication needed (e.g., local providers like Ollama, LM Studio)
   */
  authType?: 'apiKey' | 'oauth' | 'none';
  /**
   * Whether this provider requires a local translation proxy
   * When true, a local HTTP proxy translates between Anthropic and provider protocols.
   * Defaults to false if not set.
   */
  requiresProxy?: boolean;
  /**
   * Whether this is a local provider running on localhost
   * When true, the provider requires no API key and uses HTTP (not HTTPS).
   */
  isLocal?: boolean;
  /**
   * How the user pays for inference on this provider.
   *
   * - `'usage'` (default): billed per token.
   * - `'subscription'`: billed a flat fee. Turns are still costed at published
   *   per-token rates — that is the figure `claude /usage` and the Codex CLI
   *   report, and the one users expect — but such providers must be kept OUT
   *   of the shared pricing map, because seeding their models at $0 would pin
   *   a bare slug like `gpt-5.4` (a Codex model AND an OpenRouter one) to zero
   *   for whoever looked it up next. The flag rides along on cost lookups so
   *   surfaces can label the fee as flat; it never changes the number.
   */
  pricingModel?: 'usage' | 'subscription';
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
   * Whether this provider supports an OPTIONAL API key.
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
  /**
   * Native Claude auth — inherit the host's local Claude CLI login /
   * subscription instead of any base-url override or auth token.
   *
   * When true, the spawn path produces an EMPTY auth env (no
   * `ANTHROPIC_BASE_URL`, no `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`,
   * no tier-model overrides) so the official `@anthropic-ai/claude-agent-sdk`
   * resolves the ambient `~/.claude` credentials exactly like Ptah's default
   * conductor. Setting any auth env for such a provider would override that
   * login and break authentication. Distinct from `authType: 'none'` local
   * providers (Ollama/LM Studio), which DO set a localhost base url + a
   * placeholder token. Mutually exclusive with `baseUrl`.
   */
  nativeAuth?: boolean;
  /**
   * True only for entries the USER defined (see {@link CustomProviderEntry}).
   *
   * Built-in registry entries never set this. Surfaces use it to decide which
   * tiles get edit/delete affordances and which security copy to render — the
   * built-in base URLs ship in Ptah's own source, a custom one does not.
   */
  isCustom?: boolean;
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
    authType: 'apiKey',
    requiresProxy: true,
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
    defaultTiers: {
      sonnet: 'kimi-k2.6',
      opus: 'kimi-k2.7-code',
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
        inputCostPerToken: 0.95e-6, // $0.95 per 1M tokens (cache miss)
        outputCostPerToken: 4e-6, // $4.00 per 1M tokens
        cacheReadCostPerToken: 0.16e-6, // $0.16 per 1M tokens (cache hit)
        cacheCreationCostPerToken: 1.1875e-6, // 125% of input
      },
      {
        id: 'kimi-k2.7-code',
        name: 'Kimi K2.7 Code',
        description:
          'Agentic coding model, 1T MoE / 32B active, forced thinking (256K context)',
        contextLength: 256000,
        supportsToolUse: true,
        inputCostPerToken: 0.95e-6, // $0.95 per 1M tokens
        outputCostPerToken: 4e-6, // $4.00 per 1M tokens
        cacheReadCostPerToken: 0.16e-6, // $0.16 per 1M tokens (cache hit)
        cacheCreationCostPerToken: 1.1875e-6, // 125% of input
      },
      {
        id: 'kimi-k2.7-code-highspeed',
        name: 'Kimi K2.7 Code (Highspeed)',
        description: 'Low-latency variant of K2.7 Code (256K context)',
        contextLength: 256000,
        supportsToolUse: true,
        inputCostPerToken: 0.95e-6, // $0.95 per 1M tokens (highspeed pricing TBD, mirrors K2.7 Code)
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
    defaultTiers: {
      sonnet: 'glm-5.1',
      opus: 'glm-5.2',
      haiku: 'glm-4.7-flashx',
    },
    staticModels: [
      {
        id: 'glm-5.2',
        name: 'GLM-5.2',
        description:
          'Flagship coding model, 744B params, strongest open-source coding (1M context)',
        contextLength: 1000000,
        supportsToolUse: true,
        inputCostPerToken: 1.4e-6, // $1.40 per 1M tokens
        outputCostPerToken: 4.4e-6, // $4.40 per 1M tokens
        cacheReadCostPerToken: 0.26e-6, // $0.26 per 1M tokens (cache hit)
        cacheCreationCostPerToken: 1.75e-6, // 125% of input
      },
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
  CLAUDE_CLI_PROVIDER_ENTRY,
  SAKANA_PROVIDER_ENTRY,
  REQUESTY_PROVIDER_ENTRY,
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
  | 'lm-studio'
  | 'claude-cli'
  | 'sakana'
  | 'requesty';

/** Default provider when none is configured */
export const DEFAULT_PROVIDER_ID: AnthropicProviderId = 'openrouter';

/** Virtual provider ID for direct Claude auth (OAuth/API key) — not in ANTHROPIC_PROVIDERS registry */
export const ANTHROPIC_DIRECT_PROVIDER_ID = 'anthropic';

// ---------------------------------------------------------------------------
// User-defined ("custom") provider entries — TASK_2026_236
// ---------------------------------------------------------------------------

/**
 * Which protocol a custom entry speaks. Stored explicitly and NEVER re-derived
 * from the URL shape, because the two lanes are indistinguishable from a base
 * URL alone:
 *   - 'anthropic' → native Messages passthrough → `requiresProxy: false`
 *   - 'openai'    → OpenAI-compatible, needs the local translation proxy →
 *                   `requiresProxy: true`
 */
export const CUSTOM_PROVIDER_LANES = ['anthropic', 'openai'] as const;
export type CustomProviderLane = (typeof CUSTOM_PROVIDER_LANES)[number];

/**
 * Allowed shape of a custom provider id.
 *
 * Deliberately the same character class as `PROVIDER_BASE_URL_PATTERN` /
 * `PROVIDER_SCOPED_TIER_PATTERN` in
 * `libs/backend/platform-core/src/file-settings-keys.ts` — an id outside this
 * class would produce settings keys those regexes reject, and the writes would
 * be silently dropped.
 */
export const CUSTOM_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * True when `id` names a provider that ships in Ptah's own source.
 *
 * A user-defined entry may never take one of these ids: a settings file that
 * could re-declare `openrouter` would silently repoint a shipped, audited tile
 * at an arbitrary host. Includes the virtual `anthropic` direct-auth id, which
 * is not in `ANTHROPIC_PROVIDERS` but is just as reserved.
 */
export function isBuiltInProviderId(id: string): boolean {
  if (id === ANTHROPIC_DIRECT_PROVIDER_ID) return true;
  return ANTHROPIC_PROVIDERS.some((provider) => provider.id === id);
}

/**
 * `http:`/`https:` only — literally the same function `llm:setProviderBaseUrl`
 * now calls, not a second copy of the rule (see `./provider-base-url`).
 */
const isHttpUrl = isValidProviderBaseUrl;

/**
 * Optional, manually-entered per-1M-token rates.
 *
 * There is no standard for how a `/v1/models` response encodes pricing, so
 * custom entries show "cost unavailable" until the user types rates in.
 */
export const CustomProviderPricingSchema = z.object({
  inputPerMillion: z.number().nonnegative(),
  outputPerMillion: z.number().nonnegative(),
});
export type CustomProviderPricing = z.infer<typeof CustomProviderPricingSchema>;

/** Tier → concrete model id mapping, so "Default (recommended)" resolves. */
export const CustomProviderTiersSchema = z.object({
  sonnet: z.string().min(1),
  opus: z.string().min(1),
  haiku: z.string().min(1),
});

/**
 * One user-defined provider entry as persisted in `provider.custom.entries`
 * inside `~/.ptah/settings.json`.
 *
 * NON-SECRET METADATA ONLY. The API key lives exclusively in
 * `AuthSecretsService.setProviderKey(id, …)` → platform SecretStorage, the same
 * separation the built-in registry already enforces.
 */
/**
 * Field-level schemas, declared ONCE.
 *
 * The full entry schema and the partial-edit schema are both built from these
 * so the two can never disagree about what a valid `baseUrl` or `lane` is.
 * The defaulted fields are applied only in the full schema — see
 * {@link CustomProviderEntryChangesSchema} for why a partial edit must NOT
 * carry defaults.
 */
const customProviderFields = {
  id: z
    .string()
    .regex(
      CUSTOM_PROVIDER_ID_PATTERN,
      'Provider id must be lower-case alphanumeric with dashes',
    ),
  name: z.string().min(1),
  baseUrl: z
    .string()
    .refine(isHttpUrl, 'Base URL must be an http:// or https:// URL'),
  lane: z.enum(CUSTOM_PROVIDER_LANES),
  authEnvVar: z.enum(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']),
  keyPrefix: z.string(),
  helpUrl: z.string(),
  modelsEndpoint: z.string().nullable().optional(),
  defaultTiers: CustomProviderTiersSchema.nullable().optional(),
  pricing: CustomProviderPricingSchema.nullable().optional(),
} as const;

export const CustomProviderEntrySchema = z.object({
  ...customProviderFields,
  authEnvVar: customProviderFields.authEnvVar.default('ANTHROPIC_AUTH_TOKEN'),
  keyPrefix: customProviderFields.keyPrefix.default(''),
  helpUrl: customProviderFields.helpUrl.default(''),
  createdAt: z.string().optional(),
});

/** A validated user-defined provider entry. */
export type CustomProviderEntry = z.infer<typeof CustomProviderEntrySchema>;

/** The whole `provider.custom.entries` array as stored on disk. */
export const CustomProviderEntriesSchema = z.array(CustomProviderEntrySchema);

/**
 * What a CALLER supplies when creating or editing an entry.
 *
 * `createdAt` is omitted deliberately — it is stamped by the store on insert
 * and preserved on update, so a client cannot rewrite an entry's history.
 * Fields carrying a schema default (`authEnvVar`, `keyPrefix`, `helpUrl`) stay
 * optional on the way in and are filled by the parse.
 */
export const CustomProviderEntryInputSchema = CustomProviderEntrySchema.omit({
  createdAt: true,
});

/** Input side of {@link CustomProviderEntryInputSchema} — defaults optional. */
export type CustomProviderEntryInput = z.input<
  typeof CustomProviderEntryInputSchema
>;

/**
 * A partial edit to an existing entry.
 *
 * `id` is present but immutable: the API key for an entry lives in
 * SecretStorage under that id, so renaming would orphan the secret. The store
 * rejects a `changes.id` that differs from the target id rather than silently
 * dropping it.
 *
 * Built from the UNDEFAULTED field schemas on purpose. Partialling the full
 * entry schema instead would still materialise `authEnvVar`, `keyPrefix` and
 * `helpUrl` for keys the caller never mentioned, and the store's merge would
 * then quietly reset those three fields on every edit.
 */
export const CustomProviderEntryChangesSchema = z
  .object(customProviderFields)
  .partial();

/** Partial edit shape accepted by `provider:updateCustomEntry`. */
export type CustomProviderEntryChanges = z.input<
  typeof CustomProviderEntryChangesSchema
>;

/** Why a submitted entry did not make it into the merged registry. */
export interface RejectedCustomProviderEntry {
  /** The offending id, or `'<unknown>'` when the entry had no usable id. */
  readonly id: string;
  readonly reason: string;
}

/** Outcome of {@link setCustomProviderEntries} — explicit, so callers can log. */
export interface SetCustomProviderEntriesResult {
  readonly accepted: readonly CustomProviderEntry[];
  readonly rejected: readonly RejectedCustomProviderEntry[];
}

/**
 * Module-level cache of user-defined entries.
 *
 * `libs/shared` is a leaf with no file I/O — it cannot read
 * `~/.ptah/settings.json` itself. The BACKEND owns population: it reads
 * `provider.custom.entries` at auth bootstrap and on config change, then calls
 * {@link setCustomProviderEntries}. Never call the setter from frontend code.
 */
let customProviderEntries: readonly CustomProviderEntry[] = [];

/** Derived `AnthropicProvider` view of the cache, rebuilt only on set. */
let customProviders: readonly AnthropicProvider[] = [];

/**
 * Project a stored entry onto the `AnthropicProvider` shape the rest of the
 * codebase already consumes.
 *
 * The lane → `requiresProxy` mapping is the whole point of storing the lane:
 * 'anthropic' passes through natively, 'openai' needs the local translation
 * proxy.
 */
export function customEntryToAnthropicProvider(
  entry: CustomProviderEntry,
): AnthropicProvider {
  let host = entry.baseUrl;
  try {
    host = new URL(entry.baseUrl).host;
  } catch {
    // Schema guarantees a parseable URL; keep the raw string if that ever changes.
  }

  return {
    id: entry.id,
    name: entry.name,
    baseUrl: entry.baseUrl,
    authEnvVar: entry.authEnvVar,
    keyPrefix: entry.keyPrefix,
    helpUrl: entry.helpUrl,
    description: `User-defined endpoint at ${host}`,
    keyPlaceholder: entry.keyPrefix ? `${entry.keyPrefix}…` : 'API key',
    maskedKeyDisplay: '••••••••',
    authType: 'apiKey',
    requiresProxy: entry.lane === 'openai',
    isCustom: true,
    ...(entry.modelsEndpoint ? { modelsEndpoint: entry.modelsEndpoint } : {}),
    ...(entry.defaultTiers ? { defaultTiers: entry.defaultTiers } : {}),
  };
}

/**
 * Replace the user-defined provider cache.
 *
 * Every entry is re-validated here even though the parameter is typed, because
 * the data originates from a hand-editable JSON file and a single malformed
 * entry must not take the whole list down.
 *
 * Rejection rules (all non-throwing — a bad entry is skipped, not fatal):
 *   1. Fails {@link CustomProviderEntrySchema}.
 *   2. Id collides with a BUILT-IN provider id. Shadowing a built-in would let
 *      a settings file silently repoint `openrouter` (or any shipped entry) at
 *      an arbitrary host, so built-ins always win.
 *   3. Id collides with an earlier custom entry in the same array (first wins).
 *
 * @returns which entries were accepted and, for each rejection, why.
 */
export function setCustomProviderEntries(
  entries: readonly CustomProviderEntry[],
): SetCustomProviderEntriesResult {
  const accepted: CustomProviderEntry[] = [];
  const rejected: RejectedCustomProviderEntry[] = [];
  const seen = new Set<string>();

  for (const candidate of entries) {
    const parsed = CustomProviderEntrySchema.safeParse(candidate);
    if (!parsed.success) {
      const rawId =
        candidate && typeof candidate === 'object' && 'id' in candidate
          ? String((candidate as { id: unknown }).id)
          : '<unknown>';
      rejected.push({
        id: rawId,
        reason: parsed.error.issues
          .map(
            (issue) => `${issue.path.join('.') || 'entry'}: ${issue.message}`,
          )
          .join('; '),
      });
      continue;
    }

    const entry = parsed.data;
    if (isBuiltInProviderId(entry.id)) {
      rejected.push({
        id: entry.id,
        reason: `Id collides with a built-in provider and cannot shadow it`,
      });
      continue;
    }
    if (seen.has(entry.id)) {
      rejected.push({
        id: entry.id,
        reason: 'Duplicate custom provider id — the first entry wins',
      });
      continue;
    }

    seen.add(entry.id);
    accepted.push(entry);
  }

  customProviderEntries = accepted;
  customProviders = accepted.map(customEntryToAnthropicProvider);

  return { accepted, rejected };
}

/** Drop every user-defined entry (used on sign-out and by tests). */
export function clearCustomProviderEntries(): void {
  customProviderEntries = [];
  customProviders = [];
}

/** The raw stored entries — pricing and lane included, unlike the projection. */
export function getCustomProviderEntries(): readonly CustomProviderEntry[] {
  return customProviderEntries;
}

/** One stored entry by id, or undefined if it is not user-defined. */
export function getCustomProviderEntry(
  id: string,
): CustomProviderEntry | undefined {
  return customProviderEntries.find((entry) => entry.id === id);
}

/** True when `id` resolves to a user-defined entry rather than a built-in. */
export function isCustomProviderId(id: string): boolean {
  return customProviderEntries.some((entry) => entry.id === id);
}

/**
 * Every provider the app should offer: built-ins first, user-defined after.
 *
 * Use this — NOT `ANTHROPIC_PROVIDERS` — anywhere a list of providers is
 * enumerated (tile grids, key-status scans, did-you-mean suggestions). Direct
 * iteration of the static array is how a custom entry ends up working in one
 * surface and invisible in another.
 */
export function getAllAnthropicProviders(): AnthropicProvider[] {
  return [...ANTHROPIC_PROVIDERS, ...customProviders];
}

/**
 * Get a provider by ID
 *
 * Built-in registry first, then the user-defined cache — a custom entry can
 * never shadow a shipped one (the setter rejects colliding ids outright).
 *
 * @param id - Provider ID to look up
 * @returns Provider definition, or undefined if not found
 */
export function getAnthropicProvider(
  id: string,
): AnthropicProvider | undefined {
  const builtIn = ANTHROPIC_PROVIDERS.find((p) => p.id === id);
  if (builtIn) return builtIn;
  return customProviders.find((p) => p.id === id);
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
 * Whether a provider bills a flat subscription instead of per token.
 *
 * The one place this policy is read. Always asked about the ACTIVE provider —
 * never about the model id, which is ambiguous across providers.
 *
 * @param providerId - Provider ID, or null/undefined for direct Anthropic auth
 */
export function isSubscriptionCoveredProvider(
  providerId: string | null | undefined,
): boolean {
  if (!providerId) return false;
  return getAnthropicProvider(providerId)?.pricingModel === 'subscription';
}

/**
 * Seed the pricing map with static model pricing from a provider.
 *
 * Called during provider activation as a fallback for models not on OpenRouter.
 * Creates pricing map entries with both exact and normalized keys.
 *
 * Subscription-billed providers are skipped: their static entries carry $0,
 * and publishing that under a bare model id makes the next session on a
 * usage-billed provider serving the same id read as free. They take their
 * rates from the catalog like everyone else.
 *
 * @param providerId - Provider ID to seed pricing for
 */
export function seedStaticModelPricing(providerId: string): void {
  if (isSubscriptionCoveredProvider(providerId)) return;
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
    entries[model.id] = pricing;
    const lower = model.id.toLowerCase();
    if (lower !== model.id) {
      entries[lower] = pricing;
    }
  }

  if (Object.keys(entries).length > 0) {
    updatePricingMap(entries);
  }
}
