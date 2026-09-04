import {
  discoverAuthorizationServer,
  discoverAuthServerMetadata,
  parseResourceMetadataChallenge,
  registerClient,
  OAuthDiscoveryError,
  OAUTH_DISCOVERY_ERROR_NAME,
  type FetchLike,
} from './mcp-oauth-metadata';

function jsonResp(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function notFound() {
  return {
    ok: false,
    status: 404,
    json: async () => ({}),
    text: async () => '',
  };
}

/** A 401 carrying an RFC 9728 §5.1 `WWW-Authenticate` challenge. */
function challenge401(wwwAuthenticate: string) {
  return {
    ok: false,
    status: 401,
    json: async () => ({}),
    text: async () => '',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'www-authenticate' ? wwwAuthenticate : null,
    },
  };
}

/**
 * The Smithery shapes measured on 2026-09-03 (TASK_2026_375 context.md F2).
 * Every document at an origin root is a 404; the real ones live under the path.
 */
const SMITHERY_PRM_PATH =
  'https://server.smithery.ai/.well-known/oauth-protected-resource/hubspot/mcp';
const SMITHERY_AS_PATH_INSERT =
  'https://auth.smithery.ai/.well-known/oauth-authorization-server/hubspot';

function smitheryFetch(seen: string[]): FetchLike {
  return async (url) => {
    seen.push(url);
    if (url === SMITHERY_PRM_PATH) {
      return jsonResp({
        resource: 'https://server.smithery.ai/hubspot/mcp',
        authorization_servers: ['https://auth.smithery.ai/hubspot'],
      });
    }
    if (url === SMITHERY_AS_PATH_INSERT) {
      return jsonResp({
        issuer: 'https://auth.smithery.ai/hubspot',
        authorization_endpoint: 'https://auth.smithery.ai/hubspot/authorize',
        token_endpoint: 'https://auth.smithery.ai/hubspot/token',
        registration_endpoint: 'https://auth.smithery.ai/hubspot/register',
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    return notFound();
  };
}

describe('discoverAuthorizationServer', () => {
  it('reads the auth server from protected-resource metadata (RFC 9728)', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('.well-known/oauth-protected-resource')) {
        return jsonResp({
          authorization_servers: ['https://auth.example.com'],
        });
      }
      return notFound();
    };
    const result = await discoverAuthorizationServer(
      'https://mcp.example.com/mcp',
      fetchImpl,
    );
    expect(result).toBe('https://auth.example.com');
  });

  it('falls back to the server origin when PRM is absent', async () => {
    const fetchImpl: FetchLike = async () => notFound();
    const result = await discoverAuthorizationServer(
      'https://mcp.example.com/mcp',
      fetchImpl,
    );
    expect(result).toBe('https://mcp.example.com');
  });

  it('reads the RFC 9728 path form first (Smithery shape)', async () => {
    const seen: string[] = [];
    const result = await discoverAuthorizationServer(
      'https://server.smithery.ai/hubspot/mcp',
      smitheryFetch(seen),
    );
    expect(result).toBe('https://auth.smithery.ai/hubspot');
    // The path form is tried BEFORE the root document, which Smithery 404s.
    expect(seen[0]).toBe(SMITHERY_PRM_PATH);
  });

  it('keeps reading the root document for a root server URL (HubSpot direct)', async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      seen.push(url);
      if (
        url === 'https://mcp.hubspot.com/.well-known/oauth-protected-resource'
      ) {
        return jsonResp({
          authorization_servers: ['https://mcp.hubspot.com'],
        });
      }
      return notFound();
    };
    const result = await discoverAuthorizationServer(
      'https://mcp.hubspot.com',
      fetchImpl,
    );
    expect(result).toBe('https://mcp.hubspot.com');
    expect(seen).toEqual([
      'https://mcp.hubspot.com/.well-known/oauth-protected-resource',
    ]);
  });

  it('follows resource_metadata from a 401 WWW-Authenticate challenge', async () => {
    const hinted =
      'https://hubspot.run.tools/.well-known/oauth-protected-resource';
    const fetchImpl: FetchLike = async (url) => {
      if (url === hinted) {
        return jsonResp({
          authorization_servers: ['https://auth.smithery.ai/hubspot'],
        });
      }
      if (url === 'https://hubspot.run.tools/mcp') {
        return challenge401(
          'Bearer error="unauthorized", resource_metadata="' + hinted + '"',
        );
      }
      return notFound();
    };
    const result = await discoverAuthorizationServer(
      'https://hubspot.run.tools/mcp',
      fetchImpl,
    );
    expect(result).toBe('https://auth.smithery.ai/hubspot');
  });

  it('falls back to the origin when the challenge document names no auth server', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === 'https://mcp.example.com/mcp') {
        return challenge401(
          'Bearer resource_metadata="https://mcp.example.com/prm"',
        );
      }
      if (url === 'https://mcp.example.com/prm') return jsonResp({});
      return notFound();
    };
    const result = await discoverAuthorizationServer(
      'https://mcp.example.com/mcp',
      fetchImpl,
    );
    expect(result).toBe('https://mcp.example.com');
  });

  it('tolerates a fetch impl that exposes no response headers', async () => {
    // Every pre-existing fake omits `headers`; that must stay a valid FetchLike.
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => '',
    });
    await expect(
      discoverAuthorizationServer('https://mcp.example.com/mcp', fetchImpl),
    ).resolves.toBe('https://mcp.example.com');
  });
});

