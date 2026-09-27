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
 * `gpt-5.4` must stay first: `staticModels[0]` is the default-model fallback.
 * Append new IDs at the end.
 */
const CODEX_STATIC_MODELS: ProviderStaticModel[] = [
  {
    id: 'gpt-5.4',
    name: 'GPT 5.4',
    description: 'Latest GPT -- advanced reasoning',
    contextLength: 0,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT 5.3 Codex',
    description: 'GPT 5.3 optimized for code (current default)',
    contextLength: 0,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.2-codex',
    name: 'GPT 5.2 Codex',
    description: 'GPT 5.2 optimized for code',
    contextLength: 0,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.2',
    name: 'GPT 5.2',
    description: 'GPT 5.2 -- balanced performance',
    contextLength: 0,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'GPT 5.1 Codex Max',
    description: 'GPT 5.1 Codex -- maximum capability',
    contextLength: 0,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.1-codex-mini',
    name: 'GPT 5.1 Codex Mini',
    description: 'GPT 5.1 Codex -- lightweight and fast',
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
    id: 'gpt-5.6-sol',
    name: 'GPT 5.6 Sol',
    description: 'GPT 5.6 Sol',
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
  sonnet: 'gpt-5.3-codex',
  opus: 'gpt-5.4',
  haiku: 'gpt-5.1-codex-mini',
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
