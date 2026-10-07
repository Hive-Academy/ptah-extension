/**
 * OpenCode Model Routes
 *
 * Scoped model-id-to-protocol routing tables for OpenCode Zen and OpenCode Go.
 *
 * OpenCode exposes models across four upstream protocols:
 * - Anthropic Messages (`/messages`)
 * - OpenAI Chat Completions (`/chat/completions`)
 * - OpenAI Responses (`/responses`)
 * - Google generateContent (`/models/{id}`) — excluded (no translator in Ptah)
 * - Jev structured judgment (`/systemone`) — excluded (not a chat protocol)
 *
 * The route table MUST be keyed on `(subscription, modelId)` because model IDs
 * collide across subscriptions with DIFFERENT protocols (e.g. `minimax-m3` is
 * `/chat/completions` on Zen but `/messages` on Go).
 *
 * @see TASK_2026_526
 */

export type OpenCodeProviderId = 'opencode-zen' | 'opencode-go';
export type OpenCodeProtocol = 'messages' | 'chat/completions' | 'responses';
export type OpenCodeModelRoutes = Readonly<
  Record<OpenCodeProviderId, Readonly<Record<string, OpenCodeProtocol>>>
>;

/**
 * Reviewed, immutable routing table for OpenCode Zen and OpenCode Go.
 *
 * Excludes the Google generateContent models and the Jev systemone models.
 *
 * Synced with the live `/zen/v1/models` and `/zen/go/v1/models` lists on
 * 2026-10-07: retired IDs removed, new IDs added. A new ID's protocol comes
 * from its models.dev `provider.npm` (anthropic → messages, openai →
 * responses, openai-compatible → chat/completions), which matched every one of
 * the 64 Zen routes already here. Live IDs with no such source stay out
 * rather than guess a protocol (Qwen on Zen, where the two disagree on Go).
 */
