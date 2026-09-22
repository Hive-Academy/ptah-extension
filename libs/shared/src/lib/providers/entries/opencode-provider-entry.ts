/**
 * OpenCode Provider Entries
 *
 * Static provider definitions for OpenCode Zen and OpenCode Go.
 * Registered into the Anthropic-compatible provider registry.
 *
 * OpenCode Zen:
 * - Pay-as-you-go / usage-billed (`pricingModel: 'usage'`)
 * - Base URL: https://opencode.ai/zen/v1
 * - Key: User-provided remote key via OPENCODE_API_KEY
 * - Multi-protocol routing via local translation proxy
 *
 * OpenCode Go:
 * - Flat $10/month subscription (`pricingModel: 'subscription'`)
 * - Base URL: https://opencode.ai/zen/go/v1
 * - Key: User-provided separate Go key
 * - Kept OUT of the shared pricing map (`isSubscriptionCoveredProvider` guard)
 * - Multi-protocol routing via local translation proxy
 *
 * Both entries omit `modelsEndpoint` in this release, serving static models
 * derived strictly from the reviewed routing tables.
 *
 * Excluded models (7 Google generateContent, 2 Jev systemone) are omitted
 * from static models and default tiers.
 *
 * @see TASK_2026_526
 */

import type {
  AnthropicProvider,
  ProviderStaticModel,
} from '../provider-registry';
import {
  OPENCODE_MODEL_ROUTES,
  type OpenCodeProviderId,
} from './opencode-model-routes';

/**
 * Default model tier mappings for OpenCode Zen.
 * All Zen tier defaults route to native Anthropic Messages.
 */
export const OPENCODE_ZEN_DEFAULT_TIERS = {
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5',
  haiku: 'claude-haiku-4-5',
} as const;

/**
 * Default model tier mappings for OpenCode Go.
 * All Go tier defaults route to OpenAI Chat Completions.
 */
export const OPENCODE_GO_DEFAULT_TIERS = {
  sonnet: 'glm-5.3',
  opus: 'kimi-k3',
  haiku: 'glm-5.3-flash',
} as const;

/**
 * Build static models for an OpenCode subscription from its route table.
 *
 * Context length and tool use are set to unverified defaults (0 and false)
 * until independent capability evidence exists. Cost fields are intentionally
 * omitted so `seedStaticModelPricing` never seeds unverified prices.
 */
function buildOpenCodeStaticModels(
  providerId: OpenCodeProviderId,
  subscriptionLabel: string,
): ProviderStaticModel[] {
  const routes = OPENCODE_MODEL_ROUTES[providerId];
  return Object.keys(routes).map((id) => ({
    id,
    name: id,
    description: `${id} via OpenCode ${subscriptionLabel} (unverified capability metadata)`,
    contextLength: 0,
    supportsToolUse: false,
  }));
}

export const OPENCODE_ZEN_STATIC_MODELS: ProviderStaticModel[] =
  buildOpenCodeStaticModels('opencode-zen', 'Zen');

export const OPENCODE_GO_STATIC_MODELS: ProviderStaticModel[] =
  buildOpenCodeStaticModels('opencode-go', 'Go');

/**
 * OpenCode Zen provider entry.
 */
export const OPENCODE_ZEN_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'opencode-zen',
  name: 'OpenCode Zen',
  baseUrl: 'https://opencode.ai/zen/v1',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'apiKey',
  requiresProxy: true,
  isLocal: false,
  keyPrefix: '',
  helpUrl: 'https://opencode.ai/docs/zen/',
  description:
    'Usage-billed OpenCode models via Messages, Chat Completions and Responses. Gemini and Jev are not supported.',
  keyPlaceholder: 'Enter OpenCode Zen API key...',
  maskedKeyDisplay: '••••••••',
  pricingModel: 'usage',
  defaultTiers: OPENCODE_ZEN_DEFAULT_TIERS,
  staticModels: OPENCODE_ZEN_STATIC_MODELS,
};

/**
 * OpenCode Go provider entry.
 *
 * OpenCode Go is a flat $10/month subscription, so its entry carries
 * `pricingModel: 'subscription'` and stays OUT of the shared pricing map.
 */
export const OPENCODE_GO_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'opencode-go',
  name: 'OpenCode Go',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'apiKey',
  requiresProxy: true,
  isLocal: false,
  keyPrefix: '',
  helpUrl: 'https://opencode.ai/docs/go/',
  description:
    'OpenCode Go, $10/month with a separate Go key. Messages, Chat Completions and Responses; Gemini and Jev are not supported.',
  keyPlaceholder: 'Enter OpenCode Go API key...',
  maskedKeyDisplay: '••••••••',
  pricingModel: 'subscription',
  defaultTiers: OPENCODE_GO_DEFAULT_TIERS,
  staticModels: OPENCODE_GO_STATIC_MODELS,
};
