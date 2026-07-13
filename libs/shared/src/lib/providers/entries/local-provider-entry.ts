/**
 * Local Model Provider Entries
 *
 * Static provider definitions for Ollama (local + cloud) and LM Studio.
 * Ollama providers use Anthropic-native API (no proxy); LM Studio uses OpenAI translation proxy.
 * Registered into the Anthropic-compatible provider registry.
 */

import type { AnthropicProvider } from '../provider-registry';

/**
 * Hosted ollama.com endpoint used for DIRECT Ollama Cloud inference when the
 * user has stored an API key. Speaks the Anthropic Messages API
 * (`/v1/messages`) with `Authorization: Bearer <key>` — no local daemon
 * involved.
 */
export const OLLAMA_CLOUD_DIRECT_BASE_URL = 'https://ollama.com';

/**
 * Ollama provider entry — LOCAL models via Anthropic-native API.
 *
 * Key characteristics:
 * - `baseUrl`: Default Ollama endpoint (http://127.0.0.1:11434) — NOT /v1.
 *   Deliberately IPv4-literal, not `localhost`: Ollama binds 127.0.0.1 only,
 *   and `localhost` resolves to `::1` first on Windows, where an unrelated
 *   listener (WSL relay / Docker port-forward) can shadow the real daemon.
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
  baseUrl: 'http://127.0.0.1:11434',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'none',
  requiresProxy: false,
  isLocal: true,
  keyPrefix: '',
  helpUrl: 'https://ollama.com',
  description: 'Run open-source models locally via Ollama',
  keyPlaceholder: 'No API key needed',
  maskedKeyDisplay: 'Local (no key)',
  staticModels: [
    {
      id: 'llama3.1:8b',
      name: 'Llama 3.1 8B',
      description: '8B • 128K context • tools',
      contextLength: 128000,
      supportsToolUse: true,
    },
    {
      id: 'qwen2.5-coder:7b',
      name: 'Qwen2.5 Coder 7B',
      description: '7B • 32K context • tools',
      contextLength: 32768,
      supportsToolUse: true,
    },
    {
      id: 'deepseek-r1:14b',
      name: 'DeepSeek R1 14B',
      description: '14B • 128K context • thinking',
      contextLength: 131072,
      supportsToolUse: false,
    },
    {
      id: 'qwen3:8b',
      name: 'Qwen3 8B',
      description: '8B • 128K context • tools',
      contextLength: 128000,
      supportsToolUse: true,
    },
    {
      id: 'devstral',
      name: 'Devstral',
      description: '24B • 128K context • tools',
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
 * Ollama Cloud provider entry — CLOUD models.
 *
 * Two inference routes, selected by whether an API key is stored:
 * - API key present → DIRECT mode: `ANTHROPIC_BASE_URL` points at
 *   {@link OLLAMA_CLOUD_DIRECT_BASE_URL} with the key as the auth token.
 *   No local daemon involved (nothing needs to own port 11434).
 * - No key → LOCAL-PROXY mode: cloud requests proxy through the local
 *   daemon at `baseUrl`, authenticated by the daemon's `ollama signin`
 *   credentials.
 *
 * Key characteristics:
 * - `baseUrl`: Local daemon endpoint used only in local-proxy mode
 *   (127.0.0.1, not localhost — see OLLAMA_PROVIDER_ENTRY note)
 * - `authType: 'none'` -- signin-only setups need no key; strategy routing
 *   stays on `local-native`.
 * - `supportsOptionalApiKey: true` -- pasting an ollama.com API key enables
 *   direct mode plus live model discovery and per-token pricing from
 *   ollama.com/api/tags + /api/usage.
 * - `requiresProxy: false` -- Anthropic-native API on both routes
 * - `isLocal: false` -- inference runs in the cloud (free tier ~30K req/mo)
 * - Cloud models use `:cloud` suffix (e.g., `kimi-k2.5:cloud`, `glm-5:cloud`)
 */
export const OLLAMA_CLOUD_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'ollama-cloud',
  name: 'Ollama Cloud',
  baseUrl: 'http://127.0.0.1:11434',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'none',
  supportsOptionalApiKey: true,
  requiresProxy: false,
  isLocal: false,
  keyPrefix: '',
  helpUrl: 'https://ollama.com/blog/ollama-cloud',
  description:
    'Run cloud GPU models via Ollama Cloud (free tier available). ' +
    'Paste an ollama.com API key to connect directly to ollama.com (no local Ollama needed) ' +
    'with live model discovery and pricing; without a key, requests proxy through your ' +
    'signed-in local Ollama.',
  keyPlaceholder:
    'Optional — paste ollama.com API key for direct cloud access, live models & pricing',
  maskedKeyDisplay: 'Cloud (direct API key or ollama signin)',
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
