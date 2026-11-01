import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpRegistryEntry } from '@ptah-extension/shared';
import {
  McpRegistryProvider,
  McpRegistryShapeError,
} from './mcp-registry.provider';

interface DetailFixture {
  server: McpRegistryEntry;
  _meta?: Record<string, unknown>;
}

interface ListFixture {
  servers: DetailFixture[];
  metadata: { nextCursor?: string; count?: number };
}

interface NotFoundFixture {
  http_status: number;
  body: unknown;
}

const readFixture = <T>(fileName: string): T =>
  JSON.parse(
    readFileSync(
      join(__dirname, '__fixtures__/mcp-registry', fileName),
      'utf8',
    ),
  ) as T;

const envelope = (
  name = 'io.github.acme/server',
  overrides: Record<string, unknown> = {},
) => ({
  server: {
    name,
    description: 'Test server',
    version: '1.0.0',
    ...overrides,
  },
  _meta: {},
});

const listResponse = (servers: unknown[], nextCursor?: string) => ({
  servers,
  metadata: nextCursor === undefined ? {} : { nextCursor },
});

describe('McpRegistryProvider response shape handling', () => {
  let provider: McpRegistryProvider;
  let originalFetch: typeof globalThis.fetch;

  const mockFetchOnce = (body: unknown) => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    } as unknown as Response);
  };

  beforeEach(() => {
    provider = new McpRegistryProvider();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('parses the recorded list envelope and maps cursor, timestamps, and source', async () => {
    const fixture = readFixture<ListFixture>('list-page.json');
    mockFetchOnce(fixture);

    const result = await provider.listServers();

    expect(result.servers).toHaveLength(5);
    expect(result.servers[0]).toMatchObject({
      name: 'ac.inference.sh/mcp',
      version: '2.0.1',
      source: 'official',
      created_at: '2026-07-27T10:44:51.359634Z',
      updated_at: '2026-07-27T10:44:51.359634Z',
      remotes: [
        { type: 'streamable-http', url: 'https://api.inference.sh/mcp' },
      ],
    });
    expect(result.next_cursor).toBe(fixture.metadata.nextCursor);
  });

  it('uses the encoded versions/latest detail URL and preserves remotes', async () => {
    const fixture = readFixture<DetailFixture>('detail-remote-only.json');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => fixture,
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    const detail = await provider.getServerDetails(
      'academy.apexai/apex-ai-academy',
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://registry.modelcontextprotocol.io/v0.1/servers/academy.apexai%2Fapex-ai-academy/versions/latest',
    );
    expect(detail?.name).toBe('academy.apexai/apex-ai-academy');
    expect(detail?.remotes).toEqual(fixture.server.remotes);
    expect(detail?.source).toBe('official');
  });

  it('preserves package transport and environment variables from the detail fixture', async () => {
    const fixture = readFixture<DetailFixture>('detail-env-vars.json');
    mockFetchOnce(fixture);

    const detail = await provider.getServerDetails('ai.2kw/mcp-server');

    expect(detail?.packages).toEqual(fixture.server.packages);
    expect(detail?.packages?.[0]?.transport).toEqual({ type: 'stdio' });
    expect(detail?.packages?.[0]?.environmentVariables?.[0]).toMatchObject({
      name: 'AI_2KW_API_KEY',
      isRequired: true,
      isSecret: true,
    });
  });

  it('throws a coded shape error when the list envelope is unknown', async () => {
    mockFetchOnce({ items: [] });

    await expect(provider.listServers()).rejects.toMatchObject({
      name: 'McpRegistryShapeError',
      code: 'MCP_REGISTRY_SHAPE_UNKNOWN',
    });
  });

  it('throws a coded shape error when every non-empty list item is invalid', async () => {
    mockFetchOnce(
      listResponse([
        null,
        { server: { name: 'io.github.acme/missing-fields' } },
        envelope('io.github.acme/missing-transport', {
          packages: [{ registryType: 'npm', identifier: 'package' }],
        }),
      ]),
    );

    await expect(provider.listServers()).rejects.toBeInstanceOf(
      McpRegistryShapeError,
    );
  });

  it('throws a coded shape error for invalid JSON', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new SyntaxError('invalid JSON');
      },
    } as unknown as Response);

    await expect(provider.listServers()).rejects.toMatchObject({
      code: 'MCP_REGISTRY_SHAPE_UNKNOWN',
    });
  });

  it('drops a malformed item when another item is valid and logs no wire values', async () => {
    const warn = jest.fn();
    const loggingProvider = new McpRegistryProvider({ warn });
    mockFetchOnce(
      listResponse([
        envelope('io.github.acme/good'),
        envelope('io.github.acme/bad', { description: 42 }),
      ]),
    );

    const result = await loggingProvider.listServers();

    expect(result.servers.map((entry) => entry.name)).toEqual([
      'io.github.acme/good',
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('dropping malformed entry'),
      expect.objectContaining({ name: 'io.github.acme/bad' }),
    );
  });

  it('rejects the legacy flat list shape instead of returning a silent empty list', async () => {
    mockFetchOnce(
      listResponse([
        {
          name: 'io.github.acme/legacy',
          description: 'Legacy entry',
          version: '1.0.0',
        },
      ]),
    );

    await expect(provider.listServers()).rejects.toMatchObject({
      code: 'MCP_REGISTRY_SHAPE_UNKNOWN',
    });
  });

  it('throws a coded shape error for malformed detail data', async () => {
    mockFetchOnce({ server: { name: 'io.github.acme/details' }, _meta: {} });

    await expect(
      provider.getServerDetails('io.github.acme/details'),
    ).rejects.toMatchObject({ code: 'MCP_REGISTRY_SHAPE_UNKNOWN' });
  });

  it('returns null when the detail endpoint returns the recorded 404', async () => {
    const fixture = readFixture<NotFoundFixture>('detail-404.json');
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: fixture.http_status,
      statusText: 'Not Found',
      json: async () => fixture.body,
    } as unknown as Response);

    await expect(
      provider.getServerDetails('does.not/exist'),
    ).resolves.toBeNull();
  });

  it('rethrows a detail request network failure for coded RPC handling', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(
      provider.getServerDetails('io.github.acme/broken'),
    ).rejects.toThrow('network down');
  });

  it('returns an empty list for a valid empty page', async () => {
    mockFetchOnce(listResponse([]));

    const result = await provider.listServers();

    expect(result.servers).toEqual([]);
    expect(result.next_cursor).toBeUndefined();
  });

  it('sends search, latest-version, limit, and cursor parameters', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => listResponse([]),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    await provider.listServers({
      query: 'github',
      limit: 5,
      cursor: 'abc123',
    });

    const url = (fetchMock.mock.calls[0]?.[0] ?? '') as string;
    expect(url).toContain('limit=5');
    expect(url).toContain('search=github');
    expect(url).not.toContain('q=github');
    expect(url).toContain('version=latest');
    expect(url).toContain('cursor=abc123');
  });

  it('keeps one row per server name when the registry repeats a name', async () => {
    mockFetchOnce(
      listResponse([
        envelope('ac.inference.sh/mcp', { description: 'Run AI apps' }),
        envelope('ac.inference.sh/mcp', { description: 'run any model' }),
        envelope('ac.tandem/docs-mcp', { description: 'Docs' }),
      ]),
    );

    const result = await provider.listServers({ query: 'ai' });

    expect(result.servers.map((entry) => entry.name)).toEqual([
      'ac.inference.sh/mcp',
      'ac.tandem/docs-mcp',
    ]);
    expect(result.servers[0]?.description).toBe('Run AI apps');
  });

  it('throws when registry returns a non-OK, non-404 status', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    } as unknown as Response);

    await expect(provider.listServers()).rejects.toThrow(
      /MCP Registry request failed: 500/,
    );
  });

  it('caches popular servers and returns the cached list on a second call', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => listResponse([envelope('io.github.acme/popular')]),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    const first = await provider.getPopular();
    const second = await provider.getPopular();

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    provider.clearCache();
    await provider.getPopular();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
