/**
 * Zod schemas and validation constants for {@link WebSearchRpcHandlers}.
 *
 * Extracted from `web-search-rpc.handlers.ts` so the provider enum and
 * SecretStorage key prefix can be unit-tested in isolation and reused
 * without duplicating literal sets across handler and specs.
 *
 * IMPORTANT — extraction contract:
 *   - `VALID_PROVIDERS` must keep the same three members ('tavily', 'serper',
 *     'exa') as the inline `ReadonlySet<string>` that previously lived in the
 *     handler. The handler uses it via `VALID_PROVIDERS.has(provider)` and that
 *     runtime check MUST continue to accept/reject exactly the same strings.
 *   - `SECRET_KEY_PREFIX` is the SecretStorage namespace for web-search API
 *     keys. Changing it would orphan already-stored keys on end-user machines.
 *   - `WebSearchProviderSchema` is a Zod mirror of the same enum, provided for
 *     callers that want parse-style validation (returns typed narrow results
 *     instead of throwing). Keep the members in sync with `VALID_PROVIDERS`.
 */

import { z } from 'zod';

/** SecretStorage key namespace for web search API keys. */
export const SECRET_KEY_PREFIX = 'ptah.webSearch.apiKey';

/** Runtime set of supported provider names for `has()` checks. */
export const VALID_PROVIDERS: ReadonlySet<string> = new Set([
  'tavily',
  'serper',
  'exa',
]);

/**
 * Zod enum covering the same provider names as {@link VALID_PROVIDERS}.
 *
 * Use `.safeParse()` at callsites that prefer structured validation errors
 * over the `throw new Error(...)` path the handler uses today.
 */
export const WebSearchProviderSchema = z.enum(['tavily', 'serper', 'exa']);

export type WebSearchProvider = z.infer<typeof WebSearchProviderSchema>;
