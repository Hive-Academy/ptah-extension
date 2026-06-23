/**
 * Native Claude provider entry — uses the host's local CLI login / subscription.
 *
 * Unlike every other Anthropic-compatible provider, this one does NOT point
 * `ANTHROPIC_BASE_URL` at a third-party endpoint and does NOT carry an API key.
 * It relies entirely on the credentials the official `@anthropic-ai/claude-agent-sdk`
 * already resolves from the host (`~/.claude` login created by the Claude CLI,
 * honoring whatever subscription the user has). The spawn path produces an EMPTY
 * auth env for this provider so the subagent inherits that ambient login exactly
 * like Ptah's default conductor does — see `PtahCliRegistry.buildAuthEnv`.
 *
 * Key characteristics:
 * - `baseUrl: ''`  — never override the endpoint; the SDK defaults to the
 *   native Anthropic API reached with the host's credentials.
 * - `authType: 'none'` + `nativeAuth: true` — no key is collected or injected.
 *   Setting an auth token (even a placeholder) would override the real login.
 * - `defaultTiers` map to real Claude model ids so a spawned panelist (e.g. in
 *   the tribunal panel) runs a concrete model.
 */

import type { AnthropicProvider } from '../provider-registry';

export const CLAUDE_CLI_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'claude-cli',
  name: 'Claude (Subscription)',
  baseUrl: '',
  authEnvVar: 'ANTHROPIC_API_KEY',
  authType: 'none',
  nativeAuth: true,
  keyPrefix: '',
  helpUrl: 'https://www.anthropic.com/claude-code',
  description: 'Use your local Claude login / subscription — no API key needed',
  keyPlaceholder: 'No API key needed',
  maskedKeyDisplay: 'Local (Claude login)',
  defaultTiers: {
    opus: 'claude-opus-4-8',
    sonnet: 'claude-sonnet-4-6',
    haiku: 'claude-haiku-4-5',
  },
  staticModels: [
    {
      id: 'claude-opus-4-8',
      name: 'Claude Opus 4.8',
      description: 'Most capable — long-horizon agentic work (1M context)',
      contextLength: 1000000,
      supportsToolUse: true,
      inputCostPerToken: 5e-6, // $5.00 per 1M tokens
      outputCostPerToken: 25e-6, // $25.00 per 1M tokens
      cacheReadCostPerToken: 0.5e-6, // 0.1x input
      cacheCreationCostPerToken: 6.25e-6, // 1.25x input
    },
    {
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      description: 'Best balance of speed and intelligence (1M context)',
      contextLength: 1000000,
      supportsToolUse: true,
      inputCostPerToken: 3e-6, // $3.00 per 1M tokens
      outputCostPerToken: 15e-6, // $15.00 per 1M tokens
      cacheReadCostPerToken: 0.3e-6, // 0.1x input
      cacheCreationCostPerToken: 3.75e-6, // 1.25x input
    },
    {
      id: 'claude-haiku-4-5',
      name: 'Claude Haiku 4.5',
      description: 'Fastest and most cost-effective (200K context)',
      contextLength: 200000,
      supportsToolUse: true,
      inputCostPerToken: 1e-6, // $1.00 per 1M tokens
      outputCostPerToken: 5e-6, // $5.00 per 1M tokens
      cacheReadCostPerToken: 0.1e-6, // 0.1x input
      cacheCreationCostPerToken: 1.25e-6, // 1.25x input
    },
  ],
};
