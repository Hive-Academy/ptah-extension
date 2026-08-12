import { defineSetting, type SettingDefinition } from './definition';
import { MODEL_SELECTED_SCHEMA } from './model-schema';
import { EFFORT_LEVEL_SCHEMA } from './reasoning-schema';

/**
 * Canonical list of BUILT-IN provider auth keys.
 *
 * Each entry corresponds to a distinct authentication identity:
 * - 'apiKey'                  — Anthropic direct API key
 * - 'claudeCli'               — Claude CLI credential store
 * - 'thirdParty.*'            — Anthropic-compatible third-party providers
 *
 * This list drives automatic schema expansion — every provider gets its own
 * `provider.<authKey>.selectedModel` and `provider.<authKey>.reasoningEffort`
 * setting definitions without having to enumerate them manually.
 *
 * MUST stay in sync with `KNOWN_AUTH_KEYS_FOR_FILE_ROUTING` in
 * `libs/backend/platform-core/src/file-settings-keys.ts` (we cannot import it —
 * settings-core depends on platform-core, so the reverse import would be a
 * cycle). Drift is caught by the TC-19 guard in `settings-core.spec.ts`.
 *
 * USER-DEFINED providers (TASK_2026_236) are NOT in this list and must never
 * be added to it — their ids only exist at runtime. Their
 * `provider.thirdParty.<id>.*` keys are file-routed by
 * `PROVIDER_AUTH_MODEL_PATTERN` in `file-settings-keys.ts`, and their setting
 * definitions are built on demand by passing the dynamic key to
 * {@link providerSelectedModelDef} / {@link providerReasoningEffortDef},
 * which accept any {@link ProviderAuthKey}.
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
 * Any provider auth key — a built-in one (autocompleted) or a
 * `thirdParty.<custom-id>` key minted for a user-defined provider entry.
 *
 * The `string & {}` half is the open-string-union idiom: it keeps IDE
 * autocomplete for the built-ins while still accepting runtime ids.
 */
export type ProviderAuthKey = KnownProviderAuthKey | (string & {});

/**
 * Build a SettingDefinition for the selected model of a specific provider.
 *
 * Key pattern: `provider.<authKey>.selectedModel`
 * Empty string means "use provider default".
 */
export function providerSelectedModelDef(
  authKey: ProviderAuthKey,
): SettingDefinition<string> {
  return defineSetting({
    key: `provider.${authKey}.selectedModel`,
    scope: 'global',
    sensitivity: 'plain',
    schema: MODEL_SELECTED_SCHEMA,
    default: '',
    sinceVersion: 2,
    appScopable: true,
  });
}

/**
 * Build a SettingDefinition for the reasoning effort of a specific provider.
 *
 * Key pattern: `provider.<authKey>.reasoningEffort`
 * Empty string means "provider doesn't support reasoning effort".
 */
export function providerReasoningEffortDef(
  authKey: ProviderAuthKey,
): SettingDefinition<string> {
  return defineSetting({
    key: `provider.${authKey}.reasoningEffort`,
    scope: 'global',
    sensitivity: 'plain',
    schema: EFFORT_LEVEL_SCHEMA,
    default: '',
    sinceVersion: 2,
    appScopable: true,
  });
}
