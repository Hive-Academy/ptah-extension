import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { IOAuthCallbackListener } from '@ptah-extension/platform-core';
import { McpOAuthService, deriveMcpOAuthServerKey } from './mcp-oauth.service';
import { createMcpOAuthTokenStore } from './mcp-oauth-token-store';
import { McpOAuthInstalledManifestStore } from './mcp-oauth-installed-manifest';
import type { FetchLike } from './mcp-oauth-metadata';

function jsonResp(body: unknown) {
  return {
    ok: true,
    status: 200,
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

/** Fake fetch covering discovery → registration → token/refresh exchange. */
const fetchImpl: FetchLike = async (url, init) => {
  if (url.includes('.well-known/oauth-protected-resource')) {
    return jsonResp({ authorization_servers: ['https://auth.example.com'] });
  }
  if (url.endsWith('/.well-known/oauth-authorization-server')) {
    return jsonResp({
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      registration_endpoint: 'https://auth.example.com/register',
    });
  }
  if (url === 'https://auth.example.com/register') {
    return jsonResp({ client_id: 'client-123' });
  }
  if (url === 'https://auth.example.com/token') {
    const body = new URLSearchParams(init?.body ?? '');
    if (body.get('grant_type') === 'refresh_token') {
      return jsonResp({
        access_token: 'AT2',
        refresh_token: 'RT2',
        expires_in: 3600,
      });
    }
    return jsonResp({
      access_token: 'AT',
      refresh_token: 'RT',
      expires_in: 3600,
    });
  }
  return notFound();
};

function makeSecrets() {
  const map = new Map<string, string>();
  return {
    getProviderKey: async (id: string) => map.get(id),
    setProviderKey: async (id: string, value: string) => {
      map.set(id, value);
    },
    deleteProviderKey: async (id: string) => {
      map.delete(id);
    },
  };
}

/**
 * Fake `IOAuthCallbackListener` returning a canned redirect URI + code. The
 * loopback (and the VS Code URI handler) are exercised by their own specs;
 * here the connect() seam is tested independent of the redirect mechanism.
 */
function makeFakeCallbackListener(opts?: {
  redirectUri?: string;
  code?: string;
}): IOAuthCallbackListener {
  return {
    async start(_state: string) {
      return {
        redirectUri: opts?.redirectUri ?? 'http://127.0.0.1:51820/callback',
        waitForCode: async () => opts?.code ?? 'CODE123',
        close: async () => undefined,
      };
    },
  };
}

function makeService(overrides?: {
  manifestPath?: string;
  now?: () => number;
}) {
  const secrets = makeSecrets();
  const tokenStore = createMcpOAuthTokenStore(secrets);
  const manifestPath =
    overrides?.manifestPath ??
    path.join(
      os.tmpdir(),
      `mcp-oauth-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
  const manifest = new McpOAuthInstalledManifestStore(manifestPath);

  const capture: { authorizeUrl?: string } = {};
  const openExternal = async (url: string): Promise<boolean> => {
    capture.authorizeUrl = url;
    return true;
  };

  const service = new McpOAuthService({
    callbackListener: makeFakeCallbackListener(),
    openExternal,
    tokenStore,
    manifest,
    fetchImpl,
    now: overrides?.now ?? (() => 1_000_000),
    callbackTimeoutMs: 5000,
  });
  return { service, tokenStore, manifest, manifestPath, capture };
}

describe('McpOAuthService', () => {
  const cleanup: string[] = [];
  afterEach(() => {
    for (const p of cleanup.splice(0)) fs.rmSync(p, { force: true });
  });

  it('connect() runs the full authorization-code flow and stores the token', async () => {
    const { service, tokenStore, manifest, manifestPath } = makeService();
    cleanup.push(manifestPath);

    const result = await service.connect({
      serverUrl: 'https://mcp.example.com/mcp',
    });

    const expectedKey = deriveMcpOAuthServerKey('https://mcp.example.com/mcp');
    expect(result.serverKey).toBe(expectedKey);

    const stored = await tokenStore.getToken(expectedKey);
    expect(stored?.accessToken).toBe('AT');
    expect(stored?.refreshToken).toBe('RT');
    expect(stored?.expiresAt).toBe(1_000_000 + 3600 * 1000);
    expect(manifest.has(expectedKey)).toBe(true);
    expect(manifest.get(expectedKey)?.serverUrl).toBe(
      'https://mcp.example.com/mcp',
    );
  });

  it('connect() requires a callbackListener or an httpServerProvider', async () => {
    const secrets = makeSecrets();
    const tokenStore = createMcpOAuthTokenStore(secrets);
    const manifestPath = path.join(
      os.tmpdir(),
      `mcp-oauth-nolistener-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
    cleanup.push(manifestPath);
    const service = new McpOAuthService({
      // Neither callbackListener nor httpServerProvider supplied.
      openExternal: async () => true,
      tokenStore,
      manifest: new McpOAuthInstalledManifestStore(manifestPath),
      fetchImpl,
    });

    await expect(
      service.connect({ serverUrl: 'https://mcp.example.com/mcp' }),
    ).rejects.toThrow(/callbackListener or an httpServerProvider/i);
  });

  it('status() reflects connected / disconnected across disconnect()', async () => {
    const { service, manifestPath } = makeService();
    cleanup.push(manifestPath);

    const { serverKey } = await service.connect({
      serverUrl: 'https://mcp.example.com/mcp',
    });
    expect(await service.status(serverKey)).toBe('connected');

    await service.disconnect(serverKey);
    expect(await service.status(serverKey)).toBe('disconnected');
  });

  it('getFreshAccessToken() refreshes a near-expiry token', async () => {
    // Clock starts at t0; the token from connect() expires at t0 + 1h.
    let t = 1_000_000;
    const { service } = makeService({ now: () => t });
    const { serverKey } = await service.connect({
      serverUrl: 'https://mcp.example.com/mcp',
    });

    // Advance past expiry — getFreshAccessToken must refresh via refresh_token.
    t = 1_000_000 + 3600 * 1000 + 1;
    const fresh = await service.getFreshAccessToken(serverKey);
    expect(fresh).toBe('AT2');
  });

  /**
   * Fake fetch for an authorization server that does NOT advertise a
   * `registration_endpoint` (no dynamic client registration). Captures the token
   * exchange body so the test can assert the pre-registered client_id was used.
   */
  function makeNoDcrFetch(capture: { tokenBody?: URLSearchParams }): FetchLike {
    return async (url, init) => {
      if (url.includes('.well-known/oauth-protected-resource')) {
        return jsonResp({
          authorization_servers: ['https://auth.example.com'],
        });
      }
      if (url.endsWith('/.well-known/oauth-authorization-server')) {
        return jsonResp({
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          // No registration_endpoint — server requires a pre-registered client.
        });
      }
      if (url === 'https://auth.example.com/token') {
        capture.tokenBody = new URLSearchParams(init?.body ?? '');
        return jsonResp({
          access_token: 'AT',
          refresh_token: 'RT',
          expires_in: 3600,
        });
      }
      return notFound();
    };
  }

  it('connect() uses a supplied clientId when the server has no registration endpoint', async () => {
    const secrets = makeSecrets();
    const tokenStore = createMcpOAuthTokenStore(secrets);
    const manifestPath = path.join(
      os.tmpdir(),
      `mcp-oauth-prereg-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
    cleanup.push(manifestPath);
    const manifest = new McpOAuthInstalledManifestStore(manifestPath);
    const capture: { tokenBody?: URLSearchParams; authorizeUrl?: string } = {};
    const openExternal = async (url: string): Promise<boolean> => {
      capture.authorizeUrl = url;
      return true;
    };
    const service = new McpOAuthService({
      callbackListener: makeFakeCallbackListener(),
      openExternal,
      tokenStore,
      manifest,
      fetchImpl: makeNoDcrFetch(capture),
      now: () => 1_000_000,
      callbackTimeoutMs: 5000,
    });

    const { serverKey } = await service.connect({
      serverUrl: 'https://mcp.example.com/mcp',
      clientId: 'preregistered-abc',
      clientSecret: 'shhh',
    });

    // The authorize URL and token request both carry the supplied client_id.
    expect(
      new URL(capture.authorizeUrl ?? '').searchParams.get('client_id'),
    ).toBe('preregistered-abc');
    expect(capture.tokenBody?.get('client_id')).toBe('preregistered-abc');
    expect(capture.tokenBody?.get('client_secret')).toBe('shhh');

    // The token record persists the client credentials so refresh keeps working.
    const stored = await tokenStore.getToken(serverKey);
    expect(stored?.accessToken).toBe('AT');
    expect(stored?.clientId).toBe('preregistered-abc');
    expect(stored?.clientSecret).toBe('shhh');
  });

  it('connect() throws a pre-registered-required error when the server has no registration endpoint and no clientId is supplied', async () => {
    const secrets = makeSecrets();
    const tokenStore = createMcpOAuthTokenStore(secrets);
    const manifestPath = path.join(
      os.tmpdir(),
      `mcp-oauth-noreg-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
    cleanup.push(manifestPath);
    const manifest = new McpOAuthInstalledManifestStore(manifestPath);
    const service = new McpOAuthService({
      callbackListener: makeFakeCallbackListener(),
      openExternal: async () => true,
      tokenStore,
      manifest,
      fetchImpl: makeNoDcrFetch({}),
      callbackTimeoutMs: 3000,
    });

    await expect(
      service.connect({ serverUrl: 'https://mcp.example.com/mcp' }),
    ).rejects.toThrow(/pre-registered client ID/i);
  });
});

describe('deriveMcpOAuthServerKey', () => {
  it('produces a stable, config-safe key', () => {
    expect(deriveMcpOAuthServerKey('https://mcp.notion.com/mcp')).toBe(
      'oauth-mcp.notion.com-mcp',
    );
  });
});