describe('parseResourceMetadataChallenge', () => {
  it.each([
    ['Bearer resource_metadata="https://a/prm"', 'https://a/prm'],
    ['Bearer error="x", resource_metadata="https://a/prm"', 'https://a/prm'],
    ['Bearer resource_metadata=https://a/prm', 'https://a/prm'],
    ['Bearer Resource_Metadata = "https://a/prm"', 'https://a/prm'],
    ['Bearer resource_metadata=https://a/prm, scope="x"', 'https://a/prm'],
  ])('parses %s', (header, expected) => {
    expect(parseResourceMetadataChallenge(header)).toBe(expected);
  });

  it('returns undefined for an absent or unrelated challenge', () => {
    expect(parseResourceMetadataChallenge(null)).toBeUndefined();
    expect(parseResourceMetadataChallenge(undefined)).toBeUndefined();
    expect(parseResourceMetadataChallenge('Bearer realm="x"')).toBeUndefined();
  });
});

describe('discoverAuthServerMetadata', () => {
  it('parses the RFC 8414 authorization-server document', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.endsWith('/.well-known/oauth-authorization-server')) {
        return jsonResp({
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          registration_endpoint: 'https://auth.example.com/register',
          scopes_supported: ['read', 'write'],
        });
      }
      return notFound();
    };
    const meta = await discoverAuthServerMetadata(
      'https://auth.example.com',
      fetchImpl,
    );
    expect(meta.authorizationEndpoint).toBe(
      'https://auth.example.com/authorize',
    );
    expect(meta.tokenEndpoint).toBe('https://auth.example.com/token');
    expect(meta.registrationEndpoint).toBe('https://auth.example.com/register');
    expect(meta.scopesSupported).toEqual(['read', 'write']);
  });

  it('falls back to the OIDC discovery document', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.endsWith('/.well-known/openid-configuration')) {
        return jsonResp({
          authorization_endpoint: 'https://auth.example.com/oidc/authorize',
          token_endpoint: 'https://auth.example.com/oidc/token',
        });
      }
      return notFound();
    };
    const meta = await discoverAuthServerMetadata(
      'https://auth.example.com',
      fetchImpl,
    );
    expect(meta.authorizationEndpoint).toBe(
      'https://auth.example.com/oidc/authorize',
    );
  });

  it('reads the RFC 8414 path-insert form for a path-hosted issuer (Smithery)', async () => {
    const seen: string[] = [];
    const meta = await discoverAuthServerMetadata(
      'https://auth.smithery.ai/hubspot',
      smitheryFetch(seen),
    );
    expect(meta.authorizationEndpoint).toBe(
      'https://auth.smithery.ai/hubspot/authorize',
    );
    expect(meta.tokenEndpoint).toBe('https://auth.smithery.ai/hubspot/token');
    expect(meta.registrationEndpoint).toBe(
      'https://auth.smithery.ai/hubspot/register',
    );
    // Path-insert is the FIRST candidate. The legacy issuer-suffix form and the
    // two root documents, all of which Smithery 404s, come after it.
    expect(seen[0]).toBe(SMITHERY_AS_PATH_INSERT);
  });

  it('never asks for the issuer-suffix form before the path-insert form', async () => {
    const seen: string[] = [];
    await expect(
      discoverAuthServerMetadata('https://auth.smithery.ai/nosuch', (url) => {
        seen.push(url);
        return Promise.resolve(notFound());
      }),
    ).rejects.toBeInstanceOf(OAuthDiscoveryError);
    expect(seen).toEqual([
      'https://auth.smithery.ai/.well-known/oauth-authorization-server/nosuch',
      'https://auth.smithery.ai/.well-known/openid-configuration/nosuch',
      'https://auth.smithery.ai/nosuch/.well-known/oauth-authorization-server',
      'https://auth.smithery.ai/nosuch/.well-known/openid-configuration',
      'https://auth.smithery.ai/.well-known/oauth-authorization-server',
      'https://auth.smithery.ai/.well-known/openid-configuration',
    ]);
  });

  it('falls back to the OIDC form appended to a path-hosted issuer', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (
        url ===
        'https://auth.example.com/tenant/.well-known/openid-configuration'
      ) {
        return jsonResp({
          authorization_endpoint: 'https://auth.example.com/tenant/authorize',
          token_endpoint: 'https://auth.example.com/tenant/token',
        });
      }
      return notFound();
    };
    const meta = await discoverAuthServerMetadata(
      'https://auth.example.com/tenant',
      fetchImpl,
    );
    expect(meta.tokenEndpoint).toBe('https://auth.example.com/tenant/token');
  });

  it('still reads the root document for a root issuer (HubSpot direct)', async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      seen.push(url);
      if (
        url === 'https://mcp.hubspot.com/.well-known/oauth-authorization-server'
      ) {
        return jsonResp({
          issuer: 'https://mcp.hubspot.com',
          authorization_endpoint: 'https://mcp.hubspot.com/oauth/authorize',
          token_endpoint: 'https://mcp.hubspot.com/oauth/token',
        });
      }
      return notFound();
    };
    const meta = await discoverAuthServerMetadata(
      'https://mcp.hubspot.com',
      fetchImpl,
    );
    expect(meta.authorizationEndpoint).toBe(
      'https://mcp.hubspot.com/oauth/authorize',
    );
    // No `registration_endpoint`: this is the pre-registered-app path.
    expect(meta.registrationEndpoint).toBeUndefined();
    expect(seen).toEqual([
      'https://mcp.hubspot.com/.well-known/oauth-authorization-server',
    ]);
  });

  it('names the original authorization server, path included, when nothing is found', async () => {
    const fetchImpl: FetchLike = async () => notFound();
    await expect(
      discoverAuthServerMetadata('https://auth.smithery.ai/nosuch', fetchImpl),
    ).rejects.toMatchObject({
      name: OAUTH_DISCOVERY_ERROR_NAME,
      serverUrl: 'https://auth.smithery.ai/nosuch',
    });
  });

  it('throws when no metadata document is found', async () => {
    const fetchImpl: FetchLike = async () => notFound();
    await expect(
      discoverAuthServerMetadata('https://auth.example.com', fetchImpl),
    ).rejects.toThrow(/No OAuth authorization-server metadata/);
  });

  it('rejects a server with no metadata endpoints as OAuthDiscoveryError', async () => {
    const fetchImpl: FetchLike = async () => notFound();
    // `name` is the contract the RPC layer classifies on: `instanceof` first,
    // `name` second, because a bundle boundary drops the prototype.
    await expect(
      discoverAuthServerMetadata('https://mcp.firecrawl.dev', fetchImpl),
    ).rejects.toMatchObject({
      name: OAUTH_DISCOVERY_ERROR_NAME,
      serverUrl: 'https://mcp.firecrawl.dev',
    });
    expect(OAUTH_DISCOVERY_ERROR_NAME).toBe('OAuthDiscoveryError');
  });

  it('rejects with an OAuthDiscoveryError instance', async () => {
    const fetchImpl: FetchLike = async () => notFound();
    await expect(
      discoverAuthServerMetadata('https://auth.example.com', fetchImpl),
    ).rejects.toBeInstanceOf(OAuthDiscoveryError);
  });
});

describe('registerClient', () => {
  it('performs dynamic client registration and returns the client_id', async () => {
    let capturedBody: unknown;
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedBody = init?.body ? JSON.parse(init.body) : undefined;
      return jsonResp({ client_id: 'client-123' });
    };
    const registered = await registerClient(
      'https://auth.example.com/register',
      'http://127.0.0.1:5000/callback',
      fetchImpl,
    );
    expect(registered.clientId).toBe('client-123');
    expect(capturedBody).toMatchObject({
      redirect_uris: ['http://127.0.0.1:5000/callback'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('throws when registration is rejected', async () => {
    const fetchImpl: FetchLike = async () => notFound();
    await expect(
      registerClient(
        'https://auth.example.com/register',
        'http://x/cb',
        fetchImpl,
      ),
    ).rejects.toThrow(/Dynamic client registration failed/);
  });
});
