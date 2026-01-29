/**
 * Anthropic-Compatible Provider Registry (TASK_2025_129 Batch 3)
 *
 * Registry of providers that implement the Anthropic API protocol,
 * allowing Claude Agent SDK to route through them using:
 * - ANTHROPIC_BASE_URL: Provider's API endpoint
 * - ANTHROPIC_AUTH_TOKEN: Provider's API key
 *
 * All registered providers follow the same env var pattern, differing
 * only in base URL and key format.
 *
 * Known providers:
 * - OpenRouter: Multi-model access (200+ models)
 * - Moonshot (Kimi): Anthropic-compatible endpoint
 * - Z.AI (GLM): Anthropic-compatible endpoint
 *
 * @see https://openrouter.ai/docs/guides/claude-code-integration
 * @see https://platform.moonshot.ai/docs/guide/agent-support.en-US
 * @see https://docs.z.ai/devpack/tool/claude
 */

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
}

/**
 * Registry of known Anthropic-compatible providers
 *
 * To add a new provider:
 * 1. Add an entry to this array
 * 2. No other code changes required - the registry drives all behavior
 */
export const ANTHROPIC_PROVIDERS: readonly AnthropicProvider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    keyPrefix: 'sk-or-',
    helpUrl: 'https://openrouter.ai/keys',
    description: 'Access 200+ models via unified API',
    keyPlaceholder: 'sk-or-v1-...',
    maskedKeyDisplay: 'sk-or-••••••••••••',
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.ai/anthropic/',
    keyPrefix: '',
    helpUrl: 'https://platform.moonshot.ai/console/api-keys',
    description: 'Kimi models via Anthropic-compatible API',
    keyPlaceholder: 'Enter Moonshot API key...',
    maskedKeyDisplay: '••••••••••••',
  },
  {
    id: 'z-ai',
    name: 'Z.AI (GLM)',
    baseUrl: 'https://api.z.ai/api/anthropic',
    keyPrefix: '',
    helpUrl: 'https://open.z.ai/open/api/openkey',
    description: 'GLM models via Anthropic-compatible API',
    keyPlaceholder: 'Enter Z.AI API key...',
    maskedKeyDisplay: '••••••••••••',
  },
] as const;

/** Provider IDs as a union type */
export type AnthropicProviderId = (typeof ANTHROPIC_PROVIDERS)[number]['id'];

/** Default provider when none is configured */
export const DEFAULT_PROVIDER_ID: AnthropicProviderId = 'openrouter';

/**
 * Get a provider by ID
 *
 * @param id - Provider ID to look up
 * @returns Provider definition, or undefined if not found
 */
export function getAnthropicProvider(
  id: string
): AnthropicProvider | undefined {
  return ANTHROPIC_PROVIDERS.find((p) => p.id === id);
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
  // Fallback to default provider (OpenRouter)
  const defaultProvider = getAnthropicProvider(DEFAULT_PROVIDER_ID);
  return defaultProvider!.baseUrl;
}
