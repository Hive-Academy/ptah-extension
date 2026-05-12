import { defineSetting, type SettingDefinition } from './definition';
import { MODEL_SELECTED_SCHEMA } from './model-schema';
import { EFFORT_LEVEL_SCHEMA } from './reasoning-schema';

/**
 * Canonical list of provider auth keys.
 *
 * Each entry corresponds to a distinct authentication identity:
 * - 'apiKey'                  — Anthropic direct API key
 * - 'claudeCli'               — Claude CLI credential store
 * - 'thirdParty.*'            — Anthropic-compatible third-party providers
 *
 * This list drives automatic schema expansion — every provider gets its own
 * `provider.<authKey>.selectedModel` and `provider.<authKey>.reasoningEffort`
 * setting definitions without having to enumerate them manually.
 */
export const KNOWN_PROVIDER_AUTH_KEYS = [
  'apiKey',
  'claudeCli',
  'thirdParty.openrouter',
  'thirdParty.moonshot',
  'thirdParty.z-ai',
  'thirdParty.ollama',
  'thirdParty.ollama-cloud',
  'thirdParty.lm-studio',
  'thirdParty.github-copilot',
  'thirdParty.openai-codex',
] as const;

export type KnownProviderAuthKey = (typeof KNOWN_PROVIDER_AUTH_KEYS)[number];

/**
 * Build a SettingDefinition for the selected model of a specific provider.
 *
 * Key pattern: `provider.<authKey>.selectedModel`
 * Empty string means "use provider default".
 */
export function providerSelectedModelDef(
  authKey: KnownProviderAuthKey,
): SettingDefinition<string> {
  return defineSetting({
    key: `provider.${authKey}.selectedModel`,
    scope: 'global',
    sensitivity: 'plain',
    schema: MODEL_SELECTED_SCHEMA,
    default: '',
    sinceVersion: 2,
  });
}

/**
 * Build a SettingDefinition for the reasoning effort of a specific provider.
 *
 * Key pattern: `provider.<authKey>.reasoningEffort`
 * Empty string means "provider doesn't support reasoning effort".
 */
export function providerReasoningEffortDef(
  authKey: KnownProviderAuthKey,
): SettingDefinition<string> {
  return defineSetting({
    key: `provider.${authKey}.reasoningEffort`,
    scope: 'global',
    sensitivity: 'plain',
    schema: EFFORT_LEVEL_SCHEMA,
    default: '',
    sinceVersion: 2,
  });
}
