/**
 * Secret-storage naming for `IAuthSecretsService` provider-key slots.
 *
 * Every provider-key slot is stored as `ptah.auth.provider.<slotId>`. Most slot
 * ids are provider ids whose key feeds SDK authentication. Some slots only
 * reuse the encrypted store for data that SDK authentication never reads. A
 * write to one of those must not re-initialize the SDK adapter: that
 * re-initialization disposes every live chat session, and an MCP OAuth token
 * refresh runs inside `chat:start`.
 *
 * A new non-auth slot family MUST add its prefix here and derive its slot ids
 * from this constant.
 */

/** Secret key prefix that every provider-key slot is stored under. */
export const PROVIDER_KEY_SECRET_PREFIX = 'ptah.auth.provider.';

/** Slot-id prefixes of provider-key slots that hold no SDK auth credential. */
export const NON_AUTH_PROVIDER_KEY_SLOT_PREFIXES = {
  /** Per-server MCP OAuth token records, refreshed at session start. */
  mcpOAuthToken: 'mcp.oauth.',
  /** Per-server Smithery config blobs. */
  smitheryConfig: 'smithery.config.',
  /** Ptah CLI agent keys, read only by the CLI agent runtime. */
  ptahCliAgentKey: 'ptahCli.',
} as const;

/**
 * True when a change to `secretKey` can change SDK authentication: every
 * `ptah.auth.*` key except the non-auth provider-key slots above.
 */
export function isSdkAuthSecretKey(secretKey: string): boolean {
  if (!secretKey.startsWith('ptah.auth.')) return false;
  if (!secretKey.startsWith(PROVIDER_KEY_SECRET_PREFIX)) return true;
  const slotId = secretKey.slice(PROVIDER_KEY_SECRET_PREFIX.length);
  return !Object.values(NON_AUTH_PROVIDER_KEY_SLOT_PREFIXES).some((prefix) =>
    slotId.startsWith(prefix),
  );
}
