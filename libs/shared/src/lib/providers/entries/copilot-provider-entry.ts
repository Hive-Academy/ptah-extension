/**
 * Copilot Provider Entry
 *
 * Static provider definition for GitHub Copilot.
 * Registered into the Anthropic-compatible provider registry.
 */

import type {
  AnthropicProvider,
  ProviderStaticModel,
} from '../provider-registry';

/**
 * All models available through GitHub Copilot (Claude, GPT, Gemini).
 * Pricing is 0 since Copilot subscription covers usage.
 *
 * Model list kept in sync with COPILOT_MODELS in copilot-sdk.adapter.ts.
 * Synced with models.dev `github-copilot` on 2026-10-07; the model-list drift
 * check (model-lists.live.spec.ts) fails when an ID here stops being listed.
 */
const COPILOT_STATIC_MODELS: ProviderStaticModel[] = [
  {
    id: 'claude-opus-5.5',
    name: 'Claude Opus 5.5',
    description: 'Claude Opus 5.5 via GitHub Copilot',
    contextLength: 1000000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-sonnet-5.5',
    name: 'Claude Sonnet 5.5',
    description: 'Claude Sonnet 5.5 via GitHub Copilot',
    contextLength: 1000000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-fable-5.1',
    name: 'Claude Fable 5.1',
    description: 'Claude Fable 5.1 via GitHub Copilot',
    contextLength: 1000000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    description: 'Claude Opus 5 via GitHub Copilot',
    contextLength: 1000000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    description: 'Claude Sonnet 5 via GitHub Copilot',
    contextLength: 1000000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    description: 'Claude Fable 5 via GitHub Copilot',
    contextLength: 1000000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-opus-4.8',
    name: 'Claude Opus 4.8',
    description: 'Claude Opus 4.8 via GitHub Copilot',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-opus-4.7',
    name: 'Claude Opus 4.7',
    description: 'Claude Opus 4.7 via GitHub Copilot',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    description: 'Claude Sonnet 4.6 via GitHub Copilot',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    description: 'Claude Haiku 4.5 via GitHub Copilot',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    description: 'GPT-6.1 Sol via GitHub Copilot',
    contextLength: 1050000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-6-sol',
    name: 'GPT-6 Sol',
    description: 'GPT-6 Sol via GitHub Copilot',
    contextLength: 1050000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    description: 'GPT-6 Astra via GitHub Copilot',
    contextLength: 1050000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna',
    description: 'GPT-6 Luna via GitHub Copilot',
    contextLength: 1050000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    description: 'GPT-5.6 Sol via GitHub Copilot',
    contextLength: 1050000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    description: 'GPT-5.6 Terra via GitHub Copilot',
    contextLength: 1050000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    description: 'GPT-5.6 Luna via GitHub Copilot',
    contextLength: 1050000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    description: 'GPT-5.5 via GitHub Copilot',
    contextLength: 1050000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    description: 'GPT-5.4 via GitHub Copilot',
    contextLength: 1050000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 mini',
    description: 'GPT-5.4 mini via GitHub Copilot',
    contextLength: 400000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.4-nano',
    name: 'GPT-5.4 nano',
    description: 'GPT-5.4 nano via GitHub Copilot',
    contextLength: 400000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    description: 'GPT-5.3 Codex via GitHub Copilot',
    contextLength: 400000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    description: 'GPT-5 Mini via GitHub Copilot',
    contextLength: 264000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description: 'Gemini 3.8 Flash via GitHub Copilot',
    contextLength: 1000000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    description: 'Gemini 3.7 Flash via GitHub Copilot',
    contextLength: 1000000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    description: 'Gemini 3.6 Flash via GitHub Copilot',
    contextLength: 1000000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    description: 'Gemini 3.5 Flash via GitHub Copilot',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'grok-4.7',
    name: 'Grok 4.7',
    description: 'Grok 4.7 via GitHub Copilot',
    contextLength: 500000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'grok-4.6',
    name: 'Grok 4.6',
    description: 'Grok 4.6 via GitHub Copilot',
    contextLength: 500000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'grok-4.5',
    name: 'Grok 4.5',
    description: 'Grok 4.5 via GitHub Copilot',
    contextLength: 500000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    description: 'Kimi K3 via GitHub Copilot',
    contextLength: 1048576,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    description: 'Kimi K2.7 Code via GitHub Copilot',
    contextLength: 256000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'mai-code-1.1-flash',
    name: 'MAI-Code-1.1-Flash',
    description: 'MAI-Code-1.1-Flash via GitHub Copilot',
    contextLength: 256000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'mai-code-1-flash-picker',
    name: 'MAI-Code-1-Flash',
    description: 'MAI-Code-1-Flash via GitHub Copilot',
    contextLength: 256000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
];

/**
 * GitHub Copilot provider entry for the Anthropic-compatible provider registry.
 *
 * Key differences from other providers:
 * - `baseUrl` is empty — set dynamically to the translation proxy URL at runtime
 * - `authType: 'oauth'` — uses GitHub OAuth instead of API key input
 * - `requiresProxy: true` — needs the translation proxy to convert protocols
 */
/**
 * Default model tier mappings for GitHub Copilot.
 * Auto-applied on first login so users get the best models mapped immediately.
 *
 * IMPORTANT: These default to GPT models, NOT Claude. Claude models via Copilot
 * consume 5-10x more premium requests than GPT equivalents. Since the Claude
 * Agent SDK spawns subagents using tier aliases (sonnet/opus/haiku), every
 * subagent would silently use Claude at inflated rates if these defaulted
 * to Claude models — even when the user selected a GPT model for the main session.
 *
 * Users who prefer Claude through Copilot can manually configure tiers in the UI.
 */
export const COPILOT_DEFAULT_TIERS = {
  sonnet: 'gpt-5.4',
  opus: 'gpt-5.4',
  haiku: 'gpt-5-mini',
} as const;

export const COPILOT_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'github-copilot',
  name: 'GitHub Copilot',
  baseUrl: '',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'oauth',
  requiresProxy: true,
  keyPrefix: '',
  helpUrl: 'https://github.com/features/copilot',
  description: 'Claude models via GitHub Copilot subscription',
  keyPlaceholder: 'Authenticated via GitHub',
  maskedKeyDisplay: 'GitHub Copilot (connected)',
  staticModels: COPILOT_STATIC_MODELS,
  defaultTiers: COPILOT_DEFAULT_TIERS,
  pricingModel: 'subscription',
};
