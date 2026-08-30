import { z } from 'zod';

/**
 * Codex OAuth token freshness — the ONE rule.
 *
 * Two libs that must never disagree both need this answer and neither may
 * import the other:
 *
 *  - `auth-providers`' `CodexAuthService` produces `codexTokenStale` for
 *    `auth:getAuthStatus` (and decides whether to attempt a silent refresh).
 *  - `cli-agent-runtime`'s `CodexCliAdapter.ensureTokensFresh` produces the
 *    `[CliDetection] codex credential check` verdict.
 *
 * They used to disagree by construction: the adapter answered "is a credential
 * PRESENT" while the auth service answered "is `last_refresh` younger than 50
 * minutes". For a ChatGPT-subscription login that nothing ever refreshes, the
 * first is permanently true and the second permanently false, so one log line
 * said `fresh` while every status response said `codexTokenStale: true`.
 *
 * The `last_refresh` heuristic was also simply wrong for that login: the
 * measured `~/.codex/auth.json` carried `last_refresh` 20 hours old and an
 * `access_token` whose JWT `exp` was ten days out. The token's own expiry is
 * authoritative whenever it can be read; `last_refresh` is the fallback for
 * opaque (non-JWT) tokens only.
 */

/**
 * Max age of `last_refresh` before an OPAQUE token is considered stale.
 * Only reached when the access token is not a decodable JWT.
 */
export const CODEX_TOKEN_MAX_AGE_MS = 50 * 60 * 1000;

/**
 * Treat a JWT as stale this long before its real `exp`, so a request started
 * now does not arrive after expiry.
 */
export const CODEX_TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;

/** The one field of a JWT payload this module cares about. */
const jwtExpiryPayloadSchema = z.object({ exp: z.number() });

/** Decode one base64url segment to a UTF-8-ish string, or null. */
function decodeBase64UrlSegment(segment: string): string | null {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '=',
  );
  try {
    return atob(padded);
  } catch {
    return null;
  }
}

/**
 * Read the `exp` claim (UNIX seconds) out of a JWT without verifying its
 * signature. Pure, total and NEVER throws — any malformed input returns null,
 * which callers treat as "this is not a JWT, use the fallback rule".
 *
 * Signature verification is deliberately absent: this is not an authorization
 * decision, it is a "should we bother refreshing" decision about a token the
 * user's own CLI wrote to their own home directory.
 */
export function decodeJwtExpiry(token: string): number | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payloadRaw = decodeBase64UrlSegment(parts[1]);
  if (payloadRaw === null) return null;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(payloadRaw);
  } catch {
    return null;
  }

  const parsed = jwtExpiryPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) return null;
  if (!Number.isFinite(parsed.data.exp)) return null;
  return parsed.data.exp;
}

/** Inputs to the freshness rule — the two fields `~/.codex/auth.json` carries. */
export interface CodexTokenFreshnessInput {
  /** `tokens.access_token` from `~/.codex/auth.json`, if present. */
  accessToken?: string;
  /** `last_refresh` ISO timestamp from `~/.codex/auth.json`, if present. */
  lastRefresh?: string;
  /** Injectable clock for tests. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * Whether the Codex OAuth access token should be treated as expired.
 *
 * Precedence:
 * 1. The token's own `exp` claim, when the token is a decodable JWT. Stale iff
 *    it expires within {@link CODEX_TOKEN_EXPIRY_SKEW_MS}.
 * 2. Otherwise the `last_refresh` age heuristic, stale past
 *    {@link CODEX_TOKEN_MAX_AGE_MS}. A missing or unparseable `last_refresh` is
 *    stale — an opaque token with no known age cannot be vouched for.
 *
 * Callers decide PRESENCE themselves (an absent credential is not "stale", it
 * is "not authenticated"), so an omitted `accessToken` simply falls through to
 * the age heuristic.
 */
export function isCodexAccessTokenStale(
  input: CodexTokenFreshnessInput,
): boolean {
  const now = input.now ?? Date.now();

  if (input.accessToken) {
    const exp = decodeJwtExpiry(input.accessToken);
    if (exp !== null) {
      return exp * 1000 - now < CODEX_TOKEN_EXPIRY_SKEW_MS;
    }
  }

  if (!input.lastRefresh) return true;
  const refreshedAt = Date.parse(input.lastRefresh);
  if (Number.isNaN(refreshedAt)) return true;
  return now - refreshedAt > CODEX_TOKEN_MAX_AGE_MS;
}
