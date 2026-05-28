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
 * Secret storage key for the Smithery API key. Kept in lockstep with the
 * `SMITHERY_API_KEY_DEF` descriptor in `@ptah-extension/settings-core`.
 * Routed through `IAuthSecretsService` provider-key slots (each id gets an
 * isolated, encrypted slot), so the key value never leaves the backend.
 */
export const SMITHERY_API_KEY_SECRET_ID = 'smithery.apiKey';
