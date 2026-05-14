/**
 * Zod schemas for {@link AuthRpcHandlers}.
 *
 * Extracted from `auth-rpc.handlers.ts` (TASK_2025_294 W0.B6) so the schemas can
 * be unit-tested in isolation without spinning up the full handler surface, and
 * so call-site code stays focused on RPC plumbing rather than validation shape.
 *
 * IMPORTANT — extraction contract:
 *   - The parse behaviour here MUST match the inline `z.object({...})` that
 *     previously lived inside `registerSaveSettings()`. Any valid payload that
 *     parsed before MUST still parse; any invalid payload that was rejected
 *     before MUST still be rejected with an equivalent error shape.
 *   - `anthropicProviderId` is a z.enum over the runtime-known provider IDs
 *     from `ANTHROPIC_PROVIDERS`. This keeps provider-id validation in lockstep
 *     with the provider registry without duplicating the list.
 */

import { z } from 'zod';
import { ANTHROPIC_PROVIDERS } from '@ptah-extension/agent-sdk';

/**
 * Validated shape for the `auth:saveSettings` RPC method.
 *
 * Fields:
 *   - `authMethod`     — which auth strategy to persist (apiKey / claudeCli /
 *                        thirdParty). These are the three strategies understood
 *                        by the frontend settings UI.
 *   - `anthropicApiKey`, `providerApiKey` — optional raw credentials routed to
 *                        SecretStorage. Empty strings are sentinel values for
 *                        "clear the stored credential" (handled by the caller,
 *                        not this schema).
 *   - `anthropicProviderId` — optional provider selector, validated against the
 *                        ids exported from `ANTHROPIC_PROVIDERS` so unknown
 *                        providers are rejected at the RPC boundary.
 */
export const AuthSettingsSchema = z.object({
  authMethod: z.enum(['apiKey', 'claudeCli', 'thirdParty']),
  anthropicApiKey: z.string().optional(),
  providerApiKey: z.string().optional(),
  // TASK_2025_129 Batch 3: Selected Anthropic-compatible provider
  // Validated against known provider IDs from the registry
  anthropicProviderId: z
    .enum(ANTHROPIC_PROVIDERS.map((p) => p.id) as [string, ...string[]])
    .optional(),
});

export type AuthSettingsInput = z.infer<typeof AuthSettingsSchema>;

// ---------------------------------------------------------------------------
// Auth method from config storage
// ---------------------------------------------------------------------------

/** The three auth methods exposed to the rest of the handler. */
export type AuthMethod = 'apiKey' | 'claudeCli' | 'thirdParty';

/**
 * Parse the `authMethod` stored in config, normalizing legacy and new spellings.
 *
 * The CLI's `auth use` command and bootstrap migration shim write new spellings
 * (`'claude-cli'`, `'oauth'`) to disk. The frontend Settings UI writes legacy
 * spellings (`'claudeCli'`, `'thirdParty'`). Both must resolve to the same
 * canonical triad so the auth-status badge stays consistent with the actual
 * auth path resolved by `normalizeAuthMethod` in agent-sdk.
 *
 * Mapping (first match wins, default `'apiKey'`):
 *   'apiKey'                              → 'apiKey'
 *   'claudeCli' | 'claude-cli'            → 'claudeCli'
 *   'thirdParty' | 'oauth' | 'openrouter' → 'thirdParty'
 *   anything else (e.g. 'vscode-lm')      → 'apiKey' (safe default)
 *
 * Kept in lockstep with `normalizeAuthMethod` in
 * `libs/backend/agent-sdk/src/lib/helpers/auth-method.utils.ts`.
 */
export function parseAuthMethod(raw: string | null | undefined): AuthMethod {
  if (!raw) return 'apiKey';
  if (raw === 'apiKey') return 'apiKey';
  if (raw === 'claudeCli' || raw === 'claude-cli') return 'claudeCli';
  if (raw === 'thirdParty' || raw === 'oauth' || raw === 'openrouter') {
    return 'thirdParty';
  }
  return 'apiKey';
}
