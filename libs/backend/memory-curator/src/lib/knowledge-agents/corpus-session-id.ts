import type { SessionId } from '@ptah-extension/shared';

/**
 * Brand-bypass for corpus priming session ids.
 *
 * Corpus priming sessions are addressed by a `corpus-<uuid>` tabId, which does
 * NOT satisfy `SessionId.validate()` (UUID v4 only). The downstream
 * `SessionLifecycleManager` uses the value as an opaque string key, so the
 * brand is purely a type-side fence; this helper documents that fence in one
 * place rather than scattering `as unknown as SessionId` casts across callers.
 */
export function toSessionId(raw: string): SessionId {
  return raw as unknown as SessionId;
}
