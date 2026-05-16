/**
 * Codex Provider Entry
 *
 * Static provider definition for OpenAI Codex.
 * Registered into the Anthropic-compatible provider registry.
 */

import type {
  AnthropicProvider,
  ProviderStaticModel,
} from '../_shared/provider-registry';

/**
 * All models available through OpenAI Codex subscription.
 * Pricing is 0 since Codex subscription covers usage.
 *
 * Model list kept in sync with SUPPORTED_MODELS in codex-cli.adapter.ts.
 */
const CODEX_STATIC_MODELS: ProviderStaticModel[] = [
  {
    id: 'gpt-5.4',
    name: 'GPT 5.4',
    description: 'Latest GPT -- advanced reasoning',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT 5.3 Codex',
    description: 'GPT 5.3 optimized for code (current default)',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.2-codex',
    name: 'GPT 5.2 Codex',
    description: 'GPT 5.2 optimized for code',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.2',
    name: 'GPT 5.2',
    description: 'GPT 5.2 -- balanced performance',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'GPT 5.1 Codex Max',
    description: 'GPT 5.1 Codex -- maximum capability',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.1-codex-mini',
    name: 'GPT 5.1 Codex Mini',
    description: 'GPT 5.1 Codex -- lightweight and fast',
    contextLength: 128000,
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
};
