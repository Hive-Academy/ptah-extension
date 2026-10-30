/**
 * Auth Method Normalization
 *
 * Single source of truth for translating any persisted `authMethod` config
 * value (legacy or new spelling) to the canonical `LegacyAuthMethod` triad
 * used by all SDK readers.
 *
 * Background: the CLI's `auth use` command writes new spellings
 * (`'claude-cli'`, `'oauth'`, `'apiKey'`) to disk. The CLI bootstrap migration
 * shim also rewrites legacy `'claudeCli'` → `'claude-cli'` on first boot.
 * Downstream SDK code, however, still switches on the legacy
 * `LegacyAuthMethod` triad. Without this helper, `auth use claude-cli` and
 * `auth use github-copilot` silently fall back to `'apiKey'`.
 *
 * Mapping (first match wins):
 *   'apiKey'                          → 'apiKey'
 *   'claudeCli' | 'claude-cli'        → 'claudeCli'
 *   'thirdParty' | 'oauth' | 'openrouter' → 'thirdParty'
 *   anything else (missing, unknown)  → no method ({@link parseAuthMethod})
 *                                       or 'claudeCli' ({@link normalizeAuthMethod})
 */

import type { LegacyAuthMethod } from '@ptah-extension/shared';

export type { LegacyAuthMethod };

/**
 * Map a persisted `authMethod` value to the canonical triad, or `undefined`
 * when the value is missing or not a known spelling. Callers that know the
 * credential state pick the default with {@link resolveDefaultAuthMethod}.
 */
export function parseAuthMethod(
  rawValue: unknown,
): LegacyAuthMethod | undefined {
  if (rawValue === 'apiKey') return 'apiKey';
  if (rawValue === 'claudeCli' || rawValue === 'claude-cli') return 'claudeCli';
  if (
    rawValue === 'thirdParty' ||
    rawValue === 'oauth' ||
    rawValue === 'openrouter'
  ) {
    return 'thirdParty';
  }
  return undefined;
}

/**
 * Normalize any persisted `authMethod` value (legacy or new spelling) to the
 * canonical `LegacyAuthMethod` triad. Defaults to `'claudeCli'` on missing or
 * unknown input; for callers that cannot see the credential state.
 */
export function normalizeAuthMethod(rawValue: unknown): LegacyAuthMethod {
  return parseAuthMethod(rawValue) ?? 'claudeCli';
}

/** Credential facts that decide the auth method when none is configured. */
export interface DefaultAuthMethodFacts {
  /** An Anthropic API key is stored. */
  readonly hasApiKey: boolean;
  /** The Claude CLI login is connected. */
  readonly claudeCliConnected: boolean;
}

/**
 * The auth method used when the configured value is missing or unknown: the
 * Claude CLI login, unless an API key is stored and that login is not
 * connected (with neither, the Claude CLI path reports what is missing).
 */
export function resolveDefaultAuthMethod(
  facts: DefaultAuthMethodFacts,
): LegacyAuthMethod {
  return facts.hasApiKey && !facts.claudeCliConnected ? 'apiKey' : 'claudeCli';
}

/**
 * Recovery text when the direct Anthropic API key path has no key. It names
 * the Electron settings field that selects the main agent's auth method: the
 * Providers tab (`settings.component.ts`) and its "Main agent authentication"
 * field (`providers-settings.component.ts`).
 */
export const API_KEY_RECOVERY_HINT =
  'Add an API key, or choose the Claude CLI login in Settings > Providers > Main agent authentication.';
