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
 * Mapping (first match wins, default `'apiKey'`):
 *   'apiKey'                          → 'apiKey'
 *   'claudeCli' | 'claude-cli'        → 'claudeCli'
 *   'thirdParty' | 'oauth' | 'openrouter' → 'thirdParty'
 *   anything else                     → 'apiKey'
 */

import type { LegacyAuthMethod } from '@ptah-extension/shared';

export type { LegacyAuthMethod };

/**
 * Normalize any persisted `authMethod` value (legacy or new spelling) to the
 * canonical `LegacyAuthMethod` triad. Defaults to `'apiKey'` on unknown input.
 */
export function normalizeAuthMethod(rawValue: unknown): LegacyAuthMethod {
  if (typeof rawValue !== 'string') {
    return 'apiKey';
  }

  if (rawValue === 'apiKey') return 'apiKey';
  if (rawValue === 'claudeCli' || rawValue === 'claude-cli') return 'claudeCli';
  if (
    rawValue === 'thirdParty' ||
    rawValue === 'oauth' ||
    rawValue === 'openrouter'
  ) {
    return 'thirdParty';
  }

  return 'apiKey';
}
