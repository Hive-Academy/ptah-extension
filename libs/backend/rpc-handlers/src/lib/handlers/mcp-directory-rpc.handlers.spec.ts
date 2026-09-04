/**
 * McpDirectoryRpcHandlers — source-routing + resolveSmithery specs.
 *
 * Drives the real handler with mocked RpcHandler + AuthSecrets + a mocked
 * global fetch, asserting that the `source` discriminator selects the official
 * vs Smithery registry source and that `resolveSmithery` returns an http config
 * (or a graceful error when the key is missing).
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// The handler builds a real `SmitheryInstalledManifestStore`, whose path is
// `os.homedir()/.ptah/smithery-installed.json` resolved at module load. The
// install specs below write real records, so homedir is redirected to a scratch
// directory BEFORE the SUT is imported. Only `homedir` is replaced — the rest of
// the module (`tmpdir`, `platform`, …) is the real one, which transitive
// dependencies rely on.
// ---------------------------------------------------------------------------
jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return {
    ...actual,
    homedir: () =>
      require('path').join(actual.tmpdir(), 'ptah-mcp-directory-rpc-spec-home'),
  };
});

// The SUT imports from `@ptah-extension/cli-agent-runtime`, whose barrel
// transitively pulls `@ptah-extension/workspace-intelligence`. That lib's
// TreeSitter module evaluates `import.meta.url` at top level — a construct
// ts-jest's CJS transform cannot parse. Stub it (mirrors
// `ptah-cli-rpc.handlers.spec.ts`). The Smithery classes under test do not
// touch workspace-intelligence, so the stub is inert for these specs.
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {},
  Framework: {},
  MonorepoType: {},
  FileType: {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  AstAnalysisService: class AstAnalysisServiceStub {},
  DependencyGraphService: class DependencyGraphServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ContextService: class ContextServiceStub {},
  ContextOrchestrationService: class ContextOrchestrationServiceStub {},
  WorkspaceService: class WorkspaceServiceStub {},
  TokenCounterService: class TokenCounterServiceStub {},
  FileSystemService: class FileSystemServiceStub {},
  FileSystemError: class FileSystemErrorStub extends Error {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  DependencyAnalyzerService: class DependencyAnalyzerServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
  PatternMatcherService: class PatternMatcherServiceStub {},
  IgnorePatternResolverService: class IgnorePatternResolverServiceStub {},
  WorkspaceIndexerService: class WorkspaceIndexerServiceStub {},
  FileTypeClassifierService: class FileTypeClassifierServiceStub {},
  FileRelevanceScorerService: class FileRelevanceScorerServiceStub {},
  ContextSizeOptimizerService: class ContextSizeOptimizerServiceStub {},
  ContextEnrichmentService: class ContextEnrichmentServiceStub {},
}));

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  createMockAuthSecretsService,
  type MockRpcHandler,
  type MockSentryService,
  type MockAuthSecretsService,
} from '@ptah-extension/vscode-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  createMockWorkspaceProvider,
  createMockUserInteraction,
  createMockHttpServerProvider,
} from '@ptah-extension/platform-core/testing';

import type { DependencyContainer } from 'tsyringe';
import type { IHttpServerProvider } from '@ptah-extension/platform-core';
import { MCP_OAUTH_LOOPBACK_PORT } from '@ptah-extension/cli-agent-runtime';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpDirectoryRpcHandlers } from './mcp-directory-rpc.handlers';
import { deriveSmitheryConnectionId } from './mcp-directory-rpc.schema';

/**
 * Minimal DI container stub: the handler only calls `isRegistered` /`resolve`
 * for the optional OAUTH_CALLBACK_LISTENER. Returning `false` exercises the
 * loopback fallback path (Electron / CLI behaviour).
 */
const makeContainerStub = (): DependencyContainer =>
  ({
    isRegistered: () => false,
    resolve: () => {
      throw new Error('not registered');
    },
  }) as unknown as DependencyContainer;

