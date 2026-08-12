/**
 * Zod schemas for {@link AuthRpcHandlers}.
 *
 * Extracted from `auth-rpc.handlers.ts` so the schemas can
 * be unit-tested in isolation without spinning up the full handler surface, and
 * so call-site code stays focused on RPC plumbing rather than validation shape.
 *
 * IMPORTANT — extraction contract:
 *   - The parse behaviour here MUST match the inline `z.object({...})` that
 *     previously lived inside `registerSaveSettings()`. Any valid payload that
 *     parsed before MUST still parse; any invalid payload that was rejected
 *     before MUST still be rejected with an equivalent error shape.
 *   - `anthropicProviderId` is a plain string validated by a CALL-TIME lookup
 *     against the merged provider registry. It used to be a `z.enum` built from
 *     `ANTHROPIC_PROVIDERS.map(p => p.id)` — evaluated once, at module load,
 *     from the static array — which rejected every user-defined provider id
 *     unconditionally, before `getAnthropicProvider()` was ever consulted
 *     (TASK_2026_236). The refinement below preserves the extraction contract
 *     exactly: the same ids parse, unknown ids still fail with an issue at
 *     path `anthropicProviderId`. What changed is WHEN and against WHAT — per
 *     parse, against built-ins PLUS whatever custom entries the backend has
 *     loaded into the registry cache via `setCustomProviderEntries()`.
 */

import { z } from 'zod';
import { getAnthropicProvider } from '@ptah-extension/agent-sdk';

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
 *   - `anthropicProviderId` — optional provider selector, resolved through
 *                        `getAnthropicProvider()` at parse time so unknown
 *                        providers are rejected at the RPC boundary while
 *                        user-defined entries (which only exist at runtime) are
 *                        accepted.
 */
export const AuthSettingsSchema = z.object({
  authMethod: z.enum(['apiKey', 'claudeCli', 'thirdParty']),
  anthropicApiKey: z.string().optional(),
  providerApiKey: z.string().optional(),
  anthropicProviderId: z
    .string()
    .min(1)
    .refine((id) => getAnthropicProvider(id) !== undefined, {
      message: 'Unknown provider id',
    })
    .optional(),
  applyTo: z.enum(['global', 'app', 'workspace']).optional(),
});

export type AuthSettingsInput = z.infer<typeof AuthSettingsSchema>;

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
