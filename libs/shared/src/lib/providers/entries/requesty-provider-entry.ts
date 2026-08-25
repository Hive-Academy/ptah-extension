/**
 * Requesty Provider Entry
 *
 * Static provider definition for Requesty's router, registered into the
 * Anthropic-compatible provider registry.
 *
 * Requesty is a LANE-1 provider: its router speaks the native Anthropic
 * Messages protocol as a passthrough (`ANTHROPIC_BASE_URL=https://router.requesty.ai`
 * with a Bearer token in `ANTHROPIC_AUTH_TOKEN`, preserving `ANTHROPIC_MODEL` /
 * `ANTHROPIC_SMALL_FAST_MODEL`). Nothing is translated, so `requiresProxy` is
 * false — unlike OpenRouter and Sakana, which need the local translation proxy.
 * Verified at https://docs.requesty.ai/integrations/claude-code.
 *
 * Deliberate omissions (TASK_2026_236 research, "Could not verify"):
 * - `keyPrefix` is EMPTY. Requesty's own pages disagree about the prefix — a
 *   blog post shows `rqy_…` while the quickstart example shows `sk-…`. Encoding
 *   either one would reject half of all real keys at the validation hint, so we
 *   encode neither (same choice Moonshot and Z.AI already make).
 * - No `defaultTiers` and no `staticModels`. The only model slug seen in the
 *   docs (`anthropic/claude-sonnet-4-5-20250514`) appears on the OpenAI-compat
 *   lane, not on the Anthropic passthrough lane this entry uses. Shipping an
 *   unverified tier map would silently break every "Default (recommended)"
 *   selection, so tiers come from the live model list instead.
 *
 * `modelsEndpoint` points at the OpenAI-compatible `/v1/models` route, which is
 * the same surface Requesty documents as a drop-in OpenAI SDK base URL.
 */

import type { AnthropicProvider } from '../provider-registry';

export const REQUESTY_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'requesty',
  name: 'Requesty',
  baseUrl: 'https://router.requesty.ai',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'apiKey',
  requiresProxy: false,
  isLocal: false,
  keyPrefix: '',
  helpUrl: 'https://app.requesty.ai/api-keys',
  description: 'Routed multi-model access via Anthropic-compatible API',
  keyPlaceholder: 'Enter Requesty API key...',
  maskedKeyDisplay: '••••••••••••',
  modelsEndpoint: 'https://router.requesty.ai/v1/models',
};