export const OPENCODE_MODEL_ROUTES: OpenCodeModelRoutes = Object.freeze({
  'opencode-zen': Object.freeze({
    // Anthropic Messages (17 models)
    'claude-fable-5-1': 'messages',
    'claude-fable-5': 'messages',
    'claude-opus-5': 'messages',
    'claude-opus-4-8': 'messages',
    'claude-opus-4-7': 'messages',
    'claude-opus-4-6': 'messages',
    'claude-opus-4-5': 'messages',
    'claude-sonnet-5': 'messages',
    'claude-sonnet-4-6': 'messages',
    'claude-sonnet-4-5': 'messages',
    'claude-haiku-4-5': 'messages',
    'claude-opus-5-5': 'messages',
    'claude-sonnet-5-5': 'messages',
    'claude-sonnet-4': 'messages',
    'qwen3.8-flash': 'messages',
    'qwen3.6-plus': 'messages',
    'qwen3.5-plus': 'messages',

    // OpenAI Chat Completions (27 models)
    'deepseek-v4.1-flash': 'chat/completions',
    'deepseek-v4-pro': 'chat/completions',
    'deepseek-v4-flash': 'chat/completions',
    'deepseek-v4-flash-vision-exp': 'chat/completions',
    'minimax-m3': 'chat/completions',
    'minimax-m2.7': 'chat/completions',
    'minimax-m2.5': 'chat/completions',
    'glm-5.3-flash': 'chat/completions',
    'glm-5.3': 'chat/completions',
    'glm-5.2': 'chat/completions',
    'glm-5.1': 'chat/completions',
    'glm-5': 'chat/completions',
    'kimi-k2.5': 'chat/completions',
    'kimi-k2.6': 'chat/completions',
    'kimi-k2.7-code': 'chat/completions',
    'kimi-k3': 'chat/completions',
    'big-pickle': 'chat/completions',
    'mimo-v2.6-flash-free': 'chat/completions',
    'ling-3.0-flash-fin-free': 'chat/completions',
    'nemotron-3-ultra-free': 'chat/completions',
    'nemotron-3.5-lightning-free': 'chat/completions',
    'mistral-large-4': 'chat/completions',
    'exo-free': 'chat/completions',
    'space-bunny-free': 'chat/completions',
    'longcat-2.5-preview-free': 'chat/completions',
    'fledge-alpha-free': 'chat/completions',
    'ling-3.1-flash-free': 'chat/completions',

    // OpenAI Responses (32 models)
    'gpt-6-astra': 'responses',
    'gpt-5.6-sol': 'responses',
    'gpt-5.6-terra': 'responses',
    'gpt-5.6-luna': 'responses',
    'gpt-5.5': 'responses',
    'gpt-5.5-pro': 'responses',
    'gpt-5.4': 'responses',
    'gpt-5.4-pro': 'responses',
    'gpt-5.4-mini': 'responses',
    'gpt-5.4-nano': 'responses',
    'gpt-5.3-codex': 'responses',
    'gpt-5.3-codex-spark': 'responses',
    'gpt-5.2': 'responses',
    'gpt-5.2-codex': 'responses',
    'gpt-5.1': 'responses',
    'gpt-5.1-codex': 'responses',
    'gpt-5.1-codex-max': 'responses',
    'gpt-5.1-codex-mini': 'responses',
    'gpt-5': 'responses',
    'gpt-5-codex': 'responses',
    'gpt-5-nano': 'responses',
    'grok-4.7': 'responses',
    'grok-4.6': 'responses',
    'grok-4.5': 'responses',
    'grok-build-0.1': 'responses',
    'muse-spark-1.3': 'responses',
    'muse-spark-1.2': 'responses',
    'muse-spark-1.3-contributor-free': 'responses',
    'gpt-6.1-sol': 'responses',
    'gpt-6-sol': 'responses',
    'gpt-6-luna': 'responses',
    'muse-spark-1.2-contributor-free': 'responses',
  }),
  'opencode-go': Object.freeze({
    // Anthropic Messages (8 models)
    'minimax-m3': 'messages',
    'minimax-m2.7': 'messages',
    'minimax-m2.5': 'messages',
    'qwen3.8-max': 'messages',
    'qwen3.8-flash': 'messages',
    'qwen3.7-max': 'messages',
    'qwen3.7-plus': 'messages',
    'qwen3.6-plus': 'messages',

    // OpenAI Chat Completions (20 models)
    'glm-5.3-flash': 'chat/completions',
    'glm-5.3': 'chat/completions',
    'glm-5.2': 'chat/completions',
    'glm-5.1': 'chat/completions',
    'kimi-k3': 'chat/completions',
    'kimi-k2.7-code': 'chat/completions',
    'kimi-k2.6': 'chat/completions',
    'longcat-2.0': 'chat/completions',
    'deepseek-v4.1-flash': 'chat/completions',
    'deepseek-v4-pro': 'chat/completions',
    'deepseek-v4-flash': 'chat/completions',
    'deepseek-v4-flash-vision-exp': 'chat/completions',
    'mimo-v2.6-flash': 'chat/completions',
    'mimo-v2.6-pro': 'chat/completions',
    'mimo-v2.5': 'chat/completions',
    'mimo-v2.5-pro': 'chat/completions',
    'hy4-preview': 'chat/completions',
    hy3: 'chat/completions',
    'longcat-2.5-preview-free': 'chat/completions',
    'space-bunny': 'chat/completions',

    // OpenAI Responses (7 models)
    'grok-4.7': 'responses',
    'grok-4.6': 'responses',
    'gpt-5.6-luna': 'responses',
    'muse-spark-1.3-contributor': 'responses',
    'grok-4.5': 'responses',
    'gpt-6-luna': 'responses',
    'muse-spark-1.2-contributor': 'responses',
  }),
});

/**
 * Type guard for OpenCodeProviderId.
 */
export function isOpenCodeProviderId(id: string): id is OpenCodeProviderId {
  return id === 'opencode-zen' || id === 'opencode-go';
}

/**
 * Resolve the upstream protocol for a model ID under a specific OpenCode subscription.
 *
 * Strict own-property lookup: `constructor`, `toString`, `__proto__`, or unknown IDs
 * return `undefined`. No lowercasing, prefix guessing, suffix stripping, or cross-subscription
 * fallback.
 */
export function getOpenCodeModelProtocol(
  providerId: OpenCodeProviderId,
  modelId: string,
): OpenCodeProtocol | undefined {
  if (!isOpenCodeProviderId(providerId)) {
    return undefined;
  }
  const routes = OPENCODE_MODEL_ROUTES[providerId];
  if (Object.prototype.hasOwnProperty.call(routes, modelId)) {
    return routes[modelId];
  }
  return undefined;
}
