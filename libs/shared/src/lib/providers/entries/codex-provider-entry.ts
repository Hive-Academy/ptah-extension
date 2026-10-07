/**
 * Codex Provider Entry
 *
 * Static provider definition for OpenAI Codex.
 * Registered into the Anthropic-compatible provider registry.
 */

import type {
  AnthropicProvider,
  ProviderStaticModel,
} from '../provider-registry';

/**
 * Fallback model IDs for OpenAI Codex. Pricing is 0 since the subscription
 * covers usage (and `seedStaticModelPricing` skips subscription providers).
 *
 * This list is display and discovery-filter fallback only. It is NOT kept in
 * sync with anything and is not a source of context windows: every
 * `contextLength` is `0` (unknown). Real windows come only from the live
 * `/models` catalog read by `CodexAuthService.listModels` (codex-auth.service.ts),
 * recorded with `contextLengthSource: 'provider'`.
 *
 * The IDs and their order follow the `visibility: "list"` entries of the live
 * catalog (`codex debug models`, 2026-10-07). The previous `gpt-5.x-codex`
 * IDs now fail with "not supported when using Codex with a ChatGPT account".
 * `staticModels[0]` is the default-model fallback, so the catalog's first
 * model stays first.
 */
const CODEX_STATIC_MODELS: ProviderStaticModel[] = [
  {
    id: 'gpt-6.1-sol',
    name: 'GPT 6.1 Sol',
    description: 'Latest workhorse model for coding and everyday work',
    contextLength: 0,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-6-astra',
    name: 'GPT 6 Astra',
    description: 'GPT 6 Astra',
    contextLength: 0,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-6-sol',
    name: 'GPT 6 Sol',
    description: 'GPT 6 Sol',
    contextLength: 0,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT 6 Luna',
    description: 'GPT 6 Luna',
    contextLength: 0,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT 5.6 Sol',
    description: 'GPT 5.6 Sol',
    contextLength: 0,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT 5.6 Terra',
    description: 'GPT 5.6 Terra',
    contextLength: 0,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT 5.6 Luna',
    description: 'GPT 5.6 Luna',
    contextLength: 0,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
];

/**
 * Default model tier mappings for OpenAI Codex.
 * Auto-applied on first connection so users get the best models mapped immediately.
 */
export const CODEX_DEFAULT_TIERS = {
  sonnet: 'gpt-6-sol',
  opus: 'gpt-6.1-sol',
  haiku: 'gpt-6-luna',
} as const;

/**
 * OpenAI Codex provider entry for the Anthropic-compatible provider registry.
 *
 * Key differences from Copilot provider:
 * - `baseUrl` is empty -- set dynamically to the translation proxy URL at runtime
 * - `authType: 'oauth'` -- uses file-based OAuth from Codex CLI
 * - `requiresProxy: true` -- needs the translation proxy to convert protocols
 */
export const CODEX_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'openai-codex',
  name: 'OpenAI Codex',
  baseUrl: '',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'oauth',
  requiresProxy: true,
  keyPrefix: '',
  helpUrl: 'https://chatgpt.com/codex',
  description: 'GPT models via OpenAI Codex subscription',
  keyPlaceholder: 'Authenticated via Codex CLI',
  maskedKeyDisplay: 'Codex (connected)',
  staticModels: CODEX_STATIC_MODELS,
  defaultTiers: CODEX_DEFAULT_TIERS,
  pricingModel: 'subscription',
};
