/**
 * MCP OAuth metadata discovery + dynamic client registration.
 *
 * Implements the subset of the MCP authorization spec needed to connect a
 * remote MCP server with zero manual configuration:
 *   - RFC 9728 — OAuth Protected Resource Metadata (find the auth server)
 *   - RFC 8414 — Authorization Server Metadata (find authorize/token endpoints)
 *   - RFC 7591 — Dynamic Client Registration (obtain a client_id)
 *
 * All network access goes through an injected `FetchLike` so the flow is
 * unit-testable without real HTTP. No secrets are logged.
 */

/** Minimal fetch surface — satisfied by Node's global `fetch`. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
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

function origin(url: string): string {
  return new URL(url).origin;
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
 * Discover the authorization server for an MCP server URL.
 *
 * Tries RFC 9728 protected-resource metadata first; falls back to treating the
 * MCP server's own origin as the authorization server (many servers co-locate
 * their OAuth endpoints, and RFC 8414 discovery below will confirm).
 */
export async function discoverAuthorizationServer(
  serverUrl: string,
  fetchImpl: FetchLike,
): Promise<string> {
  const prmUrl = `${origin(serverUrl)}/.well-known/oauth-protected-resource`;
  try {
    const resp = await fetchImpl(prmUrl, {
      headers: { Accept: 'application/json' },
    });
    if (resp.ok) {
      const body = asRecord(await resp.json());
      const servers = body['authorization_servers'];
      if (Array.isArray(servers) && servers.length > 0) {
        const first = str(servers[0]);
        if (first) return first;
      }
    }
  } catch {
    /* fall through to origin */
  }
  return origin(serverUrl);
}

/**
 * Fetch RFC 8414 authorization-server metadata. Tries the standard
 * `oauth-authorization-server` document, then the OIDC
 * `openid-configuration` document as a fallback.
 */
export async function discoverAuthServerMetadata(
  authServer: string,
  fetchImpl: FetchLike,
): Promise<AuthServerMetadata> {
  const base = origin(authServer);
  const candidates = [
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
  ];

  for (const url of candidates) {
    try {
      const resp = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
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
      /* try next candidate */
    }
  }

  throw new Error(
    `No OAuth authorization-server metadata found for ${base}. The server may not support OAuth discovery.`,
  );
}

/**
 * RFC 7591 dynamic client registration. Returns a public client (no secret)
 * when the server issues one — the PKCE flow does not require a client secret.
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  fetchImpl: FetchLike,
  clientName = 'Ptah',
): Promise<RegisteredClient> {
  const resp = await fetchImpl(registrationEndpoint, {
    method: 'POST',
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
