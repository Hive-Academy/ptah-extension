/**
 * Codex Provider Entry
 *
 * Static provider definition for OpenAI Codex.
 * Registered into the Anthropic-compatible provider registry.
 */

import type { AnthropicProvider } from '../provider-registry';

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
 *
 * No `staticModels`: a hardcoded ID list would hide every future OpenAI model
 * until a Ptah release. Visible models come only from dynamic discovery: the
 * selected app-server catalog (`model/list`) and the account API
 * (`CodexAuthService.listModels`, codex-home-auth.service.ts). A model that
 * discovery does not return stays hidden rather than guessed.
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
  defaultTiers: CODEX_DEFAULT_TIERS,
  pricingModel: 'subscription',
};