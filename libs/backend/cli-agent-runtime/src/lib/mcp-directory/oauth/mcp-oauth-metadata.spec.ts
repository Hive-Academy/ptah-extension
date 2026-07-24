import {
  discoverAuthorizationServer,
  discoverAuthServerMetadata,
  registerClient,
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

  it('throws when no metadata document is found', async () => {
    const fetchImpl: FetchLike = async () => notFound();
    await expect(
      discoverAuthServerMetadata('https://auth.example.com', fetchImpl),
    ).rejects.toThrow(/No OAuth authorization-server metadata/);
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
