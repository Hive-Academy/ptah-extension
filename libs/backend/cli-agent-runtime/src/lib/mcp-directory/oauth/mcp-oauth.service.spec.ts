import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type {
  IHttpServerProvider,
  HttpServerRequestHandler,
} from '@ptah-extension/platform-core';
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

/** Fake loopback provider that captures the handler and lets the test invoke it. */
function makeFakeHttpProvider() {
  let handler: HttpServerRequestHandler | undefined;
  const provider: IHttpServerProvider = {
    async listen(_host, _port, h) {
      handler = h;
      return { port: 51820, host: '127.0.0.1', close: async () => undefined };
    },
  };
  const invoke = (url: string): void => {
    const res = {
      writeHead: () => res,
      end: () => undefined,
    } as unknown as Parameters<HttpServerRequestHandler>[1];
    void handler?.({ url } as Parameters<HttpServerRequestHandler>[0], res);
  };
  return { provider, invoke };
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
  const { provider, invoke } = makeFakeHttpProvider();

  // Simulate the browser redirect hitting the loopback with the real state.
  const openExternal = async (url: string): Promise<boolean> => {
    const state = new URL(url).searchParams.get('state');
    setImmediate(() =>
      invoke(`http://127.0.0.1:51820/callback?code=CODE123&state=${state}`),
    );
    return true;
  };

  const service = new McpOAuthService({
    httpServerProvider: provider,
    openExternal,
    tokenStore,
    manifest,
    fetchImpl,
    now: overrides?.now ?? (() => 1_000_000),
    callbackTimeoutMs: 5000,
  });
  return { service, tokenStore, manifest, manifestPath };
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

  it('rejects a callback whose state does not match', async () => {
    const secrets = makeSecrets();
    const tokenStore = createMcpOAuthTokenStore(secrets);
    const manifestPath = path.join(
      os.tmpdir(),
      `mcp-oauth-badstate-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
    );
    cleanup.push(manifestPath);
    const manifest = new McpOAuthInstalledManifestStore(manifestPath);
    const { provider, invoke } = makeFakeHttpProvider();
    const openExternal = async (): Promise<boolean> => {
      setImmediate(() =>
        invoke('http://127.0.0.1:51820/callback?code=X&state=WRONG'),
      );
      return true;
    };
    const service = new McpOAuthService({
      httpServerProvider: provider,
      openExternal,
      tokenStore,
      manifest,
      fetchImpl,
      callbackTimeoutMs: 3000,
    });

    await expect(
      service.connect({ serverUrl: 'https://mcp.example.com/mcp' }),
    ).rejects.toThrow(/state mismatch/i);
  });
});

describe('deriveMcpOAuthServerKey', () => {
  it('produces a stable, config-safe key', () => {
    expect(deriveMcpOAuthServerKey('https://mcp.notion.com/mcp')).toBe(
      'oauth-mcp.notion.com-mcp',
    );
  });
});
