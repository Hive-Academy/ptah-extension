/**
 * MCP OAuth metadata discovery + dynamic client registration.
 *
 * Implements the subset of the MCP authorization spec needed to connect a
 * remote MCP server with zero manual configuration:
 *   - RFC 9728 — OAuth Protected Resource Metadata (find the auth server)
 *   - RFC 8414 — Authorization Server Metadata (find authorize/token endpoints)
 *   - RFC 7591 — Dynamic Client Registration (obtain a client_id)
 *
 * Discovery is PATH-AWARE (TASK_2026_375 B1.2). A host that serves many MCP
 * servers under different paths publishes nothing at its origin, so the
 * origin-only probes this file used to make found nothing and every such server
 * looked like "does not support OAuth". Measured on Smithery: the
 * protected-resource document lives at
 * `/.well-known/oauth-protected-resource/<server path>` and the
 * authorization-server document at
 * `/.well-known/oauth-authorization-server/<issuer path>`, while both roots
 * answer 404.
 *
 * All network access goes through an injected `FetchLike` so the flow is
 * unit-testable without real HTTP. No secrets are logged.
 *
 * Every request is bounded twice: `withRequestTimeout` aborts any single
 * request after `OAUTH_REQUEST_TIMEOUT_MS`, and the discovery functions accept
 * a deadline `signal` that aborts the in-flight request and stops trying
 * further candidate URLs once the whole phase has run out of time.
 */

/** Upper bound for any single OAuth HTTP request (discovery, DCR, token). */
export const OAUTH_REQUEST_TIMEOUT_MS = 15_000;
/**
 * Upper bound for everything `connect()` does before it waits for the browser
 * callback: protected-resource discovery, auth-server metadata discovery and
 * dynamic client registration together.
 */
export const OAUTH_DISCOVERY_DEADLINE_MS = 45_000;
/**
 * Upper bound for the advisory `probeDiscovery()`. It sits under the 30 s
 * default RPC timeout of the frontend, so it must give up before that fires.
 */
export const OAUTH_PROBE_DEADLINE_MS = 25_000;

/** Minimal fetch surface — satisfied by Node's global `fetch`. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  /**
   * Response headers. OPTIONAL so every existing caller and test fake keeps
   * compiling. The only reader is the 401 `WWW-Authenticate` probe below, which
   * treats an absent `headers` as "no challenge".
   */
  headers?: { get(name: string): string | null };
}>;

export interface AuthServerMetadata {
  issuer?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
}

export interface RegisteredClient {
  clientId: string;
  clientSecret?: string;
}

/**
 * `name` of {@link OAuthDiscoveryError}. Callers classify by `instanceof`
 * first and by this name second. The name check is not decoration: an error
 * that crosses a bundle boundary or a `structuredClone` loses its prototype,
 * and the repo already matches `PROVIDER_AUTH_ERROR_NAME` by name for the same
 * reason. Never classify by message substring.
 */
export const OAUTH_DISCOVERY_ERROR_NAME = 'OAuthDiscoveryError';

/**
 * The server published no RFC 8414 (and no OIDC) authorization-server metadata.
 *
 * In practice this means the server does not use OAuth at all — it usually
 * wants an API key. The UI turns this into that advice instead of the raw
 * message.
 */
export class OAuthDiscoveryError extends Error {
  override readonly name = OAUTH_DISCOVERY_ERROR_NAME;

  constructor(readonly serverUrl: string) {
    super(
      `No OAuth authorization-server metadata found for ${serverUrl}. ` +
        `The server may not support OAuth discovery.`,
    );
  }
}

/** `name` of {@link OAuthTimeoutError}; classify by it the same way. */
export const OAUTH_TIMEOUT_ERROR_NAME = 'OAuthTimeoutError';

/**
 * An OAuth request, or the discovery phase as a whole, ran out of time. It
 * replaces the runtime's raw `AbortError` / `TimeoutError`, whose message
 * ("This operation was aborted") means nothing to the user. `url` is the
 * request that was cut off, kept for logs; it is not in the message.
 */
export class OAuthTimeoutError extends Error {
  override readonly name = OAUTH_TIMEOUT_ERROR_NAME;

  constructor(readonly url: string) {
    super('The authorization server did not respond in time.');
  }
}

