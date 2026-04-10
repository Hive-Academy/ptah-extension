/**
 * Local Model Provider Entries - TASK_2025_265
 *
 * Static provider definitions for Ollama and LM Studio.
 * Both are OpenAI-compatible local model servers that require no authentication.
 * Registered into the Anthropic-compatible provider registry.
 */

import type { AnthropicProvider } from '../helpers/anthropic-provider-registry';

/**
 * Ollama provider entry for the Anthropic-compatible provider registry.
 *
 * Key characteristics:
 * - `baseUrl`: Default Ollama endpoint (http://localhost:11434/v1)
 * - `authType: 'none'` -- no authentication required
 * - `requiresProxy: true` -- needs translation proxy (OpenAI -> Anthropic)
 * - `isLocal: true` -- runs on localhost, uses HTTP not HTTPS
 * - No static models -- models are fetched dynamically from Ollama's /v1/models
 */
export const OLLAMA_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'ollama',
  name: 'Ollama',
  baseUrl: 'http://localhost:11434/v1',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'none',
  requiresProxy: true,
  isLocal: true,
  keyPrefix: '',
  helpUrl: 'https://ollama.com',
  description: 'Run open-source models locally via Ollama',
  keyPlaceholder: 'No API key needed',
  maskedKeyDisplay: 'Local (no key)',
};

/**
 * LM Studio provider entry for the Anthropic-compatible provider registry.
 *
 * Key characteristics:
 * - `baseUrl`: Default LM Studio endpoint (http://localhost:1234/v1)
 * - `authType: 'none'` -- no authentication required
 * - `requiresProxy: true` -- needs translation proxy (OpenAI -> Anthropic)
 * - `isLocal: true` -- runs on localhost, uses HTTP not HTTPS
 * - No static models -- models are fetched dynamically from LM Studio's /v1/models
 */
export const LM_STUDIO_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'lm-studio',
  name: 'LM Studio',
  baseUrl: 'http://localhost:1234/v1',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'none',
  requiresProxy: true,
  isLocal: true,
  keyPrefix: '',
  helpUrl: 'https://lmstudio.ai',
  description: 'Run local models via LM Studio',
  keyPlaceholder: 'No API key needed',
  maskedKeyDisplay: 'Local (no key)',
};
