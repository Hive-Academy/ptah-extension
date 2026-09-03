/**
 * McpDirectoryRpcHandlers — source-routing + resolveSmithery specs.
 *
 * Drives the real handler with mocked RpcHandler + AuthSecrets + a mocked
 * global fetch, asserting that the `source` discriminator selects the official
 * vs Smithery registry source and that `resolveSmithery` returns an http config
 * (or a graceful error when the key is missing).
 */

import 'reflect-metadata';

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
import { McpDirectoryRpcHandlers } from './mcp-directory-rpc.handlers';

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
