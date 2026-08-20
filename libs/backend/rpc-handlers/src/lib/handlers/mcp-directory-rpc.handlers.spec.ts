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

  const build = () => {
    const handlers = new McpDirectoryRpcHandlers(
      logger as unknown as Logger,
      rpc as never,
      createMockWorkspaceProvider(),
      sentry as unknown as SentryService,
      authSecrets,
      createMockUserInteraction(),
      createMockHttpServerProvider(),
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

  it('routes search to PulseMCP when source=pulsemcp (no key required)', async () => {
    // No provider key configured — PulseMCP must still be reachable.
    authSecrets.getProviderKey.mockResolvedValue(undefined);
    mockFetch((url) => {
      expect(url).toContain('api.pulsemcp.com');
      return {
        servers: [{ name: 'autodesk-mcp', short_description: 'Autodesk MCP' }],
        total_count: 1,
      };
    });
    build();

    const res = await call('mcpDirectory:search', {
      query: 'autodesk',
      source: 'pulsemcp',
    });
    expect(res.success).toBe(true);
    const data = res.data as { servers: { name: string; source?: string }[] };
    expect(data.servers[0].name).toBe('autodesk-mcp');
    expect(data.servers[0].source).toBe('pulsemcp');
  });

  it('routes getPopular to PulseMCP when source=pulsemcp', async () => {
    authSecrets.getProviderKey.mockResolvedValue(undefined);
    mockFetch((url) => {
      expect(url).toContain('api.pulsemcp.com');
      return { servers: [{ name: 'popular-mcp' }], total_count: 1 };
    });
    build();

    const res = await call('mcpDirectory:getPopular', { source: 'pulsemcp' });
    expect(res.success).toBe(true);
    const data = res.data as { servers: { name: string }[] };
    expect(data.servers[0].name).toBe('popular-mcp');
  });
});
