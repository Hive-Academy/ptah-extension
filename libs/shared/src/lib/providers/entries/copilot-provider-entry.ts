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

/** Every Copilot model takes tool calls and costs 0: the subscription covers usage. */
function copilotModel(
  id: string,
  name: string,
  contextLength: number,
): ProviderStaticModel {
  return {
    id,
    name,
    description: `${name} via GitHub Copilot`,
    contextLength,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  };
}

/**
 * All models available through GitHub Copilot (Claude, GPT, Gemini).
 * Pricing is 0 since Copilot subscription covers usage.
 *
 * Model list kept in sync with COPILOT_MODELS in copilot-sdk.adapter.ts.
 * Synced with models.dev `github-copilot` on 2026-10-07; the model-list drift
 * check (model-lists.live.spec.ts) fails when an ID here stops being listed.
 */
const COPILOT_STATIC_MODELS: ProviderStaticModel[] = [
  copilotModel('claude-opus-5.5', 'Claude Opus 5.5', 1_000_000),
  copilotModel('claude-sonnet-5.5', 'Claude Sonnet 5.5', 1_000_000),
  copilotModel('claude-fable-5.1', 'Claude Fable 5.1', 1_000_000),
  copilotModel('claude-opus-5', 'Claude Opus 5', 1_000_000),
  copilotModel('claude-sonnet-5', 'Claude Sonnet 5', 1_000_000),
  copilotModel('claude-fable-5', 'Claude Fable 5', 1_000_000),
  copilotModel('claude-opus-4.8', 'Claude Opus 4.8', 200_000),
  copilotModel('claude-opus-4.7', 'Claude Opus 4.7', 200_000),
  copilotModel('claude-sonnet-4.6', 'Claude Sonnet 4.6', 200_000),
  copilotModel('claude-haiku-4.5', 'Claude Haiku 4.5', 200_000),
  copilotModel('gpt-6.1-sol', 'GPT-6.1 Sol', 1_050_000),
  copilotModel('gpt-6-sol', 'GPT-6 Sol', 1_050_000),
  copilotModel('gpt-6-astra', 'GPT-6 Astra', 1_050_000),
  copilotModel('gpt-6-luna', 'GPT-6 Luna', 1_050_000),
  copilotModel('gpt-5.6-sol', 'GPT-5.6 Sol', 1_050_000),
  copilotModel('gpt-5.6-terra', 'GPT-5.6 Terra', 1_050_000),
  copilotModel('gpt-5.6-luna', 'GPT-5.6 Luna', 1_050_000),
  copilotModel('gpt-5.5', 'GPT-5.5', 1_050_000),
  copilotModel('gpt-5.4', 'GPT-5.4', 1_050_000),
  copilotModel('gpt-5.4-mini', 'GPT-5.4 mini', 400_000),
  copilotModel('gpt-5.4-nano', 'GPT-5.4 nano', 400_000),
  copilotModel('gpt-5.3-codex', 'GPT-5.3 Codex', 400_000),
  copilotModel('gpt-5-mini', 'GPT-5 Mini', 264_000),
  copilotModel('gemini-3.8-flash', 'Gemini 3.8 Flash', 1_000_000),
  copilotModel('gemini-3.7-flash', 'Gemini 3.7 Flash', 1_000_000),
  copilotModel('gemini-3.6-flash', 'Gemini 3.6 Flash', 1_000_000),
  copilotModel('gemini-3.5-flash', 'Gemini 3.5 Flash', 200_000),
  copilotModel('grok-4.7', 'Grok 4.7', 500_000),
  copilotModel('grok-4.6', 'Grok 4.6', 500_000),
  copilotModel('grok-4.5', 'Grok 4.5', 500_000),
  copilotModel('kimi-k3', 'Kimi K3', 1_048_576),
  copilotModel('kimi-k2.7-code', 'Kimi K2.7 Code', 256_000),
  copilotModel('mai-code-1.1-flash', 'MAI-Code-1.1-Flash', 256_000),
  copilotModel('mai-code-1-flash-picker', 'MAI-Code-1-Flash', 256_000),
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