describe('McpDirectoryRpcHandlers — Smithery source routing', () => {
  let logger: MockLogger;
  let rpc: MockRpcHandler;
  let sentry: MockSentryService;
  let authSecrets: MockAuthSecretsService;
  let originalFetch: typeof globalThis.fetch;

  const build = (
    httpServerProvider: IHttpServerProvider | null = createMockHttpServerProvider(),
  ) => {
    const handlers = new McpDirectoryRpcHandlers(
      logger as unknown as Logger,
      rpc as never,
      createMockWorkspaceProvider(),
      sentry as unknown as SentryService,
      authSecrets,
      createMockUserInteraction(),
      httpServerProvider as IHttpServerProvider,
      makeContainerStub(),
    );
    handlers.register();
    return handlers;
  };

  const call = (method: string, params: unknown) =>
    rpc.handleMessage({ method, params, correlationId: 'c1' } as never);

  const mockFetch = (impl: (url: string) => unknown) => {
    globalThis.fetch = jest.fn(async (url: string) => {
      const body = impl(url);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
      } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;
  };

  beforeEach(() => {
    logger = createMockLogger();
    rpc = createMockRpcHandler();
    sentry = createMockSentryService();
    authSecrets = createMockAuthSecretsService();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('routes search to the official registry by default', async () => {
    mockFetch((url) => {
      expect(url).toContain('registry.modelcontextprotocol.io');
      return { servers: [{ server: { name: 'io.github/official' } }] };
    });
    build();

    const res = await call('mcpDirectory:search', { query: 'x' });
    expect(res.success).toBe(true);
    expect((res.data as { servers: { name: string }[] }).servers[0].name).toBe(
      'io.github/official',
    );
  });

  it('routes search to Smithery when source=smithery (key configured)', async () => {
    authSecrets.getProviderKey.mockResolvedValue('smithery-key');
    mockFetch((url) => {
      expect(url).toContain('registry.smithery.ai');
      return {
        servers: [{ qualifiedName: '@owner/smith' }],
        pagination: { currentPage: 1, totalPages: 1 },
      };
    });
    build();

    const res = await call('mcpDirectory:search', {
      query: 'x',
      source: 'smithery',
    });
    expect(res.success).toBe(true);
    const data = res.data as { servers: { name: string; source?: string }[] };
    expect(data.servers[0].name).toBe('@owner/smith');
    expect(data.servers[0].source).toBe('smithery');
  });

  it('returns empty servers gracefully when Smithery key is missing', async () => {
    authSecrets.getProviderKey.mockResolvedValue(undefined);
    globalThis.fetch = jest.fn() as unknown as typeof globalThis.fetch;
    build();

    const res = await call('mcpDirectory:search', {
      query: 'x',
      source: 'smithery',
    });
    expect(res.success).toBe(true);
    expect((res.data as { servers: unknown[] }).servers).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('routes getDetails to Smithery and carries configSchema', async () => {
    authSecrets.getProviderKey.mockResolvedValue('k');
    mockFetch(() => ({
      qualifiedName: '@owner/d',
      security: { scanPassed: true },
      connections: [
        { type: 'http', configSchema: { type: 'object', properties: {} } },
      ],
    }));
    build();

    const res = await call('mcpDirectory:getDetails', {
      name: '@owner/d',
      source: 'smithery',
    });
    expect(res.success).toBe(true);
    const data = res.data as {
      scanPassed?: boolean;
      connections?: { configSchema?: unknown }[];
    };
    expect(data.scanPassed).toBe(true);
    expect(data.connections?.[0].configSchema).toBeDefined();
  });

  it('resolveSmithery returns an http config when key present', async () => {
    authSecrets.getProviderKey.mockResolvedValue('resolve-key');
    mockFetch(() => ({
      qualifiedName: '@owner/r',
      connections: [{ type: 'http', configSchema: { type: 'object' } }],
    }));
    build();

    const res = await call('mcpDirectory:resolveSmithery', {
      qualifiedName: '@owner/r',
      config: { token: 'abc' },
    });
    expect(res.success).toBe(true);
    const data = res.data as { config?: { type: string; url: string } };
    expect(data.config?.type).toBe('http');
    expect(data.config?.url).toContain('server.smithery.ai');
  });

  it('resolveSmithery returns an error when key missing', async () => {
    authSecrets.getProviderKey.mockResolvedValue(undefined);
    build();

    const res = await call('mcpDirectory:resolveSmithery', {
      qualifiedName: '@owner/r',
      config: {},
    });
    expect(res.success).toBe(true);
    const data = res.data as { error?: string };
    expect(data.error).toMatch(/api key/i);
  });

  it('declares resolveSmithery in the METHODS tuple', () => {
    expect(McpDirectoryRpcHandlers.METHODS).toContain(
      'mcpDirectory:resolveSmithery',
    );
  });

  // ── OAuth discovery classification (TASK_2026_367 C3) ──────────────────────

  /** Every discovery document 404s — the firecrawl shape from the log. */
  const mockFetchNoDiscovery = () => {
    globalThis.fetch = jest.fn(async () => {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;
  };

  it('connectOAuth reports reason no-oauth-discovery when the server publishes no metadata', async () => {
    mockFetchNoDiscovery();
    build();

    const res = await call('mcpDirectory:connectOAuth', {
      serverUrl: 'https://mcp.firecrawl.dev',
    });
    expect(res.success).toBe(true);
    const data = res.data as { success: boolean; reason?: string };
    expect(data.success).toBe(false);
    expect(data.reason).toBe('no-oauth-discovery');
  });

  it('connectOAuth reports reason other for an unrelated error', async () => {
    build();

    // A Zod rejection is an ordinary Error: it must NOT be classified as a
    // discovery failure, or the UI would advise an API key for a typo.
    const res = await call('mcpDirectory:connectOAuth', {
      serverUrl: 'not-a-url',
    });
    expect(res.success).toBe(true);
    const data = res.data as { success: boolean; reason?: string };
    expect(data.success).toBe(false);
    expect(data.reason).toBe('other');
  });

  it('probeOAuthDiscovery reports supported:false with reason no-oauth-discovery', async () => {
    mockFetchNoDiscovery();
    build();

    const res = await call('mcpDirectory:probeOAuthDiscovery', {
      serverUrl: 'https://mcp.firecrawl.dev',
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      supported: false,
      reason: 'no-oauth-discovery',
    });
  });

  it('probeOAuthDiscovery reports dynamicRegistration:false when no registration_endpoint is published', async () => {
    mockFetch((url) => {
      if (url.endsWith('/.well-known/oauth-authorization-server')) {
        return {
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          // No registration_endpoint — the HubSpot shape.
        };
      }
      return {};
    });
    build();

    const res = await call('mcpDirectory:probeOAuthDiscovery', {
      serverUrl: 'https://auth.example.com/mcp',
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ supported: true, dynamicRegistration: false });
  });

  it('probeOAuthDiscovery reports dynamicRegistration:true when the server advertises RFC 7591', async () => {
    mockFetch((url) => {
      if (url.endsWith('/.well-known/oauth-authorization-server')) {
        return {
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          registration_endpoint: 'https://auth.example.com/register',
        };
      }
      return {};
    });
    build();

    const res = await call('mcpDirectory:probeOAuthDiscovery', {
      serverUrl: 'https://auth.example.com/mcp',
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ supported: true, dynamicRegistration: true });
  });

  it('probeOAuthDiscovery rejects a non-URL param through Zod without calling the network', async () => {
    globalThis.fetch = jest.fn() as unknown as typeof globalThis.fetch;
    build();

    const res = await call('mcpDirectory:probeOAuthDiscovery', {
      serverUrl: 'firecrawl',
    });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ supported: false, reason: 'other' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('declares probeOAuthDiscovery in the METHODS tuple', () => {
    expect(McpDirectoryRpcHandlers.METHODS).toContain(
      'mcpDirectory:probeOAuthDiscovery',
    );
  });

  // ── Redirect URL advertisement (TASK_2026_373) ────────────────────────────

  it('getOAuthRedirectUri reports the fixed loopback URL on a non-VS-Code host', async () => {
    build();

    const res = await call('mcpDirectory:getOAuthRedirectUri', {});
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      redirectUri: `http://127.0.0.1:${MCP_OAUTH_LOOPBACK_PORT}/callback`,
    });
  });

  it('getOAuthRedirectUri returns null plus an error when the host cannot run the flow', async () => {
    // A host that registers neither a callback listener nor an HTTP server
    // provider cannot answer. That is a legitimate headless answer, so it is
    // logged at warn and never sent to Sentry.
    build(null);

    const res = await call('mcpDirectory:getOAuthRedirectUri', {});
    expect(res.success).toBe(true);
    const data = res.data as { redirectUri: string | null; error?: string };
    expect(data.redirectUri).toBeNull();
    expect(data.error).toMatch(/callbackListener or an httpServerProvider/i);
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('declares getOAuthRedirectUri in the METHODS tuple', () => {
    expect(McpDirectoryRpcHandlers.METHODS).toContain(
      'mcpDirectory:getOAuthRedirectUri',
    );
  });

  it('getPopular with an unknown source falls back to the official registry and never throws', async () => {
    mockFetch((url) => {
      expect(url).toContain('registry.modelcontextprotocol.io');
      return { servers: [{ name: 'official-popular' }] };
    });
    build();

    const res = await call('mcpDirectory:getPopular', {
      source: 'pulsemcp' as never,
    });
    expect(res.success).toBe(true);
    const data = res.data as { servers: { name: string }[] };
    expect(data.servers[0].name).toBe('official-popular');
  });
});

// ── Smithery Connections API (TASK_2026_375 B2.3) ───────────────────────────

/**
 * Drives the real handler against a fake Smithery Platform API.
 *
 * Every fixture is the documented wire shape (see
 * `smithery-connections.client.spec.ts` for the sources). The manifest is the
 * real store writing under a redirected home, so these specs also pin that an
 * install survives to the next read.
 */
describe('McpDirectoryRpcHandlers — Smithery Connections API', () => {
  let logger: MockLogger;
  let rpc: MockRpcHandler;
  let sentry: MockSentryService;
  let authSecrets: MockAuthSecretsService;
  let userInteraction: ReturnType<typeof createMockUserInteraction>;
  let originalFetch: typeof globalThis.fetch;
  let manifestPath: string;

  /** Requests the fake API saw, newest last. */
  let requests: Array<{ url: string; method: string; body?: unknown }>;

  const NAMESPACE = 'abdallah';

  const connectionBody = (
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    connectionId: 'hubspot',
    name: 'HubSpot',
    transport: 'http',
    mcpUrl: null,
    metadata: { managedBy: 'ptah', server: 'hubspot' },
    iconUrl: null,
    createdAt: '2026-09-03T10:00:00.000Z',
    status: { state: 'connected' },
    serverInfo: { name: 'hubspot', version: '1.0.0' },
    ...over,
  });

  /** Route the fake API. Returning undefined means "404 with an error body". */
  const mockApi = (
    route: (
      url: string,
      method: string,
      body: unknown,
    ) => { status?: number; body?: unknown } | undefined,
  ) => {
    globalThis.fetch = jest.fn(
      async (url: string, init?: { method?: string; body?: string }) => {
        const method = init?.method ?? 'GET';
        const parsedBody = init?.body ? JSON.parse(init.body) : undefined;
        requests.push({ url, method, body: parsedBody });
        const hit = route(url, method, parsedBody) ?? {
          status: 404,
          body: { error: 'not_found', message: 'Not found' },
        };
        const status = hit.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          statusText: status === 200 ? 'OK' : 'Error',
          json: async () => hit.body ?? {},
        } as unknown as Response;
      },
    ) as unknown as typeof globalThis.fetch;
  };

  /** The happy path: one namespace, one connection, PUT echoes what it got. */
  const mockHealthyApi = (
    connectionOverrides: Record<string, unknown> = {},
  ) => {
    mockApi((url, method) => {
      if (url.endsWith('/namespaces')) {
        return { body: { namespaces: [{ name: NAMESPACE }] } };
      }
      if (url.endsWith(`/connect/${NAMESPACE}`) && method === 'GET') {
        return { body: { connections: [connectionBody(connectionOverrides)] } };
      }
      if (url.includes(`/connect/${NAMESPACE}/`)) {
        if (method === 'DELETE') return { body: { success: true } };
        return { body: connectionBody(connectionOverrides) };
      }
      return undefined;
    });
  };

  const build = () => {
    const handlers = new McpDirectoryRpcHandlers(
      logger as unknown as Logger,
      rpc as never,
      createMockWorkspaceProvider(),
      sentry as unknown as SentryService,
      authSecrets,
      userInteraction,
      createMockHttpServerProvider(),
      makeContainerStub(),
    );
    handlers.register();
    return handlers;
  };

  const call = (method: string, params: unknown) =>
    rpc.handleMessage({ method, params, correlationId: 'c1' } as never);

  const readManifest = (): Record<string, Record<string, unknown>> => {
    if (!fs.existsSync(manifestPath)) return {};
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).servers;
  };

  beforeEach(() => {
    logger = createMockLogger();
    rpc = createMockRpcHandler();
    sentry = createMockSentryService();
    authSecrets = createMockAuthSecretsService();
    userInteraction = createMockUserInteraction();
    originalFetch = globalThis.fetch;
    requests = [];

    manifestPath = path.join(os.homedir(), '.ptah', 'smithery-installed.json');
    fs.rmSync(path.dirname(manifestPath), { recursive: true, force: true });

    authSecrets.getProviderKey.mockResolvedValue('sk-smithery');
    authSecrets.hasProviderKey.mockResolvedValue(true);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    fs.rmSync(path.dirname(manifestPath), { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  // ── deriveSmitheryConnectionId ───────────────────────────────────────────

  describe('deriveSmitheryConnectionId', () => {
    it('drops the smithery_ prefix and maps every other character to a dash', () => {
      expect(deriveSmitheryConnectionId('smithery_owner_server')).toBe(
        'owner-server',
      );
      expect(deriveSmitheryConnectionId('smithery_hubspot')).toBe('hubspot');
      expect(deriveSmitheryConnectionId('smithery_a.b_c')).toBe('a-b-c');
    });

    it('lowercases and trims dashes off both ends', () => {
      expect(deriveSmitheryConnectionId('smithery__Weird__')).toBe('weird');
    });

    it('falls back to "server" when nothing survives', () => {
      expect(deriveSmitheryConnectionId('smithery___')).toBe('server');
    });
  });

  // ── installSmithery ──────────────────────────────────────────────────────

  it('installSmithery creates the connection and records namespace + connectionId', async () => {
    mockHealthyApi();
    build();

    const res = await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({
      success: true,
      serverKey: 'smithery_hubspot',
      status: 'connected',
      namespace: NAMESPACE,
      connectionId: 'hubspot',
    });

    const put = requests.find((r) => r.method === 'PUT');
    expect(put?.url).toBe(
      `https://api.smithery.ai/connect/${NAMESPACE}/hubspot`,
    );
    expect(put?.body).toEqual({
      server: 'hubspot',
      metadata: { managedBy: 'ptah', server: 'hubspot' },
    });

    expect(readManifest()['smithery_hubspot']).toMatchObject({
      namespace: NAMESPACE,
      connectionId: 'hubspot',
    });
  });

  it('installSmithery returns status auth_required with the setupUrl', async () => {
    mockHealthyApi({
      status: {
        state: 'auth_required',
        setupUrl: 'https://auth.smithery.ai/setup/one-time',
      },
    });
    build();

    const res = await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });

    expect(res.data).toMatchObject({
      status: 'auth_required',
      setupUrl: 'https://auth.smithery.ai/setup/one-time',
    });
  });

  it('installSmithery keeps the install as legacy when the PUT fails', async () => {
    mockApi((url, method) => {
      if (url.endsWith('/namespaces')) {
        return { body: { namespaces: [{ name: NAMESPACE }] } };
      }
      if (method === 'PUT') {
        return {
          status: 500,
          body: { error: 'server_error', message: 'Smithery is down' },
        };
      }
      return undefined;
    });
    build();

    const res = await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });

    const data = res.data as {
      success: boolean;
      status?: string;
      error?: string;
      namespace?: string;
    };
    expect(data.success).toBe(true);
    expect(data.status).toBe('unknown');
    expect(data.error).toMatch(/Smithery is down/);
    expect(data.namespace).toBeUndefined();

    // The install is NOT lost — it is recorded in its legacy form.
    const record = readManifest()['smithery_hubspot'];
    expect(record).toBeDefined();
    expect(record['namespace']).toBeUndefined();
  });

  it('installSmithery records a legacy install when the key has no namespace', async () => {
    mockApi((url) =>
      url.endsWith('/namespaces') ? { body: { namespaces: [] } } : undefined,
    );
    build();

    const res = await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });

    expect(res.data).toMatchObject({ success: true, status: 'unknown' });
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
    expect(readManifest()['smithery_hubspot']).toBeDefined();
  });

  it('never logs the API key or a setupUrl', async () => {
    mockHealthyApi({
      status: { state: 'auth_required', setupUrl: 'https://s.ai/LEAK-URL' },
    });
    build();

    await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });

    const logged = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.debug.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(logged).not.toContain('sk-smithery');
    expect(logged).not.toContain('LEAK-URL');
  });

  // ── uninstallSmithery ────────────────────────────────────────────────────

  it('uninstallSmithery deletes the connection then removes the record', async () => {
    mockHealthyApi();
    build();
    await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });
    requests.length = 0;

    const res = await call('mcpDirectory:uninstallSmithery', {
      serverKey: 'smithery_hubspot',
    });

    expect(res.data).toEqual({ success: true });
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: 'DELETE',
        url: `https://api.smithery.ai/connect/${NAMESPACE}/hubspot`,
      }),
    );
    expect(readManifest()['smithery_hubspot']).toBeUndefined();
  });

  it('uninstallSmithery still removes the record when the DELETE fails', async () => {
    mockHealthyApi();
    build();
    await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });

    mockApi((url, method) =>
      method === 'DELETE'
        ? { status: 500, body: { error: 'boom', message: 'no' } }
        : { body: { namespaces: [{ name: NAMESPACE }] } },
    );

    const res = await call('mcpDirectory:uninstallSmithery', {
      serverKey: 'smithery_hubspot',
    });

    expect(res.data).toEqual({ success: true });
    expect(readManifest()['smithery_hubspot']).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('uninstallSmithery makes no API call for a legacy record', async () => {
    mockApi((url) =>
      url.endsWith('/namespaces') ? { body: { namespaces: [] } } : undefined,
    );
    build();
    await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });
    requests.length = 0;

    await call('mcpDirectory:uninstallSmithery', {
      serverKey: 'smithery_hubspot',
    });

    expect(requests).toEqual([]);
    expect(readManifest()['smithery_hubspot']).toBeUndefined();
  });

  // ── smitheryAccount ──────────────────────────────────────────────────────

  it('smitheryAccount reports the namespaces and picks the first as active', async () => {
    mockApi((url) =>
      url.endsWith('/namespaces')
        ? { body: { namespaces: [{ name: 'abdallah' }, { name: 'team' }] } }
        : undefined,
    );
    build();

    const res = await call('mcpDirectory:smitheryAccount', {});
    expect(res.data).toEqual({
      configured: true,
      namespaces: ['abdallah', 'team'],
      activeNamespace: 'abdallah',
    });
  });

  it('smitheryAccount reports configured:false without calling the API', async () => {
    authSecrets.hasProviderKey.mockResolvedValue(false);
    mockHealthyApi();
    build();

    const res = await call('mcpDirectory:smitheryAccount', {});
    expect(res.data).toEqual({
      configured: false,
      namespaces: [],
      activeNamespace: null,
    });
    expect(requests).toEqual([]);
  });

  it('smitheryAccount reports the error for a rejected key without alerting Sentry', async () => {
    mockApi(() => ({
      status: 401,
      body: { error: 'unauthorized', message: 'Invalid API key' },
    }));
    build();

    const res = await call('mcpDirectory:smitheryAccount', {});
    const data = res.data as { configured: boolean; error?: string };
    expect(data.configured).toBe(true);
    expect(data.error).toMatch(/Invalid API key/);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  // ── listSmitheryConnections ──────────────────────────────────────────────

  it('listSmitheryConnections marks a connection Ptah installed', async () => {
    mockHealthyApi();
    build();
    await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });

    const res = await call('mcpDirectory:listSmitheryConnections', {});
    expect(res.data).toEqual({
      namespace: NAMESPACE,
      connections: [
        {
          connectionId: 'hubspot',
          name: 'HubSpot',
          server: 'hubspot',
          status: 'connected',
          createdAt: '2026-09-03T10:00:00.000Z',
          managedByPtah: true,
          serverKey: 'smithery_hubspot',
        },
      ],
    });
  });

  it('listSmitheryConnections reports managedByPtah:false for a connection made elsewhere', async () => {
    mockApi((url, method) => {
      if (url.endsWith('/namespaces')) {
        return { body: { namespaces: [{ name: NAMESPACE }] } };
      }
      if (url.endsWith(`/connect/${NAMESPACE}`) && method === 'GET') {
        return {
          body: {
            connections: [
              {
                connectionId: 'made-elsewhere',
                name: 'Made elsewhere',
                metadata: { userId: 'someone' },
                status: { state: 'auth_required', setupUrl: 'https://x/y' },
                serverInfo: { name: 'exa', version: '1' },
              },
            ],
          },
        };
      }
      return undefined;
    });
    build();

    const res = await call('mcpDirectory:listSmitheryConnections', {});
    const data = res.data as {
      connections: Array<Record<string, unknown>>;
    };
    expect(data.connections[0]).toMatchObject({
      connectionId: 'made-elsewhere',
      server: 'exa',
      status: 'auth_required',
      managedByPtah: false,
    });
    expect(data.connections[0]['serverKey']).toBeUndefined();
    // The list never leaks a setup URL — Authorize re-mints one.
    expect(data.connections[0]['setupUrl']).toBeUndefined();
  });

  it('listSmitheryConnections returns an empty list with a null namespace when there is none', async () => {
    mockApi((url) =>
      url.endsWith('/namespaces') ? { body: { namespaces: [] } } : undefined,
    );
    build();

    const res = await call('mcpDirectory:listSmitheryConnections', {});
    expect(res.data).toEqual({ connections: [], namespace: null });
  });

  it('caches the namespace across calls instead of re-fetching it', async () => {
    mockHealthyApi();
    build();

    await call('mcpDirectory:listSmitheryConnections', {});
    await call('mcpDirectory:listSmitheryConnections', {});

    const namespaceCalls = requests.filter((r) =>
      r.url.endsWith('/namespaces'),
    );
    expect(namespaceCalls).toHaveLength(1);
  });

  it('drops the cached namespace when the API key changes', async () => {
    mockHealthyApi();
    build();

    await call('mcpDirectory:listSmitheryConnections', {});
    await call('mcpDirectory:setSmitheryApiKey', { apiKey: 'sk-other' });
    await call('mcpDirectory:listSmitheryConnections', {});

    expect(requests.filter((r) => r.url.endsWith('/namespaces'))).toHaveLength(
      2,
    );
  });

  // ── smitheryConnectionStatus ─────────────────────────────────────────────

  it('smitheryConnectionStatus reports the live state and setupUrl', async () => {
    mockHealthyApi();
    build();
    await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });

    mockHealthyApi({
      status: {
        state: 'auth_required',
        setupUrl: 'https://auth.smithery.ai/setup/fresh',
      },
    });

    const res = await call('mcpDirectory:smitheryConnectionStatus', {
      serverKey: 'smithery_hubspot',
    });
    expect(res.data).toEqual({
      status: 'auth_required',
      setupUrl: 'https://auth.smithery.ai/setup/fresh',
    });
  });

  it('smitheryConnectionStatus reports unknown for an unknown serverKey', async () => {
    mockHealthyApi();
    build();

    const res = await call('mcpDirectory:smitheryConnectionStatus', {
      serverKey: 'smithery_never_installed',
    });
    const data = res.data as { status: string; error?: string };
    expect(data.status).toBe('unknown');
    expect(data.error).toMatch(/No Smithery install record/);
  });

  it('smitheryConnectionStatus tells the user to reinstall a legacy record', async () => {
    mockApi((url) =>
      url.endsWith('/namespaces') ? { body: { namespaces: [] } } : undefined,
    );
    build();
    await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });

    const res = await call('mcpDirectory:smitheryConnectionStatus', {
      serverKey: 'smithery_hubspot',
    });
    const data = res.data as { status: string; error?: string };
    expect(data.status).toBe('unknown');
    expect(data.error).toMatch(/install it again/);
  });

  // ── openSmitherySetup ────────────────────────────────────────────────────

  it('openSmitherySetup re-PUTs for a fresh URL and opens it', async () => {
    mockHealthyApi();
    build();
    await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });

    mockHealthyApi({
      status: {
        state: 'auth_required',
        setupUrl: 'https://auth.smithery.ai/setup/fresh-token',
      },
    });
    requests.length = 0;

    const res = await call('mcpDirectory:openSmitherySetup', {
      serverKey: 'smithery_hubspot',
    });

    expect(res.data).toEqual({
      opened: true,
      setupUrl: 'https://auth.smithery.ai/setup/fresh-token',
    });
    expect(requests.some((r) => r.method === 'PUT')).toBe(true);
    expect(userInteraction.openExternal).toHaveBeenCalledWith(
      'https://auth.smithery.ai/setup/fresh-token',
    );
  });

  it('openSmitherySetup opens nothing when the connection is already connected', async () => {
    mockHealthyApi();
    build();
    await call('mcpDirectory:installSmithery', {
      qualifiedName: 'hubspot',
      config: {},
    });

    const res = await call('mcpDirectory:openSmitherySetup', {
      serverKey: 'smithery_hubspot',
    });

    expect(res.data).toMatchObject({ opened: false });
    expect((res.data as { error?: string }).error).toMatch(/already/i);
    expect(userInteraction.openExternal).not.toHaveBeenCalled();
  });

  it('openSmitherySetup reports the error for an unknown serverKey', async () => {
    mockHealthyApi();
    build();

    const res = await call('mcpDirectory:openSmitherySetup', {
      serverKey: 'nope',
    });
    expect(res.data).toMatchObject({ opened: false });
    expect(userInteraction.openExternal).not.toHaveBeenCalled();
  });

  it('openSmitherySetup rejects an empty serverKey through Zod without a network call', async () => {
    mockHealthyApi();
    build();

    const res = await call('mcpDirectory:openSmitherySetup', { serverKey: '' });
    expect((res.data as { opened: boolean }).opened).toBe(false);
    expect(requests).toEqual([]);
  });

  // ── METHODS tuple (rpc-allowlist.spec.ts pairs with this) ────────────────

  it.each([
    'mcpDirectory:smitheryAccount',
    'mcpDirectory:listSmitheryConnections',
    'mcpDirectory:smitheryConnectionStatus',
    'mcpDirectory:openSmitherySetup',
  ])('declares %s in the METHODS tuple', (method) => {
    expect(McpDirectoryRpcHandlers.METHODS).toContain(method);
  });
});