/**
 * Wrap a fetch so every request, including reading its body, is aborted after
 * `timeoutMs`. A caller-supplied `init.signal` (a phase deadline) still
 * applies; whichever fires first wins. Either abort surfaces as
 * {@link OAuthTimeoutError}; every other failure propagates unchanged.
 */
export function withRequestTimeout(
  fetchImpl: FetchLike,
  timeoutMs: number = OAUTH_REQUEST_TIMEOUT_MS,
): FetchLike {
  return async (url, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    const guard = async <T>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (error: unknown) {
        if (signal.aborted) throw new OAuthTimeoutError(url);
        throw error;
      }
    };
    const resp = await guard(() => fetchImpl(url, { ...init, signal }));
    return {
      ok: resp.ok,
      status: resp.status,
      headers: resp.headers,
      json: () => guard(() => resp.json()),
      text: () => guard(() => resp.text()),
    };
  };
}

/** Stop a discovery phase whose deadline has passed. */
function assertBeforeDeadline(
  signal: AbortSignal | undefined,
  url: string,
): void {
  if (signal?.aborted) throw new OAuthTimeoutError(url);
}

/**
 * The pathname of a URL with any trailing slash removed, or `''` when the URL
 * is at the root. `''` means "no path form applies", which is what both
 * discovery functions below branch on.
 */
function significantPath(url: URL): string {
  return url.pathname.replace(/\/+$/, '');
}

/** Preserve order, drop repeats — root and path forms coincide sometimes. */
function unique(urls: readonly string[]): string[] {
  return [...new Set(urls)];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Read `authorization_servers[0]` from one RFC 9728 protected-resource metadata
 * document. Returns undefined for any failure — a missing document is the
 * normal case here, not an error.
 */
async function readProtectedResourceMetadata(
  prmUrl: string,
  fetchImpl: FetchLike,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const resp = await fetchImpl(prmUrl, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!resp.ok) return undefined;
    const body = asRecord(await resp.json());
    const servers = body['authorization_servers'];
    if (!Array.isArray(servers) || servers.length === 0) return undefined;
    return str(servers[0]);
    // degradation-audit: optional-capability - per the doc comment on this
    // function, a missing protected-resource document is the normal case, not
    // an error; the caller tries the next discovery candidate.
  } catch {
    return undefined;
  }
}

/**
 * Read the `resource_metadata` parameter out of a `WWW-Authenticate` challenge.
 * Tolerant on purpose: servers differ on quoting, spacing and parameter order,
 * and RFC 9728 §5.1 fixes only the parameter name.
 */
export function parseResourceMetadataChallenge(
  header: string | null | undefined,
): string | undefined {
  if (!header) return undefined;
  const match = /resource_metadata\s*=\s*(?:"([^"]*)"|([^\s,]+))/i.exec(header);
  if (!match) return undefined;
  return str(match[1] ?? match[2]);
}

/**
 * Ask the MCP server itself where its protected-resource metadata lives, by
 * reading the `WWW-Authenticate` challenge on its 401. This is the only route
 * that works when a host serves many servers under different paths and
 * publishes no document the client could have guessed.
 */
async function discoverPrmUrlFromChallenge(
  serverUrl: string,
  fetchImpl: FetchLike,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const resp = await fetchImpl(serverUrl, {
      headers: { Accept: 'application/json, text/event-stream' },
      signal,
    });
    if (resp.status !== 401) return undefined;
    const header =
      resp.headers?.get('WWW-Authenticate') ??
      resp.headers?.get('www-authenticate') ??
      null;
    return parseResourceMetadataChallenge(header);
    // degradation-audit: optional-capability - one candidate in the multi-step
    // discovery chain documented on `discoverAuthorizationServer`; a probe
    // failure here just means the caller falls through to the next candidate.
  } catch {
    return undefined;
  }
}

/**
 * Discover the authorization server for an MCP server URL.
 *
 * Candidate order:
 *   1. RFC 9728 §3.1 path form — `/.well-known/oauth-protected-resource<path>`.
 *   2. The root protected-resource document.
 *   3. The `resource_metadata` URL advertised by the server's own 401.
 *   4. Fall back to the MCP server's origin. Many servers co-locate their OAuth
 *      endpoints, and RFC 8414 discovery below will confirm or reject it.
 *
 * `signal` is the phase deadline: once it aborts, no further candidate is
 * tried and the call rejects with {@link OAuthTimeoutError}.
 */
