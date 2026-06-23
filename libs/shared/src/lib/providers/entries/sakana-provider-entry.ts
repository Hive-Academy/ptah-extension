/**
 * Sakana Provider Entry
 *
 * Static provider definition for Sakana AI's "Fugu" models.
 * Registered into the Anthropic-compatible provider registry.
 *
 * Sakana exposes an OpenAI-compatible API (Chat Completions + Responses) at
 * https://api.sakana.ai/v1 with Bearer authentication. It is the first
 * provider combining `authType: 'apiKey'` (a user-provided remote key) with
 * `requiresProxy: true` (a local translation proxy converts Anthropic
 * Messages -> OpenAI Chat Completions). Tier mapping is driven entirely by
 * `defaultTiers`; the static model list provides tool-use metadata and an
 * offline/no-key fallback while `modelsEndpoint` enables live model discovery
 * (including dated aliases such as `fugu-ultra-20260615`).
 *
 * Pricing is unpublished, so cost fields are intentionally omitted —
 * `seedStaticModelPricing` safely skips models without cost data.
 */

import type {
  AnthropicProvider,
  ProviderStaticModel,
} from '../provider-registry';

/**
 * Static model list for Sakana — used as the always-available fallback (no key
 * / offline) and as the source of tool-use + context metadata that the OpenAI
 * `/v1/models` response omits. `mergeStaticMetadata` ORs `supportsToolUse: true`
 * back into the dynamic list.
 */
const SAKANA_STATIC_MODELS: ProviderStaticModel[] = [
  {
    id: 'fugu',
    name: 'Fugu',
    description: 'Sakana Fugu — default routing model',
    contextLength: 200000,
    supportsToolUse: true,
  },
  {
    id: 'fugu-ultra',
    name: 'Fugu Ultra',
    description: 'Sakana Fugu Ultra — highest-capability model',
    contextLength: 200000,
    supportsToolUse: true,
  },
];

/**
 * Default model tier mappings for Sakana.
 * Auto-applied on first provider selection so "Default (recommended)" resolves
 * to the provider's best model. `autoResolveDefaultTiers()` only matches
 * `claude.*(sonnet|opus|haiku)`, so Fugu falls back to these explicit mappings.
 */
export const SAKANA_DEFAULT_TIERS = {
  sonnet: 'fugu',
  opus: 'fugu-ultra',
  haiku: 'fugu',
} as const;

/**
 * Sakana (Fugu) provider entry for the Anthropic-compatible provider registry.
 *
 * Key characteristics:
 * - `baseUrl`: Sakana's OpenAI-compatible endpoint (https://api.sakana.ai/v1)
 * - `authType: 'apiKey'` -- user-provided Bearer key
 * - `requiresProxy: true` -- needs the translation proxy (OpenAI -> Anthropic)
 * - `isLocal: false` -- remote API
 * - `modelsEndpoint` -- enables dynamic listing via the generic
 *   ProviderModelsService path (incl. dated aliases like `fugu-ultra-20260615`)
 */
export const SAKANA_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'sakana',
  name: 'Sakana (Fugu)',
  baseUrl: 'https://api.sakana.ai/v1',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'apiKey',
  requiresProxy: true,
  isLocal: false,
  keyPrefix: '',
  helpUrl: 'https://console.sakana.ai/api-keys',
  description: 'Fugu models via Sakana AI',
  keyPlaceholder: 'Enter Sakana API key...',
  maskedKeyDisplay: '••••••••••••',
  modelsEndpoint: 'https://api.sakana.ai/v1/models',
  defaultTiers: SAKANA_DEFAULT_TIERS,
  staticModels: SAKANA_STATIC_MODELS,
};
