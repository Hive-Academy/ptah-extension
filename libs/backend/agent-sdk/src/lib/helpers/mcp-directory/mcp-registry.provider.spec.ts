import { McpRegistryProvider } from './mcp-registry.provider';

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

  it('parses the current envelope shape ({ servers: [{ server, _meta }] })', async () => {
    mockFetchOnce({
      servers: [
        {
          server: {
            name: 'io.github.acme/server-a',
            description: 'Server A',
          },
          _meta: { 'io.modelcontextprotocol.registry/official': {} },
        },
        {
          server: {
            name: 'io.github.acme/server-b',
            description: 'Server B',
          },
          _meta: {},
        },
      ],
      metadata: { next_cursor: 'cursor-xyz' },
    });

    const result = await provider.listServers();

    expect(result.servers).toHaveLength(2);
    expect(result.servers[0]?.name).toBe('io.github.acme/server-a');
    expect(result.servers[0]?.description).toBe('Server A');
    expect(result.next_cursor).toBe('cursor-xyz');
  });

  it('still parses the legacy flat shape ({ servers: [{ name, description }] })', async () => {
    mockFetchOnce({
      servers: [{ name: 'io.github.acme/legacy', description: 'Legacy entry' }],
      next_cursor: 'top-level-cursor',
    });

    const result = await provider.listServers();

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('io.github.acme/legacy');
    expect(result.next_cursor).toBe('top-level-cursor');
  });

  it('drops entries that lack a usable name instead of rendering blanks', async () => {
    mockFetchOnce({
      servers: [
        { server: { description: 'no name here' } },
        null,
        { server: { name: '', description: 'empty name' } },
        { server: { name: 'io.github.acme/ok', description: 'ok' } },
      ],
    });

    const result = await provider.listServers();

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('io.github.acme/ok');
  });

  it('unwraps server details from { server: {...} } envelope', async () => {
    mockFetchOnce({
      server: {
        name: 'io.github.acme/details',
        description: 'Details entry',
      },
      _meta: {},
    });

    const detail = await provider.getServerDetails('io.github.acme/details');
    expect(detail?.name).toBe('io.github.acme/details');
  });

  it('returns flat detail body when no { server } wrapper is present', async () => {
    mockFetchOnce({
      name: 'io.github.acme/flat-detail',
      description: 'Flat detail entry',
    });

    const detail = await provider.getServerDetails(
      'io.github.acme/flat-detail',
    );
    expect(detail?.name).toBe('io.github.acme/flat-detail');
  });

  it('returns null when getServerDetails hits 404', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    } as unknown as Response);

    const detail = await provider.getServerDetails('io.github.acme/missing');
    expect(detail).toBeNull();
  });

  it('returns null when getServerDetails throws (e.g. network error)', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('boom'));

    const detail = await provider.getServerDetails('io.github.acme/broken');
    expect(detail).toBeNull();
  });

  it('returns empty list when body has no servers field', async () => {
    mockFetchOnce({});

    const result = await provider.listServers();
    expect(result.servers).toEqual([]);
    expect(result.next_cursor).toBeUndefined();
  });

  it('drops primitive items that are not objects', async () => {
    mockFetchOnce({
      servers: [
        42,
        'not-an-object',
        { server: { name: 'io.github.acme/only-one' } },
      ],
    });

    const result = await provider.listServers();
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('io.github.acme/only-one');
  });

  it('forwards query and cursor as URL params', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ servers: [] }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    await provider.listServers({
      query: 'github',
      limit: 5,
      cursor: 'abc123',
    });

    const url = (fetchMock.mock.calls[0]?.[0] ?? '') as string;
    expect(url).toContain('limit=5');
    expect(url).toContain('q=github');
    expect(url).toContain('cursor=abc123');
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
      json: async () => ({
        servers: [{ server: { name: 'io.github.acme/popular' } }],
      }),
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
