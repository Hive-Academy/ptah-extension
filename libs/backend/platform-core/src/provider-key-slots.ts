/**
 * Secret-storage naming for `IAuthSecretsService` provider-key slots.
 *
 * Every provider-key slot is stored as `ptah.auth.provider.<slotId>`. A change
 * to an SDK auth secret re-initializes the SDK adapter, and that
 * re-initialization disposes EVERY live chat session. Connectors (MCP OAuth,
 * Smithery, CLI agents) reuse the same encrypted slots for data that SDK auth
 * never reads, and an MCP OAuth token refresh runs inside `chat:start`. So the
 * classification below is deliberately positive:
 *
 * - An SDK auth provider id is shaped like a provider id
 *   (`/^[a-z0-9][a-z0-9-]*$/`, the same rule custom provider ids are
 *   validated against). Built-in ids (`openrouter`, `z-ai`, `ollama-cloud`,
 *   `opencode-zen`, …) all follow it.
 * - A connector data slot MUST use a dotted `<family>.<id>` slot id. It is then
 *   never an auth secret, with no registration needed.
 * - The few dot-free connector ids that predate this rule are listed in
 *   {@link NON_AUTH_PROVIDER_KEY_SLOT_IDS}.
 */

/** Secret key prefix that every provider-key slot is stored under. */
export const PROVIDER_KEY_SECRET_PREFIX = 'ptah.auth.provider.';

/** Shape of an SDK auth provider id; mirrors `CUSTOM_PROVIDER_ID_PATTERN`. */
const AUTH_PROVIDER_SLOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Slot-id prefixes of connector data slots. The owners derive their slot ids
 * from these, so the convention has one source.
 */
export const NON_AUTH_PROVIDER_KEY_SLOT_PREFIXES = {
  /** Per-server MCP OAuth token records, refreshed at session start. */
  mcpOAuthToken: 'mcp.oauth.',
  /** Per-server Smithery config blobs. */
  smitheryConfig: 'smithery.config.',
  /** Ptah CLI agent keys, read only by the CLI agent runtime. */
  ptahCliAgentKey: 'ptahCli.',
} as const;

/** Exact slot ids of connector secrets that hold no SDK auth credential. */
export const NON_AUTH_PROVIDER_KEY_SLOT_IDS = {
  /** Smithery registry API key (MCP directory). */
  smitheryApiKey: 'smithery.apiKey',
  /** Cursor CLI agent key; dot-free because it predates the convention. */
  cursorAgentKey: 'cursor',
} as const;

const DOT_FREE_NON_AUTH_IDS: ReadonlySet<string> = new Set(
  Object.values(NON_AUTH_PROVIDER_KEY_SLOT_IDS),
);

/**
 * True when a change to `secretKey` can change SDK authentication:
 * `ptah.auth.anthropicApiKey`, or a provider-key slot whose id is shaped like
 * a provider id and is not a listed connector id. Everything else (connector
 * slots, keys outside `ptah.auth.`) is false.
 */
export function isSdkAuthSecretKey(secretKey: string): boolean {
  if (!secretKey.startsWith('ptah.auth.')) return false;
  if (!secretKey.startsWith(PROVIDER_KEY_SECRET_PREFIX)) return true;
  const slotId = secretKey.slice(PROVIDER_KEY_SECRET_PREFIX.length);
  return (
    AUTH_PROVIDER_SLOT_ID_PATTERN.test(slotId) &&
    !DOT_FREE_NON_AUTH_IDS.has(slotId)
  );
}
