/**
 * Copilot Provider Entry
 *
 * Static provider definition for GitHub Copilot.
 * Registered into the Anthropic-compatible provider registry.
 */

import type {
  AnthropicProvider,
  ProviderStaticModel,
} from '../_shared/provider-registry';

/**
 * All models available through GitHub Copilot (Claude, GPT, Gemini).
 * Pricing is 0 since Copilot subscription covers usage.
 *
 * Model list kept in sync with COPILOT_MODELS in copilot-sdk.adapter.ts.
 */
const COPILOT_STATIC_MODELS: ProviderStaticModel[] = [
  // --- Claude models ---
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    description: 'Latest Sonnet — fast and intelligent (200K context)',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-opus-4.7',
    name: 'Claude Opus 4.7',
    description: 'Latest Opus — highest intelligence (1M context)',
    contextLength: 1_000_000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-opus-4.5',
    name: 'Claude Opus 4.5',
    description: 'Previous-gen Opus — high intelligence (200K context)',
    contextLength: 200_000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    description: 'Previous-gen Sonnet — balanced performance (200K context)',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    description: 'Sonnet 4 — reliable and efficient (200K context)',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    description: 'Fast and lightweight (200K context)',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  // --- GPT models ---
  {
    id: 'gpt-5.4',
    name: 'GPT 5.4',
    description: 'Latest GPT — advanced reasoning',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT 5.3 Codex',
    description: 'GPT 5.3 optimized for code',
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
    description: 'GPT 5.2 — balanced performance',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.1-codex-max',
    name: 'GPT 5.1 Codex Max',
    description: 'GPT 5.1 Codex — maximum capability',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.1-codex',
    name: 'GPT 5.1 Codex',
    description: 'GPT 5.1 optimized for code',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.1-codex-mini',
    name: 'GPT 5.1 Codex Mini',
    description: 'GPT 5.1 Codex — lightweight and fast',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5.1',
    name: 'GPT 5.1',
    description: 'GPT 5.1 — reliable and efficient',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT 5 Mini',
    description: 'GPT 5 Mini — fast and lightweight',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT 4.1',
    description: 'GPT 4.1 — previous generation',
    contextLength: 128000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  // --- Gemini models ---
  {
    id: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro Preview',
    description: 'Google Gemini 3 Pro — advanced multimodal',
    contextLength: 128000,
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
};
