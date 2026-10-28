/**
 * Kimi Code Provider Entry
 *
 * Static provider definition for the Kimi Code subscription, registered into
 * the Anthropic-compatible provider registry.
 *
 * - Flat subscription (`pricingModel: 'subscription'`). The static models carry
 *   no per-token cost, so cost renders as unavailable instead of a fake amount,
 *   and `seedStaticModelPricing` keeps them out of the shared pricing map.
 * - Base URL: https://api.kimi.ai/coding/ (Anthropic Messages endpoint).
 * - Auth: `authType: 'oauth'` + `requiresProxy: true`. The SDK talks to a local
 *   Kimi Code proxy that relays Messages requests unchanged and attaches a
 *   fresh credential per request: the Kimi Code CLI sign-in
 *   (`~/.kimi-code/credentials`, refreshed and written back by Ptah) first,
 *   and the stored Kimi Code API key as a fallback (`apiKeyFallback`).
 * - `authEnvVar: 'ANTHROPIC_API_KEY'` (sent as `x-api-key`) is used by the
 *   direct key paths: draft verification, connection check and Ptah CLI
 *   agents.
 * - No `modelsEndpoint`: the dynamic fetch sends `Authorization: Bearer`, and a
 *   live list would replace the static `capabilities` below.
 * - `keyPrefix` is empty: Kimi Code keys have no documented stable prefix.
 *
 * Model availability depends on the subscription plan; each model description
 * names its plan gate. Lowest-plan users must remap opus and sonnet to
 * `kimi-for-coding`.
 *
 * @see https://www.kimi.com/code
 */

import type { ModelCapability } from '../../types/auth-env.types';
import type {
  AnthropicProvider,
  ProviderStaticModel,
} from '../provider-registry';

/**
 * Capabilities every Kimi Code model declares to the runtime through
 * `ANTHROPIC_DEFAULT_<TIER>_MODEL_SUPPORTED_CAPABILITIES`. The runtime does not
 * recognise non-Claude ids, so without this list it drops effort and thinking.
 * `adaptive_thinking` is deliberately absent, so the runtime sends `enabled`
 * thinking.
 */
export const KIMI_CODE_MODEL_CAPABILITIES: readonly ModelCapability[] = [
  'thinking',
  'interleaved_thinking',
  'effort',
  'xhigh_effort',
  'max_effort',
];

/**
 * Default model tier mappings for Kimi Code.
 *
 * Haiku carries every internal one-shot query, which the runtime sends with
 * thinking disabled, so it must be a model that accepts thinking-off
 * (`k3.1-pro` is thinking-only).
 */
export const KIMI_CODE_DEFAULT_TIERS = {
  sonnet: 'k3',
  opus: 'k3.1-pro',
  haiku: 'kimi-for-coding',
} as const;

const KIMI_CODE_STATIC_MODELS: ProviderStaticModel[] = [
  {
    id: 'k3.1-pro',
    name: 'K3.1 Pro',
    description: 'Thinking-only flagship (256K). Plus/Moderato plan or higher',
    contextLength: 262144,
    supportsToolUse: true,
    capabilities: KIMI_CODE_MODEL_CAPABILITIES,
  },
  {
    id: 'k3.1-pro[1m]',
    name: 'K3.1 Pro (1M)',
    description: '1M-context K3.1 Pro. Pro/Allegretto plan or higher',
    contextLength: 1048576,
    supportsToolUse: true,
    capabilities: KIMI_CODE_MODEL_CAPABILITIES,
  },
  {
    id: 'k3.1-pro-highspeed',
    name: 'K3.1 Pro Highspeed',
    description: 'Low-latency K3.1 Pro. Pro/Allegretto plan or higher',
    contextLength: 1048576,
    supportsToolUse: true,
    capabilities: KIMI_CODE_MODEL_CAPABILITIES,
  },
  {
    id: 'k3',
    name: 'K3',
    description: 'K3 (up to 1M on higher plans). Plus plan or higher',
    contextLength: 262144,
    supportsToolUse: true,
    capabilities: KIMI_CODE_MODEL_CAPABILITIES,
  },
  {
    id: 'k3-256k',
    name: 'K3 256K',
    description: 'K3 pinned to 256K. Plus plan or higher',
    contextLength: 262144,
    supportsToolUse: true,
    capabilities: KIMI_CODE_MODEL_CAPABILITIES,
  },
  {
    id: 'kimi-for-coding',
    name: 'Kimi for Coding',
    description: 'Available on every plan (Andante+)',
    contextLength: 1048576,
    supportsToolUse: true,
    capabilities: KIMI_CODE_MODEL_CAPABILITIES,
  },
  {
    id: 'kimi-for-coding-highspeed',
    name: 'Kimi for Coding Highspeed',
    description: 'Low-latency. Pro/Allegretto plan or higher',
    contextLength: 262144,
    supportsToolUse: true,
    capabilities: KIMI_CODE_MODEL_CAPABILITIES,
  },
];

/** Kimi Code provider entry. */
export const KIMI_CODE_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'kimi-code',
  name: 'Kimi Code',
  baseUrl: 'https://api.kimi.ai/coding/',
  authEnvVar: 'ANTHROPIC_API_KEY',
  authType: 'oauth',
  requiresProxy: true,
  apiKeyFallback: true,
  isLocal: false,
  keyPrefix: '',
  helpUrl: 'https://www.kimi.com/code',
  description:
    'Kimi Code subscription (K3.1 Pro, K3, Kimi for Coding) with Kimi Code CLI sign-in, or an API key',
  keyPlaceholder: 'Optional: Kimi Code API key',
  maskedKeyDisplay: '••••••••••••',
  pricingModel: 'subscription',
  defaultTiers: KIMI_CODE_DEFAULT_TIERS,
  staticModels: KIMI_CODE_STATIC_MODELS,
};
