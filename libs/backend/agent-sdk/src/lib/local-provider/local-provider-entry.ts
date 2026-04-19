/**
 * Local Model Provider Entries - TASK_2025_265, updated TASK_2025_281
 *
 * Static provider definitions for Ollama (local + cloud) and LM Studio.
 * Ollama providers use Anthropic-native API (no proxy); LM Studio uses OpenAI translation proxy.
 * Registered into the Anthropic-compatible provider registry.
 */

import type { AnthropicProvider } from '../helpers/anthropic-provider-registry';

/**
 * Ollama provider entry — LOCAL models via Anthropic-native API.
 *
 * Key characteristics:
 * - `baseUrl`: Default Ollama endpoint (http://localhost:11434) — NOT /v1
 * - `authType: 'none'` -- no authentication required
 * - `requiresProxy: false` -- Ollama v0.14.0+ speaks Anthropic Messages API natively
 * - `isLocal: true` -- runs on localhost, uses HTTP not HTTPS
 * - `staticModels` -- defensive fallback shown when Ollama is offline / discovery
 *   hasn't run yet. Dynamic discovery via OllamaModelDiscoveryService takes
 *   precedence when available and returns the user's actual installed models.
 */
export const OLLAMA_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'ollama',
  name: 'Ollama',
  baseUrl: 'http://localhost:11434',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'none',
  requiresProxy: false,
  isLocal: true,
  keyPrefix: '',
  helpUrl: 'https://ollama.com',
  description: 'Run open-source models locally via Ollama',
  keyPlaceholder: 'No API key needed',
  maskedKeyDisplay: 'Local (no key)',
  // Defensive fallback list of commonly-installed Ollama models.
  // Shown only if the dynamic discovery service is unavailable (e.g., Ollama
  // not running). Users can pull any of these via `ollama pull <model>`.
  staticModels: [
    {
      id: 'llama3.1:8b',
      name: 'Llama 3.1 8B',
      description: '8B \u2022 128K context \u2022 tools',
      contextLength: 128000,
      supportsToolUse: true,
    },
    {
      id: 'qwen2.5-coder:7b',
      name: 'Qwen2.5 Coder 7B',
      description: '7B \u2022 32K context \u2022 tools',
      contextLength: 32768,
      supportsToolUse: true,
    },
    {
      id: 'deepseek-r1:14b',
      name: 'DeepSeek R1 14B',
      description: '14B \u2022 128K context \u2022 thinking',
      contextLength: 131072,
      supportsToolUse: false,
    },
    {
      id: 'qwen3:8b',
      name: 'Qwen3 8B',
      description: '8B \u2022 128K context \u2022 tools',
      contextLength: 128000,
      supportsToolUse: true,
    },
    {
      id: 'devstral',
      name: 'Devstral',
      description: '24B \u2022 128K context \u2022 tools',
      contextLength: 128000,
      supportsToolUse: true,
    },
  ],
  defaultTiers: {
    haiku: 'qwen3:8b',
    sonnet: 'devstral',
    opus: 'qwen3:32b',
  },
};

/**
 * Ollama Cloud provider entry — CLOUD models via Ollama's cloud proxy.
 *
 * Key characteristics:
 * - `baseUrl`: Same localhost endpoint (cloud requests proxied by local Ollama)
 * - `authType: 'none'` -- auth handled by `ollama signin` (stored locally)
 * - `requiresProxy: false` -- Anthropic-native API
 * - `isLocal: false` -- inference runs in the cloud (free tier ~30K req/mo)
 * - Cloud models use `:cloud` suffix (e.g., `kimi-k2.5:cloud`, `glm-5:cloud`)
 */
export const OLLAMA_CLOUD_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'ollama-cloud',
  name: 'Ollama Cloud',
  baseUrl: 'http://localhost:11434',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'none',
  requiresProxy: false,
  isLocal: false,
  keyPrefix: '',
  helpUrl: 'https://ollama.com/blog/ollama-cloud',
  description: 'Run cloud GPU models via Ollama Cloud (free tier available)',
  keyPlaceholder: 'No API key needed — sign in via `ollama signin`',
  maskedKeyDisplay: 'Cloud (ollama signin)',
  defaultTiers: {
    haiku: 'ministral-3:cloud',
    sonnet: 'kimi-k2.5:cloud',
    opus: 'deepseek-v3.2:cloud',
  },
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
