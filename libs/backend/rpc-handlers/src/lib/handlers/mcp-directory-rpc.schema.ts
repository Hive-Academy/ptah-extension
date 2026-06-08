/**
 * Zod schemas for {@link McpDirectoryRpcHandlers}.
 *
 * These validate secret-bearing boundary inputs (the Smithery API key) before
 * the handler touches secure storage. The schema lives here so it can be unit
 * tested independently of the handler surface.
 */

import { z } from 'zod';

/**
 * Validated shape for the `mcpDirectory:setSmitheryApiKey` RPC method.
 *
 * `apiKey` is a raw secret routed to encrypted storage. An empty / whitespace
 * value is a sentinel meaning "clear the stored key" (handled by the caller).
 */
export const SetSmitheryApiKeySchema = z.object({
  apiKey: z.string(),
});

export type SetSmitheryApiKeyInput = z.infer<typeof SetSmitheryApiKeySchema>;

/**
 * Validated shape for the `mcpDirectory:resolveSmithery` RPC method.
 *
 * `config` is collected from the connection configSchema form; the API key is
 * NOT part of this boundary (read backend-side at resolve time).
 */
export const ResolveSmitherySchema = z.object({
  qualifiedName: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  profile: z.string().optional(),
});

export type ResolveSmitheryInput = z.infer<typeof ResolveSmitherySchema>;

/**
 * Validated shape for the `mcpDirectory:installSmithery` RPC method.
 *
 * Records a Smithery install. `config` may carry per-server secrets — it is
 * routed to the encrypted secret store, never to the plaintext manifest.
 */
export const InstallSmitherySchema = z.object({
  qualifiedName: z.string().min(1),
  serverKey: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()),
  profile: z.string().optional(),
});

export type InstallSmitheryInput = z.infer<typeof InstallSmitherySchema>;

/** Validated shape for the `mcpDirectory:uninstallSmithery` RPC method. */
export const UninstallSmitherySchema = z.object({
  serverKey: z.string().min(1),
});

export type UninstallSmitheryInput = z.infer<typeof UninstallSmitherySchema>;

/**
 * Derive a stable, filesystem/URL-safe serverKey from a qualified name when the
 * caller does not supply one (e.g. "@owner/server" → "smithery_owner_server").
 */
export function deriveSmitheryServerKey(qualifiedName: string): string {
  const slug = qualifiedName
    .replace(/^@/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return `smithery_${slug || 'server'}`;
}

/**
 * Secret storage key for the Smithery API key. Kept in lockstep with the
 * `SMITHERY_API_KEY_DEF` descriptor in `@ptah-extension/settings-core`.
 * Routed through `IAuthSecretsService` provider-key slots (each id gets an
 * isolated, encrypted slot), so the key value never leaves the backend.
 */
export const SMITHERY_API_KEY_SECRET_ID = 'smithery.apiKey';
