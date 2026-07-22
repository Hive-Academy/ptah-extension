import {
  createMcpOAuthTokenStore,
  MCP_OAUTH_TOKEN_SECRET_PREFIX,
  type McpOAuthTokenRecord,
} from './mcp-oauth-token-store';

function makeSecrets() {
  const map = new Map<string, string>();
  return {
    map,
    getProviderKey: async (id: string) => map.get(id),
    setProviderKey: async (id: string, value: string) => {
      map.set(id, value);
    },
    deleteProviderKey: async (id: string) => {
      map.delete(id);
    },
  };
}

const token: McpOAuthTokenRecord = {
  accessToken: 'access-abc',
  refreshToken: 'refresh-xyz',
  expiresAt: 123456,
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'client-1',
  scope: 'read',
};

describe('createMcpOAuthTokenStore', () => {
  it('round-trips a token record through the encrypted slot', async () => {
    const secrets = makeSecrets();
    const store = createMcpOAuthTokenStore(secrets);

    await store.setToken('srv', token);
    expect(secrets.map.has(`${MCP_OAUTH_TOKEN_SECRET_PREFIX}srv`)).toBe(true);

    const read = await store.getToken('srv');
    expect(read).toEqual(token);
  });

  it('returns null for an unknown server', async () => {
    const store = createMcpOAuthTokenStore(makeSecrets());
    expect(await store.getToken('missing')).toBeNull();
  });

  it('returns null for a corrupt slot value', async () => {
    const secrets = makeSecrets();
    secrets.map.set(`${MCP_OAUTH_TOKEN_SECRET_PREFIX}srv`, 'not-json');
    const store = createMcpOAuthTokenStore(secrets);
    expect(await store.getToken('srv')).toBeNull();
  });

  it('returns null when the stored blob lacks an accessToken', async () => {
    const secrets = makeSecrets();
    secrets.map.set(
      `${MCP_OAUTH_TOKEN_SECRET_PREFIX}srv`,
      JSON.stringify({ refreshToken: 'x' }),
    );
    const store = createMcpOAuthTokenStore(secrets);
    expect(await store.getToken('srv')).toBeNull();
  });

  it('deletes the slot on deleteToken', async () => {
    const secrets = makeSecrets();
    const store = createMcpOAuthTokenStore(secrets);
    await store.setToken('srv', token);
    await store.deleteToken('srv');
    expect(secrets.map.has(`${MCP_OAUTH_TOKEN_SECRET_PREFIX}srv`)).toBe(false);
    expect(await store.getToken('srv')).toBeNull();
  });
});