export async function discoverAuthorizationServer(
  serverUrl: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<string> {
  const url = new URL(serverUrl);
  const base = url.origin;
  const path = significantPath(url);

  const candidates = unique([
    ...(path ? [`${base}/.well-known/oauth-protected-resource${path}`] : []),
    `${base}/.well-known/oauth-protected-resource`,
  ]);

  for (const candidate of candidates) {
    assertBeforeDeadline(signal, serverUrl);
    const found = await readProtectedResourceMetadata(
      candidate,
      fetchImpl,
      signal,
    );
    if (found) return found;
  }

  assertBeforeDeadline(signal, serverUrl);
  const hinted = await discoverPrmUrlFromChallenge(
    serverUrl,
    fetchImpl,
    signal,
  );
  if (hinted) {
    assertBeforeDeadline(signal, serverUrl);
    const found = await readProtectedResourceMetadata(
      hinted,
      fetchImpl,
      signal,
    );
    if (found) return found;
  }

  assertBeforeDeadline(signal, serverUrl);
  return base;
}

/**
 * Fetch RFC 8414 authorization-server metadata.
 *
 * When the authorization server carries a path
 * (`https://auth.smithery.ai/hubspot`) the RFC 8414 §3.1 path-insert forms are
 * tried FIRST, then the OIDC Discovery 1.0 §4 form that appends the well-known
 * suffix to the issuer, and only then the two root documents. Returns the first
 * document that carries both an authorization and a token endpoint.
 *
 * `signal` is the phase deadline: once it aborts, no further candidate is
 * tried and the call rejects with {@link OAuthTimeoutError} instead of the
 * misleading {@link OAuthDiscoveryError}.
 */
export async function discoverAuthServerMetadata(
  authServer: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<AuthServerMetadata> {
  const issuer = new URL(authServer);
  const base = issuer.origin;
  const path = significantPath(issuer);

  const candidates = unique([
    ...(path
      ? [
          `${base}/.well-known/oauth-authorization-server${path}`,
          `${base}/.well-known/openid-configuration${path}`,
          `${base}${path}/.well-known/oauth-authorization-server`,
          `${base}${path}/.well-known/openid-configuration`,
        ]
      : []),
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
  ]);

  for (const url of candidates) {
    assertBeforeDeadline(signal, authServer);
    try {
      const resp = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!resp.ok) continue;
      const body = asRecord(await resp.json());
      const authorizationEndpoint = str(body['authorization_endpoint']);
      const tokenEndpoint = str(body['token_endpoint']);
      if (authorizationEndpoint && tokenEndpoint) {
        return {
          issuer: str(body['issuer']),
          authorizationEndpoint,
          tokenEndpoint,
          registrationEndpoint: str(body['registration_endpoint']),
          scopesSupported: Array.isArray(body['scopes_supported'])
            ? (body['scopes_supported'] as unknown[]).filter(
                (s): s is string => typeof s === 'string',
              )
            : undefined,
        };
      }
    } catch {
      /* try next candidate; a passed deadline is caught at the loop head */
    }
  }
  assertBeforeDeadline(signal, authServer);

  // Name the authorization server the caller asked about, not its origin: the
  // path is what tells one path-hosted server from another on the same host.
  throw new OAuthDiscoveryError(authServer);
}

/**
 * RFC 7591 dynamic client registration. Returns a public client (no secret)
 * when the server issues one — the PKCE flow does not require a client secret.
 * `signal` is the phase deadline, forwarded to the request.
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  fetchImpl: FetchLike,
  clientName = 'Ptah',
  signal?: AbortSignal,
): Promise<RegisteredClient> {
  assertBeforeDeadline(signal, registrationEndpoint);
  const resp = await fetchImpl(registrationEndpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!resp.ok) {
    throw new Error(
      `Dynamic client registration failed (HTTP ${resp.status}). The server may require a pre-registered client.`,
    );
  }
  const body = asRecord(await resp.json());
  const clientId = str(body['client_id']);
  if (!clientId) {
    throw new Error(
      'Client registration response did not include a client_id.',
    );
  }
  return { clientId, clientSecret: str(body['client_secret']) };
}
