/**
 * Redaction helper for MCP server URLs.
 *
 * Smithery (and other hosted-MCP) connection URLs carry the API key and the
 * base64-encoded per-server config in their query string
 * (`server.smithery.ai/...?config=...&api_key=...&profile=...`). Those values
 * are secrets and MUST NOT reach logs, telemetry, or Sentry.
 *
 * `redactMcpUrl` keeps the scheme + host + path (useful for debugging which
 * server was reached) and masks every secret-bearing query parameter with
 * `***redacted***`. It is intentionally conservative: any query parameter whose
 * name matches a known-secret token, plus the userinfo component, is masked.
 *
 * SECURITY: callers should route every log line that would otherwise emit a raw
 * `mcpUrl` / override `url` through this function.
 */

const REDACTED = '***redacted***';

/**
 * Query-parameter names that carry secrets or secret-bearing payloads.
 * Matched case-insensitively. `config` is included because Smithery base64-
 * encodes the full per-server config (which may itself contain credentials).
 */
const SECRET_QUERY_PARAMS = new Set([
  'api_key',
  'apikey',
  'key',
  'config',
  'token',
  'access_token',
  'secret',
  'password',
  'profile',
]);

/**
 * Redact secret-bearing query-string values (and any embedded userinfo) from an
 * MCP server URL, preserving the scheme, host, and path for debuggability.
 *
 * Falls back to a coarse `***redacted***` for the whole query string when the
 * input cannot be parsed as a URL (never emits the raw value on the error path).
 */
export function redactMcpUrl(url: string): string {
  if (typeof url !== 'string' || url.length === 0) {
    return url;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return redactUnparseable(url);
  }

  if (parsed.username) parsed.username = REDACTED;
  if (parsed.password) parsed.password = REDACTED;

  for (const name of [...parsed.searchParams.keys()]) {
    if (SECRET_QUERY_PARAMS.has(name.toLowerCase())) {
      parsed.searchParams.set(name, REDACTED);
    }
  }

  return parsed.toString();
}

/**
 * Best-effort redaction for strings that are not valid URLs: strips any query
 * string entirely rather than risk leaking a malformed secret-bearing value.
 */
function redactUnparseable(value: string): string {
  const queryIndex = value.indexOf('?');
  if (queryIndex === -1) {
    return value;
  }
  return `${value.slice(0, queryIndex)}?${REDACTED}`;
}

/**
 * Redact every entry of an `mcpServersOverride`-style map for safe logging.
 * Returns a plain object keyed by server key → redacted URL (or a marker when a
 * non-http entry has no URL field).
 */
export function redactMcpOverrideMap(
  override: Record<string, { url?: string } | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!override) return out;
  for (const [serverKey, entry] of Object.entries(override)) {
    out[serverKey] = entry?.url ? redactMcpUrl(entry.url) : '<no-url>';
  }
  return out;
}
