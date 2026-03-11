/**
 * Copilot Provider Entry - TASK_2025_186
 *
 * Static provider definition for GitHub Copilot.
 * Registered into the Anthropic-compatible provider registry.
 */

import type {
  AnthropicProvider,
  ProviderStaticModel,
} from '../helpers/anthropic-provider-registry';

/**
 * Static Claude model definitions available through GitHub Copilot.
 * Pricing is 0 since Copilot subscription covers usage.
 *
 * Model list matches the Claude models from COPILOT_MODELS in
 * copilot-sdk.adapter.ts, filtered to Claude-only.
 */
const COPILOT_CLAUDE_MODELS: ProviderStaticModel[] = [
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    description: 'Latest Sonnet — fast and intelligent (200K context)',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6',
    description: 'Latest Opus — highest intelligence (200K context)',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-opus-4.5',
    name: 'Claude Opus 4.5',
    description: 'Previous-gen Opus — high intelligence (200K context)',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    description: 'Previous-gen Sonnet — balanced performance (200K context)',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    description: 'Sonnet 4 — reliable and efficient (200K context)',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    description: 'Fast and lightweight (200K context)',
    contextLength: 200000,
    supportsToolUse: true,
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  },
];

/**
 * GitHub Copilot provider entry for the Anthropic-compatible provider registry.
 *
 * Key differences from other providers:
 * - `baseUrl` is empty — set dynamically to the translation proxy URL at runtime
 * - `authType: 'oauth'` — uses GitHub OAuth instead of API key input
 * - `requiresProxy: true` — needs the translation proxy to convert protocols
 */
export const COPILOT_PROVIDER_ENTRY: AnthropicProvider = {
  id: 'github-copilot',
  name: 'GitHub Copilot',
  baseUrl: '',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  authType: 'oauth',
  requiresProxy: true,
  keyPrefix: '',
  helpUrl: 'https://github.com/features/copilot',
  description: 'Claude models via GitHub Copilot subscription',
  keyPlaceholder: 'Authenticated via GitHub',
  maskedKeyDisplay: 'GitHub Copilot (connected)',
  staticModels: COPILOT_CLAUDE_MODELS,
};
